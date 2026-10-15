"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { announceOutcome } from "@/components/outcome-notice";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { callApi, useMutation, type MutationState } from "@/lib/client/api";
import { formatClinicDate, formatDate } from "@/lib/format";

interface Option {
  id: string;
  label: string;
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok: ReactNode }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : (state.error.code === "conflict" ? "Stock or record changed" : "Not saved")}>
          {state.error.message}
          {state.error.requestId ? <span className="block text-sm text-ink-soft">Reference: {state.error.requestId}</span> : null}
        </Notice>
      ) : null}
      {state.phase === "success" ? <Notice tone="success" role="status" title="Saved">{ok}</Notice> : null}
    </ResultRegion>
  );
}

const opts = (list: Option[]) => list.map((o) => (
  <option key={o.id} value={o.id}>
    {o.label}
  </option>
));
const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(",", "."));

export function LocationForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/locations`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ name: String(f.get("name") ?? "").trim(), kind: String(f.get("kind")) });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="border-t border-line pt-4">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="loc-name" name="name" label="Location name" required />
        <SelectField id="loc-kind" name="kind" label="Kind" defaultValue="usable">
          <option value="usable">Usable (available for care)</option>
          <option value="quarantine">Quarantine (never available)</option>
          <option value="in_transit">In transit</option>
        </SelectField>
      </div>
      <Outcome state={state} ok="Location created." />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Add location
      </Button>
    </form>
  );
}

/** Closes a location that no longer holds stock (a retired fridge). The database refuses while any stock or transfer remains. */
export function CloseLocation({ clinicId, locationId, name }: { clinicId: string; locationId: string; name: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/locations/${locationId}/close`);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="quiet" className="px-2" onClick={() => setOpen(true)} aria-label={`Close location ${name}`}>
        Close…
      </Button>
    );
  }
  return (
    <form
      className="mt-2 w-full rounded-control border border-line bg-sunken p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
        if (r?.ok) {
          announceOutcome(`inventory:${clinicId}`, { title: `${name} closed`, message: "The empty location is no longer available for stock." });
          router.refresh();
        }
      }}
    >
      <TextField id={`close-${locationId}`} name="reason" label={`Why is ${name} closing?`} required minLength={3} maxLength={500} hint="Only an empty location with nothing in transit can close." />
      <Outcome state={state} ok="Location closed." />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" pending={state.phase === "pending"}>Close the location</Button>
        <Button variant="secondary" disabled={state.phase === "pending"} onClick={() => setOpen(false)}>Keep it open</Button>
      </div>
    </form>
  );
}

export function RegisterLotForm({ clinicId, products }: { clinicId: string; products: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/lots`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ productId: String(f.get("productId")), manufacturerLot: String(f.get("lot") ?? "").trim(), expiresOn: String(f.get("expires") ?? ""), manufacturer: String(f.get("maker") ?? "").trim() || undefined });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <SelectField id="rl-prod" name="productId" label="Product" required>
        {opts(products)}
      </SelectField>
      <TextField id="rl-lot" name="lot" label="Lot number (as printed)" autoComplete="off" required error={fe.manufacturerLot} />
      <TextField id="rl-exp" name="expires" type="date" label="Expiry date (as printed)" required error={fe.expiresOn} />
      <TextField id="rl-maker" name="maker" label="Manufacturer (optional)" />
      <Outcome state={state} ok="Lot registered. Now receive stock into a location." />
      <Button type="submit" disabled={state.phase === "pending" || products.length === 0}>
        Register lot
      </Button>
    </form>
  );
}

export function ReceiveForm({ clinicId, lots, locations }: { clinicId: string; lots: Option[]; locations: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ accepted: boolean }>(`/api/v1/clinics/${clinicId}/stock/receipts`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ lotId: String(f.get("lotId")), locationId: String(f.get("locationId")), quantity: num(f, "qty"), deliveryReference: String(f.get("ref") ?? "").trim(), accepted: f.get("rejected") !== "on" });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <SelectField id="rc-lot" name="lotId" label="Lot" required>
        {opts(lots)}
      </SelectField>
      <SelectField id="rc-loc" name="locationId" label="Put into" required>
        {opts(locations)}
      </SelectField>
      <TextField id="rc-qty" name="qty" type="number" step="any" min="0" label="Quantity received" required error={fe.quantity} />
      <TextField id="rc-ref" name="ref" label="Delivery reference" required error={fe.deliveryReference} />
      <label className="mb-4 flex min-h-11 items-center gap-2">
        <input type="checkbox" name="rejected" className="size-5" /> The delivery is damaged or suspect (book into quarantine, not usable stock)
      </label>
      <Outcome state={state} ok={state.phase === "success" && !state.data.accepted ? "Booked into quarantine." : "Stock received."} />
      <Button type="submit" disabled={state.phase === "pending" || lots.length === 0 || locations.length === 0}>
        Receive stock
      </Button>
    </form>
  );
}

export function WastageForm({ clinicId, lots, locations }: { clinicId: string; lots: Option[]; locations: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/wastage`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ lotId: String(f.get("lotId")), locationId: String(f.get("locationId")), quantity: num(f, "qty"), reason: String(f.get("reason")), incidentReference: String(f.get("ref") ?? "").trim() || undefined });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit}>
      <SelectField id="wa-lot" name="lotId" label="Lot" required>
        {opts(lots)}
      </SelectField>
      <SelectField id="wa-loc" name="locationId" label="From" required>
        {opts(locations)}
      </SelectField>
      <TextField id="wa-qty" name="qty" type="number" step="any" min="0" label="Quantity" required />
      <SelectField id="wa-reason" name="reason" label="Reason" defaultValue="damaged">
        <option value="expired">Expired</option>
        <option value="damaged">Damaged</option>
        <option value="spoiled">Spoiled</option>
        <option value="breakage">Breakage</option>
        <option value="open_vial_discard">Open vial discarded</option>
        <option value="temperature_excursion">Temperature excursion</option>
        <option value="other">Other</option>
      </SelectField>
      <TextField id="wa-ref" name="ref" label="Incident reference (optional)" />
      <Outcome state={state} ok="Wastage recorded. It cannot be edited; a mistake is corrected with a new entry." />
      <Button type="submit" variant="danger" disabled={state.phase === "pending" || lots.length === 0}>
        Record wastage
      </Button>
    </form>
  );
}

