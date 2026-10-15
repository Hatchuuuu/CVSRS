import type { SVGProps } from "react";

/**
 * eVacTrack brand. The mark is an "eV" monogram whose V is a check: a record the clinic has confirmed. The wordmark is
 * Atkinson Hyperlegible Next ExtraBold converted to outlines, so it renders identically on every page without
 * loading a web font. `inverse` is for dark surfaces (the footer).
 */
export const WORD_EVAC = "M30.5 1.2Q22.4 1.2 16.1 -1.9Q9.9 -5 6.3 -10.9Q2.8 -16.8 2.8 -25.2Q2.8 -33.1 6.5 -38.9Q10.2 -44.7 16.4 -47.9Q22.5 -51.1 29.8 -51.1Q36 -51.1 41 -48.9Q45.9 -46.7 49.4 -42.6Q52.8 -38.6 54.5 -33Q56.1 -27.4 55.6 -20.5L18.8 -20.5Q19.4 -18.2 20.4 -16.5Q21.5 -14.8 22.9 -13.7Q24.4 -12.5 26.2 -11.9Q28 -11.4 30 -11.4Q33.4 -11.4 35.9 -12.3Q38.4 -13.3 39.7 -14.9L52.6 -10.1Q48.5 -4.2 42.5 -1.5Q36.4 1.2 30.5 1.2ZM18.7 -30.1L40.6 -30.1Q40.3 -33.2 38.9 -35.1Q37.5 -37.1 35.3 -38Q33 -39 30.3 -39Q27.6 -39 25.2 -38.1Q22.8 -37.2 21.1 -35.3Q19.4 -33.3 18.7 -30.1ZM75.6 0L53.1 -66.8L70.6 -66.8L85.4 -19L100.3 -66.8L118 -66.8L95.3 0ZM131.5 1.2Q126.4 1.2 122.4 -0.6Q118.4 -2.4 116.2 -5.7Q113.9 -9 113.9 -13.4Q113.9 -19.4 118 -23.1Q122 -26.9 129.4 -28.9Q136.9 -30.9 147.1 -31.4L147.1 -32.8Q147.1 -36.8 144.9 -38.4Q142.7 -40 138.9 -40Q136.1 -40 133.8 -38.5Q131.5 -37.1 130.7 -34.6L116.7 -39.4Q119.2 -44.3 125.1 -47.7Q131 -51.1 139.8 -51.1Q150.8 -51.1 156.9 -46.4Q163 -41.6 163 -31.2L163 -18.5Q163 -15 163.2 -11.4Q163.4 -7.9 163.8 -4.9Q164.2 -1.9 164.7 0L149.2 0L147.5 -5.9Q144.8 -1.8 140.7 -0.3Q136.5 1.2 131.5 1.2ZM137.3 -9.9Q140.3 -9.9 142.5 -10.8Q144.7 -11.7 145.9 -14Q147.1 -16.3 147.1 -20.4L147.1 -21.7Q138.1 -21.2 134.7 -19.4Q131.2 -17.5 131.2 -14.8Q131.2 -12.6 132.9 -11.3Q134.7 -9.9 137.3 -9.9ZM194.8 1.2Q186.4 1.2 180.7 -2.1Q174.9 -5.4 171.9 -11.3Q169 -17.3 169 -25.2Q169 -33.1 172.3 -38.9Q175.5 -44.7 181.3 -47.9Q187 -51.1 194.6 -51.1Q198.8 -51.1 203.2 -50Q207.6 -48.8 211.4 -46Q215.3 -43.1 217.7 -37.8L204.1 -32.8Q203 -36 200.7 -37.3Q198.4 -38.5 195.8 -38.5Q193.3 -38.5 190.9 -37.3Q188.6 -36 187.2 -33.1Q185.7 -30.2 185.7 -25.1Q185.7 -19.9 187.2 -16.9Q188.7 -13.9 191 -12.7Q193.3 -11.4 195.8 -11.4Q198.8 -11.4 200.8 -12.6Q202.9 -13.7 204.2 -15.8L217.4 -11Q214.8 -6.2 210.9 -3.5Q207.1 -0.9 202.9 0.1Q198.7 1.2 194.8 1.2Z";
export const WORD_TRACK = "M240.2 0L240.2 -51.8L218.9 -51.8L218.9 -66.8L278.5 -66.8L278.5 -51.8L257.2 -51.8L257.2 0ZM278.6 0L278.6 -49.6L291.7 -49.6L294.4 -40.5Q295.8 -44.7 298.5 -47.1Q301.2 -49.5 304.7 -50.5Q308.2 -51.4 311.9 -51.1L311.9 -34.7Q307.1 -35.5 303.3 -34.6Q299.5 -33.8 297.3 -31.1Q295.1 -28.3 295.1 -23.3L295.1 0ZM331.6 1.2Q326.5 1.2 322.5 -0.6Q318.5 -2.4 316.3 -5.7Q314 -9 314 -13.4Q314 -19.4 318.1 -23.1Q322.1 -26.9 329.6 -28.9Q337 -30.9 347.2 -31.4L347.2 -32.8Q347.2 -36.8 345 -38.4Q342.8 -40 339 -40Q336.2 -40 333.9 -38.5Q331.6 -37.1 330.8 -34.6L316.8 -39.4Q319.3 -44.3 325.2 -47.7Q331.1 -51.1 339.9 -51.1Q350.9 -51.1 357 -46.4Q363.1 -41.6 363.1 -31.2L363.1 -18.5Q363.1 -15 363.3 -11.4Q363.5 -7.9 363.9 -4.9Q364.3 -1.9 364.8 0L349.3 0L347.6 -5.9Q344.9 -1.8 340.8 -0.3Q336.6 1.2 331.6 1.2ZM337.4 -9.9Q340.4 -9.9 342.6 -10.8Q344.8 -11.7 346 -14Q347.2 -16.3 347.2 -20.4L347.2 -21.7Q338.2 -21.2 334.8 -19.4Q331.3 -17.5 331.3 -14.8Q331.3 -12.6 333.1 -11.3Q334.8 -9.9 337.4 -9.9ZM394.9 1.2Q386.5 1.2 380.8 -2.1Q375 -5.4 372.1 -11.3Q369.1 -17.3 369.1 -25.2Q369.1 -33.1 372.4 -38.9Q375.6 -44.7 381.4 -47.9Q387.1 -51.1 394.7 -51.1Q398.9 -51.1 403.3 -50Q407.7 -48.8 411.6 -46Q415.4 -43.1 417.8 -37.8L404.2 -32.8Q403.1 -36 400.8 -37.3Q398.5 -38.5 395.9 -38.5Q393.4 -38.5 391.1 -37.3Q388.7 -36 387.3 -33.1Q385.8 -30.2 385.8 -25.1Q385.8 -19.9 387.3 -16.9Q388.8 -13.9 391.1 -12.7Q393.4 -11.4 395.9 -11.4Q398.9 -11.4 400.9 -12.6Q403 -13.7 404.3 -15.8L417.5 -11Q414.9 -6.2 411.1 -3.5Q407.2 -0.9 403 0.1Q398.8 1.2 394.9 1.2ZM424.5 0L424.5 -70.8L441 -70.8L441 -31.5L457 -49.6L476.5 -49.6L457 -28.7L477.8 0L458.3 0L446.1 -17.1L441 -11.7L441 0Z";

