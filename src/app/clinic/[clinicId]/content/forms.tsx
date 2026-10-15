"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export interface Version {
  versionId: string;
  code: string;
  language: "en" | "fil";
  title: string;
  body: string;
  source: string;
  status: "draft" | "submitted" | "active" | "rejected" | "retired";
  authoredBy: string | null;
  authoredById: string;
  reviewedBy: string | null;
  reviewedOn: string | null;
  reviewNote: string | null;
}

function Err({ state }: { state: ReturnType<typeof useMutation>["state"] }) {
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

export function ContentForm({ clinicId, version, onDone }: { clinicId: string; version?: Version; onDone?: () => void }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/content`);
  const [body, setBody] = useState(version?.body ?? "");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({
      versionId: version?.versionId,
      code: version ? undefined : String(f.get("code") ?? "").trim(),
      language: String(f.get("language")),
      title: String(f.get("title") ?? "").trim(),
      body: body.trim(),
      source: String(f.get("source") ?? "").trim(),
    });
    if (r?.ok) {
      onDone?.();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  const id = version?.versionId ?? "new";
  return (
    <form onSubmit={submit} className="max-w-2xl rounded-control border border-line bg-canvas p-4">
      {version ? null : <TextField id={`ct-code-${id}`} name="code" label="Short code" hint="Lowercase letters, numbers and dashes, for example after-your-visit. Used to keep translations together." required pattern="[a-z0-9][a-z0-9\-]{1,58}" error={fe?.code} />}
      <SelectField id={`ct-lang-${id}`} name="language" label="Language" defaultValue={version?.language ?? "en"}>
        <option value="en">English</option>
        <option value="fil">Filipino</option>
      </SelectField>
      <TextField id={`ct-title-${id}`} name="title" label="Title" defaultValue={version?.title} required minLength={3} maxLength={150} error={fe?.title} />
      <div className="mb-4">
        <label htmlFor={`ct-body-${id}`} className="mb-1 block font-semibold">
          Text families will read
        </label>
        <p id={`ct-body-${id}-hint`} className="mb-1.5 text-sm text-ink-soft">Write only what your clinic has approved. Plain words. The system adds nothing and does not check the medical content.</p>
        <textarea id={`ct-body-${id}`} rows={8} value={body} onChange={(e) => setBody(e.target.value)} required minLength={20} maxLength={4000} className="block w-full rounded-control border border-line-strong bg-surface px-3 py-2" aria-invalid={!!fe?.body} aria-describedby={`ct-body-${id}-hint${fe?.body ? ` ct-body-${id}-error` : ""}`} />
        {fe?.body ? <p id={`ct-body-${id}-error`} className="mt-1 text-sm font-semibold text-danger">{fe.body}</p> : null}
      </div>
      <TextField id={`ct-src-${id}`} name="source" label="Where it comes from" hint="The leaflet, guideline or advice this text follows. The reviewer checks against it." defaultValue={version?.source} required minLength={3} maxLength={300} error={fe?.source} />
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Save draft"}
      </Button>
      <Err state={state} />
    </form>
  );
}

export function Act({ label, path, body, variant = "secondary" }: { label: string; path: string; body?: unknown; variant?: "primary" | "secondary" | "danger" }) {
  const router = useRouter();
  const { state, run } = useMutation(path);
  return (
    <div>
      <Button
        variant={variant}
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run(body);
          if (r?.ok) router.refresh();
        }}
      >
        {label}
      </Button>
      <Err state={state} />
    </div>
  );
}

export function WithReason({ label, path, action, fieldLabel, variant = "secondary", required = true }: { label: string; path: string; action: "approve" | "reject" | "retire"; fieldLabel: string; variant?: "primary" | "secondary" | "danger"; required?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(path);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("t") ?? "").trim();
    const body = action === "retire" ? { reason: text } : { decision: action, note: action === "approve" ? text || undefined : text };
    const r = await run(body);
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      <Button variant={variant} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-2 rounded-control border border-line bg-canvas p-3">
          <TextField id={`wr-${path}`} name="t" label={fieldLabel} required={required} maxLength={300} />
          <Button type="submit" variant={variant} disabled={state.phase === "pending"}>
            Confirm
          </Button>
          <Err state={state} />
        </form>
      ) : null}
    </div>
  );
}
