/** The clinic child record page opens only for viewers with this capability (it calls notFound() otherwise). */
export const RECORD_CAPABILITY = "child.search";

export function canOpenChildRecord(capabilities: Iterable<string>): boolean {
  const caps = capabilities instanceof Set ? (capabilities as ReadonlySet<string>) : new Set(capabilities);
  return caps.has(RECORD_CAPABILITY);
}

/** A link target for a child's clinic record, or null when the viewer could not open it (for example a BHW). */
export function childRecordHref(clinicId: string, childId: string | null | undefined, capabilities: Iterable<string>): string | null {
  return childId && canOpenChildRecord(capabilities) ? `/clinic/${clinicId}/children/${childId}` : null;
}
