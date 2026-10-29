import { redirect } from "next/navigation";
import { requireDeveloper } from "@/lib/server/developer";
export default async function DeveloperClinic({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  await requireDeveloper(clinicId);
  redirect(`/developer/${clinicId}/staff`);
}
