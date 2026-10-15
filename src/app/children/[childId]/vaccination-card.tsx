"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { CardScanner } from "./card-scanner";
export interface CardRow { productText: string; doseLabel?: string; administeredOn?: string; precision?: string; lotText?: string; provider?: string; notes?: string; source: "manual" | "ocr"; confidence?: number }
export interface CardSubmission { submissionId: string; rows: CardRow[]; status: string; version: number; decisionNote: string | null; createdAt: string }
const blank = (): CardRow => ({ productText: "", precision: "exact", source: "manual" });
export function VaccinationCard({ childId, submissions }: { childId: string; submissions: CardSubmission[] }) {
  const router = useRouter(); const [rows, setRows] = useState<CardRow[]>([blank()]); const [editing, setEditing] = useState<CardSubmission | null>(null); const [confirmed, setConfirmed] = useState(false);
  const { state, run } = useMutation(`/api/v1/children/${childId}/card-submissions`);
  const [scanning,setScanning]=useState(false);
  const patch = (index: number, name: keyof CardRow, value: string) => { setConfirmed(false); setRows(previous => previous.map((row, i) => i === index ? { ...row, [name]: value || undefined } : row)); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scanning || state.phase === "pending") return;
    const result = await run({ rows: rows.map(row => ({ ...row, administeredOn: row.precision === "unknown" ? undefined : row.administeredOn })), confirmed, ...(editing ? { submissionId: editing.submissionId, expectedVersion: editing.version } : {}) });
    if (result?.ok) { setRows([blank()]); setEditing(null); setConfirmed(false); router.refresh(); }
  }
  const errors = state.phase === "error" ? state.error.fieldErrors ?? {} : {};
  const duplicate = rows.some((row, index) => rows.slice(0, index).some(other => other.productText.toLowerCase() === row.productText.toLowerCase() && other.administeredOn === row.administeredOn && row.productText));
  return <div className="space-y-6">
    <form onSubmit={submit}>
      <CardScanner disabled={state.phase === "pending"} onScanningChange={setScanning} onRows={candidates => { setRows(candidates.map(row => ({ ...row, precision: row.administeredOn ? "exact" : "unknown" }))); setConfirmed(false); }} />
      <fieldset disabled={scanning || state.phase === "pending"}>
      <legend className="sr-only">Review card entries</legend>
      {editing ? <Notice tone="review" title="Editing the requested changes">{editing.decisionNote}</Notice> : null}
      {rows.map((row, index) => <fieldset key={index} className="mb-5 rounded-control border border-line p-4"><legend className="px-1 font-bold">Card entry {index + 1}{row.source === "ocr" ? " · extracted: every field needs review" : ""}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField id={`card-vaccine-${index}`} label="Vaccine as written" value={row.productText} onChange={e => patch(index,"productText",e.target.value)} required maxLength={200} error={errors[`rows.${index}.productText`]} />
          <TextField id={`card-dose-${index}`} label="Dose number / label" value={row.doseLabel ?? ""} onChange={e => patch(index,"doseLabel",e.target.value)} maxLength={40} />
          <SelectField id={`card-precision-${index}`} label="Date certainty" value={row.precision ?? "exact"} onChange={e => patch(index,"precision",e.target.value)}><option value="exact">Exact date</option><option value="month">Month only</option><option value="year">Year only</option><option value="unknown">Unknown</option></SelectField>
          <TextField id={`card-date-${index}`} label="Date given" type="date" value={row.administeredOn ?? ""} onChange={e => patch(index,"administeredOn",e.target.value)} required={row.precision !== "unknown"} disabled={row.precision === "unknown"} error={errors[`rows.${index}.administeredOn`]} />
          <TextField id={`card-lot-${index}`} label="Batch / lot number (optional)" value={row.lotText ?? ""} onChange={e => patch(index,"lotText",e.target.value)} maxLength={100} />
          <TextField id={`card-clinic-${index}`} label="Clinic / provider (optional)" value={row.provider ?? ""} onChange={e => patch(index,"provider",e.target.value)} maxLength={200} />
          <TextField id={`card-note-${index}`} label="Card notes (optional)" value={row.notes ?? ""} onChange={e => patch(index,"notes",e.target.value)} maxLength={500} />
        </div>
        <Button type="button" variant="secondary" disabled={rows.length === 1 || state.phase === "pending"} onClick={() => { setRows(rows.filter((_,i)=>i!==index)); setConfirmed(false); }}>Remove entry {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={rows.length >= 20 || state.phase === "pending"} onClick={()=> { setRows([...rows,blank()]); setConfirmed(false); }}>Add another card entry</Button>
      {duplicate ? <Notice tone="attention" title="Possible duplicate">Two entries have the same vaccine and date. Check them against the card before submitting.</Notice> : null}
      <label className="my-5 flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required /> I checked every entry against the paper vaccination card.</label>
      <ResultRegion>{state.phase === "error" ? <Notice tone="danger" title="Card not saved" role="alert">{state.error.message}</Notice> : state.phase === "success" ? <Notice tone="success" title="Card sent for clinic review" role="status">These entries count only after the clinic verifies them.</Notice> : null}</ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>Submit card for review</Button>
      </fieldset>
    </form>
    <div><h3 className="mb-3 text-lg font-bold">Submitted cards</h3>{submissions.length ? <ul className="divide-y divide-line">{submissions.map(s=><li key={s.submissionId} className="py-4"><p className="font-bold">{s.rows.length} entries · {s.status.replaceAll("_"," ")}</p><p>{s.decisionNote}</p>{s.status === "changes_requested" ? <Button type="button" variant="secondary" disabled={scanning || state.phase === "pending"} onClick={()=> { setRows(s.rows); setEditing(s); setConfirmed(false); }}>Edit requested changes</Button> : null}{["pending","changes_requested"].includes(s.status) ? <WithdrawCard childId={childId} submissionId={s.submissionId} /> : null}</li>)}</ul> : <p className="text-ink-soft">No cards submitted yet.</p>}</div>
  </div>;
}
function WithdrawCard({ childId, submissionId }: { childId: string; submissionId: string }) {
  const router=useRouter(); const { state,run }=useMutation(`/api/v1/children/${childId}/card-submissions/${submissionId}/withdraw`); const [confirm,setConfirm]=useState(false);
  return <span className="ml-3 inline-block">{confirm ? <><Button type="button" variant="danger" pending={state.phase==="pending"} onClick={async()=> { if ((await run({}))?.ok) router.refresh(); }}>Confirm withdrawal</Button><Button type="button" variant="secondary" onClick={()=>setConfirm(false)}>Keep submission</Button></> : <Button type="button" variant="secondary" onClick={()=>setConfirm(true)}>Withdraw</Button>}{state.phase==="error" ? <Notice role="alert" title="Withdrawal not saved" tone="danger">{state.error.message}</Notice>:null}</span>;
}
