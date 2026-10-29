"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ClipboardList, HelpCircle, MessageSquare, Settings, Users } from "lucide-react";
import { activeClinicAccess, type MembershipLike } from "@/lib/auth/clinic-access";
import { clinicLandingRoute } from "@/lib/auth/destination";
import { portalHref, resolvePortalContext } from "@/lib/portal-context";
import { WorkspaceNavLink } from "@/components/workspace-nav-link";

export function usePortalContext(memberships: readonly MembershipLike[]) {
  const path = usePathname();
  const query = useSearchParams();
  return resolvePortalContext(path, new URLSearchParams(query.toString()), memberships);
}

export function PortalNavigation({ memberships, unread }: { memberships: readonly MembershipLike[]; unread: number | null }) {
  const context = usePortalContext(memberships);
  const clinics = activeClinicAccess(memberships);
  const technical = clinics.filter(c => c.roles.includes("tech_admin"));
  const clinical = clinics.filter(c => c.roles.some(role => role !== "tech_admin"));
  const firstClinical = clinical[0];
  const firstTechnical = technical[0];
  const links = context.kind === "parents" ? [
    { href: "/children", label: "My Children", Icon: Users },
    { href: "/vaccination-records", label: "Vaccination records", Icon: ClipboardList },
    { href: "/appointments", label: "Appointments", Icon: CalendarDays },
    { href: "/help", label: "Care Info", Icon: HelpCircle },
  ] : context.kind === "developer" && context.clinicId ? [
    { href: `/developer/${context.clinicId}/staff`, label: "Staff accounts", Icon: Users },
    { href: `/developer/${context.clinicId}/settings`, label: "Clinic settings", Icon: Settings },
    { href: `/developer/${context.clinicId}/operations`, label: "Operations", Icon: ClipboardList },
    { href: `/developer/${context.clinicId}/audit`, label: "Technical audit", Icon: ClipboardList },
  ] : [];
  const shared = [
    { href: portalHref("/messages", context), label: "Messages", Icon: MessageSquare },
    { href: portalHref("/account", context), label: "Settings / Account", Icon: Settings },
  ];
  return <>
    <ul className="grid gap-1">
      {[...links, ...shared].map(({ href, label, Icon }) => <li key={href}>
        <WorkspaceNavLink href={href} label={label === "Messages" ? unread === null ? "Messages, unread count unavailable" : unread > 0 ? `Messages, ${unread} unread` : undefined : undefined}>
          <Icon aria-hidden className="size-4 shrink-0" /><span>{label}</span>
          {label === "Messages" && unread !== null && unread > 0 ? <span aria-hidden className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">{unread > 99 ? "99+" : unread}</span> : null}
        </WorkspaceNavLink>
      </li>)}
    </ul>
    {clinics.length > 0 ? <div className="mt-6 border-t border-line pt-4">
      <p className="mb-2 px-4 text-sm font-semibold text-ink-soft">Your workspaces</p>
      <ul className="grid gap-1 text-sm">
        {context.kind !== "parents" ? <li><Link href="/children" className="flex min-h-11 items-center rounded-control px-4 font-semibold no-underline hover:bg-sunken">Parents Portal</Link></li> : null}
        {context.kind !== "clinic" && firstClinical ? <li><Link href={clinical.length === 1 ? clinicLandingRoute(firstClinical.clinicId, firstClinical.capabilities) : "/clinic"} className="flex min-h-11 items-center rounded-control px-4 font-semibold no-underline hover:bg-sunken">Clinics Portal</Link></li> : null}
        {context.kind !== "developer" && firstTechnical ? <li><Link href={technical.length === 1 ? `/developer/${firstTechnical.clinicId}` : "/developer"} className="flex min-h-11 items-center rounded-control px-4 font-semibold no-underline hover:bg-sunken">Developer Console</Link></li> : null}
      </ul>
    </div> : null}
  </>;
}
