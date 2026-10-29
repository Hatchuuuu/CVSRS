import { personName } from "@/lib/person-name";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageTitle, StatusChip } from "@/components/ui";
import { requireClinicStaff } from "@/lib/server/viewer";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { RequestStaffForm, StaffRowActions } from "./staff-forms";
import { membershipStatusChip } from "./status";
import { staffRoleLabel } from "@/lib/staff-roles";
import { STAFF_SIGN_UP_PATH } from "@/lib/auth/staff-entry";
import { StaffLocationForm } from "./staff-location-form";

export const metadata: Metadata = { title: "Staff access" };

interface Row {
  membershipId: string;
  profileId: string;
  displayName: string;
  role: string;
  capabilities: string[];
  status: string;
  version: number;
  validUntil: string | null;
  requestedBy: string | null;
  requiresClinicalApproval: boolean;
  barangay: string | null;
  cityMunicipality: string | null;
}

export default async function StaffAccess({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("admin.users") && !caps.has("grant.approve.clinical")) notFound();
  const rows = (await rpc.rpc<Row[]>("list_staff_memberships", { p_clinic_id: clinicId })) ?? [];
  return (
    <>
      <PageTitle
        title="Staff access"
        lead="Access is granted by two different people. Anyone can be requested, but clinical access must be approved by a clinical lead, and nobody can approve their own access."
      />
      <OutcomeNoticeView noticeKey={`staff-access:${clinicId}`} />
      {rows.length === 0 ? (
        <EmptyState title="No staff access records yet" />
      ) : (
        <ul className="mb-8 divide-y divide-line rounded-card border border-line bg-surface" aria-label="Staff access">
          {rows.map((r) => {
            const needed = r.requiresClinicalApproval ? "grant.approve.clinical" : "admin.users";
            const canApprove = r.status === "pending_approval" && caps.has(needed) && r.profileId !== ctx.profileId && r.requestedBy !== ctx.profileId;
            const canRevoke = caps.has(needed) && ["pending_approval", "active", "suspended"].includes(r.status);
            const chip = membershipStatusChip(r.status);
            return (
              <li key={r.membershipId} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {personName(r.displayName || "(no name)")} <span className="font-normal text-ink-soft">— {staffRoleLabel(r.role)}</span>
                  </p>
                  <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{r.barangay && r.cityMunicipality ? `${r.barangay}, ${r.cityMunicipality}` : "Work location not assigned"}</p>
                <p className="text-sm text-ink-soft">
                  {r.requiresClinicalApproval ? "Includes clinical access (needs a clinical lead's approval)" : "Non-clinical access"}
                  {r.capabilities.length ? ` · extra: ${r.capabilities.join(", ")}` : ""}
                </p>
                {r.status === "pending_approval" && !canApprove && r.profileId === ctx.profileId ? <p className="text-sm">This is your own request; someone else must approve it.</p> : null}
                <StaffRowActions clinicId={clinicId} row={{ id: r.membershipId, version: r.version, name: r.displayName }} canApprove={canApprove} canRevoke={canRevoke} />
                {caps.has("admin.users") ? <StaffLocationForm clinicId={clinicId} row={r} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <RequestStaffForm clinicId={clinicId} staffSignUpUrl={`${process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "") ?? ""}${STAFF_SIGN_UP_PATH}`} />
    </>
  );
}