export function CountForm({ clinicId, lots, locations }: { clinicId: string; lots: Option[]; locations: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ status: string; delta?: number }>(`/api/v1/clinics/${clinicId}/stock/adjustments`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ lotId: String(f.get("lotId")), locationId: String(f.get("locationId")), observed: num(f, "observed"), countReference: String(f.get("ref") ?? "").trim(), reason: String(f.get("reason") ?? "").trim() });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  const done = state.phase === "success" ? state.data : null;
  return (
    <form onSubmit={submit}>
      <SelectField id="co-lot" name="lotId" label="Lot" required>
        {opts(lots)}
      </SelectField>
      <SelectField id="co-loc" name="locationId" label="Location" required>
        {opts(locations)}
      </SelectField>
      <TextField id="co-obs" name="observed" type="number" step="any" min="0" label="Quantity you counted" required error={fe.observed} />
      <TextField id="co-ref" name="ref" label="Count sheet reference" required error={fe.countReference} />
      <TextField id="co-reason" name="reason" label="Why might it differ?" required error={fe.reason} />
      <Outcome
        state={state}
        ok={done?.status === "pending_approval" ? "The difference needs approval from a clinical lead before the books change." : done?.status === "no_difference" ? "The count matches the books." : "Count difference posted."}
      />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending" || lots.length === 0}>
        Submit count
      </Button>
    </form>
  );
}

interface LedgerRow {
  movementId: string;
  at: string;
  type: string;
  delta: string;
  unit: string;
  location: string;
  reference: string;
  reason: string | null;
}

/** A dose from the lot given to a child of this clinic (rows from before 0034 carry no `scope` and are these). */
interface TraceChild {
  scope?: "this_clinic";
  eventId: string;
  childName: string;
  recordNo: string;
  administeredOn: string | null;
  status: string | null;
  eventStatus: string | null;
}

/** Doses from the lot recorded at another clinic of the organisation: counted, never named (`trace_lot_use`, 0034). */
interface TraceOtherClinic {
  scope: "other_clinic";
  clinicId: string;
  clinicName: string | null;
  records: number;
}

type TraceRow = TraceChild | TraceOtherClinic;

const traceStatus = (t: TraceChild) => (t.eventStatus === "voided" ? "voided" : t.status ? t.status.replaceAll("_", " ") : "status not recorded");

