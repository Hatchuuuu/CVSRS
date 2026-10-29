import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { Card, EmptyState, PageTitle, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { StockNav } from "./subnav";
import { CloseLocation, LotActions, LocationForm, ReceiveForm, ReconcilePanel, RegisterLotForm, WastageForm, CountForm } from "./forms";

const LOCATION_KIND: Record<string, string> = { usable: "usable", quarantine: "quarantine", in_transit: "in transit" };

export const metadata: Metadata = { title: "Vaccine stock" };

export interface StockLot {
  lotId: string;
  lot: string;
  product: string;
  productCode: string;
  stockUnit: string;
  expiresOn: string;
  disposition: "usable" | "quarantined" | "recalled";
  expired: boolean;
  physicalOnHand: string;
  usable: string;
  locations: { locationId: string; onHand: string }[];
}
interface Stock {
  asOf: string;
  locations: { id: string; name: string; kind: string; status: string }[];
  lots: StockLot[];
}
interface Product {
  id: string;
  name: string;
  code: string;
}

const n = (v: string) => Number(v).toLocaleString("en-PH", { maximumFractionDigits: 4 });

export default async function Inventory({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const canManage = caps.has("inventory.manage");
  const canApprove = caps.has("inventory.approve");
  if (!canManage && !canApprove && !caps.has("vaccination.record")) notFound();
  const [stock, products] = await Promise.all([
    rpc.rpc<Stock>("list_stock", { p_clinic_id: clinicId }),
    canManage ? rpc.rpc<Product[]>("list_active_products", { p_clinic_id: clinicId }).then((p) => p ?? []) : Promise.resolve([] as Product[]),
  ]);
  if (!stock) notFound();
  const usableLocs = stock.locations.filter((l) => l.kind === "usable" && l.status === "active");
  const lotOptions = stock.lots.map((l) => ({ id: l.lotId, label: `${l.product} · lot ${l.lot} · exp ${formatDate(l.expiresOn)}${l.disposition === "recalled" ? " · recalled" : ""}` }));
  const receivableLots = lotOptions.filter((l) => stock.lots.find((lot) => lot.lotId === l.id)?.disposition !== "recalled");
  const locOptions = stock.locations.filter((l) => l.status === "active").map((l) => ({ id: l.id, label: `${l.name} (${l.kind})` }));
  const locName = new Map(stock.locations.map((l) => [l.id, l.name]));

  return (
    <>
      <PageTitle dashboard
        title="Vaccine stock"
        lead={`As of ${formatDate(stock.asOf)}. "On hand" is what is physically there; "usable" leaves out quarantined, recalled and expired lots. Every change is a permanent ledger entry with a reason.`}
      />
      <dl aria-label="Stock overview" className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line pb-6 xl:grid-cols-4">
        {[
          ["Registered lots", stock.lots.length],
          ["Expired lots", stock.lots.filter(l => l.expired).length],
          ["Quarantined or recalled", stock.lots.filter(l => l.disposition !== "usable").length],
          ["Active usable locations", usableLocs.length],
        ].map(([label, value]) => <div key={label}><dt className="text-sm text-ink-soft">{label}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd></div>)}
      </dl>
      <StockNav clinicId={clinicId} current="lots" canManage={canManage || canApprove} />
      <OutcomeNoticeView noticeKey={`inventory:${clinicId}`} />
      <Card className="mb-6" aria-labelledby="st-h">
        <h2 id="st-h" className="mb-3 text-xl font-bold">
          Lots
        </h2>
        {stock.lots.length === 0 ? (
          <EmptyState title="No lots registered yet">{canManage ? "Register a lot, then receive stock into a location." : "Lots are registered by someone with the Inventory clerk role. If nobody has it yet, an access administrator grants it under Staff access (a second person approves)."}</EmptyState>
        ) : (
          <ul className="-mx-5 divide-y divide-line sm:-mx-6">
            {stock.lots.map((l) => (
              <li key={l.lotId} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {l.product} <span className="font-normal text-ink-soft">· lot {l.lot}</span>
                  </p>
                  <span className="flex flex-wrap gap-2">
                    {l.disposition === "recalled" ? <StatusChip tone="danger">Recalled</StatusChip> : l.disposition === "quarantined" ? <StatusChip tone="review">Quarantined</StatusChip> : l.expired ? <StatusChip tone="danger">Expired</StatusChip> : <StatusChip tone="success">In date</StatusChip>}
                  </span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="inline text-ink-soft">Expires: </dt>
                    <dd className="inline font-semibold">{formatDate(l.expiresOn)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-ink-soft">On hand: </dt>
                    <dd className="inline font-semibold">
                      {n(l.physicalOnHand)} {l.stockUnit}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-ink-soft">Usable: </dt>
                    <dd className="inline font-semibold">
                      {n(l.usable)} {l.stockUnit}
                    </dd>
                  </div>
                </dl>
                {l.locations.length > 0 ? (
                  <p className="mt-1 text-sm text-ink-soft">{l.locations.map((x) => `${locName.get(x.locationId) ?? "location"}: ${n(x.onHand)}`).join(" · ")}</p>
                ) : null}
                <LotActions clinicId={clinicId} lotId={l.lotId} disposition={l.disposition} canManage={canManage} canApprove={canApprove} canLedger={canManage} canTrace={canApprove && caps.has("child.read_clinical")} clinicTimezone={membership.clinicTimezone} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card aria-labelledby="rl-h">
            <h2 id="rl-h" className="mb-3 text-xl font-bold">
              Register a lot
            </h2>
            <RegisterLotForm clinicId={clinicId} products={products.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))} />
          </Card>
          <Card aria-labelledby="rc-h">
            <h2 id="rc-h" className="mb-3 text-xl font-bold">
              Receive stock
            </h2>
            <ReceiveForm clinicId={clinicId} lots={receivableLots} locations={usableLocs.map((l) => ({ id: l.id, label: l.name }))} />
          </Card>
          <Card aria-labelledby="wa-h">
            <h2 id="wa-h" className="mb-3 text-xl font-bold">
              Record wastage
            </h2>
            <WastageForm clinicId={clinicId} lots={lotOptions} locations={locOptions} />
          </Card>
          <Card aria-labelledby="co-h">
            <h2 id="co-h" className="mb-3 text-xl font-bold">
              Physical count
            </h2>
            <CountForm clinicId={clinicId} lots={lotOptions} locations={locOptions} />
          </Card>
          <Card aria-labelledby="lo-h" className="lg:col-span-2">
            <h2 id="lo-h" className="mb-3 text-xl font-bold">
              Stock locations
            </h2>
            {stock.locations.length === 0 ? (
              <p className="mb-3 text-ink-soft">No locations yet. Create a usable location (for example, the fridge) and a quarantine location.</p>
            ) : (
              <ul className="mb-3 divide-y divide-line rounded-control border border-line">
                {stock.locations.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                    <span className={l.status === "active" ? "" : "text-ink-soft"}>
                      {l.name} · {LOCATION_KIND[l.kind] ?? l.kind}
                      {l.status === "active" ? "" : " · closed"}
                    </span>
                    {l.status === "active" && l.kind !== "in_transit" ? <CloseLocation clinicId={clinicId} locationId={l.id} name={l.name} /> : null}
                  </li>
                ))}
              </ul>
            )}
            <LocationForm clinicId={clinicId} />
          </Card>
        </div>
      ) : null}

      {canApprove ? (
        <Card className="mt-6" aria-labelledby="rec-h">
          <h2 id="rec-h" className="mb-3 text-xl font-bold">
            Check the books
          </h2>
          <ReconcilePanel clinicId={clinicId} />
        </Card>
      ) : null}
    </>
  );
}
