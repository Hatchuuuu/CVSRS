"use client";
import { personName } from "@/lib/person-name";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { VACCINATION_CARE_FIELDS, type VaccinationCareDraft } from "@/lib/validation/vaccination-care";
import { callApi, useMutation, type MutationState } from "@/lib/client/api";
import { clinicLocalToInstant, formatClinicDateTime, formatDate, instantToClinicLocal } from "@/lib/format";

export interface StockLotOption {
  lotId: string;
  lot: string;
  product: string;
  productCode: string;
  expiresOn: string;
  disposition: string;
  expired: boolean;
  usable: string;
  locations: { locationId: string; onHand: string }[];
}
export interface StockLocationOption {
  id: string;
  name: string;
  kind: string;
  status: string;
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: ReactNode }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved — nothing was recorded"}>
          {state.error.message}
          {state.error.requestId ? <span className="block text-sm text-ink-soft">Reference: {state.error.requestId}</span> : null}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title="Recorded">{ok}</Notice> : null}
    </ResultRegion>
  );
}

/**
 * `datetime-local` has no zone. Times are read and shown as CLINIC wall time, never the device's, so a tablet left on UTC
 * still records 07:00 Manila as 07:00 Manila (the database dates the dose in the clinic zone). An unreadable value is
 * sent as missing, so the server's validation message is shown instead of a guessed time.
 */
const clinicNow = (clinicTimezone: string) => instantToClinicLocal(new Date(), clinicTimezone);
const toIso = (local: string, clinicTimezone: string) => clinicLocalToInstant(local, clinicTimezone) ?? undefined;
const zoneHint = (clinicTimezone: string, rest = "") => `Clinic time (${clinicTimezone}).${rest ? ` ${rest}` : ""}`;

function usableLots(lots: StockLotOption[]) {
  return lots.filter((l) => l.disposition === "usable" && !l.expired && Number(l.usable) > 0);
}

/**
 * Two steps on purpose (BP18): fill in, then REVIEW against the child's name, then sign. The child banner stays pinned above.
 * The database re-checks identity, visit, lot, stock and the approved schedule; a refusal saves nothing.
 */
