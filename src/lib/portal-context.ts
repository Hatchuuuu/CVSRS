import { activeClinicAccess, type MembershipLike } from "@/lib/auth/clinic-access";

export type PortalKind = "parents" | "clinic" | "developer";
export interface PortalContext { kind: PortalKind; clinicId: string | null }

/** Presentation only: pages and commands independently enforce live permissions. */
export function resolvePortalContext(pathname: string, query: URLSearchParams, memberships: readonly MembershipLike[]): PortalContext {
  const clinics = activeClinicAccess(memberships).sort((a, b) => a.clinicId.localeCompare(b.clinicId));
  const technical = clinics.filter(c => c.roles.includes("tech_admin"));
  const clinical = clinics.filter(c => c.roles.some(role => role !== "tech_admin"));
  const route = pathname.match(/^\/(clinic|developer)(?:\/([^/]+))?(?:\/|$)/);
  if (route) {
    const kind = route[1] === "developer" ? "developer" : "clinic";
    const admitted = kind === "developer" ? technical : clinics;
    return { kind, clinicId: admitted.find(c => c.clinicId === route[2])?.clinicId ?? null };
  }
  if (/^\/(children|vaccination-records|appointments|help)(?:\/|$)/.test(pathname)) return { kind: "parents", clinicId: null };
  if (query.getAll("portal").length === 1 && query.getAll("clinic").length <= 1) {
    const kind = query.get("portal");
    if (kind === "parents") return { kind, clinicId: null };
    const clinicId = query.get("clinic");
    if (kind === "developer" && technical.some(c => c.clinicId === clinicId)) return { kind, clinicId };
    if (kind === "clinic" && clinics.some(c => c.clinicId === clinicId)) return { kind, clinicId };
  }
  if (clinical[0]) return { kind: "clinic", clinicId: clinical[0].clinicId };
  if (technical[0]) return { kind: "developer", clinicId: technical[0].clinicId };
  return { kind: "parents", clinicId: null };
}

export function portalHref(path: "/account" | "/messages", context: PortalContext): string {
  const query = new URLSearchParams({ portal: context.kind });
  if (context.clinicId) query.set("clinic", context.clinicId);
  return `${path}?${query}`;
}

export function isPortalPage(pathname: string): boolean {
  return /^\/(children|vaccination-records|appointments|help|messages|account|clinic|developer)(?:\/|$)/.test(pathname);
}
