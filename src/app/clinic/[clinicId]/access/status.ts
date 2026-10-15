type Tone = "success" | "attention" | "neutral";

/** Statuses returned by list_staff_memberships: pending_approval, active, suspended. Each gets its own label. */
export function membershipStatusChip(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "active":
      return { tone: "success", label: "Active" };
    case "pending_approval":
      return { tone: "attention", label: "Waiting for approval" };
    case "suspended":
      return { tone: "neutral", label: "Paused" };
    default:
      return { tone: "neutral", label: status.replace(/_/g, " ") };
  }
}
