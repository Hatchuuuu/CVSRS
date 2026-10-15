import { canonicalPublicUrl } from "@/lib/env";

/**
 * CSRF defence for cookie-authenticated mutations (BP32): accept only same-origin requests.
 * The server request URL must be the origin supplied by a trusted ingress; forwarded headers are not trusted here.
 * In production the URL must also match CVSRS_PUBLIC_URL. The ingress must replace Host and forwarded headers.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  let expected: string;
  try {
    const serverUrl = new URL(req.url);
    expected = serverUrl.origin;
    // Next's dev server may reconstruct a 127.0.0.1 request as localhost. Accept
    // the actual Host only for a loopback-to-loopback alias on this same port.
    // Deployment origins and forwarded headers never use this exception.
    if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname)) {
      const host = req.headers.get("host");
      if (host) {
        const local = new URL(`${serverUrl.protocol}//${host}`);
        if (["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) && local.port === serverUrl.port && !local.username && !local.password && local.pathname === "/" && !local.search && !local.hash) expected = local.origin;
      }
    }
    if (process.env.NODE_ENV === "production") {
      if (canonicalPublicUrl(process.env.CVSRS_PUBLIC_URL) !== expected) return false;
    }
  } catch {
    return false;
  }
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      return parsed.origin === expected && parsed.href === `${expected}/`;
    } catch { return false; }
  }
  // In production, require Origin header to prevent proxy-stripping bypasses.
  // sec-fetch-site fallback is only permitted in development and test environments.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}