export function AdministerPanel({ clinicId, clinicTimezone, initialClinicTime, encounterId, childName, recordNo, lots, locations }: { clinicId: string; clinicTimezone: string; initialClinicTime: string; encounterId: string; childName: string; recordNo: string; lots: StockLotOption[]; locations: StockLocationOption[] }) {
  const router = useRouter();
  const { state, run, reset } = useMutation<{ creditedRequirements: string[]; scheduleEvaluated: boolean; administeredOn: string }>(`/api/v1/clinics/${clinicId}/encounters/${encounterId}/administrations`);
  const options = useMemo(() => usableLots(lots), [lots]);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [lotId, setLotId] = useState(options[0]?.lotId ?? "");
  const [locationId, setLocationId] = useState("");
  const [when, setWhen] = useState(initialClinicTime);
  const [maxWhen, setMaxWhen] = useState(initialClinicTime);
  const [route, setRoute] = useState("");
  const [site, setSite] = useState("");
  const [assess, setAssess] = useState("");
  const [consent, setConsent] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [care, setCare] = useState<VaccinationCareDraft>({});
  const lot = options.find((l) => l.lotId === lotId);
  const usableLocs = (lot?.locations ?? []).filter((x) => Number(x.onHand) > 0 && locations.find((l) => l.id === x.locationId)?.kind === "usable");
  const chosenLoc = locationId || usableLocs[0]?.locationId || "";
  const locName = locations.find((l) => l.id === chosenLoc)?.name ?? "";
  const needsRepeat = state.phase === "error" && /genuine repeat/.test(state.error.message);

  async function sign() {
    if (!lot) return;
    const r = await run({
      lotId: lot.lotId,
      locationId: chosenLoc,
      administeredAt: toIso(when, clinicTimezone),
      route: route.trim() || undefined,
      site: site.trim() || undefined,
      assessmentReference: assess.trim() || undefined,
      consentReference: consent.trim() || undefined,
      confirmRepeat: repeat || undefined,
      care: Object.values(care).some(value => value?.trim()) ? care : undefined,
    });
    if (r?.ok) router.refresh();
  }

  function startAnother() {
    reset();
    setStep("edit");
    setLotId(options[0]?.lotId ?? "");
    setLocationId("");
    const now = clinicNow(clinicTimezone);
    setWhen(now);
    setMaxWhen(now);
    setRoute("");
    setSite("");
    setRepeat(false);
    setCare({});
  }

  if (state.phase === "success") {
    return (
      <div>
        <Notice tone="success" role="status" title="Vaccination recorded and signed">
          Saved for <strong>{childName}</strong>. One dose was taken from stock.{" "}
          {state.data.scheduleEvaluated ? (state.data.creditedRequirements.length ? `Counted toward: ${state.data.creditedRequirements.join(", ")}.` : "It did not match a schedule requirement, so no credit was given.") : "No approved schedule is active, so the schedule was not evaluated."}
        </Notice>
        <Button variant="secondary" onClick={startAnother}>
          Record another vaccine for {childName}
        </Button>
      </div>
    );
  }

  if (options.length === 0) {
    return <Notice tone="attention" title="No usable stock">There is no in-date, unquarantined vaccine on hand. Ask inventory staff to receive stock, or use “Record care already given” below if the vaccine has already been given.</Notice>;
  }

  if (step === "review") {
    const givenAt = clinicLocalToInstant(when, clinicTimezone);
    return (
      <div>
        <Notice tone="info" title={`Check this is the right child: ${childName} (record ${recordNo})`}>
          Signing records that <strong>you</strong> confirm this vaccine was given. It cannot be deleted afterwards, only corrected with a reason.
        </Notice>
        <dl className="mb-5 grid gap-x-8 gap-y-2 rounded-control border border-line bg-surface p-4 sm:grid-cols-2">
          <Row k="Vaccine" v={lot?.product ?? ""} />
          <Row k="Lot" v={`${lot?.lot} · expires ${formatDate(lot?.expiresOn)}`} />
          <Row k="Taken from" v={locName} />
          <Row k="Given at" v={givenAt ? `${formatClinicDateTime(givenAt, clinicTimezone)} (${clinicTimezone} time)` : "Not a valid time: go back and edit"} />
          <Row k="Route / site" v={[route, site].filter(Boolean).join(" · ") || "Not recorded"} />
          <Row k="Assessment / consent" v={[assess, consent].filter(Boolean).join(" · ") || "Not recorded"} />
          {VACCINATION_CARE_FIELDS.filter(field => care[field.key]?.trim()).map(field => <Row key={field.key} k={field.label} v={care[field.key]!.trim()} />)}
        </dl>
        {needsRepeat ? (
          <label className="mb-4 flex min-h-11 items-start gap-2">
            <input type="checkbox" className="mt-1 size-5" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <span>A similar record already exists today. I confirm this is a genuine repeat administration.</span>
          </label>
        ) : null}
        <Outcome state={state} />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setStep("edit")} disabled={state.phase === "pending"}>
            Back and edit
          </Button>
          <Button onClick={sign} disabled={state.phase === "pending"}>
            {state.phase === "pending" ? "Saving…" : state.phase === "error" && state.error.unknown ? "Check and save again (safe to repeat)" : "Sign and record"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStep("review");
      }}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField id="ad-lot" label="Vaccine and lot" value={lotId} onChange={(e) => { setLotId(e.target.value); setLocationId(""); }} required>
          {options.map((l) => (
            <option key={l.lotId} value={l.lotId}>
              {l.product} · lot {l.lot} · exp {formatDate(l.expiresOn)} · {Number(l.usable)} usable
            </option>
          ))}
        </SelectField>
        <SelectField id="ad-loc" label="Taken from" value={chosenLoc} onChange={(e) => setLocationId(e.target.value)} required>
          {usableLocs.map((x) => (
            <option key={x.locationId} value={x.locationId}>
              {locations.find((l) => l.id === x.locationId)?.name} ({Number(x.onHand)})
            </option>
          ))}
        </SelectField>
        <TextField id="ad-when" type="datetime-local" label="Actual time given" value={when} onFocus={() => setMaxWhen(clinicNow(clinicTimezone))} onChange={(e) => { setWhen(e.target.value); setMaxWhen(clinicNow(clinicTimezone)); }} max={maxWhen} required hint={zoneHint(clinicTimezone, "The real time of the injection, not the time you are typing it in.")} />
        <TextField id="ad-route" label="Route (if required by clinic policy)" value={route} onChange={(e) => setRoute(e.target.value)} />
        <TextField id="ad-site" label="Site (if required by clinic policy)" value={site} onChange={(e) => setSite(e.target.value)} />
        <TextField id="ad-as" label="Assessment reference" value={assess} onChange={(e) => setAssess(e.target.value)} hint="Reference to the clinic's pre-vaccination assessment." />
        <TextField id="ad-co" label="Consent reference" value={consent} onChange={(e) => setConsent(e.target.value)} hint="Reference to consent as the clinic records it." />
      </div>
      <fieldset className="mb-6 mt-4 rounded-control border border-line p-4">
        <legend className="px-1 font-bold">Care instructions for the family</legend>
        <p className="mb-4 text-sm text-ink-soft">Complete the relevant fields. These details are saved with the vaccination and shown to verified family members with your name and date. The app does not generate medicine or dosage advice.</p>
        <div className="grid gap-x-4 sm:grid-cols-2">{VACCINATION_CARE_FIELDS.map(field => <Field key={field.key} id={`care-${field.key}`} label={field.label} hint={field.hint}>
          <textarea id={`care-${field.key}`} aria-describedby={`care-${field.key}-hint`} rows={3} maxLength={500} value={care[field.key] ?? ""} onChange={event => setCare(current => ({ ...current, [field.key]: event.target.value }))} className="block w-full rounded-control border border-line-strong bg-surface px-3 py-2" />
        </Field>)}</div>
      </fieldset>
      <Button type="submit" disabled={!lot || !chosenLoc}>
        Review before signing
      </Button>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{k}</dt>
      <dd className="whitespace-pre-wrap break-words font-semibold">{v}</dd>
    </div>
  );
}

