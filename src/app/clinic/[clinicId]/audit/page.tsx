import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState, Notice, PageTitle } from "@/components/ui";
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
  // A repeated parameter (?action=a&action=b) arrives as an array; only single values are used.
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const sp = { action: one("action"), before: one("before"), beforeId: one("beforeId"), from: one("from"), to: one("to") };
  const { rpc, membership } = await requireClinicStaff(clinicId);
  if (!membership.capabilities.includes("audit.read")) notFound();
  // The "Older entries" cursor comes from our own link; anything else is ignored rather than sent to the database.
  const cursorAt = isAuditInstant(sp.before) ? sp.before : null;
  const cursorId = cursorAt && sp.beforeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.beforeId) ? sp.beforeId : null;
  const iso = (d?: string, end = false) => (d && z.iso.date().safeParse(d).success ? clinicDateBoundary(d, membership.clinicTimezone, end).toISOString() : null);
  let data: Result | null = null;
  let problem: string | null = null;
  try {
    data = await rpc.rpc<Result>("search_audit", { p_clinic_id: clinicId, p_action: sp.action?.trim() || null, p_actor: null, p_from: iso(sp.from), p_to: iso(sp.to, true), p_before: cursorAt, p_before_id: cursorId, p_limit: 50 });
  } catch (e) {
    problem = (e as { message?: string }).message ?? "The search failed.";
  }
  const q = new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) });

  return (
    <>
      <PageTitle title="Audit trail" lead="Who did what and when, for the whole organization. It cannot be edited or deleted. Searching it is itself recorded." />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block font-semibold">Action starts with</span>
          <input name="action" defaultValue={sp.action ?? ""} placeholder="for example certificate." maxLength={60} className="min-h-11 rounded-control border border-line-strong bg-surface px-3" />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">From</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="min-h-11 rounded-control border border-line-strong bg-surface px-3" />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">To</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="min-h-11 rounded-control border border-line-strong bg-surface px-3" />
        </label>
        <button className="inline-flex min-h-11 items-center rounded-control border border-primary bg-primary px-5 font-semibold text-on-primary hover:bg-primary-strong">Search</button>
      </form>
      {problem ? (
        <Notice tone="danger" role="alert" title="The search could not run">
          {problem}
        </Notice>
      ) : !data || data.rows.length === 0 ? (
        <EmptyState title="Nothing matches">Check the filters. A search never widens itself.</EmptyState>
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
          {data.nextBefore ? (
            <p className="mt-4">
              <Link href={`/clinic/${clinicId}/audit?${new URLSearchParams({ ...Object.fromEntries(q), before: data.nextBefore, ...(data.nextBeforeId ? { beforeId: data.nextBeforeId } : {}) }).toString()}`} className="font-semibold text-primary">
                Older entries
              </Link>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
