import { requireDeveloper } from "@/lib/server/developer";
import { StaffConsole } from "@/components/technical/staff-console";
import { StaffMemberships } from "@/components/technical/staff-memberships";
export const metadata = { title: "Staff · Developer Console" };
export default async function Staff({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<{ q?: string; status?: string }> }) {
  const { clinicId } = await params;
  await requireDeveloper(clinicId);
  const { q, status } = await searchParams;
  return <><StaffConsole clinicId={clinicId} developer /><StaffMemberships clinicId={clinicId} query={q} status={status} /></>;
}
