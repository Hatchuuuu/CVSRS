import type { ReactNode } from "react";
import { requireClinicStaff } from "@/lib/server/viewer";

/** The shared workspace sidebar owns navigation; clinic access is still checked for every route. */
export default async function ClinicLayout({ children, params }: { children: ReactNode; params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  await requireClinicStaff(clinicId);
  return <div className="min-w-0">{children}</div>;
}
