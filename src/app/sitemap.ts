import type { MetadataRoute } from "next";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

/** The landing page and the legal documents are the only indexable pages, and only on a deployment with a canonical public address. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "");
  if (!origin) return [];
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    ...LEGAL_DOCUMENTS.map((doc) => ({ url: `${origin}${doc.href}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
