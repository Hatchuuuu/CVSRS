import type { CSSProperties } from "react";

/**
 * Illustration for the landing hero: a sample immunization record laid out like the paper Immunization Card's ruled
 * grid. Every value is fictional and the card says so; it is one image to assistive technology.
 */
type Dose = "given" | "due" | "none";

const ROWS: { vaccine: string; doses: [Dose, Dose, Dose] }[] = [
  { vaccine: "BCG", doses: ["given", "none", "none"] },
  { vaccine: "Hepatitis B", doses: ["given", "none", "none"] },
  { vaccine: "Pentavalent", doses: ["given", "given", "given"] },
  { vaccine: "Oral polio", doses: ["given", "given", "given"] },
  { vaccine: "Pneumococcal", doses: ["given", "given", "given"] },
  { vaccine: "MMR", doses: ["due", "none", "none"] },
];

function Mark({ dose, index }: { dose: Dose; index: number }) {
  if (dose === "none") return <span className="lp-dose lp-dose--none" />;
  if (dose === "due") return <span className="lp-dose lp-dose--due" style={{ "--i": index } as CSSProperties}>Due</span>;
  return (
    <span className="lp-dose lp-dose--given" style={{ "--i": index } as CSSProperties}>
      <svg viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="10" />
        <path d="m5.8 10.3 2.8 2.7 5.6-5.8" />
      </svg>
    </span>
  );
}

export function HeroRecord() {
  let order = 0;
  return (
    <figure
      className="lp-record"
      role="img"
      aria-label="Sample immunization record, for illustration: doses given for BCG, hepatitis B, pentavalent, oral polio and pneumococcal vaccines, and the first MMR dose due next."
    >
      <div aria-hidden className="lp-record-inner">
        <div className="lp-record-head">
          <span className="lp-record-avatar">MS</span>
          <span className="lp-record-who">
            <strong>Mika Santos</strong>
            <span>9 months old</span>
          </span>
          <span className="lp-record-sample">Sample</span>
        </div>
        <div className="lp-record-grid">
          <div className="lp-record-row lp-record-row--head">
            <span>Vaccine</span>
            <span>Dose 1</span>
            <span>Dose 2</span>
            <span>Dose 3</span>
          </div>
          {ROWS.map((row) => (
            <div key={row.vaccine} className="lp-record-row">
              <span className="lp-record-vaccine">{row.vaccine}</span>
              {row.doses.map((dose, i) => (
                <Mark key={i} dose={dose} index={dose === "none" ? 0 : order++} />
              ))}
            </div>
          ))}
        </div>
        <div className="lp-record-next">
          <span>
            <strong>Next due</strong> MMR, dose 1
          </span>
          <span className="lp-record-when">at 9 months</span>
        </div>
      </div>
    </figure>
  );
}
