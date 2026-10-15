"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { announceOutcome } from "@/components/outcome-notice";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, Card, Notice, ResultRegion, SelectField, StatusChip, TextField } from "@/components/ui";
import { callApi, useMutation, type MutationState } from "@/lib/client/api";
import { formatDate } from "@/lib/format";
import { caseRenderer, caseTitle, quantity, textOf } from "./case-kinds";

export interface ReviewCase {
  caseId: string;
  /** Kinds come from the database; an unknown kind still renders (generic card). */
  kind: "duplicate" | "link" | "identity_edit" | "correction" | "clinical" | "stock" | "sync" | "appointment" | (string & {});
  status: string;
  reason: string;
  createdAt: string;
  evidence: Record<string, unknown>;
  childId: string | null;
  eventId?: string | null;
  createdBy?: string | null;
  candidateChildId: string | null;
  child: { displayName: string; localRecordNo: string; dob: string | null } | null;
  candidate: { displayName: string; localRecordNo: string; dob: string | null } | null;
  guardianName: string | null;
}
interface Hit {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
}

const dob = (d: string | null | undefined) => formatDate(d, { fallback: "DOB not recorded" });

/** The review queue page shows this key's notice under its title (see page.tsx). */
export const REVIEW_NOTICE_KEY = "review-queue";

/**
 * Errors stay in the card. A success is announced at the top of the queue instead: a decided case leaves the open list on the
 * refresh that follows, and its card (with anything it rendered) unmounts.
 */
function Outcome<T>({ state, ok }: { state: MutationState<T>; ok: string }) {
  useEffect(() => {
    if (state.phase === "success") announceOutcome(REVIEW_NOTICE_KEY, { title: ok });
  }, [state, ok]);
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );
}

/** `position` (item n of the list) makes each card region's accessible name unique, even for two cases about the same child. */
export function CaseCard({ clinicId, c, canVerify, canResolve, canEdit, canApproveStock = false, canApproveCorrection = false, myId = "", position }: { clinicId: string; c: ReviewCase; canVerify: boolean; canResolve: boolean; canEdit: boolean; canApproveStock?: boolean; canApproveCorrection?: boolean; myId?: string; position?: { n: number; of: number } }) {
  const evidence = c.evidence ?? {};
  const renderer = caseRenderer({ kind: c.kind, evidence });
  const safe = { ...c, evidence };
  const mine = !!c.createdBy && c.createdBy === myId;
  const regionName = [caseTitle(renderer), c.child ? `${c.child.displayName} (${c.child.localRecordNo})` : null, position ? `item ${position.n} of ${position.of}` : `case ${c.caseId.slice(0, 8)}`].filter(Boolean).join(", ");
  return (
    <Card aria-label={regionName}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`case-${c.caseId}`} className="text-lg font-bold">
          {caseTitle(renderer)}
        </h2>
        <StatusChip tone="review">Needs review</StatusChip>
      </div>
      {renderer === "link" ? <LinkCase clinicId={clinicId} c={safe} allowed={canVerify} /> : null}
      {renderer === "duplicate" ? <DuplicateCase clinicId={clinicId} c={safe} allowed={canResolve} /> : null}
      {renderer === "identity_edit" ? <EditCase clinicId={clinicId} c={safe} allowed={canEdit} /> : null}
      {renderer === "stock_count" ? <StockCountCase clinicId={clinicId} c={safe} allowed={canApproveStock} /> : null}
      {renderer === "stock_transfer" ? <StockTransferCase clinicId={clinicId} c={safe} /> : null}
      {renderer === "stock_exception" ? <StockExceptionCase clinicId={clinicId} c={safe} allowed={canResolve} /> : null}
      {renderer === "correction" ? <CorrectionCase clinicId={clinicId} c={safe} allowed={canApproveCorrection} mine={mine} /> : null}
      {renderer === "clinical_exception" ? <ExceptionCase clinicId={clinicId} c={safe} allowed={canApproveCorrection} mine={mine} /> : null}
      {renderer === "clinical_reported" ? <ReportedDoseCase clinicId={clinicId} c={safe} /> : null}
      {renderer === "appointment" ? <AppointmentCase clinicId={clinicId} c={safe} allowed={canResolve} /> : null}
      {renderer === "generic" ? <GenericCase clinicId={clinicId} c={safe} allowed={canResolve} /> : null}
    </Card>
  );
}