/** The restricted recall list: this clinic's children by name, other clinics only as a count with the clinic named. */
export function LotTraceList({ trace }: { trace: TraceRow[] }) {
  if (trace.length === 0) return <p>No child has a recorded dose from this lot.</p>;
  return (
    <ul className="divide-y divide-line">
      {trace.map((t) =>
        t.scope === "other_clinic" ? (
          <li key={`other-${t.clinicId}`} className="py-2 text-ink-soft">
            {t.records === 1 ? "1 dose from this lot was" : `${t.records} doses from this lot were`} recorded at {t.clinicName ?? "another clinic"}. Ask that clinic for its list.
          </li>
        ) : (
          <li key={t.eventId} className="py-2">
            <strong>{t.childName}</strong> <span className="tnum text-ink-soft">{t.recordNo} · {formatDate(t.administeredOn)} · {traceStatus(t)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** `clinicTimezone`: ledger movements are timestamps, shown on the clinic's calendar (not the UTC date). */
export function LotActions({ clinicId, lotId, disposition, canManage, canApprove, canLedger, canTrace = false, clinicTimezone }: { clinicId: string; lotId: string; disposition: string; canManage: boolean; canApprove: boolean; canLedger: boolean; canTrace?: boolean; clinicTimezone: string }) {
  const router = useRouter();
  const [trace, setTrace] = useState<TraceRow[] | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const tracePending = useRef(false);
  // Each lookup is an audited disclosure of identifiable children: one request at a time, and hiding needs no request.
  async function showTrace() {
    if (trace) { setTrace(null); return; }
    if (tracePending.current) return;
    tracePending.current = true;
    setTraceLoading(true);
    setTraceError(null);
    const res = await callApi<TraceRow[]>(`/api/v1/clinics/${clinicId}/stock/lots/${lotId}/trace`);
    if (res.ok) setTrace(res.data);
    else setTraceError(res.message);
    tracePending.current = false;
    setTraceLoading(false);
  }
  const change = useMutation(`/api/v1/clinics/${clinicId}/stock/lots/${lotId}/disposition`);
  const [open, setOpen] = useState<"none" | "change" | "ledger">("none");
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const ledgerPending = useRef(false);

  async function showLedger() {
    if (open === "ledger") { setOpen("none"); return; }
    if (ledgerPending.current) return;
    setOpen("ledger");
    ledgerPending.current = true;
    setLedgerLoading(true);
    setLedger(null);
    setLedgerError(null);
    const res = await callApi<LedgerRow[]>(`/api/v1/clinics/${clinicId}/stock/lots/${lotId}/ledger`);
    if (res.ok) setLedger(res.data);
    else setLedgerError(res.message);
    ledgerPending.current = false;
    setLedgerLoading(false);
  }
  async function onChange(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await change.run({ disposition: String(f.get("disposition")), reason: String(f.get("reason") ?? "") });
    if (r?.ok) {
      announceOutcome(`inventory:${clinicId}`, { title: "Lot status updated", message: `The lot is now ${String(f.get("disposition"))}.` });
      setOpen("none");
      router.refresh();
    }
  }
  const allowed = [
    ...(disposition === "usable" && canManage ? ([["quarantined", "Quarantine this lot"]] as const) : []),
    ...(disposition !== "recalled" && canApprove ? ([["recalled", "Recall this lot"]] as const) : []),
    ...(disposition !== "usable" && canApprove ? ([["usable", "Release for use"]] as const) : []),
  ];
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-3">
        {canLedger ? (
          <Button variant="quiet" onClick={showLedger} aria-expanded={open === "ledger"}>
            {open === "ledger" ? "Hide ledger" : "Show ledger"}
          </Button>
        ) : null}
        {allowed.length > 0 ? (
          <Button variant="quiet" onClick={() => setOpen(open === "change" ? "none" : "change")} aria-expanded={open === "change"}>
            Change lot status
          </Button>
        ) : null}
        {canTrace ? (
          <Button variant="quiet" onClick={showTrace} pending={traceLoading} aria-expanded={trace !== null}>
            {trace ? "Hide who received this lot" : "Who received this lot"}
          </Button>
        ) : null}
      </div>
      {traceError ? <Notice tone="danger" role="alert">{traceError}</Notice> : null}
      {trace ? (
        <div className="mt-2 rounded-control border border-line bg-canvas p-3">
          <p className="mb-1 text-sm text-ink-soft">Restricted list, recorded in the audit trail. Use for recall follow-up only.</p>
          <LotTraceList trace={trace} />
        </div>
      ) : null}
      {open === "change" ? (
        <form onSubmit={onChange} className="mt-2 rounded-control border border-line p-3">
          <SelectField id={`d-${lotId}`} name="disposition" label="New status" defaultValue={allowed[0]?.[0]}>
            {allowed.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
          <TextField id={`dr-${lotId}`} name="reason" label="Reason (recorded in the audit trail)" required minLength={3} />
          <p className="mb-2 text-sm text-ink-soft">Stock is not deleted. It stays on the books and is simply not offered for care.</p>
          <Outcome state={change.state} ok="Lot status updated." />
          <Button type="submit" variant="danger" disabled={change.state.phase === "pending"}>
            Confirm
          </Button>
        </form>
      ) : null}
      {open === "ledger" ? (
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Lot ledger, scrolls sideways on small screens">
          {ledgerError ? <Notice tone="danger" role="alert">{ledgerError} Close and reopen the ledger to retry.</Notice> : null}
          {ledger ? (
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <caption className="sr-only">Every stock movement for this lot, oldest first</caption>
              <thead>
                <tr className="border-b border-line">
                  {["When", "Type", "Change", "Location", "Reference / reason"].map((h) => (
                    <th key={h} scope="col" className="p-2 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((m) => (
                  <tr key={m.movementId} className="border-b border-line">
                    <td className="p-2">{formatClinicDate(m.at, clinicTimezone)}</td>
                    <td className="p-2">{m.type.replace("_", " ")}</td>
                    <td className="p-2 font-semibold">
                      {Number(m.delta) > 0 ? "+" : ""}
                      {Number(m.delta)} {m.unit}
                    </td>
                    <td className="p-2">{m.location}</td>
                    <td className="p-2">{[m.reference, m.reason].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : ledgerLoading ? (
            <p role="status">Loading…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReconcilePanel({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const path = `/api/v1/clinics/${clinicId}/stock/reconcile`;
  // Separate keys: a check and a repair are different commands, so neither can replay or block the other.
  const check = useMutation<{ mismatches: unknown[]; repaired: boolean }>(path);
  const repair = useMutation<{ mismatches: unknown[]; repaired: boolean }>(path);
  const [last, setLast] = useState<"check" | "repair">("check");
  // Repair overwrites balances, so it is confirmed first; a check changes nothing and runs directly.
  const [confirmRepair, setConfirmRepair] = useState(false);
  const { triggerRef: repairTriggerRef, groupProps: repairGroupProps, textProps: repairTextProps, cancelProps: repairCancelProps } = useConfirmStep(confirmRepair, repair.state.phase === "pending");
  const state = last === "check" ? check.state : repair.state;
  const busy = check.state.phase === "pending" || repair.state.phase === "pending";
  return (
    <div>
      <p className="mb-3">Compares the running balances with the permanent ledger. Repair only rebuilds the balances; the ledger is never changed.</p>
      <ResultRegion>
        {state.phase === "success" ? (
          state.data.mismatches.length === 0 ? (
            <Notice tone="success" role="status" title="Books agree with the ledger" />
          ) : (
            <Notice tone={state.data.repaired ? "attention" : "danger"} role="status" title={`${state.data.mismatches.length} difference(s) found${state.data.repaired ? " and repaired" : ""}`}>
              {state.data.repaired ? "The balances were rebuilt from the ledger." : "Balances differ from the ledger. Investigate, then repair."}
            </Notice>
          )
        ) : null}
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : last === "check" ? "Could not check" : "Could not repair"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" pending={check.state.phase === "pending"} disabled={busy} onClick={() => { setLast("check"); void check.run({ repair: false }); }}>
          Check
        </Button>
        {!confirmRepair ? (
          <Button ref={repairTriggerRef} variant="danger" pending={repair.state.phase === "pending"} disabled={busy} onClick={() => setConfirmRepair(true)}>
            Check and repair balances
          </Button>
        ) : null}
      </div>
      {confirmRepair ? (
        <div {...repairGroupProps} className="mt-3 rounded-control border border-danger bg-danger-bg p-3" aria-label="Confirm balance repair">
          <p {...repairTextProps} className="mb-3 text-sm font-semibold text-danger">Rebuild the running balances from the ledger? Every balance that differs is replaced by the ledger total, and the stock figures on this page change to match. The ledger itself is not changed. Run “Check” first if you have not seen the differences.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              pending={repair.state.phase === "pending"}
              disabled={busy}
              onClick={async () => {
                setLast("repair");
                const r = await repair.run({ repair: true });
                if (r?.ok) {
                  setConfirmRepair(false);
                  router.refresh();
                }
              }}
            >
              Yes, repair balances
            </Button>
            <Button {...repairCancelProps} variant="secondary" disabled={busy} onClick={() => setConfirmRepair(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
