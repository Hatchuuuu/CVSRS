"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export function PrivacyNoticeForm({ clinicId, current }: { clinicId: string; current: { configured: boolean; version?: string; text?: string } }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/privacy-notice`);
  const [text, setText] = useState(current.text ?? "");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ version: String(new FormData(e.currentTarget).get("version") ?? "").trim(), text: text.trim() });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-3xl">
      <p className="mb-3 text-ink-soft">
        {current.configured ? `Version ${current.version} is in force.` : "No privacy notice is set."} Paste the notice your privacy officer approved. Families must accept the current version before they add or link a child. The system supplies no wording.
      </p>
      <TextField id="pn-version" name="version" label="Version" hint="Use a new version whenever the text changes, so families are asked again." required maxLength={50} error={fe?.version} />
      <div className="mb-4">
        <label htmlFor="pn-text" className="mb-1 block font-semibold">
          Notice text
        </label>
        <textarea id="pn-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} required minLength={50} maxLength={8000} className="block w-full rounded-control border border-line-strong bg-surface px-3 py-2" aria-invalid={!!fe?.text} aria-describedby={fe?.text ? "pn-text-error" : undefined} />
        {fe?.text ? <p id="pn-text-error" className="mt-1 text-sm font-semibold text-danger">{fe.text}</p> : null}
      </div>
      <Button type="submit" disabled={state.phase === "pending"}>
        {current.configured ? "Publish a new version" : "Publish notice"}
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Published" /> : null}
      </ResultRegion>
    </form>
  );
}