/** Care already given that the normal path refused (or could not be entered in time). Facts are preserved; no credit until reviewed. */
export function ExceptionForm({ clinicId, clinicTimezone, initialClinicTime, childId, encounterId, products, lots, locations }: { clinicId: string; clinicTimezone: string; initialClinicTime: string; childId: string; encounterId: string | null; products: { id: string; name: string }[]; lots: StockLotOption[]; locations: StockLocationOption[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ stockPosted: boolean; problems: string[]; reviewCaseId: string }>(`/api/v1/clinics/${clinicId}/children/${childId}/administration-exceptions`);
  const [when, setWhen] = useState(initialClinicTime);
  const [maxWhen, setMaxWhen] = useState(initialClinicTime);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const r = await run({
      encounterId: encounterId ?? undefined,
      reason: v("reason"),
      dose: { administeredAt: toIso(when, clinicTimezone), productId: v("productId"), productText: v("productText"), lotId: v("lotId"), lotText: v("lotText"), locationId: v("locationId"), route: v("route"), site: v("site") },
    });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <p className="mb-4 max-w-prose text-ink-soft">Use this only when the vaccine has <strong>already been given</strong> and the normal form would not accept it (for example a smudged lot number, a recalled lot, or timing outside the schedule). The record is kept, a lead reviews it, and it earns no schedule credit until accepted.</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="ex-when" type="datetime-local" label="Actual time given" value={when} onFocus={() => setMaxWhen(clinicNow(clinicTimezone))} onChange={(e) => { setWhen(e.target.value); setMaxWhen(clinicNow(clinicTimezone)); }} max={maxWhen} required hint={zoneHint(clinicTimezone)} error={fe["dose.administeredAt"]} />
        <SelectField id="ex-prod" name="productId" label="Vaccine (if known)" defaultValue="">
          <option value="">Not sure / describe below</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField id="ex-text" name="productText" label="Describe the vaccine (if not chosen)" />
        <SelectField id="ex-lot" name="lotId" label="Lot (if known)" defaultValue="">
          <option value="">Unknown / not listed</option>
          {lots.map((l) => (
            <option key={l.lotId} value={l.lotId}>
              {l.product} · lot {l.lot}
            </option>
          ))}
        </SelectField>
        <TextField id="ex-lottext" name="lotText" label="Lot as written (if not listed)" />
        <SelectField id="ex-loc" name="locationId" label="Taken from (if the lot is known)" defaultValue="">
          <option value="">Not known</option>
          {locations.filter((l) => l.kind === "usable").map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>
        <TextField id="ex-route" name="route" label="Route" />
        <TextField id="ex-site" name="site" label="Site" />
      </div>
      <TextField id="ex-reason" name="reason" label="Why could this not be recorded normally?" required minLength={3} error={fe.reason} />
      <Outcome
        state={state}
        ok={state.phase === "success" ? `Kept as pending evidence for review.${state.data.stockPosted ? " The dose was taken from stock." : " No stock was deducted; a stock check was opened for the reviewer."}` : undefined}
      />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Record care already given"}
      </Button>
    </form>
  );
}

interface Hit {
  childId: string;
  displayName: string;
  localRecordNo: string;
}

/** Proposal only: a different person with correction authority decides. `clinicTimezone` defaults to the clinics table default. */
export function CorrectionForm({ clinicId, clinicTimezone = "Asia/Manila", eventId, lots, locations }: { clinicId: string; clinicTimezone?: string; eventId: string; lots: StockLotOption[]; locations: StockLocationOption[] }) {
  const router = useRouter();
  const { state, run, reset } = useMutation<{ caseId: string }>(`/api/v1/clinics/${clinicId}/administrations/${eventId}/corrections`);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("correct_details");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [target, setTarget] = useState<Hit | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);

  async function search(q: string) {
    const sequence = ++searchSequence.current;
    setTarget(null);
    setHits(null);
    setSearchError(null);
    setSearching(false);
    if (q.trim().length < 2) return;
    setSearching(true);
    const res = await callApi<Hit[]>(`/api/v1/clinics/${clinicId}/children?${new URLSearchParams({ q })}`);
    if (sequence !== searchSequence.current) return;
    setSearching(false);
    if (res.ok) setHits(res.data);
    else setSearchError(res.message);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const reason = v("reason");
    let body: Record<string, unknown>;
    if (kind === "reattribute_child") body = { kind, reason, proposal: { toChildId: target?.childId } };
    else if (kind === "void_duplicate") body = { kind, reason, proposal: { stockEffect: v("stockEffect") } };
    else body = { kind, reason, proposal: { route: v("route"), site: v("site"), lotId: v("lotId"), locationId: v("locationId"), administeredAt: v("when") ? toIso(v("when")!, clinicTimezone) : undefined } };
    const r = await run(body);
    if (r?.ok) {
      setOpen(false);
      router.refresh();
    }
  }
  return (
    <div className="mt-2">
      <Button
        variant="quiet"
        onClick={() => {
          // A new request starts clean; the previous outcome belonged to the last one.
          if (!open) reset();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
      >
        Request a correction
      </Button>
      {/* Outside the form: a successful request closes the form, and the confirmation must stay (it used to unmount with it). */}
      <ResultRegion>
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title="Correction sent for approval">
            A different person with correction authority decides on it in the Review queue. The original entry stays as it is until then.
          </Notice>
        ) : null}
      </ResultRegion>
      {open ? (
        <form onSubmit={submit} className="mt-2 rounded-control border border-line bg-canvas p-4">
          <SelectField id={`ck-${eventId}`} label="What needs correcting?" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="correct_details">Wrong lot, time, route or site</option>
            <option value="reattribute_child">Recorded against the wrong child</option>
            <option value="void_duplicate">Entered twice (duplicate record)</option>
          </SelectField>
          {kind === "correct_details" ? (
            <div className="grid gap-x-4 sm:grid-cols-2">
              <SelectField id={`cl-${eventId}`} name="lotId" label="Correct lot (only if a different vial was used)" defaultValue="">
                <option value="">No change</option>
                {usableLots(lots).map((l) => (
                  <option key={l.lotId} value={l.lotId}>
                    {l.product} · lot {l.lot}
                  </option>
                ))}
              </SelectField>
              <SelectField id={`cll-${eventId}`} name="locationId" label="Taken from (with a new lot)" defaultValue="">
                <option value="">—</option>
                {locations.filter((l) => l.kind === "usable").map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
              <TextField id={`cw-${eventId}`} name="when" type="datetime-local" label="Correct time given" hint={zoneHint(clinicTimezone)} />
              <TextField id={`cr-${eventId}`} name="route" label="Route" />
              <TextField id={`cs-${eventId}`} name="site" label="Site" />
            </div>
          ) : null}
          {kind === "void_duplicate" ? (
            <SelectField id={`cv-${eventId}`} name="stockEffect" label="What happened to the vaccine?" defaultValue="return_to_stock">
              <option value="return_to_stock">It was never used: return it to stock</option>
              <option value="wastage">It was really used or lost: record as wastage</option>
              <option value="none">No stock effect</option>
            </SelectField>
          ) : null}
          {kind === "reattribute_child" ? (
            <div className="mb-4">
              <TextField id={`ct-${eventId}`} label="Find the correct child" onChange={(e) => void search(e.target.value)} autoComplete="off" />
              {searching ? <p role="status" className="text-ink-soft">Searching this clinic…</p> : null}
              {searchError ? <Notice tone="danger" role="alert" title="Search unavailable">{searchError} Try again before choosing the correct child.</Notice> : null}
              {hits?.length === 0 ? <p className="text-ink-soft">No matching child at this clinic.</p> : null}
              {hits?.map((h) => (
                <label key={h.childId} className="flex min-h-11 items-center gap-2">
                  <input type="radio" name={`tgt-${eventId}`} className="size-5" checked={target?.childId === h.childId} onChange={() => setTarget(h)} />
                  {personName(h.displayName)} · {h.localRecordNo}
                </label>
              ))}
            </div>
          ) : null}
          <TextField id={`cx-${eventId}`} name="reason" label="Reason (kept in the audit trail)" required minLength={3} />
          <Outcome state={state} />
          <Button type="submit" disabled={state.phase === "pending" || (kind === "reattribute_child" && !target)}>
            Send for approval
          </Button>
          <p className="mt-2 text-sm text-ink-soft">Nothing changes until a different person with correction authority approves. The original entry is always kept.</p>
        </form>
      ) : null}
    </div>
  );
}
