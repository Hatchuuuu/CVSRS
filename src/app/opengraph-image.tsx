import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_E, MARK_STROKE, MARK_V, WORD_EVAC, WORD_TRACK } from "@/components/brand";

export const alt = "eVacTrack: children's vaccination records for families and community health centers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fontFile = (weight: number) =>
  readFile(join(process.cwd(), `node_modules/@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-${weight}-normal.woff`));

type Dose = "given" | "due" | "none";
const ROWS: [string, Dose, Dose, Dose][] = [
  ["BCG", "given", "none", "none"],
  ["Pentavalent", "given", "given", "given"],
  ["Oral polio", "given", "given", "given"],
  ["MMR", "due", "none", "none"],
];

function DoseMark({ dose }: { dose: Dose }) {
  if (dose === "none") return <div style={{ width: 14, height: 2, background: "#c6d1e6" }} />;
  if (dose === "due")
    return (
      <div style={{ display: "flex", padding: "3px 12px", borderRadius: 999, border: "2px solid #f2a33a", background: "#fff4e2", color: "#8a4300", fontSize: 18, fontWeight: 800 }}>
        Due
      </div>
    );
  return (
    <svg width="30" height="30" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="10" fill="#0648ef" />
      <path d="m5.8 10.3 2.8 2.7 5.6-5.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Social card: brand, headline and a sample record (every value fictional, labelled "Sample"). */
export default async function OpenGraphImage() {
  const [regular, extraBold] = await Promise.all([fontFile(400), fontFile(800)]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", fontFamily: "Atkinson" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 660, padding: "64px 48px 64px 72px", background: "#0648ef" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="56" height="56" viewBox="0 0 40 40">
              <rect width="40" height="40" rx="10" fill="#ffffff" />
              <path d={MARK_E} fill="none" stroke="#0648ef" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
              <path d={MARK_V} fill="none" stroke="#5f9bff" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg width="229" height="35" viewBox="0 -71 478 73">
              <path d={WORD_EVAC} fill="#ffffff" />
              <path d={WORD_TRACK} fill="#b8ccff" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* Line breaks are set by hand so each sentence splits where it reads naturally. */}
            {[
              ["Every vaccine", "#ffffff"],
              ["on record.", "#ffffff"],
              ["Every due date", "#b8ccff"],
              ["in view.", "#b8ccff"],
            ].map(([line, color]) => (
              <div key={line} style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.06, letterSpacing: -1.8, color }}>
                {line}
              </div>
            ))}
            <div style={{ marginTop: 28, fontSize: 28, lineHeight: 1.4, color: "#e3eaff", maxWidth: 520 }}>
              The family portal for your community health center.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", background: "#f3f6fe" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 440, padding: 22, borderRadius: 24, background: "#ffffff", border: "1px solid #e1e7f3", boxShadow: "0 30px 60px -24px rgba(11,26,58,0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 999, background: "#e5ecfd", color: "#0a2f9e", fontSize: 20, fontWeight: 800 }}>MS</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0b1a3a" }}>Mika Santos</div>
                <div style={{ fontSize: 17, color: "#56627f" }}>Immunization record</div>
              </div>
              <div style={{ display: "flex", marginLeft: "auto", padding: "4px 12px", borderRadius: 999, border: "1px dashed #c6d1e6", color: "#56627f", fontSize: 15, fontWeight: 800 }}>Sample</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", border: "1px solid #e1e7f3", borderRadius: 16 }}>
              {ROWS.map(([name, ...doses], i) => (
                <div key={name} style={{ display: "flex", alignItems: "center", height: 58, borderTop: i === 0 ? "none" : "1px solid #e1e7f3", padding: "0 6px 0 18px" }}>
                  <div style={{ flex: 1, fontSize: 20, fontWeight: 800, color: "#0b1a3a" }}>{name}</div>
                  {doses.map((dose, j) => (
                    <div key={j} style={{ display: "flex", width: 72, justifyContent: "center" }}>
                      <DoseMark dose={dose} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Atkinson", data: regular, weight: 400, style: "normal" },
        { name: "Atkinson", data: extraBold, weight: 800, style: "normal" },
      ],
    },
  );
}