function RecordLink({ clinicId, childId, children }: { clinicId: string; childId: string | null; children: string }) {
  return childId ? (
    <Link href={`/clinic/${clinicId}/children/${childId}`} className="font-semibold underline">
      {children}
    </Link>
  ) : null;
}

/** Closes a case without changing any record (`resolve` with outcome `no_action`); the typed reason goes to the audit trail. */
function CloseCaseForm({ clinicId, c, label, reasonLabel, hint, ok }: { clinicId: string; c: ReviewCase; label: string; reasonLabel: string; hint?: string; ok: string }) {
  const router = useRouter();
  const done = useMutation(`/api/v1/clinics/${clinicId}/review-cases/${c.caseId}/resolve`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    const r = await done.run({ outcome: "no_action", reason });
    if (r?.ok) router.refresh();
  }
  const fe = done.state.phase === "error" ? done.state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="mt-4">
      <TextField id={`close-${c.caseId}`} name="reason" label={reasonLabel} hint={hint} required minLength={3} maxLength={500} error={fe?.reason} />
      <Button type="submit" variant="secondary" pending={done.state.phase === "pending"}>
        {label}
      </Button>
      <Outcome state={done.state} ok={ok} />
    </form>
  );
}

function ReportedDoseCase({ clinicId, c }: { clinicId: string; c: ReviewCase }) {
  const product = textOf(c.evidence.reportedProduct);
  const date = textOf(c.evidence.reportedDate);
  return (
    <div>
      <p>
        A guardian reported a vaccination given elsewhere: <strong>{product ?? "vaccine not named"}</strong>
        {date ? ` on ${formatDate(date)}` : ""}. It earns no credit until a clinician verifies it.
      </p>
      {c.childId ? (
        <RecordLink clinicId={clinicId} childId={c.childId}>
          Open the record to verify or decline
        </RecordLink>
      ) : (
        <p className="text-ink-soft">This report is not linked to a record. Find the child from the clinic workspace.</p>
      )}
    </div>
  );
}

function AppointmentCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const serviceDate = textOf(c.evidence.serviceDate);
  return (
    <div>
      <p>
        {c.child ? (
          <>
            <strong>{c.child.displayName}</strong> ({c.child.localRecordNo})
          </>
        ) : (
          "A child"
        )}{" "}
        was booked for {serviceDate ? <strong>{formatDate(serviceDate)}</strong> : "a session"}, and that session was closed. Contact the family to book another visit.
      </p>
      {c.reason ? <p className="text-ink-soft">Recorded: {c.reason}</p> : null}
      <RecordLink clinicId={clinicId} childId={c.childId}>
        Open the record for guardian contacts
      </RecordLink>
      {allowed ? (
        <CloseCaseForm clinicId={clinicId} c={c} label="Family contacted" reasonLabel="What was agreed (recorded in the audit trail)" hint="For example: spoke to the mother, booked for 14 October." ok="Marked as contacted" />
      ) : (
        <p className="mt-2 text-ink-soft">A reviewer closes this once the family has been contacted.</p>
      )}
    </div>
  );
}

function GenericCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  return (
    <div>
      <p>{c.reason ? c.reason : "No reason was recorded for this item."}</p>
      {c.child ? (
        <p className="text-ink-soft">
          Child: {c.child.displayName} ({c.child.localRecordNo})
        </p>
      ) : null}
      <RecordLink clinicId={clinicId} childId={c.childId}>
        Open the record
      </RecordLink>
      {allowed ? (
        <CloseCaseForm clinicId={clinicId} c={c} label="Close this item" reasonLabel="What was done (recorded in the audit trail)" hint="Closing changes no record." ok="Item closed" />
      ) : (
        <p className="mt-2 text-ink-soft">A reviewer must close this.</p>
      )}
    </div>
  );
}

function LinkCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const router = useRouter();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [searchPhase, setSearchPhase] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [searchError, setSearchError] = useState("");
  const searchSequence = useRef(0);
  const decide = useMutation(`/api/v1/clinics/${clinicId}/review-cases/${c.caseId}/resolve-link`);
  const ev = c.evidence as { childName?: string; dob?: string; relationship?: string; note?: string };

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    const sequence = ++searchSequence.current;
    setPicked(null);
    setHits(null);
    setSearchError("");
    setSearchPhase("pending");
    const res = await callApi<Hit[]>(`/api/v1/clinics/${clinicId}/children?${new URLSearchParams({ q })}`);
    if (sequence !== searchSequence.current) return;
    if (res.ok) {
      setHits(res.data);
      setSearchPhase("success");
    } else {
      setSearchError(res.message);
      setSearchPhase("error");
    }
  }
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked) return;
    const method = String(new FormData(e.currentTarget).get("method"));
    const r = await decide.run({ decision: "approve", childId: picked.childId, method });
    if (r?.ok) router.refresh();
  }
  async function reject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    const r = await decide.run({ decision: "reject", reason }, { method: "POST" });
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      <p>
        <strong>{c.guardianName ?? "A guardian"}</strong> asks to be linked to {ev.childName ? <>a child named <strong>{ev.childName}</strong></> : "a child (no name given)"}
        {ev.dob ? ` (born ${formatDate(ev.dob)})` : ""} as <strong>{(ev.relationship ?? "other").replace("_", " ")}</strong>.
      </p>
      {ev.note ? <p className="text-ink-soft">Note: {ev.note}</p> : null}
      {!allowed ? (
        <p className="mt-2 text-ink-soft">You do not have permission to decide guardian links.</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-bold">Find the child, then approve</h3>
            <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <TextField id={`q-${c.caseId}`} name="q" label="Search this clinic" defaultValue={ev.childName ?? ""} onChange={() => { searchSequence.current++; setSearchPhase("idle"); setHits(null); setPicked(null); }} />
              </div>
              <div className="mb-4">
                <Button type="submit" variant="secondary" disabled={searchPhase === "pending"}>
                  {searchPhase === "pending" ? "Searching…" : "Search"}
                </Button>
              </div>
            </form>
            {searchPhase === "pending" ? <p role="status" className="text-ink-soft">Searching this clinic…</p> : null}
            {searchPhase === "error" ? <Notice tone="danger" role="alert" title="Search unavailable">{searchError} No identity decision can be based on this search. Try again.</Notice> : null}
            {searchPhase === "success" && hits ? (
              hits.length === 0 ? (
                <p className="text-ink-soft">No matching child at this clinic. Reject if you cannot verify the request.</p>
              ) : (
                <fieldset className="mb-3">
                  <legend className="mb-1 font-semibold">Matching children</legend>
                  {hits.map((h) => (
                    <label key={h.childId} className="flex min-h-11 items-center gap-2">
                      <input type="radio" name={`pick-${c.caseId}`} className="size-5" checked={picked?.childId === h.childId} onChange={() => setPicked(h)} />
                      {h.displayName} · {h.localRecordNo} · {dob(h.dob)}
                    </label>
                  ))}
                </fieldset>
              )
            ) : null}
            {picked ? (
              <form onSubmit={approve}>
                <SelectField id={`meth-${c.caseId}`} name="method" label="How did you verify this adult?" defaultValue="in_person_id">
                  <option value="in_person_id">In person, with ID</option>
                  <option value="clinic_record">Existing clinic record</option>
                  <option value="invitation">Clinic invitation</option>
                  <option value="court_document">Court document</option>
                </SelectField>
                <Button type="submit" disabled={decide.state.phase === "pending"}>
                  Approve link to {picked.displayName}
                </Button>
              </form>
            ) : null}
          </div>
          <form onSubmit={reject}>
            <h3 className="mb-2 font-bold">Cannot verify</h3>
            <TextField id={`rej-${c.caseId}`} name="reason" label="Reason (recorded in the audit trail)" required minLength={3} />
            <Button type="submit" variant="danger" disabled={decide.state.phase === "pending"}>
              Reject request
            </Button>
          </form>
        </div>
      )}
      <Outcome state={decide.state} ok="Decision saved" />
    </div>
  );
}

function DuplicateCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const router = useRouter();
  const merge = useMutation(`/api/v1/clinics/${clinicId}/merges`);
  const distinct = useMutation(`/api/v1/clinics/${clinicId}/review-cases/${c.caseId}/resolve`);
  const person = (p: ReviewCase["child"], id: string | null) => (
    <div className="rounded-control border border-line p-3">
      <p className="font-bold">{p?.displayName ?? "Unavailable"}</p>
      {p ? (
        <p className="text-sm text-ink-soft">
          {p.localRecordNo} · {dob(p.dob)}
        </p>
      ) : null}
      {id ? (
        <Link href={`/clinic/${clinicId}/children/${id}`} className="text-sm font-semibold underline" target="_blank">
          Open record
        </Link>
      ) : null}
    </div>
  );
  const [pending, setPending] = useState<{ survivor: string; duplicate: string; keepNo: string; mergeNo: string } | null>(null);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(pending !== null, merge.state.phase === "pending");
  async function doMerge(survivor: string, duplicate: string, reason: string) {
    const r = await merge.run({ survivorId: survivor, duplicateId: duplicate, reason });
    if (r?.ok) {
      setPending(null);
      router.refresh();
    }
  }
  async function notDup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    const r = await distinct.run({ outcome: "not_duplicate", reason });
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      <p className="mb-3 text-ink-soft">Similar names or the same birth date do not prove these are the same child. Twins and siblings often match.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {person(c.child, c.childId)}
        {c.candidate ? person(c.candidate, c.candidateChildId) : <p className="text-ink-soft">The other record is at a clinic you cannot access.</p>}
      </div>
      {allowed && c.candidate && c.childId && c.candidateChildId ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={(event) => { triggerRef.current = event.currentTarget; setPending({ survivor: c.candidateChildId!, duplicate: c.childId!, keepNo: c.candidate!.localRecordNo, mergeNo: c.child?.localRecordNo ?? "" }); }} disabled={merge.state.phase === "pending"} aria-expanded={pending?.survivor === c.candidateChildId}>
            Same child — keep {c.candidate.localRecordNo}
          </Button>
          <Button variant="secondary" onClick={(event) => { triggerRef.current = event.currentTarget; setPending({ survivor: c.childId!, duplicate: c.candidateChildId!, keepNo: c.child?.localRecordNo ?? "", mergeNo: c.candidate!.localRecordNo }); }} disabled={merge.state.phase === "pending"} aria-expanded={pending?.survivor === c.childId}>
            Same child — keep {c.child?.localRecordNo}
          </Button>
        </div>
      ) : null}
      {allowed && pending ? (
        <div {...groupProps} aria-label="Confirm merge">
          <MergeConfirm caseId={c.caseId} keepNo={pending.keepNo} mergeNo={pending.mergeNo} busy={merge.state.phase === "pending"} onConfirm={(reason) => doMerge(pending.survivor, pending.duplicate, reason)} onCancel={() => setPending(null)} textProps={textProps} cancelProps={cancelProps} />
        </div>
      ) : null}
      {allowed ? (
        <form onSubmit={notDup} className="mt-4">
          <TextField id={`nd-${c.caseId}`} name="reason" label="Different children (e.g. twins)? Reason" required minLength={3} />
          <Button type="submit" variant="danger" disabled={distinct.state.phase === "pending"}>
            These are different children
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-ink-soft">Only a reviewer with merge permission can decide this.</p>
      )}
      <Outcome state={merge.state} ok="Records merged. The older record is preserved and points to the survivor." />
      <Outcome state={distinct.state} ok="Marked as different children" />
    </div>
  );
}

/** A merge cannot be undone, so the reviewer states the evidence they used; it is sent as the merge reason and kept in the audit trail. */
export function MergeConfirm({ caseId, keepNo, mergeNo, busy, onConfirm, onCancel, textProps, cancelProps }: { caseId: string; keepNo: string; mergeNo: string; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void; textProps?: ReturnType<typeof useConfirmStep>["textProps"]; cancelProps?: ReturnType<typeof useConfirmStep>["cancelProps"] }) {
  return (
    <form
      className="mt-3 rounded-control border border-attention bg-attention-bg p-3"
      aria-label="Confirm merge"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(String(new FormData(e.currentTarget).get("reason") ?? "").trim());
      }}
    >
      <p {...textProps} className="mb-3 text-sm font-semibold text-attention">
        Merge record {mergeNo} into {keepNo}? Its guardians, clinic enrolment and open bookings move to {keepNo}, its QR pass stops working, and {mergeNo} remains only as a pointer. There is no undo: open both records and check them first.
      </p>
      <TextField id={`mr-${caseId}`} name="reason" label="How you know they are the same child (recorded in the audit trail)" hint="For example: same mother and birth certificate number, checked in person." required minLength={3} maxLength={500} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={busy}>
          Yes, merge into {keepNo}
        </Button>
        <Button {...cancelProps} variant="secondary" disabled={busy} onClick={onCancel}>
          Do not merge
        </Button>
      </div>
    </form>
  );
}

function EditCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const router = useRouter();
  const done = useMutation(`/api/v1/clinics/${clinicId}/review-cases/${c.caseId}/resolve`);
  const patch = (c.evidence.patch ?? {}) as Record<string, unknown>;
  async function handled(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await done.run({ outcome: String(f.get("outcome")), reason: String(f.get("reason") ?? "") });
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      {Object.keys(patch).length === 0 ? (
        <p>A guardian asked for a change{c.reason ? ` (“${c.reason}”)` : ""}, but no field was listed.</p>
      ) : (
        <>
          <p>A guardian asked for these changes{c.reason ? ` (“${c.reason}”)` : ""}:</p>
          <ul className="my-2 list-disc pl-5">
            {Object.entries(patch).map(([k, v]) => (
              <li key={k}>
                {k}: <strong>{textOf(v) ?? "(left empty)"}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {c.childId ? (
        <Link href={`/clinic/${clinicId}/children/${c.childId}`} className="font-semibold underline">
          Open the record to apply verified changes
        </Link>
      ) : null}
      {allowed ? (
        <form onSubmit={handled} className="mt-4">
          <SelectField id={`o-${c.caseId}`} name="outcome" label="Outcome" defaultValue="no_action">
            <option value="no_action">Handled (changes applied or not needed)</option>
            <option value="rejected">Rejected</option>
          </SelectField>
          <TextField id={`ro-${c.caseId}`} name="reason" label="Reason / note" required minLength={3} />
          <Button type="submit" disabled={done.state.phase === "pending"}>
            Close request
          </Button>
        </form>
      ) : null}
      <Outcome state={done.state} ok="Request closed" />
    </div>
  );
}

const NOT_RECORDED = "not recorded";

/** A count above the auto-approve threshold: the only stock case that can be approved as an adjustment. */
function StockCountCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const router = useRouter();
  const approve = useMutation(`/api/v1/clinics/${clinicId}/stock/adjustments/${c.caseId}/approve`);
  const reject = useMutation(`/api/v1/clinics/${clinicId}/stock/adjustments/${c.caseId}/reject`);
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
  const ev = c.evidence;
  const delta = quantity(ev.delta);
  const sheet = textOf(ev.countReference);
  const why = textOf(ev.reason);
  return (
    <div>
      <p>
        A physical count found <strong>{quantity(ev.observed) ?? NOT_RECORDED}</strong> where the books showed <strong>{quantity(ev.book) ?? NOT_RECORDED}</strong>
        {delta ? ` (difference ${Number(ev.delta) > 0 ? "+" : ""}${delta})` : ""}. Count sheet: {sheet ?? NOT_RECORDED}.{why ? ` Reason given: “${why}”.` : ""}
      </p>
      <p className="text-ink-soft">On approval the difference is recalculated against the books as they are now, so movements since the count are respected.</p>
      {allowed ? (
        <div className="mt-3 space-y-3">
          {mode === "approve" ? (
            <div className="rounded-control border border-primary/30 bg-primary-soft p-3">
              <p className="mb-3 text-sm font-semibold">Post this count to the stock books? The ledger keeps it permanently; a later mistake needs a new count.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  pending={approve.state.phase === "pending"}
                  onClick={async () => {
                    const r = await approve.run();
                    if (r?.ok) router.refresh();
                  }}
                >
                  Yes, post the adjustment
                </Button>
                <Button variant="secondary" disabled={approve.state.phase === "pending"} onClick={() => setMode("none")}>Not yet</Button>
              </div>
            </div>
          ) : mode === "reject" ? (
            <form
              className="rounded-control border border-danger bg-danger-bg p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await reject.run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
                if (r?.ok) router.refresh();
              }}
            >
              <TextField id={`rj-${c.caseId}`} name="reason" label="Why the count is wrong (recorded in the audit trail)" required minLength={3} maxLength={500} />
              <p className="mb-3 text-sm">Nothing is posted. Ask for a recount if the books still look wrong.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" pending={reject.state.phase === "pending"}>Reject the count</Button>
                <Button variant="secondary" disabled={reject.state.phase === "pending"} onClick={() => setMode("none")}>Back</Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setMode("approve")}>Approve and post the adjustment…</Button>
              <Button variant="secondary" onClick={() => setMode("reject")}>Reject the count…</Button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-ink-soft">A different person with stock-approval authority must decide this.</p>
      )}
      <Outcome state={approve.state} ok="Adjustment posted" />
      <Outcome state={reject.state} ok="Count rejected" />
    </div>
  );
}

/** Opened when a transfer arrives short. It is decided (written off or returned) on the Transfers page, which closes this case. */
function StockTransferCase({ clinicId, c }: { clinicId: string; c: ReviewCase }) {
  const sent = quantity(c.evidence.sent);
  const received = quantity(c.evidence.received);
  const short = sent && received ? quantity(Number(c.evidence.sent) - Number(c.evidence.received)) : null;
  return (
    <div>
      <p>{c.reason ? c.reason : "A stock transfer arrived short"}.</p>
      <dl className="my-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="inline text-ink-soft">Units sent: </dt>
          <dd className="inline font-semibold">{sent ?? NOT_RECORDED}</dd>
        </div>
        <div>
          <dt className="inline text-ink-soft">Units received: </dt>
          <dd className="inline font-semibold">{received ?? NOT_RECORDED}</dd>
        </div>
        {short ? (
          <div>
            <dt className="inline text-ink-soft">Missing: </dt>
            <dd className="inline font-semibold">{short}</dd>
          </div>
        ) : null}
      </dl>
      <p className="text-sm text-ink-soft">An inventory approver other than the sender writes the shortfall off or returns it to stock on the Transfers page. That decision closes this case.</p>
      <Link href={`/clinic/${clinicId}/inventory/transfers`} className="font-semibold underline">
        Decide the shortfall on the Transfers page
      </Link>
    </div>
  );
}

/** Opened when care was recorded as an exception and no stock issue could be posted. Nothing here posts stock. */
function StockExceptionCase({ clinicId, c, allowed }: { clinicId: string; c: ReviewCase; allowed: boolean }) {
  const lot = textOf(c.evidence.reportedLot);
  const problems = Array.isArray(c.evidence.problems) ? c.evidence.problems.filter((p): p is string => typeof p === "string") : [];
  return (
    <div>
      <p>
        Care was recorded{c.child ? ` for ${c.child.displayName} (${c.child.localRecordNo})` : ""}, but no dose was deducted from stock. Check the lot and quantity, and post a count if the books are wrong.
      </p>
      <ul className="my-2 list-disc pl-5 text-ink-soft">
        <li>Lot written on the record: {lot ?? NOT_RECORDED}</li>
        {problems.map((p) => (
          <li key={p}>{problemText(p)}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <RecordLink clinicId={clinicId} childId={c.childId}>
          Open the child&apos;s record
        </RecordLink>
        <Link href={`/clinic/${clinicId}/inventory`} className="font-semibold underline">
          Open the stock page
        </Link>
      </div>
      {allowed ? (
        <CloseCaseForm clinicId={clinicId} c={c} label="Close this stock check" reasonLabel="What you checked or posted (recorded in the audit trail)" hint="Closing changes no stock. Post a physical count on the stock page first if the books are wrong." ok="Stock check closed" />
      ) : (
        <p className="mt-2 text-ink-soft">A reviewer closes this once the stock has been checked.</p>
      )}
    </div>
  );
}

const KIND_TEXT: Record<string, string> = { correct_details: "Correct details of the record", reattribute_child: "Move the record to a different child", void_duplicate: "Void the record as a duplicate" };
const EFFECT_TEXT: Record<string, string> = { return_to_stock: "return the unit to stock", wastage: "record the unit as wastage", none: "no stock effect" };

function CorrectionCase({ clinicId, c, allowed, mine }: { clinicId: string; c: ReviewCase; allowed: boolean; mine: boolean }) {
  const router = useRouter();
  const approve = useMutation(`/api/v1/clinics/${clinicId}/corrections/${c.caseId}/approve`);
  const reject = useMutation(`/api/v1/clinics/${clinicId}/corrections/${c.caseId}/reject`);
  const kind = textOf(c.evidence.kind);
  const proposal = c.evidence.proposal;
  const p = proposal && typeof proposal === "object" && !Array.isArray(proposal) ? (proposal as Record<string, unknown>) : {};
  return (
    <div>
      <p>
        <strong>{kind ? (KIND_TEXT[kind] ?? kind) : "Correction"}</strong>
        {c.child ? ` for ${c.child.displayName} (${c.child.localRecordNo})` : ""}.{c.reason ? ` Reason: “${c.reason}”.` : ""}
      </p>
      <ul className="my-2 list-disc pl-5 text-ink-soft">
        {Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
          <li key={k}>
            {k === "stockEffect" ? "Stock: " + (EFFECT_TEXT[String(v)] ?? String(v)) : `${k}: ${textOf(v) ?? JSON.stringify(v)}`}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">Approving keeps the original entry, adds a new revision, adjusts stock only if the physical facts changed, and recalculates the schedule.</p>
      {!allowed ? (
        <p className="mt-2 text-ink-soft">A clinical lead with correction authority must decide this.</p>
      ) : mine ? (
        <p className="mt-2 font-semibold">You requested this, so someone else must approve it.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Button
            disabled={approve.state.phase === "pending"}
            onClick={async () => {
              const r = await approve.run({});
              if (r?.ok) router.refresh();
            }}
          >
            Approve correction
          </Button>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await reject.run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
              if (r?.ok) router.refresh();
            }}
          >
            <TextField id={`rj-${c.caseId}`} name="reason" label="Reason to decline" required minLength={3} />
            <div className="mb-4">
              <Button type="submit" variant="danger" disabled={reject.state.phase === "pending"}>
                Decline
              </Button>
            </div>
          </form>
        </div>
      )}
      <Outcome state={approve.state} ok="Correction applied" />
      <Outcome state={reject.state} ok="Correction declined" />
    </div>
  );
}

const PROBLEM_TEXT: Record<string, string> = {
  product_not_mapped: "the vaccine was not matched to an approved product",
  lot_unknown: "the lot is not in the system",
  lot_recalled: "the lot is recalled",
  lot_quarantined: "the lot was quarantined",
  lot_expired: "the lot was expired",
  stock_unavailable: "no stock could be deducted",
  stock_not_posted: "no stock was deducted",
};
const problemText = (p: string) => PROBLEM_TEXT[p] ?? p.replace("timing_or_eligibility: ", "outside the approved schedule: ");

function ExceptionCase({ clinicId, c, allowed, mine }: { clinicId: string; c: ReviewCase; allowed: boolean; mine: boolean }) {
  const router = useRouter();
  const decide = useMutation(`/api/v1/clinics/${clinicId}/administrations/${c.eventId}/exception-decision`);
  const problems = Array.isArray(c.evidence.problems) ? c.evidence.problems.filter((p): p is string => typeof p === "string") : [];
  return (
    <div>
      <p>
        Care recorded as an exception{c.child ? ` for ${c.child.displayName} (${c.child.localRecordNo})` : ""}.{c.reason ? ` ${c.reason}` : ""}
      </p>
      <ul className="my-2 list-disc pl-5 text-ink-soft">
        {problems.map((p) => (
          <li key={p}>{problemText(p)}</li>
        ))}
        <li>{c.evidence.stockPosted === true ? "the dose was deducted from stock" : "no stock was deducted; a stock check was opened"}</li>
      </ul>
      <p className="text-sm text-ink-soft">It earns no schedule credit until accepted, and acceptance still cannot make a dose count that the approved schedule does not allow.</p>
      {!allowed ? (
        <p className="mt-2 text-ink-soft">A clinical lead with correction authority must decide this.</p>
      ) : mine ? (
        <p className="mt-2 font-semibold">You recorded this, so someone else must decide it.</p>
      ) : !c.eventId ? (
        <p className="mt-2 text-ink-soft">This case is not linked to a vaccination entry. Open the child&apos;s record to decide it.</p>
      ) : (
        <form
          className="mt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const r = await decide.run({ decision: submitter?.value === "reject" ? "reject" : "accept", note: String(f.get("note") ?? "") });
            if (r?.ok) router.refresh();
          }}
        >
          <TextField id={`ed-${c.caseId}`} name="note" label="Note for the record" required minLength={3} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" value="accept" disabled={decide.state.phase === "pending"}>
              Accept as given
            </Button>
            <Button type="submit" value="reject" variant="danger" disabled={decide.state.phase === "pending"}>
              Do not accept
            </Button>
          </div>
        </form>
      )}
      <Outcome state={decide.state} ok="Decision saved" />
    </div>
  );
}
