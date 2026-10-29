"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/mobile-nav";
import { StaffNav } from "@/app/clinic/[clinicId]/staff-nav";
import { clinicNavItems } from "@/lib/auth/clinic-navigation";
import { staffRoleLabel } from "@/lib/staff-roles";
import type { MembershipLike } from "@/lib/auth/clinic-access";
import { isPortalPage } from "@/lib/portal-context";
import { PortalNavigation, usePortalContext } from "@/components/portal-navigation";

interface Clinic { clinicId: string; clinicName: string; roles: string[]; capabilities: string[] }

export function WorkspaceSidebar({ clinics, memberships = [], unread, children }: { clinics: Clinic[]; memberships?: MembershipLike[]; unread: number | null; children: ReactNode }) {
  const path = usePathname();
  const context = usePortalContext(memberships);
  const portal = isPortalPage(path);
  const clinic = portal ? clinics.find(item => item.clinicId === context.clinicId) : clinics.find(item => path === `/clinic/${item.clinicId}` || path.startsWith(`/clinic/${item.clinicId}/`)) ?? clinics[0];
  const staffItems = clinic ? clinicNavItems(clinic.clinicId, clinic.capabilities, clinic.roles).filter(item => !portal || !item.href.startsWith("/developer/")) : [];
  const contents = <>
    <div className="mb-5 border-b border-line pb-4">
      <p className="font-bold leading-snug text-ink">{portal ? context.kind === "parents" ? "Parents Portal" : context.kind === "developer" ? "Developer Console" : "Clinics Portal" : clinic?.clinicName ?? "Family portal"}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{portal ? clinic?.clinicName ?? (context.kind === "parents" ? "Your children’s vaccination records" : "Choose a clinic to get started") : clinic ? clinic.roles.map(staffRoleLabel).join(" · ") : "Your children’s vaccination records"}</p>
      {clinic && portal ? <p className="mt-2 text-xs leading-relaxed text-ink-soft">{clinic.roles.map(staffRoleLabel).join(" · ")}</p> : null}
      {clinics.length > 1 && (!portal || context.kind !== "parents") ? <Link href={portal && context.kind === "developer" ? "/developer" : "/clinic"} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold">Switch clinic</Link> : null}
    </div>
    {staffItems.length > 0 && (!portal || context.kind === "clinic") ? <div className="mb-4 border-b border-line pb-4"><StaffNav items={staffItems} embedded /></div> : null}
    {portal ? <PortalNavigation memberships={memberships} unread={unread} /> : children}
  </>;
  return (
    <div data-workspace-navigation className="relative z-30 mb-5 lg:z-auto lg:mb-0">
      <MobileNav sidebar unread={unread}>{contents}</MobileNav>
      <aside aria-label="Workspace sidebar" className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] flex-col border-r border-line bg-surface lg:flex">
        <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">{contents}</nav>
      </aside>
    </div>
  );
}
