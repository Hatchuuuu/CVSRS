import type { ReactNode } from "react";
import Link from "next/link";
import { requireDeveloper } from "@/lib/server/developer";
export default async function DeveloperClinicLayout({ children, params }: { children: ReactNode; params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { membership } = await requireDeveloper(clinicId);
  return <>
    <div className="mb-6 border-b border-line pb-4">
      <p className="font-bold">Developer Console · {membership.clinicName}</p>
      <nav aria-label="Technical console" className="flex flex-wrap gap-x-5 gap-y-1">
        <Link className="inline-flex min-h-11 items-center" href="/developer">Assigned clinics</Link>
        {[["staff", "Staff"], ["settings", "Clinic settings"], ["operations", "Operations"], ["audit", "Technical audit"]].map(([path, label]) => <Link className="inline-flex min-h-11 items-center" key={path} href={`/developer/${clinicId}/${path}`}>{label}</Link>)}
      </nav>
    </div>
    {children}
  </>;
}
