/** Pick an admitted staff workspace from live capabilities, for entry and clinic navigation. */
export function clinicLandingRoute(clinicId: string, capabilities: readonly string[]): string {
  const caps = new Set(capabilities);
  const base = `/clinic/${clinicId}`;
  if (caps.has("queue.manage") || caps.has("child.read_clinical")) return `${base}/today`;
  if (caps.has("inventory.manage") || caps.has("inventory.approve")) return `${base}/inventory`;
  // Access administrators start at the admin console, where staff applications and approvals wait.
  if (caps.has("admin.users")) return `${base}/admin`;
  if (caps.has("admin.config") || caps.has("rules.propose") || caps.has("rules.approve")) return `${base}/clinical`;
  if (caps.has("bhw.followup")) return `${base}/followup`;
  return base;
}
