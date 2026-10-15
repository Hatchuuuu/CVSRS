import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { Card, EmptyState, PageTitle, StatusChip } from "@/components/ui";
import { formatClinicDate, formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { StockNav } from "../subnav";
import { CancelTransfer, ReceiveTransfer, ResolveShortfall, SendForm } from "./forms";

export const metadata: Metadata = { title: "Stock transfers" };

interface Transfer {
  id: string;
  sentBy: string;
  reference: string;
  status: "in_transit" | "received" | "received_short" | "cancelled" | "closed_written_off" | "closed_returned";
  fromClinic: string;
  toClinic: string;
  lot: string;
  product: string;
  stockUnit: string;
  expiresOn: string;
  quantitySent: string;
  quantityReceived: string | null;
  shortfall: string | null;
  sentAt: string;
  note: string | null;
  resolutionNote: string | null;
}
interface Transfers {
  outgoing: Transfer[];
  incoming: Transfer[];
  clinics: { id: string; name: string }[];
}
interface Stock {
  locations: { id: string; name: string; kind: string; status: string }[];
  lots: { lotId: string; lot: string; product: string; stockUnit: string; expiresOn: string; disposition: string; expired: boolean; usable: string }[];
}

const STATUS: Record<Transfer["status"], { tone: "attention" | "success" | "review" | "neutral"; label: string }> = {
  in_transit: { tone: "attention", label: "In transit" },
  received: { tone: "success", label: "Received" },
  received_short: { tone: "review", label: "Arrived short: needs a decision" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  closed_written_off: { tone: "neutral", label: "Shortfall written off" },
  closed_returned: { tone: "neutral", label: "Shortfall returned to stock" },
};
const n = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("en-PH", { maximumFractionDigits: 4 }));

export default async function Transfers({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const canManage = caps.has("inventory.manage");
  const canApprove = caps.has("inventory.approve");
  if (!canManage && !canApprove) notFound();
  const [t, stock] = await Promise.all([rpc.rpc<Transfers>("list_stock_transfers", { p_clinic_id: clinicId }), rpc.rpc<Stock>("list_stock", { p_clinic_id: clinicId })]);
  if (!t || !stock) notFound();
  const usable = stock.locations.filter((l) => l.kind === "usable" && l.status === "active").map((l) => ({ id: l.id, label: l.name }));
  const lots = stock.lots.filter((l) => l.disposition === "usable" && !l.expired && Number(l.usable) > 0).map((l) => ({ id: l.lotId, label: `${l.product} · lot ${l.lot} · exp ${formatDate(l.expiresOn)} · ${n(l.usable)} ${l.stockUnit} usable` }));

  return (
    <>
      <PageTitle title="Stock transfers" lead="Stock that leaves this clinic stays on the books as “in transit” until the other clinic counts it in. Nothing disappears while it travels." />
      <StockNav clinicId={clinicId} current="transfers" />
      <OutcomeNoticeView noticeKey={`stock-transfers:${clinicId}`} />

      {t.incoming.filter((x) => x.status === "in_transit").length > 0 && canManage ? (
        <Card className="mb-6" aria-labelledby="in-h">
          <h2 id="in-h" className="mb-3 text-xl font-bold">
            Waiting to be received here
          </h2>
          <ul className="divide-y divide-line rounded-control border border-line">
            {t.incoming
              .filter((x) => x.status === "in_transit")
              .map((x) => (
                <li key={x.id} className="p-4">
                  <p className="font-bold">
                    {x.product} <span className="font-normal text-ink-soft">· lot {x.lot}</span>
                  </p>
                  <p className="text-sm text-ink-soft">
                    {x.reference} · from {x.fromClinic} · {n(x.quantitySent)} {x.stockUnit} sent {formatClinicDate(x.sentAt, membership.clinicTimezone)}
                  </p>
                  <ReceiveTransfer clinicId={clinicId} transferId={x.id} sent={x.quantitySent} unit={x.stockUnit} locations={usable} />
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      {canManage ? (
        <Card className="mb-6" aria-labelledby="sd-h">
          <h2 id="sd-h" className="mb-3 text-xl font-bold">
            Send stock to another clinic
          </h2>
          {t.clinics.length === 0 ? (
            <p className="text-ink-soft">There is no other active clinic in this organization.</p>
          ) : (
            <SendForm clinicId={clinicId} clinics={t.clinics.map((c) => ({ id: c.id, label: c.name }))} lots={lots} locations={usable} />
          )}
        </Card>
      ) : null}

      <Card aria-labelledby="hist-h">
        <h2 id="hist-h" className="mb-3 text-xl font-bold">
          Sent from here
        </h2>
        {t.outgoing.length === 0 ? (
          <EmptyState title="Nothing sent yet" />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {t.outgoing.map((x) => {
              const s = STATUS[x.status];
              return (
                <li key={x.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      {x.product} <span className="font-normal text-ink-soft">· lot {x.lot} · to {x.toClinic}</span>
                    </p>
                    <StatusChip tone={s.tone}>{s.label}</StatusChip>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {x.reference} · sent {n(x.quantitySent)} {x.stockUnit}
                    {x.quantityReceived !== null ? ` · received ${n(x.quantityReceived)}` : ""}
                    {x.resolutionNote ? ` · ${x.resolutionNote}` : ""}
                  </p>
                  {x.status === "in_transit" && canManage ? <CancelTransfer clinicId={clinicId} transferId={x.id} /> : null}
                  {x.status === "received_short" && canApprove && x.sentBy !== ctx.profileId ? <ResolveShortfall clinicId={clinicId} transferId={x.id} shortfall={x.shortfall ?? "0"} unit={x.stockUnit} locations={usable} /> : null}
                  {x.status === "received_short" && canApprove && x.sentBy === ctx.profileId ? <p className="text-sm text-ink-soft">Another inventory approver must decide the shortfall on your transfer.</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
