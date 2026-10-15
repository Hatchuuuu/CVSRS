"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import type { CardSubmission } from "@/app/children/[childId]/vaccination-card";
import type { ProductOption } from "./evidence";
export function CardReview({ clinicId, submission, products, canReview }: { clinicId: string; submission: CardSubmission; products: ProductOption[]; canReview: boolean }) {
  const router=useRouter(); const [decision,setDecision]=useState("changes_requested"); const { state,run }=useMutation(`/api/v1/clinics/${clinicId}/card-submissions/${submission.submissionId}`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const rows=decision==="approved" ? submission.rows.map((row,i)=> ({ productText: row.productText, productId: String(form.get(`product-${i}`)), administeredOn: String(form.get(`date-${i}`)), precision: "exact", provider: row.provider, lotText: row.lotText, reference: `card:${submission.submissionId} dose:${row.doseLabel ?? "unspecified"}` })) : [];
    if ((await run({ decision, note: String(form.get("note")), expectedVersion: submission.version, rows }))?.ok) router.refresh();
  }
  return <article className="mb-5 rounded-control border border-line p-4"><h3 className="font-bold">Card submission · {submission.status.replaceAll("_"," ")}</h3>
    <ul className="my-3 divide-y divide-line">{submission.rows.map((row,i)=><li key={i} className="py-2"><strong>{row.productText}</strong> · Dose {row.doseLabel ?? "not stated"} · {row.administeredOn ?? "date unknown"}<p className="text-sm text-ink-soft">{[row.provider,row.lotText,row.notes].filter(Boolean).join(" · ")}{row.source==="ocr" ? " · extracted from photo; check against paper" : ""}</p></li>)}</ul>
    {submission.decisionNote ? <p>{submission.decisionNote}</p> : null}
    {canReview && submission.status==="pending" ? <form onSubmit={submit}>
      <SelectField id={`decision-${submission.submissionId}`} label="Review decision" value={decision} onChange={e=>setDecision(e.target.value)}><option value="changes_requested">Ask the family to correct details</option><option value="rejected">Reject card entries</option><option value="approved">Confirm all entries from documentary evidence</option></SelectField>
      {decision==="approved" ? submission.rows.map((row,i)=><fieldset key={i} className="grid gap-x-4 sm:grid-cols-2"><legend className="font-bold">Confirm {row.productText} · entry {i+1}</legend><SelectField id={`review-product-${submission.submissionId}-${i}`} name={`product-${i}`} label="Approved product" required defaultValue=""><option value="">Choose approved product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</SelectField><TextField id={`review-date-${submission.submissionId}-${i}`} name={`date-${i}`} label="Confirmed exact date" type="date" required defaultValue={row.administeredOn ?? ""} /></fieldset>) : null}
      <TextField id={`review-note-${submission.submissionId}`} name="note" label="Review note for the family" minLength={3} maxLength={500} required />
      <ResultRegion>{state.phase==="error" ? <Notice title="Review not saved" tone="danger" role="alert">{state.error.message}</Notice> : null}</ResultRegion>
      <Button pending={state.phase==="pending"} type="submit">Save review decision</Button>
    </form> : null}
  </article>;
}
