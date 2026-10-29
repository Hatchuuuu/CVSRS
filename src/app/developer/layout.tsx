import type { ReactNode } from "react";
import { requireViewer } from "@/lib/server/viewer";
export default async function DeveloperLayout({ children }: { children: ReactNode }) {
  await requireViewer();
  return <div className="min-w-0">{children}</div>;
}
