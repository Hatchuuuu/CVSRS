import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type legacyFontkit from "@pdf-lib/fontkit";
import * as fontkit from "fontkit";
import { Readable } from "node:stream";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { AppError } from "../api/errors";

export interface CertificateSnapshot {
  version: number;
  certificateNo: string;
  clinic: { name: string; address: string | null; contact: string | null };
  child: { displayName: string; dob: string | null; datePrecision: string; recordNo: string };
  entries: { administeredOn: string; datePrecision: string; product: string; source: "clinic" | "recorded_elsewhere"; lot: string | null; provider: string | null }[];
  issuedBy: string;
  preparedAt: string;
}

const FONT_FILE = join(process.cwd(), "src/lib/certificates/fonts/NotoSansSC.ttf");
const W = 595.28, H = 841.89, M = 48;
const fmtDate = (iso: string | null, precision = "exact") => {
  if (!iso) return "Not recorded";
  const d = new Date(iso + "T00:00:00Z");
  const text = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return precision === "exact" ? text : `about ${text}`;
};

/** Break a token at glyph boundaries when it is wider than its column. */
function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(line + char, size) <= width) line += char;
      else { if (line) lines.push(line); line = char; }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Renders frozen content; reprints return the stored bytes instead. */
export async function renderCertificatePdf(snapshot: CertificateSnapshot, verifyUrl: string, issuedAtText: string | null): Promise<Buffer> {
  const fontBytes = await readFile(FONT_FILE);
  const sourceFont = fontkit.create(fontBytes) as fontkit.Font;
  const verify = (value: string | null | undefined, field: string): void => {
    for (const char of value ?? "") {
      if (!sourceFont.hasGlyphForCodePoint(char.codePointAt(0)!) && !/\s/u.test(char)) {
        throw new AppError("unprocessable", 422, `${field} contains a character the certificate font cannot display. Edit the source record and try again.`, { [field]: "Contains an unsupported character for PDF printing." });
      }
    }
  };
  verify(snapshot.certificateNo, "certificateNo");
  verify(snapshot.clinic.name, "clinicName");
  verify(snapshot.clinic.address, "clinicAddress");
  verify(snapshot.clinic.contact, "clinicContact");
  verify(snapshot.child.displayName, "childName");
  verify(snapshot.child.recordNo, "recordNo");
  verify(snapshot.issuedBy, "issuedBy");
  verify(verifyUrl, "verifyUrl");
  verify(issuedAtText, "issuedAt");
  snapshot.entries.forEach((e, i) => { verify(e.product, `entries.${i}.product`); verify(e.lot, `entries.${i}.lot`); verify(e.provider, `entries.${i}.provider`); });

  const pdf = await PDFDocument.create();
  // pdf-lib expects the older streaming subset API; current fontkit fixes
  // malformed glyph outlines and exposes the same bytes through encode().
  pdf.registerFontkit({
    create(bytes: Uint8Array) {
      const font = fontkit.create(Buffer.from(bytes)) as fontkit.Font;
      const createSubset = font.createSubset.bind(font);
      font.createSubset = () => {
        const subset = createSubset();
        return Object.assign(subset, { encodeStream: () => Readable.from([subset.encode()]) });
      };
      return font;
    },
  } as unknown as typeof legacyFontkit);
  pdf.setTitle(`Vaccination certificate ${snapshot.certificateNo}`);
  pdf.setProducer("eVacTrack");
  pdf.setCreator("eVacTrack");
  // TrueType outlines remain valid when subset, keeping printable Unicode PDFs
  // within the certificate storage limit. CFF subsets fail in print renderers.
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const qr = await pdf.embedPng(await QRCode.toBuffer(verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 300 }));
  const ink = rgb(0.11, 0.13, 0.16), soft = rgb(0.38, 0.42, 0.46), accent = rgb(0.06, 0.46, 0.43), lineColor = rgb(0.8, 0.82, 0.84);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M - 17;
  const draw = (value: string, x: number, size: number, color = ink) => page.drawText(value, { x, y, size, font, color });
  const rule = () => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: lineColor });
  const nextPage = () => { page = pdf.addPage([W, H]); y = H - M - 17; };
  const room = (height: number) => { if (y - height < M) nextPage(); };
  const block = (value: string, x: number, size: number, width: number, leading: number, color = ink) => {
    for (const segment of wrap(value, font, size, width)) { room(leading); draw(segment, x, size, color); y -= leading; }
  };

  block(snapshot.clinic.name, M, 13, W - 2 * M, 17, accent);
  block([snapshot.clinic.address, snapshot.clinic.contact].filter(Boolean).join(" | "), M, 9.5, W - 2 * M, 12, soft);
  room(57); y -= 14;
  block("Vaccination Certificate", M, 24, W - 2 * M, 28);
  block(`Certificate no. ${snapshot.certificateNo}`, M, 11, W - 2 * M, 15, soft);
  y -= 7; rule(); y -= 21;
  block("Child", M, 9.5, W - 2 * M, 16, soft);
  block(snapshot.child.displayName, M, 16, W - 2 * M, 20);
  block(`Date of birth: ${fmtDate(snapshot.child.dob, snapshot.child.datePrecision)}`, M, 11, W - 2 * M, 15);
  block(`Clinic record no.: ${snapshot.child.recordNo}`, M, 11, W - 2 * M, 15);
  y -= 20;
  block("Vaccinations checked by the clinic", M, 9.5, W - 2 * M, 17, soft);
  const cols = [M, M + 108, M + 300] as const;
  const header = () => { room(33); y -= 12; draw("Date", cols[0], 9.5); draw("Vaccine", cols[1], 9.5); draw("Lot / source", cols[2], 9.5); y -= 6; rule(); };
  header();
  for (const e of snapshot.entries) {
    const vaccine = wrap(e.product, font, 10.5, cols[2] - cols[1] - 10);
    const detailText = e.source === "clinic" ? `Given at this clinic${e.lot ? `, lot ${e.lot}` : ""}` : `Given elsewhere${e.provider ? ` (${e.provider})` : ""}, verified by the clinic`;
    const detail = wrap(detailText, font, 9.5, W - M - cols[2]);
    const date = wrap(fmtDate(e.administeredOn, e.datePrecision), font, 10.5, cols[1] - cols[0] - 8);
    const rows = Math.max(vaccine.length, detail.length, date.length);
    for (let i = 0; i < rows; i++) {
      if (y - 21 < M) { nextPage(); block(`Certificate no. ${snapshot.certificateNo} (continued)`, M, 10, W - 2 * M, 17, soft); header(); }
      y -= 15;
      const dateLine = date[i], vaccineLine = vaccine[i], detailLine = detail[i];
      if (dateLine) draw(dateLine, cols[0], 10.5);
      if (vaccineLine) draw(vaccineLine, cols[1], 10.5);
      if (detailLine) draw(detailLine, cols[2], 9.5, soft);
      y += 2;
    }
    room(9); y -= 8; rule();
  }

  if (y < M + 140) nextPage();
  y -= 26;
  const qrSize = 96;
  page.drawImage(qr, { x: W - M - qrSize, y: y - qrSize + 12, width: qrSize, height: qrSize });
  const leftWidth = W - 2 * M - qrSize - 18;
  block(`Issued by ${snapshot.issuedBy}`, M, 10.5, leftWidth, 15);
  block(`Issued on ${issuedAtText ?? "the date shown when verified"}`, M, 10.5, leftWidth, 15);
  y -= 7;
  block("To check that this certificate is genuine and still valid, scan the code or open the address below. The check shows only whether this certificate is valid.", M, 9.5, leftWidth, 12, soft);
  block(verifyUrl, M, 8.5, leftWidth, 11, soft);
  y -= 7;
  block("This is a clinic-issued record made from the clinic's own verified records. Whether another institution accepts it is decided by that institution. It is not a substitute for medical advice.", M, 8.5, W - 2 * M, 11, soft);
  return Buffer.from(await pdf.save());
}