/** Mark geometry on a 40-unit tile (stroked at MARK_STROKE), shared with the favicon, home-screen icon and social card. */
export const MARK_E = "M8.84 20.39h11.55A5.78 5.78 0 1 0 18.92 24.31";
export const MARK_V = "m20.39 20.39 4.31 5.85 6.85-12.78";
export const MARK_STROKE = 3.5;

export function BrandMark({ inverse = false, ...props }: SVGProps<SVGSVGElement> & { inverse?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden focusable="false" {...props}>
      <rect width="40" height="40" rx="10" fill={inverse ? "#ffffff" : "#0648ef"} />
      <g fill="none" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round">
        <path d={MARK_E} stroke={inverse ? "#0648ef" : "#ffffff"} />
        <path d={MARK_V} stroke={inverse ? "#5f9bff" : "#a9c8ff"} />
      </g>
    </svg>
  );
}

export function BrandWordmark({ inverse = false, ...props }: SVGProps<SVGSVGElement> & { inverse?: boolean }) {
  return (
    <svg viewBox="0 -71 478 73" aria-hidden focusable="false" {...props}>
      <path d={WORD_EVAC} fill={inverse ? "#ffffff" : "#0b1a3a"} />
      <path d={WORD_TRACK} fill={inverse ? "#a9c1ff" : "#0648ef"} />
    </svg>
  );
}

/** Mark plus wordmark. Height follows the font size of the parent (1em = mark height). */
export function BrandLogo({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.32em] ${className ?? ""}`}>
      <BrandMark inverse={inverse} className="h-[1em] w-[1em] shrink-0" />
      <BrandWordmark inverse={inverse} className="h-[0.62em] w-auto" />
      <span className="sr-only">eVacTrack</span>
    </span>
  );
}
