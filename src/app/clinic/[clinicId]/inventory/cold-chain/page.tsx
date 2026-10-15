import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState, Notice, PageTitle, StatusChip } from "@/components/ui";
import { formatClinicDateTime } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { StockNav } from "../subnav";
import { LimitsForm, ReadingForm, ReviewExcursion } from "./forms";

export const metadata: Metadata = { title: "Cold chain" };

interface Temperature {
  limits: { minC: string; maxC: string; policyReference: string; setAt: string } | null;
  readings: { id: string; recordedBy: string; location: string; observedAt: string; minC: string; maxC: string; status: "no_limits" | "within_limits" | "excursion"; note: string | null; limitMinC: string | null; limitMaxC: string | null; reviewed: boolean; reviewAction: string | null; reviewNote: string | null }[];
  openExcursions: number;
}
interface Stock {
  locations: { id: string; name: string; kind: string; status: string }[];
}

const ACTION: Record<string, string> = { no_action: "No action needed", lots_quarantined: "Lots quarantined", stock_discarded: "Stock discarded", other: "Other action" };

export default async function ColdChain({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const when = (iso: string) => formatClinicDateTime(iso, membership.clinicTimezone);
  const caps = new Set(membership.capabilities);
  const canManage = caps.has("inventory.manage");
  const canApprove = caps.has("inventory.approve");
  if (!canManage && !canApprove) notFound();
  const [temp, stock] = await Promise.all([rpc.rpc<Temperature>("list_temperature", { p_clinic_id: clinicId, p_days: 14 }), rpc.rpc<Stock>("list_stock", { p_clinic_id: clinicId })]);
  if (!temp || !stock) notFound();
  const stores = stock.locations.filter((l) => l.kind !== "in_transit" && l.status === "active").map((l) => ({ id: l.id, label: `${l.name} (${l.kind})` }));

  return (
    <>
      <PageTitle title="Cold chain" lead="Log fridge temperatures. Readings are always kept. They are judged only against limits your clinical approver has recorded from your own policy." />
      <StockNav clinicId={clinicId} current="cold-chain" />

      {temp.openExcursions > 0 ? (
        <Notice tone="danger" role="alert" title={`${temp.openExcursions} reading${temp.openExcursions === 1 ? "" : "s"} outside the approved limits ${temp.openExcursions === 1 ? "needs" : "need"} a decision`}>
          Do not use the affected stock until an approver records what was done.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {canManage ? (
          <Card aria-labelledby="rd-h">
            <h2 id="rd-h" className="mb-3 text-xl font-bold">
              Log a reading
            </h2>
            <ReadingForm clinicId={clinicId} clinicTimezone={membership.clinicTimezone} locations={stores} />
          </Card>
        ) : null}
        <Card aria-labelledby="lm-h">
          <h2 id="lm-h" className="mb-3 text-xl font-bold">
            Approved limits
          </h2>
          {temp.limits ? (
            <p className="mb-3">
              <span className="tnum font-bold">
                {temp.limits.minC} to {temp.limits.maxC} °C
              </span>{" "}
              <span className="text-ink-soft">· {temp.limits.policyReference}</span>
            </p>
          ) : (
            <Notice tone="attention" title="No limits recorded">
              Readings cannot be judged until the cold-chain lead&apos;s limits are entered.
            </Notice>
          )}
          {canApprove ? <LimitsForm clinicId={clinicId} current={temp.limits} /> : <p className="text-ink-soft">Only an inventory approver can change limits.</p>}
        </Card>
      </div>

      <Card className="mt-6" aria-labelledby="hs-h">
        <h2 id="hs-h" className="mb-3 text-xl font-bold">
          Recent readings and unresolved excursions
        </h2>
        {temp.readings.length === 0 ? (
          <EmptyState title="No readings logged" />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {temp.readings.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {r.location} <span className="tnum font-normal text-ink-soft">· {when(r.observedAt)}</span>
                  </p>
                  {r.status === "excursion" ? (
                    r.reviewed ? <StatusChip tone="neutral">Outside limits · reviewed</StatusChip> : <StatusChip tone="danger">Outside limits · needs a decision</StatusChip>
                  ) : r.status === "within_limits" ? (
                    <StatusChip tone="success">Within limits</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">Not judged (no limits then)</StatusChip>
                  )}
                </div>
                <p className="tnum text-sm">
                  {r.minC} to {r.maxC} °C{r.limitMinC !== null ? ` · limits then ${r.limitMinC} to ${r.limitMaxC} °C` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
                {r.reviewed ? <p className="text-sm text-ink-soft">{ACTION[r.reviewAction ?? "other"]}: {r.reviewNote}</p> : null}
                {r.status === "excursion" && !r.reviewed && canApprove && r.recordedBy !== ctx.profileId ? <ReviewExcursion clinicId={clinicId} readingId={r.id} /> : null}
                {r.status === "excursion" && !r.reviewed && canApprove && r.recordedBy === ctx.profileId ? <p className="mt-2 text-sm text-ink-soft">Another inventory approver must review your reading.</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
