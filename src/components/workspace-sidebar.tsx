"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/mobile-nav";
import { StaffNav } from "@/app/clinic/[clinicId]/staff-nav";
import { clinicNavItems } from "@/lib/auth/clinic-navigation";
import { staffRoleLabel } from "@/lib/staff-roles";

interface Clinic { clinicId: string; clinicName: string; roles: string[]; capabilities: string[] }

export function WorkspaceSidebar({ clinics, unread, children }: { clinics: Clinic[]; unread: number | null; children: ReactNode }) {
  const path = usePathname();
  const clinic = clinics.find(item => path === `/clinic/${item.clinicId}` || path.startsWith(`/clinic/${item.clinicId}/`)) ?? clinics[0];
  const contents = <>
    <div className="mb-5 border-b border-line pb-4">
      <p className="font-bold leading-snug text-ink">{clinic?.clinicName ?? "Family portal"}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{clinic ? clinic.roles.map(staffRoleLabel).join(" · ") : "Your children’s vaccination records"}</p>
      {clinics.length > 1 ? <Link href="/clinic" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold">Switch clinic</Link> : null}
    </div>
    {clinic ? <div className="mb-4 border-b border-line pb-4"><StaffNav items={clinicNavItems(clinic.clinicId, clinic.capabilities)} embedded /></div> : null}
    {children}
  </>;
  return (
    <div data-workspace-navigation className="relative z-30 mb-5 lg:z-auto lg:mb-0">
      <MobileNav sidebar unread={unread}>{contents}</MobileNav>
      <aside aria-label="Workspace sidebar" className="hidden lg:block">
        <nav aria-label="Main navigation" className="sticky top-[calc(var(--header-h)+1.5rem)] max-h-[calc(100dvh-var(--header-h)-3rem)] overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-4">
          {contents}
        </nav>
      </aside>
    </div>
  );
}
