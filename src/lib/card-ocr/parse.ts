export interface CardCandidate {
  productText: string;
  doseLabel?: string;
  administeredOn?: string;
  lotText?: string;
  source: "ocr";
  confidence?: number;
  notes?: string;
}

const known = /\b(BCG|PENTA(?:VALENT)?|MMR|MEASLES|HEPATITIS\s*B|HEP\s*B|OPV|IPV|PCV|ROTAVIRUS|COVID(?:-19)?)(?=\b|[0-9])/i;

function validDate(value: string): string | undefined {
  const normalized = value.replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const [year = 0, month = 0, day = 0] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? normalized : undefined;
}

export function parseCardText(text: string): CardCandidate[] {
  const rows: CardCandidate[] = [];
  for (const raw of text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const vaccineMatch = raw.match(known);
    const vaccine = vaccineMatch?.[0];
    if (!vaccine) continue;
    const dateToken = raw.match(/\b(?:\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/)?.[0];
    let administeredOn = dateToken ? validDate(dateToken) : undefined;
    let notes: string | undefined;
    if (dateToken && /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(dateToken)) {
      const [first=0,second=0,year=0]=dateToken.split(/[-/]/).map(Number);
      if (first>12) administeredOn=validDate(`${year}-${String(second).padStart(2,"0")}-${String(first).padStart(2,"0")}`);
      else if (second>12) administeredOn=validDate(`${year}-${String(first).padStart(2,"0")}-${String(second).padStart(2,"0")}`);
      if (!administeredOn) notes=`Check the date on the card: ${dateToken}`;
    }
    const afterVaccine=raw.slice((vaccineMatch?.index ?? 0)+vaccine.length).replace(dateToken ?? "", "");
    const doseLabel = afterVaccine.match(/^\s*(?:\|\s*)?(?:dose\s*)?([0-9])\b/i)?.[1];
    const lotText = raw.match(/\bLOT[-\s:]?([A-Z0-9-]{2,})\b/i)?.[0].replace(/\s|:/g, "-");
    const productText = vaccine.replace(/\s+/g, " ").replace(/^PENTA(?:VALENT)?$/i, "Penta").toUpperCase() === "PENTA" ? "Penta" : vaccine.toUpperCase();
    rows.push({ productText, ...(doseLabel ? { doseLabel } : {}), ...(administeredOn ? { administeredOn } : {}), ...(lotText ? { lotText } : {}), ...(notes ? { notes } : {}), source: "ocr" });
  }
  return rows;
}
