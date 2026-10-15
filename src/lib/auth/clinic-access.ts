/**
 * A person can hold more than one role at the same clinic (for example assistant and inventory clerk). The database grants the
 * union of those roles' capabilities, so the workspace must too: one entry per clinic, never one per membership (audit F09).
 */
export interface MembershipLike {
  membershipId: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone: string;
  role: string;
  status: string;
  validUntil: string | null;
  capabilities: string[];
}

export interface ClinicAccess<M extends MembershipLike = MembershipLike> extends MembershipLike {
  /** Every active role at this clinic, in the order the memberships were listed. `role` is the first of them. */
  roles: string[];
  /** The underlying memberships, for anything that needs a specific one. */
  memberships: M[];
}

const usable = (m: MembershipLike, now: number) => m.status === "active" && (!m.validUntil || Date.parse(m.validUntil) > now);

/** Active memberships merged per clinic, in first-seen order. */
export function activeClinicAccess<M extends MembershipLike>(memberships: readonly M[], now: number = Date.now()): ClinicAccess<M>[] {
  const byClinic = new Map<string, ClinicAccess<M>>();
  for (const m of memberships) {
    if (!usable(m, now)) continue;
    const seen = byClinic.get(m.clinicId);
    if (!seen) {
      byClinic.set(m.clinicId, { ...m, capabilities: [...new Set(m.capabilities)], roles: [m.role], memberships: [m] });
      continue;
    }
    seen.capabilities = [...new Set([...seen.capabilities, ...m.capabilities])];
    if (!seen.roles.includes(m.role)) seen.roles.push(m.role);
    seen.memberships.push(m);
  }
  return [...byClinic.values()];
}

/** The merged access for one clinic, or null when the person has no active membership there. */
export function clinicAccessFor<M extends MembershipLike>(memberships: readonly M[], clinicId: string, now: number = Date.now()): ClinicAccess<M> | null {
  return activeClinicAccess(memberships, now).find((a) => a.clinicId === clinicId) ?? null;
}
