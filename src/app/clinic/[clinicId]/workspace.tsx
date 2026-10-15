"use client";
import Link from "next/link";
import { QrScanner } from "./qr-scanner";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip, TextField, recordStatusChip } from "@/components/ui";
import { callApi, useMutation } from "@/lib/client/api";

import { formatDate } from "@/lib/format";

interface Hit {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
  dobPrecision: string;
  recordStatus: string;
}

const fmt = (d: string | null) => formatDate(d, { fallback: "DOB not recorded" });

export function ChildList({ clinicId, items }: { clinicId: string; items: Hit[] }) {
  return (
    <ul className="divide-y divide-line rounded-control border border-line" aria-label="Matching children">
      {items.map((h) => (
        <li key={h.childId}>
          <Link href={`/clinic/${clinicId}/children/${h.childId}`} className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-canvas">
            <span>
              <span className="block font-bold">{h.displayName}</span>
              <span className="text-sm text-ink-soft">
                {h.localRecordNo} · {fmt(h.dob)}
              </span>
            </span>
            {h.recordStatus === "active" ? <StatusChip tone="success">Verified record</StatusChip> : h.recordStatus === "provisional" ? <StatusChip tone="review">Awaiting verification</StatusChip> : recordStatusChip(h.recordStatus)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ChildSearch({ clinicId }: { clinicId: string }) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchSequence = useRef(0);

  function clearSearch() {
    searchSequence.current++;
    setItems(null);
    setError(null);
    setBusy(false);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const q = String(f.get("q") ?? "").trim();
    const dob = String(f.get("dob") ?? "");
    const sequence = ++searchSequence.current;
    setItems(null);
    if (q.length < 2 && !dob) return setError("Enter at least two letters of the parent or child name, the record number, or a date of birth.");
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ q });
    if (dob) params.set("dob", dob);
    const res = await callApi<Hit[]>(`/api/v1/clinics/${clinicId}/children?${params}`);
    if (sequence !== searchSequence.current) return;
    setBusy(false);
    if (res.ok) setItems(res.data);
    else setError(res.message);
  }

  return (
    <div>
      <form onSubmit={submit} role="search" className="grid gap-x-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <TextField id="q" name="q" label="Name or record number" hint="Search by parent or child name. Authorized registration staff can also use a contact." autoComplete="off" onChange={clearSearch} />
        <TextField id="sdob" name="dob" type="date" label="Date of birth (optional)" onChange={clearSearch} />
        <div className="mb-4">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Searching…" : "Search"}
          </Button>
        </div>
      </form>
      <ResultRegion>
        {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
        {items && items.length === 0 ? <EmptyState title="No child found at this clinic">Check the spelling, try the date of birth, or register the child below.</EmptyState> : null}
        {items && items.length >= 20 ? <Notice role="status">Showing up to 20 matches. There may be more. Add the date of birth or use the record number to narrow the search.</Notice> : null}
        {items && items.length > 0 ? <ChildList clinicId={clinicId} items={items} /> : null}
      </ResultRegion>
    </div>
  );
}

export function QrLookup({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await open(String(new FormData(e.currentTarget).get("token") ?? "").trim());
  }
  async function open(token: string) {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    const res = await callApi<{ childId: string }>(`/api/v1/clinics/${clinicId}/qr/resolve`, { method: "POST", body: { token }, key: crypto.randomUUID() });
    setBusy(false);
    if (res.ok) router.push(`/clinic/${clinicId}/children/${res.data.childId}`);
    else setMsg(res.status === 404 ? "This QR pass is not valid at this clinic. Search by name instead." : res.message);
  }
  return (
    <form onSubmit={submit}>
      <QrScanner onCode={open} />
      <TextField id="token" name="token" label="QR pass code" hint="Type or paste the code if the camera is unavailable." autoComplete="off" spellCheck={false} />
      <ResultRegion>{msg ? <Notice tone="attention" role="alert">{msg}</Notice> : null}</ResultRegion>
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Checking…" : "Open record"}
      </Button>
    </form>
  );
}

interface Candidate {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
  sameDob: boolean;
}
type RegisterResult = { created: boolean; childId?: string; localRecordNo?: string; candidates: Candidate[] };

export function RegisterChildForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation<RegisterResult>(`/api/v1/clinics/${clinicId}/children`);
  const [precision, setPrecision] = useState<"exact" | "estimated" | "unknown">("exact");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [candidateResult, setCandidateResult] = useState<RegisterResult | null>(null);
  const editSequence = useRef(0);
  const fieldErrors = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};

  function invalidateCandidates() {
    editSequence.current++;
    setPayload(null);
    setCandidateResult(null);
  }

  function build(f: FormData, confirmedDistinct: boolean) {
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const gname = v("gname");
    return {
      child: {
        givenNames: v("givenNames"),
        familyName: v("familyName"),
        dobPrecision: precision,
        dob: precision === "exact" ? v("dob") : undefined,
        estimatedBirthStart: precision === "estimated" ? v("estStart") : undefined,
        estimatedBirthEnd: precision === "estimated" ? v("estEnd") : undefined,
        sex: v("sex"),
      },
      guardian: gname ? { fullName: gname, relationship: v("grel"), phone: v("gphone"), verifiedInPerson: f.get("gverified") === "on" } : undefined,
      confirmedDistinct,
      identityConfirmed: f.get("idconfirmed") === "on",
    };
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sequence = editSequence.current;
    const body = build(new FormData(e.currentTarget), false);
    setPayload(null);
    setCandidateResult(null);
    const res = await run(body);
    if (!res?.ok) return;
    if (res.data.created) {
      if (sequence === editSequence.current) (e.target as HTMLFormElement).reset();
    } else if (sequence === editSequence.current) {
      setPayload(body);
      setCandidateResult(res.data);
    }
  }
  async function registerAnyway() {
    if (!payload) return;
    const body = { ...payload, confirmedDistinct: true };
    const res = await run(body);
    if (res?.ok && res.data.created) router.refresh();
  }

  const result = state.phase === "success" && state.data.created ? state.data : candidateResult;
  return (
    <form onSubmit={submit} onChange={invalidateCandidates}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="r-given" name="givenNames" label="Given name(s)" required autoComplete="off" error={fieldErrors["child.displayName"]} />
        <TextField id="r-family" name="familyName" label="Family name" autoComplete="off" />
        <SelectField id="r-prec" label="How well is the birth date known?" value={precision} onChange={(e) => setPrecision(e.target.value as typeof precision)}>
          <option value="exact">Exact date known</option>
          <option value="estimated">Estimated range</option>
          <option value="unknown">Unknown</option>
        </SelectField>
        {precision === "exact" ? <TextField id="r-dob" name="dob" type="date" label="Date of birth" required error={fieldErrors["child.dob"]} /> : <div />}
        {precision === "estimated" ? (
          <>
            <TextField id="r-es" name="estStart" type="date" label="Earliest possible" required />
            <TextField id="r-ee" name="estEnd" type="date" label="Latest possible" required />
          </>
        ) : null}
        <SelectField id="r-sex" name="sex" label="Sex (only if needed for care)" defaultValue="not_recorded">
          <option value="not_recorded">Not recorded</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </SelectField>
      </div>
      <fieldset className="mb-4 rounded-control border border-line p-4">
        <legend className="px-1 font-bold">Accompanying adult (optional)</legend>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <TextField id="g-name" name="gname" label="Full name" autoComplete="off" />
          <SelectField id="g-rel" name="grel" label="Relationship" defaultValue="other">
            <option value="mother">Mother</option>
            <option value="father">Father</option>
            <option value="grandparent">Grandparent</option>
            <option value="aunt_uncle">Aunt or uncle</option>
            <option value="legal_guardian">Legal guardian</option>
            <option value="other">Other</option>
          </SelectField>
          <TextField id="g-phone" name="gphone" label="Phone (optional)" type="tel" autoComplete="off" />
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="gverified" className="size-5" /> I checked this adult&apos;s identity and authority in person
        </label>
      </fieldset>
      <label className="mb-4 flex min-h-11 items-center gap-2">
        <input type="checkbox" name="idconfirmed" className="size-5" /> I confirmed the child&apos;s identity (marks the record verified)
      </label>

      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {result && result.created ? (
          <Notice tone="success" role="status" title={`Registered — record ${result.localRecordNo}`}>
            <Link className="font-semibold underline" href={`/clinic/${clinicId}/children/${result.childId}`}>
              Open the child&apos;s record
            </Link>
          </Notice>
        ) : null}
        {result && !result.created ? (
          <Notice tone="review" role="status" title="Possible existing record — check before registering">
            <ul className="my-2 list-disc pl-5">
              {result.candidates.map((c) => (
                <li key={c.childId}>
                  <Link className="font-semibold underline" href={`/clinic/${clinicId}/children/${c.childId}`} target="_blank">
                    {c.displayName}
                  </Link>{" "}
                  ({c.localRecordNo}, {fmt(c.dob)}
                  {c.sameDob ? ", same date of birth" : ""})
                </li>
              ))}
            </ul>
            <p className="mb-2">Twins and siblings can look similar. Only register a new record if this is genuinely a different child.</p>
            <Button variant="danger" onClick={registerAnyway} pending={state.phase === "pending"}>
              This is a different child — register anyway
            </Button>
          </Notice>
        ) : null}
      </ResultRegion>
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Checking and saving…" : "Check for existing records and register"}
      </Button>
    </form>
  );
}
