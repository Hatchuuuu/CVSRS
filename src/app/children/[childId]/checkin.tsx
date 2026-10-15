"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { formatClinicDateTime } from "@/lib/format";

export interface CheckinView {
  enabled: boolean;
  safetyNotice: string;
  items: { id: string; category: "question" | "after_vaccination" | "other"; message: string; status: "open" | "answered" | "closed"; answer: string | null; createdAt: string; answeredAt: string | null }[];
}

const CATEGORY = { question: "A question", after_vaccination: "About how my child is after a vaccination", other: "Something else" } as const;
export function AskTheClinic({ childId, view, clinicTimezone }: { childId: string; view: CheckinView; clinicTimezone: string }) {
  const when = (iso: string) => formatClinicDateTime(iso, clinicTimezone);
  const router = useRouter();
  const { state, run } = useMutation<{ safetyNotice: string }>(`/api/v1/children/${childId}/checkins`);
  const [text, setText] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ category: String(f.get("category")), message: text.trim() });
    if (r?.ok) {
      setText("");
      router.refresh();
    }
  }
  return (
    <div className="space-y-5">
      {view.enabled ? (
        <>
          <Notice tone="attention" title="Please read first">
            {view.safetyNotice}
          </Notice>
          <form onSubmit={submit} className="max-w-xl card-elevated p-5 sm:p-6 shadow-xs">
            <SelectField id="ck-cat" name="category" label="What is this about?" defaultValue="question">
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
            <div className="mb-4">
              <label htmlFor="ck-msg" className="mb-1 block font-semibold">
                Your message
              </label>
              <textarea id="ck-msg" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} required className="block w-full rounded-control border border-line-strong bg-surface px-3 py-2" aria-invalid={state.phase === "error" && !!state.error.fieldErrors?.message} aria-describedby={state.phase === "error" && state.error.fieldErrors?.message ? "ck-msg-error" : undefined} />
              {state.phase === "error" && state.error.fieldErrors?.message ? <p id="ck-msg-error" className="mt-1 text-sm font-semibold text-danger">{state.error.fieldErrors.message}</p> : null}
            </div>
            <Button type="submit" pending={state.phase === "pending"}>
              {state.phase === "pending" ? "Sending…" : "Send to the clinic"}
            </Button>
            <ResultRegion>
              {state.phase === "error" ? (
                <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not sent"}>
                  {state.error.message}
                </Notice>
              ) : null}
              {state.phase === "success" ? (
                <Notice tone="success" role="status" title="Sent to the clinic">
                  A reply will appear here and in Messages. {state.data.safetyNotice}
                </Notice>
              ) : null}
            </ResultRegion>
          </form>
        </>
      ) : (
        <Notice tone="info" title="This clinic does not take questions here yet">
          Please call or visit the clinic.
        </Notice>
      )}
      {view.items.length > 0 ? (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface" aria-label="Your questions">
          {view.items.map((k) => (
            <li key={k.id} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink-soft">
                  {CATEGORY[k.category]} · {when(k.createdAt)}
                </span>
                {k.status === "answered" ? <StatusChip tone="success">Answered</StatusChip> : <StatusChip tone="attention">Waiting for the clinic</StatusChip>}
              </div>
              <p>{k.message}</p>
              {k.answer ? (
                <p className="rounded-control border border-line bg-canvas p-3">
                  <span className="font-semibold">Clinic reply{k.answeredAt ? ` (${when(k.answeredAt)})` : ""}: </span>
                  {k.answer}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : view.enabled ? (
        <EmptyState title="No questions sent yet" />
      ) : null}
    </div>
  );
}
