import { PDFDocument } from "pdf-lib";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCertificatePdf, type CertificateSnapshot } from "../../src/lib/certificates/pdf";
import { AppError } from "../../src/lib/api/errors";
import { deriveKey } from "../../src/lib/certificates/service";

const snap = (n: number, name = "Ana Santos"): CertificateSnapshot => ({
  version: 1,
  certificateNo: "CERT-000001",
  clinic: { name: "Barangay Health Center", address: "Street, Barangay", contact: "0917 000 0000" },
  child: { displayName: name, dob: "2026-01-15", datePrecision: "exact", recordNo: "CV-000001" },
  entries: Array.from({ length: n }, (_, i) => ({
    administeredOn: "2026-03-01",
    datePrecision: "exact",
    product: `Product ${i + 1} with a rather long descriptive name that has to wrap onto a second line`,
    source: i % 2 ? ("recorded_elsewhere" as const) : ("clinic" as const),
    lot: i % 2 ? null : `LOT-${i}`,
    provider: i % 2 ? "Another clinic" : null,
  })),
  issuedBy: "Nurse Example",
  preparedAt: "2026-09-30T00:00:00Z",
});
const URL = "http://localhost:3000/verify/" + "a".repeat(64);

const popplerAvailable = !spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).error;
const bboxAvailable = popplerAvailable && spawnSync("pdftotext", ["-h"], { encoding: "utf8" }).stderr.includes("-bbox");
const fitzAvailable = spawnSync("python", ["-c", "import fitz"], { encoding: "utf8" }).status === 0;
const fontToolsAvailable = spawnSync("python", ["-c", "import fontTools"], { encoding: "utf8" }).status === 0;
const pdfText = (bytes: Buffer, bbox = false) => {
  const dir = mkdtempSync(join(tmpdir(), "cvsrs-cert-pdf-"));
  try {
    const path = join(dir, "certificate.pdf");
    writeFileSync(path, bytes);
    const result = bbox && !bboxAvailable && fitzAvailable
      ? spawnSync("python", ["-c", "import fitz,sys; d=fitz.open(sys.argv[1]); print(''.join('<word xMin=\"%s\" yMin=\"%s\" xMax=\"%s\" yMax=\"%s\"/>' % tuple(w[:4]) for p in d for w in p.get_text('words')))", path], { encoding: "utf8" })
      : spawnSync("pdftotext", [...(bbox ? ["-bbox"] : []), "-enc", "UTF-8", path, "-"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("certificate PDF rendering", () => {
  it.skipIf(!fitzAvailable)("embeds a font that a print renderer can load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cvsrs-cert-render-"));
    try {
      const path = join(dir, "certificate.pdf");
      writeFileSync(path, await renderCertificatePdf(snap(1), URL, null));
      const outlineCheck = fontToolsAvailable ? "; import io; from fontTools.ttLib import TTFont; fonts=[TTFont(io.BytesIO(d.extract_font(f[0])[3])) for p in d for f in p.get_fonts()]; [f['glyf'][g].getCoordinates(f['glyf']) for f in fonts for g in f.getGlyphOrder()]" : "";
      const result = spawnSync("python", ["-c", "import fitz,sys; d=fitz.open(sys.argv[1]); [fitz.Font(fontbuffer=d.extract_font(f[0])[3]) for p in d for f in p.get_fonts()]; [p.get_pixmap() for p in d]" + outlineCheck, path], { encoding: "utf8" });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stderr + result.stdout).not.toMatch(/unknown file format|FT_New_Memory_Face|MuPDF error/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("produces a valid PDF with the frozen content and the verification address", async () => {
    const buf = await renderCertificatePdf(snap(3), URL, "30 September 2026");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("CERT-000001");
  });

  it("spreads long histories over several pages instead of overflowing", async () => {
    const doc = await PDFDocument.load(await renderCertificatePdf(snap(60), URL, null));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  }, 20_000);

  it.skipIf(!popplerAvailable)("keeps a long certificate within the storage limit, titled and with its scope statement", async () => {
    const bytes = await renderCertificatePdf(snap(60), URL, null);
    expect(bytes.toString("base64").length).toBeLessThanOrEqual(2_800_000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toMatch(/^Vaccination certificate /);
    const text = pdfText(bytes);
    expect(text).toContain("This is a clinic-issued record made from the clinic's own verified records.");
    expect(text).not.toMatch(/DEMO|Fictional/);
  }, 20_000);

  it.skipIf(!popplerAvailable)("preserves supported Unicode in actual extracted PDF text", async () => {
    const fixture = snap(1, "Zoë Ñañez 李雷");
    fixture.clinic.name = "Clínica 李雷";
    fixture.issuedBy = "Dr. Mañana 李";
    const text = pdfText(await renderCertificatePdf(fixture, URL, null));
    expect(text).toContain("Zoë Ñañez 李雷");
    expect(text).toContain("Clínica 李雷");
    expect(text).toContain("Dr. Mañana 李");
    expect(text).not.toContain("?");
  });

  it("rejects unsupported glyphs with a field-specific error", async () => {
    await expect(renderCertificatePdf(snap(1, "Zoë 🙂"), URL, null)).rejects.toMatchObject({
      name: "AppError", code: "unprocessable", status: 422,
      fieldErrors: { childName: expect.stringContaining("unsupported") },
    } satisfies Partial<AppError>);
  });

  it.skipIf(!popplerAvailable)("keeps long headings, identities, issuer, and unbroken words inside page margins", async () => {
    const fixture = snap(3, "Verylongname".repeat(18));
    fixture.clinic.name = "Clínica " + "Longclinicname".repeat(15);
    fixture.clinic.address = "Addressword".repeat(28);
    fixture.child.recordNo = "Recordnumber".repeat(18);
    fixture.issuedBy = "Nurse " + "Longissuername".repeat(15);
    fixture.entries[0]!.product = "Longvaccinename".repeat(12);
    fixture.entries[0]!.provider = "Longprovidername".repeat(12);
    fixture.entries[0]!.source = "recorded_elsewhere";
    const bytes = await renderCertificatePdf(fixture, URL, "30 September 2026");
    const strings = pdfText(bytes);
    expect(strings.replace(/\s/g, "")).toContain(fixture.child.displayName);
    expect(strings.replace(/\s/g, "")).toContain(fixture.issuedBy.replace(/\s/g, ""));
    if (!bboxAvailable && !fitzAvailable) return;
    const boxes = [...pdfText(bytes, true).matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)];
    expect(boxes.length).toBeGreaterThan(0);
    for (const match of boxes) {
      const [, xmin, ymin, xmax, ymax] = match;
      expect(Number(xmin)).toBeGreaterThanOrEqual(47.5);
      expect(Number(xmax)).toBeLessThanOrEqual(595.28 - 47.5);
      expect(Number(ymin)).toBeGreaterThanOrEqual(47.5);
      expect(Number(ymax)).toBeLessThanOrEqual(841.89 - 47.5);
    }
  }, 15000);

  it("derives stable, distinct, UUID-shaped follow-up idempotency keys", () => {
    const k = "3b241101-e2bb-4255-8caf-4136c566a962";
    expect(deriveKey(k, "issue")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveKey(k, "issue")).toBe(deriveKey(k, "issue"));
    expect(deriveKey(k, "issue")).not.toBe(deriveKey(k, "store"));
  });
});
