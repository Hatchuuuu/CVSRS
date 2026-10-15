"use client";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { formatClinicDate } from "@/lib/format";

export interface MyTransfers {
  transfers: { id: string; status: "requested" | "ready" | "completed" | "declined" | "cancelled"; toClinic: string; fromClinic: string; fromClinicTimezone: string; requestedAt: string; completedAt: string | null; note: string | null }[];
  clinics: { id: string; name: string }[];
}

const LABEL = {
  requested: { tone: "attention", text: "Waiting for your current clinic" },
  ready: { tone: "review", text: "Released. Waiting for the new clinic" },
  completed: { tone: "success", text: "Moved" },
  declined: { tone: "neutral", text: "Not going ahead" },
  cancelled: { tone: "neutral", text: "Cancelled" },
} as const;

function Cancel({ childId, id }: { childId: string; id: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/children/${childId}/record-transfers/${id}/cancel`);
  return (
    <div>
      <Button
        variant="secondary"
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run();
          if (r?.ok) router.refresh();
        }}
      >
        Cancel this request
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not cancelled"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}

/** Asking is the guardian's consent. Nothing moves until the current clinic releases the record and the new clinic accepts it. */
export function MoveRecord({ childId, data }: { childId: string; data: MyTransfers }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/children/${childId}/record-transfers`);
  const open = data.transfers.find((t) => t.status === "requested" || t.status === "ready");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ toClinicId: String(new FormData(e.currentTarget).get("toClinicId")) });
    if (r?.ok) router.refresh();
  }
  return (
    <div className="space-y-4">
      {data.transfers.length > 0 ? (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface" aria-label="Record moves">
          {data.transfers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span>
                <span className="block font-bold">
                  {t.fromClinic} → {t.toClinic}
                </span>
                <span className="text-sm text-ink-soft">{formatClinicDate(t.requestedAt, t.fromClinicTimezone)}</span>
              </span>
              <StatusChip tone={LABEL[t.status].tone}>{LABEL[t.status].text}</StatusChip>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No move requested" />
      )}
      {open ? (
        <Cancel childId={childId} id={open.id} />
      ) : data.clinics.length > 0 ? (
        <form onSubmit={submit} className="max-w-xl">
          <p className="mb-3 text-sm text-ink-soft">Asking counts as your permission for the clinics to share your child&apos;s record with each other. Nothing moves until your current clinic releases it and the new clinic accepts it. Future visits at your current clinic are cancelled when it moves.</p>
          <SelectField id="mv-to" name="toClinicId" label="Move the record to" required defaultValue="">
            <option value="" disabled>
              Choose a clinic…
            </option>
            {data.clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
            Ask to move the record
          </Button>
          <ResultRegion>
            {state.phase === "error" ? (
              <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not sent"}>
                {state.error.message}
              </Notice>
            ) : null}
          </ResultRegion>
        </form>
      ) : null}
    </div>
  );
}
