import { EmptyState, Notice, Section, StatusChip } from "@/components/ui";
import { StaffRowActions, RequestStaffForm } from "@/app/clinic/[clinicId]/access/staff-forms";
import { StaffLocationForm } from "@/app/clinic/[clinicId]/access/staff-location-form";
import { membershipStatusChip } from "@/app/clinic/[clinicId]/access/status";
import { requireDeveloper } from "@/lib/server/developer";
import { staffRoleLabel } from "@/lib/staff-roles";
import { personName } from "@/lib/person-name";
import { formatClinicDate } from "@/lib/format";
import { STAFF_SIGN_UP_PATH } from "@/lib/auth/staff-entry";
import Link from "next/link";

interface Row {
  membershipId: string; profileId: string; displayName: string; role: string; capabilities: string[];
  status: string; version: number; validUntil: string | null; requestedBy: string | null;
  requiresClinicalApproval: boolean; barangay: string | null; cityMunicipality: string | null;
}
export async function StaffMemberships({ clinicId, query = "", status = "" }: { clinicId: string; query?: string; status?: string }) {
  const { rpc, membership, ctx } = await requireDeveloper(clinicId);
  const rows = await rpc.rpc<Row[]>("list_technical_staff_memberships", { p_clinic_id: clinicId });
  if (rows === null) throw new Error("Staff memberships unavailable");
  const caps = new Set(membership.capabilities);
  const now = new Date().getTime();
  const expiring = rows.filter((r) => r.status === "active" && r.validUntil && Date.parse(r.validUntil) > now && Date.parse(r.validUntil) <= now + 7 * 86_400_000 && (["clinical_lead", "tech_admin"].includes(r.role) || r.capabilities.some((c) => ["admin.users", "grant.approve.clinical"].includes(c))));
  const effectiveStatus = (r: Row) => r.status === "active" && r.validUntil && Date.parse(r.validUntil) <= now ? "expired" : r.status;
  const filtered = rows.filter((r) => (!status || effectiveStatus(r) === status) && `${r.displayName} ${staffRoleLabel(r.role)}`.toLowerCase().includes(query.toLowerCase()));
  return <Section id="memberships" title="Staff membership directory" description="Identity creation and clinic access are separate. Each grant needs independent approval.">
    {expiring.length ? <Notice tone="attention" title="Approval-capable access expires within seven days"><ul>{expiring.map((r) => <li key={r.membershipId}>{personName(r.displayName)} · {staffRoleLabel(r.role)} · {formatClinicDate(r.validUntil!, membership.clinicTimezone)}</li>)}</ul><p>Arrange independent approval before expiry. <Link href={`/developer/${clinicId}/operations/runbook`}>Open the access recovery runbook</Link>. Access is never renewed automatically.</p></Notice> : null}
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-1">Search staff<input className="min-h-11 rounded-control border border-line bg-surface px-3" type="search" name="q" defaultValue={query} /></label>
      <label className="grid gap-1">Access status<select className="min-h-11 rounded-control border border-line bg-surface px-3" name="status" defaultValue={status}><option value="">All access records</option><option value="active">Active</option><option value="pending_approval">Waiting for approval</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></label>
      <button className="min-h-11 rounded-control border border-line px-4" type="submit">Filter</button>
    </form>
    {!filtered.length ? <EmptyState title="No matching staff access" /> : <ul className="divide-y divide-line rounded-card border border-line bg-surface">{filtered.map((r) => {
      const needed = r.requiresClinicalApproval ? "grant.approve.clinical" : "admin.users";
      const chip = membershipStatusChip(effectiveStatus(r));
      return <li key={r.membershipId} className="p-4">
        <p className="font-bold">{personName(r.displayName)} · {staffRoleLabel(r.role)}</p>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        <p className="text-sm">{r.validUntil ? `Expires ${formatClinicDate(r.validUntil, membership.clinicTimezone)}` : "No scheduled expiry"}</p>
        <StaffRowActions clinicId={clinicId} row={{ id: r.membershipId, version: r.version, name: r.displayName }} canApprove={r.status === "pending_approval" && caps.has(needed) && r.profileId !== ctx.profileId && r.requestedBy !== ctx.profileId} canRevoke={caps.has(needed) && ["active", "pending_approval", "suspended"].includes(r.status)} />
        {caps.has("admin.users") ? <StaffLocationForm clinicId={clinicId} row={r} /> : null}
      </li>;
    })}</ul>}
    {caps.has("admin.users") ? <details className="mt-5 rounded-control border border-line bg-surface p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Request access for an existing account</summary><RequestStaffForm clinicId={clinicId} staffSignUpUrl={`${process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "") ?? ""}${STAFF_SIGN_UP_PATH}`} /></details> : null}
  </Section>;
}
