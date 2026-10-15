/** Staff roles a clinic can grant (the database's role vocabulary), with the names people see. */
export const STAFF_ROLES = [
  { role: "clinical_staff", label: "Clinical staff (nurse or midwife)" },
  { role: "assistant", label: "Registration assistant" },
  { role: "bhw", label: "Barangay health worker" },
  { role: "inventory", label: "Inventory clerk" },
  { role: "clinical_lead", label: "Clinical lead" },
  { role: "tech_admin", label: "Technical administrator" },
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number]["role"];

const LABELS = new Map<string, string>(STAFF_ROLES.map((r) => [r.role, r.label]));

/** The display name of a role; an unknown value is shown as plain words rather than hidden. */
export function staffRoleLabel(role: string): string {
  return LABELS.get(role) ?? role.replaceAll("_", " ");
}
