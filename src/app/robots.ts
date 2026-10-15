import type { MetadataRoute } from "next";

/**
 * Only the public landing page and the legal documents (/terms, /privacy, /accessibility) are meant for search engines; signed-in
 * areas, queue screens and certificate checks are not.
 * The unlisted staff sign-in is deliberately absent: naming it here would publish it. Its pages carry a noindex meta tag instead.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/$",
      disallow: ["/account", "/api", "/auth", "/children", "/clinic", "/dev", "/display", "/help", "/messages", "/sign-in", "/sign-up", "/verify"],
    },
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  };
}
