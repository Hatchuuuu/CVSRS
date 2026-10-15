"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export function AnswerForm({ clinicId, checkinId }: { clinicId: string; checkinId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/checkins/${checkinId}/answer`);
  const [text, setText] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ answer: text.trim() });
    if (r?.ok) router.refresh();
  }
  return (
    <form onSubmit={submit}>
      <label htmlFor={`ans-${checkinId}`} className="mb-1 block font-semibold">
        Your reply to the family
      </label>
      <textarea id={`ans-${checkinId}`} rows={3} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} className="mb-2 block w-full rounded-control border border-line-strong bg-surface px-3 py-2" />
      <p className="mb-2 text-sm text-ink-soft">{500 - text.length} characters left. The family sees this in the app.</p>
      <Button type="submit" disabled={state.phase === "pending" || text.trim().length === 0}>
        {state.phase === "pending" ? "Sending…" : "Send reply"}
      </Button>
      <ResultRegion>
        {state.phase === "success" ? <Notice tone="success" role="status" title="Reply sent">The family can see your reply in the app.</Notice> : null}
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not sent"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </form>
  );
}

export function PolicyForm({ clinicId, policy }: { clinicId: string; policy: { enabled: boolean; safetyNotice: string } }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/checkin-policy`);
  const [notice, setNotice] = useState(policy.safetyNotice);
  async function save(enabled: boolean) {
    const r = await run({ enabled, safetyNotice: notice.trim() || undefined });
    if (r?.ok) router.refresh();
  }
  return (
    <div className="max-w-2xl">
      <label htmlFor="pol-notice" className="mb-1 block font-semibold">
        Safety notice families will see
      </label>
      <p className="mb-1.5 text-sm text-ink-soft">Written and approved by your clinical lead. For example, when to seek urgent care and how to reach the clinic. The software does not supply wording.</p>
      <textarea id="pol-notice" rows={4} maxLength={600} value={notice} onChange={(e) => setNotice(e.target.value)} className="mb-3 block w-full rounded-control border border-line-strong bg-surface px-3 py-2" />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">Currently {policy.enabled ? "on" : "off"}.</span>
        <Button disabled={state.phase === "pending"} onClick={() => save(true)}>
          {policy.enabled ? "Update notice" : "Turn on"}
        </Button>
        {policy.enabled ? (
          <Button variant="secondary" disabled={state.phase === "pending"} onClick={() => save(false)}>
            Turn off
          </Button>
        ) : null}
      </div>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}
