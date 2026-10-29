import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button, EmptyState, Notice, PageTitle, TextField } from "@/components/ui";
import { isAuditInstant } from "@/lib/api/query";
import { clinicDateBoundary, formatClinicDateTime } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";

export const metadata: Metadata = { title: "Audit trail" };

interface Row {
  id: string;
  at: string;
  action: string;
  capability: string | null;
  entityType: string;
  outcome: "success" | "denied" | "failed";
  reason: string | null;
  actor: string | null;
  system: string | null;
}
interface Result {
  rows: Row[];
  nextBefore: string | null;
  nextBeforeId: string | null;
}

export default async function Audit({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { clinicId } = await params;
  const raw = await searchParams;
  // Keep ambiguous filters from silently widening an audit search.
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const sp = { action: one("action"), before: one("before"), beforeId: one("beforeId"), from: one("from"), to: one("to") };
  const { rpc, membership } = await requireClinicStaff(clinicId);
  if (!membership.capabilities.includes("audit.read")) notFound();
  const errors: { action?: string; from?: string; to?: string } = {};
  if (Array.isArray(raw.action) || (sp.action?.trim().length ?? 0) > 60) errors.action = "Use no more than 60 characters and one action filter.";
  for (const key of ["from", "to"] as const) {
    const value = sp[key];
    if (Array.isArray(raw[key]) || (value && (!z.iso.date().safeParse(value).success || value.startsWith("0000-")))) {
      errors[key] = `Enter a valid ${key === "from" ? "start" : "end"} date.`;
    }
  }
  if (!errors.from && !errors.to && sp.from && sp.to && sp.from > sp.to) errors.to = "The end date must be on or after the start date.";
  // The "Older entries" cursor comes from our own link; anything else is ignored rather than sent to the database.
  const cursorAt = isAuditInstant(sp.before) ? sp.before : null;
  const cursorId = cursorAt && sp.beforeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.beforeId) ? sp.beforeId : null;
  const iso = (d?: string, end = false) => (d && z.iso.date().safeParse(d).success ? clinicDateBoundary(d, membership.clinicTimezone, end).toISOString() : null);
  let data: Result | null = null;
  let problem: string | null = Object.keys(errors).length ? "Correct the highlighted filters and search again." : null;
  if (!problem) {
    try {
      data = await rpc.rpc<Result>("search_audit", { p_clinic_id: clinicId, p_action: sp.action?.trim() || null, p_actor: null, p_from: iso(sp.from), p_to: iso(sp.to, true), p_before: cursorAt, p_before_id: cursorId, p_limit: 50 });
    } catch (e) {
      problem = (e as { message?: string }).message ?? "The search failed.";
    }
  }
  const q = new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) });
  const hasFilters = !!(raw.action || raw.from || raw.to || raw.before);

  return (
    <>
      <PageTitle title="Audit trail" lead="Who did what and when, for the whole organization. It cannot be edited or deleted. Searching it is itself recorded." />
      <form method="get" className="mb-5 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
        <TextField id="audit-action" name="action" label="Action starts with" defaultValue={sp.action ?? ""} placeholder="for example certificate." maxLength={60} error={errors.action} />
        <TextField id="audit-from" type="date" name="from" label="From" defaultValue={sp.from ?? ""} error={errors.from} />
        <TextField id="audit-to" type="date" name="to" label="To" defaultValue={sp.to ?? ""} error={errors.to} />
        <div className="mb-4 flex min-h-11 flex-wrap items-center gap-3 lg:mt-7">
          <Button type="submit">Search</Button>
          {hasFilters ? <Link href={`/clinic/${clinicId}/audit`} className="inline-flex min-h-11 items-center font-semibold text-primary">Clear filters</Link> : null}
        </div>
      </form>
      {problem ? (
        <Notice tone="danger" role="alert" title="The search could not run">
          {problem}
        </Notice>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState title={cursorAt ? "No older entries match" : "Nothing matches"}>Check the filters or clear them to start again. A search never widens itself.</EmptyState>
      ) : (
        <>
          <div role="region" aria-label="Audit results" tabIndex={0} className="overflow-x-auto rounded-control border border-line bg-surface">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <caption className="sr-only">Audit entries, newest first</caption>
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {["When", "Who", "Action", "About", "Result", "Reason"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 align-top">
                    <td className="tnum px-3 py-2">{formatClinicDateTime(r.at, membership.clinicTimezone)}</td>
                    <td className="px-3 py-2">{r.actor ?? (r.system ? `System (${r.system})` : "—")}</td>
                    <td className="px-3 py-2 font-semibold">{r.action}</td>
                    <td className="px-3 py-2">{r.entityType.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{r.outcome === "success" ? "Done" : r.outcome === "denied" ? "Refused" : "Failed"}</td>
                    <td className="px-3 py-2 text-ink-soft">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!problem && (cursorAt || data?.nextBefore) ? (
        <nav aria-label="Audit pages" className="mt-4 flex flex-wrap gap-4">
          {cursorAt ? <Link href={`/clinic/${clinicId}/audit?${q}`} className="inline-flex min-h-11 items-center font-semibold text-primary">Newest entries</Link> : null}
          {data?.nextBefore ? (
            <Link href={`/clinic/${clinicId}/audit?${new URLSearchParams({ ...Object.fromEntries(q), before: data.nextBefore, ...(data.nextBeforeId ? { beforeId: data.nextBeforeId } : {}) })}`} className="inline-flex min-h-11 items-center font-semibold text-primary">Older entries</Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
