import type { NavItem } from '@/app/clinic/[clinicId]/staff-nav';

export function clinicNavItems(clinicId: string, capabilities: readonly string[]): NavItem[] {
  const caps = new Set(capabilities);
  const base = `/clinic/${clinicId}`;
  const items: NavItem[] = [];
  if (caps.has("queue.manage") || caps.has("appointment.manage") || caps.has("child.read_clinical")) items.push({ href: `${base}/today`, label: "Today", icon: "today" });
  if (caps.has("child.search")) items.push({ href: base, label: "Find or register", icon: "search", exact: true });
  if (caps.has("guardian.verify") || caps.has("review.resolve") || caps.has("correction.approve") || caps.has("inventory.approve")) items.push({ href: `${base}/review`, label: "Review queue", icon: "review" });
  if (caps.has("inventory.manage") || caps.has("inventory.approve") || caps.has("vaccination.record")) items.push({ href: `${base}/inventory`, label: "Vaccine stock", icon: "stock" });
  if (caps.has("bhw.followup") || caps.has("child.read_clinical")) items.push({ href: `${base}/followup`, label: "Follow-up list", icon: "followup" });
  if (caps.has("child.read_clinical") || caps.has("rules.approve") || caps.has("grant.approve.clinical")) items.push({ href: `${base}/questions`, label: "Questions and plans", icon: "questions" });
  if (caps.has("guardian.verify") || caps.has("review.resolve")) items.push({ href: `${base}/transfers`, label: "Record transfers", icon: "transfers" });
  if (caps.has("admin.users") || caps.has("grant.approve.clinical") || caps.has("admin.config")) items.push({ href: `${base}/admin`, label: "Admin console", icon: "admin" });
  if (caps.has("admin.config") || caps.has("rules.propose") || caps.has("rules.approve")) items.push({ href: `${base}/content`, label: "Care information", icon: "content" });
  if (caps.has("admin.config") || caps.has("audit.read")) items.push({ href: `${base}/settings`, label: "Settings and operations", icon: "settings" });
  if (caps.has("report.run") || caps.has("vaccination.record")) items.push({ href: `${base}/reports`, label: "Reports", icon: "reports" });
  if (caps.has("queue.manage") || caps.has("vaccination.record") || caps.has("inventory.manage")) items.push({ href: `${base}/outage-forms`, label: "Outage forms", icon: "forms" });
  if (caps.has("admin.config") || caps.has("rules.propose") || caps.has("rules.approve")) items.push({ href: `${base}/clinical`, label: "Clinical setup", icon: "clinical" });
  if (caps.has("admin.users") || caps.has("grant.approve.clinical")) items.push({ href: `${base}/access`, label: "Staff access", icon: "access" });
  return items;
}
