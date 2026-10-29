import { notFound } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { ProfileForm, type Profile } from "@/app/clinic/[clinicId]/settings/forms";
import { requireDeveloper } from "@/lib/server/developer";
export const metadata = { title: "Clinic settings · Developer Console" };
export default async function Settings({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireDeveloper(clinicId);
  if (!membership.capabilities.includes("admin.config")) notFound();
  const profile = await rpc.rpc<Profile>("get_clinic_profile", { p_clinic_id: clinicId });
  if (!profile) throw new Error("Clinic profile unavailable");
  return <><PageTitle title="Clinic settings" lead={`Public contact information and clinic time zone for ${membership.clinicName}.`} /><ProfileForm clinicId={clinicId} profile={profile} /></>;
}
