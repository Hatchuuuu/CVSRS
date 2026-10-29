import "server-only";
import { notFound } from "next/navigation";
import { clinicAccessFor } from "@/lib/auth/clinic-access";
import { requireClinicStaff } from "@/lib/server/viewer";

export async function requireDeveloper(clinicId: string) {
  const viewer = await requireClinicStaff(clinicId);
  if (!clinicAccessFor(viewer.ctx.memberships, clinicId)?.roles.includes("tech_admin")) notFound();
  return viewer;
}
