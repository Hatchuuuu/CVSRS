import type { ReactNode } from "react";
import { requireViewer } from "@/lib/server/viewer";

// Guardians mostly use phones: one comfortable column with a readable measure.
// Signing in is checked here, above the loading boundary, so a signed-out visit answers with a real redirect (307) instead of a
// streamed page that redirects in the browser (audit F10). The viewer read is cached per request, so the pages reuse it.
export default async function GuardianLayout({ children }: { children: ReactNode }) {
  await requireViewer();
  return <div className="mx-auto w-full max-w-3xl">{children}</div>;
}
