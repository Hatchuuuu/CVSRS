import type { NextConfig } from "next";

// Static security headers for every response. The Content-Security-Policy is per request (nonce) and is set in src/proxy.ts.
// Application pages and API responses are never cached by browsers or shared caches: they contain children's records (BP32/BP33).
const CERTIFICATE_FONT = ["./src/lib/certificates/fonts/NotoSansSC.ttf", "./src/lib/certificates/fonts/NotoSansSC-LICENSE.txt"];

const config: NextConfig = {
  // The end-to-end runner (scripts/e2e.ts) uses its own build folder, so it can run beside `npm run dev` (one `next dev` per folder).
  distDir: process.env.CVSRS_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Only the two routes that render certificate PDFs need the font (read from disk by src/lib/certificates/pdf.ts).
  outputFileTracingIncludes: {
    "/api/v1/clinics/\\[clinicId\\]/children/\\[childId\\]/certificates": CERTIFICATE_FONT,
    "/api/v1/clinics/\\[clinicId\\]/certificates/\\[certificateId\\]/retry": CERTIFICATE_FONT,
  },
  async headers() {
    return [
      {
        source: "/ocr/:file*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // same-origin (not no-referrer): no-referrer makes browsers send "Origin: null" on form posts, which breaks CSRF checks.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        // everything except immutable build assets and the public brand files below
        source: "/((?!_next/static|_next/image|favicon.ico|fonts/|images/).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        // Public fonts and marketing photographs hold no personal data; let browsers reuse them for a week.
        source: "/:dir(fonts|images)/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default config;
