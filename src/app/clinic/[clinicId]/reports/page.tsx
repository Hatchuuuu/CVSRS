import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadButton } from "@/components/download-button";
import { EmptyState, Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { clinicToday, formatClinicDateTime, formatDate } from "@/lib/format";
import { REPORTS, defaultRange, findReport } from "@/lib/reports/catalog";
import { requireClinicStaff } from "@/lib/server/viewer";
import { PaperTallyForm, type ProductOption } from "./paper-tally";

export const metadata: Metadata = { title: "Reports" };

interface ReportData {
  rows: Record<string, unknown>[];
  totals?: Record<string, number> | null;
  total?: number | null;
  unresolved?: number;
  asOf: string;
  definitions: { version: string; terms: Record<string, string> };
}
interface Backlog {
  openReviewCases: Record<string, number>;
  pendingOutsideDoses: number;
  provisionalChildren: number;
  pendingGuardianLinks: number;
  pendingCertificates: number;
  failedMessages: number;
  openTemperatureExcursions: number;
  transfersNeedingDecision: number;
  transfersInTransit: number;
  plansAwaitingReview: number;
  openCheckins: number;
  definitions: { terms: Record<string, string> };
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const STATUS_TEXT: Record<string, string> = { matches: "Agrees", paper_higher: "Paper is higher", system_higher: "System is higher", no_paper_tally: "No paper entry yet" };

function cell(key: string, v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (key === "date" || key === "expiresOn") return formatDate(String(v));
  if (key === "status") return STATUS_TEXT[String(v)] ?? String(v);
  return String(v);
}

export default async function Reports({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<{ report?: string; from?: string; to?: string }> }) {
  const { clinicId } = await params;
  const sp = await searchParams;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const canReport = caps.has("report.run");
  const canTally = canReport || caps.has("vaccination.record");
  if (!canReport && !canTally) notFound();

  const visible = REPORTS.filter((r) => (r.slug === "paper-reconciliation" ? canTally : canReport));
  const def = findReport(sp.report ?? visible[0]!.slug);
  if (!def || !visible.includes(def)) notFound();
  const dflt = defaultRange(clinicToday(membership.clinicTimezone));
  const from = isDate(sp.from) ? sp.from : dflt.from;
  const to = isDate(sp.to) ? sp.to : dflt.to;

  // Independent reads run together. Only the report itself is caught (its message is shown in place of the table).
  const [report, backlog, products] = await Promise.all([
    rpc.rpc<ReportData>(def.rpc, { p_clinic_id: clinicId, p_from: from, p_to: to, p_export: false }).then(
      (d) => ({ data: d, problem: null }),
      (e: unknown) => ({ data: null, problem: (e as { message?: string }).message ?? "The report could not be produced." }),
    ),
    canReport ? rpc.rpc<Backlog>("report_backlog", { p_clinic_id: clinicId }) : Promise.resolve(null),
    def.slug === "paper-reconciliation" && canTally ? rpc.rpc<ProductOption[]>("list_active_products", { p_clinic_id: clinicId }).then((p) => p ?? []) : Promise.resolve([] as ProductOption[]),
  ]);
  const data: ReportData | null = report.data;
  const problem: string | null = report.problem;

  const exportHref = `/api/v1/clinics/${clinicId}/reports/${def.slug}/export?from=${from}&to=${to}`;
  const totalsRow = data?.totals ?? null;

  return (
    <>
      <PageTitle title="Reports" lead="Figures come straight from visits, vaccinations and the stock ledger. They never contain names." />

      {backlog ? (
        <Section id="bk-h" title="Needs attention" className="border-t-0 pt-0" description="Work that is waiting for a person.">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Unconfirmed children", backlog.provisionalChildren],
              ["Guardian links to verify", backlog.pendingGuardianLinks],
              ["Reported doses to check", backlog.pendingOutsideDoses],
              ["Review cases open", Object.values(backlog.openReviewCases).reduce((a, b) => a + b, 0)],
              ["Certificates not finished", backlog.pendingCertificates],
              ["Messages that failed", backlog.failedMessages],
              ["Fridge readings to review", backlog.openTemperatureExcursions],
              ["Transfers needing a decision", backlog.transfersNeedingDecision],
              ["Transfers in transit", backlog.transfersInTransit],
              ["Catch-up plans to review", backlog.plansAwaitingReview],
              ["Family questions waiting", backlog.openCheckins],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-control border border-line bg-surface p-3">
                <dt className="text-sm text-ink-soft">{label}</dt>
                <dd className="tnum text-2xl font-bold">{n}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <nav aria-label="Report type" className="mb-4 mt-8 flex flex-wrap gap-2">
        {visible.map((r) => (
          <Link
            key={r.slug}
            href={`/clinic/${clinicId}/reports?report=${r.slug}&from=${from}&to=${to}`}
            aria-current={r.slug === def.slug ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-control border px-4 font-semibold no-underline ${r.slug === def.slug ? "border-primary/30 bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink hover:bg-sunken"}`}
          >
            {r.title}
          </Link>
        ))}
      </nav>

      <Section id="rp-h" title={def.title} className="border-t-0 pt-0" description={def.lead}>
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <input type="hidden" name="report" value={def.slug} />
          <label className="block">
            <span className="mb-1 block font-semibold">From</span>
            <input type="date" name="from" defaultValue={from} required className="min-h-11 rounded-control border border-line-strong bg-surface px-3" />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">To</span>
            <input type="date" name="to" defaultValue={to} required className="min-h-11 rounded-control border border-line-strong bg-surface px-3" />
          </label>
          <button className="inline-flex min-h-11 items-center rounded-control border border-primary bg-primary px-5 font-semibold text-on-primary hover:bg-primary-strong">Show report</button>
          {canReport ? (
            <DownloadButton href={exportHref} filename={`${def.slug}_${from}_${to}.csv`} label="Download CSV" failureText="The CSV could not be downloaded. Check the dates and the connection, then try again." />
          ) : null}
        </form>

        {problem ? (
          <Notice tone="danger" role="alert" title="This report could not be produced">
            {problem}
          </Notice>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title="Nothing to show for this period">Try a wider date range.</EmptyState>
        ) : (
          <>
            <div role="region" aria-label={`${def.title} table`} tabIndex={0} className="overflow-x-auto rounded-control border border-line bg-surface">
              <table className="w-full min-w-[32rem] border-collapse text-left">
                <caption className="sr-only">
                  {def.title}, {formatDate(from)} to {formatDate(to)}
                </caption>
                <thead>
                  <tr className="border-b border-line bg-sunken">
                    {def.columns.map((c) => (
                      <th key={c.key} scope="col" className="px-3 py-2 text-sm font-bold">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {def.columns.map((c, j) => (
                        <td key={c.key} className={`px-3 py-2 ${j === 0 ? "font-semibold" : "tnum"} ${c.key === "date" ? "whitespace-nowrap" : ""}`}>
                          {c.key === "status" && r.status === "matches" ? <StatusChip tone="success">Agrees</StatusChip> : c.key === "status" ? <StatusChip tone="attention">{cell(c.key, r[c.key])}</StatusChip> : cell(c.key, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {totalsRow ? (
                  <tfoot>
                    <tr className="border-t-2 border-line-strong bg-sunken font-bold">
                      {def.columns.map((c, j) => (
                        <td key={c.key} className="tnum px-3 py-2">
                          {j === 0 ? "Total" : totalsRow[c.key] === undefined ? "" : String(totalsRow[c.key])}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {data.total !== undefined && data.total !== null ? <p className="tnum mt-2 font-semibold">Total: {data.total}</p> : null}
            {def.slug === "paper-reconciliation" ? <p className="mt-2 text-ink-soft">{data.unresolved ? `${data.unresolved} line(s) still differ or have no paper entry.` : "Every line agrees."}</p> : null}
            <p className="mt-2 text-sm text-ink-soft">Produced {formatClinicDateTime(data.asOf, membership.clinicTimezone)}. Definitions version {data.definitions.version}.</p>
            <details className="mt-3 rounded-control border border-line bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold text-primary">What these columns mean</summary>
              <dl className="space-y-2 border-t border-line p-4">
                {def.terms.map((t) => (
                  <div key={t}>
                    <dt className="font-semibold">{def.columns.find((c) => c.key === t)?.label ?? t}</dt>
                    <dd className="text-ink-soft">{data.definitions.terms[t]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
      </Section>

      {def.slug === "paper-reconciliation" && canTally ? (
        <Section id="pt-h" title="Enter a paper log tally" description="Count the doses written on the paper log for a day. Enter it as many times as you like: the latest entry counts and earlier ones are kept.">
          <PaperTallyForm clinicId={clinicId} products={products} defaultDate={to} />
        </Section>
      ) : null}
    </>
  );
}
