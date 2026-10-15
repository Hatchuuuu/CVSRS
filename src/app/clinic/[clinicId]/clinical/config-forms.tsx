"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok: string }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" ? <Notice tone="success" role="status" title={ok} /> : null}
    </ResultRegion>
  );
}

export function MasterStatusButton({ clinicId, kind, id, status, label }: { clinicId: string; kind: "antigen" | "product"; id: string; status: "active" | "retired"; label: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/clinical-master/status`);
  return (
    <div className="mt-2">
      <Outcome state={state} ok="Updated" />
      <Button
        variant="secondary"
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run({ kind, id, status });
          if (r?.ok) router.refresh();
        }}
      >
        {label}
      </Button>
    </div>
  );
}

export function AddAntigenForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/clinical-master/antigens`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ code: String(f.get("code") ?? "").trim(), name: String(f.get("name") ?? "").trim() });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="border-t border-line pt-4">
      <h3 className="mb-2 font-bold">Add an antigen</h3>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="ag-code" name="code" label="Code" required error={fe.code} />
        <TextField id="ag-name" name="name" label="Name" required error={fe.name} />
      </div>
      <Outcome state={state} ok="Antigen added as a draft. A different person must activate it." />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Add antigen
      </Button>
    </form>
  );
}

export function AddProductForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/clinical-master/products`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    const r = await run({
      code: v("code"),
      name: v("name"),
      manufacturer: v("manufacturer") || undefined,
      presentation: v("presentation"),
      stockUnit: v("stockUnit"),
      dosesPerContainer: Number(v("dosesPerContainer")),
      administrationUnit: v("administrationUnit"),
      policyReference: v("policyReference") || undefined,
      antigenCodes: v("antigenCodes").split(",").map((x) => x.trim()).filter(Boolean),
    });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="border-t border-line pt-4">
      <h3 className="mb-2 font-bold">Add a product</h3>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="pr-code" name="code" label="Code" required error={fe.code} />
        <TextField id="pr-name" name="name" label="Name" required />
        <TextField id="pr-man" name="manufacturer" label="Manufacturer (optional)" />
        <TextField id="pr-pres" name="presentation" label="Presentation" hint="For example, how it is supplied." required />
        <TextField id="pr-stock" name="stockUnit" label="Stock unit" required />
        <TextField id="pr-dpc" name="dosesPerContainer" type="number" step="any" min="0" label="Doses per container" required error={fe.dosesPerContainer} />
        <TextField id="pr-admin" name="administrationUnit" label="Administration unit" required />
        <TextField id="pr-pol" name="policyReference" label="Policy / product reference" />
      </div>
      <TextField id="pr-ag" name="antigenCodes" label="Antigen codes (comma separated)" hint="Every code must already exist." required error={fe.antigenCodes} />
      <Outcome state={state} ok="Product added as a draft. A different person must activate it." />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Add product
      </Button>
    </form>
  );
}

export function ImportScheduleForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation<{ versionId: string }>(`/api/v1/clinics/${clinicId}/schedules`);
  const [parseError, setParseError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setParseError(null);
    const text = String(new FormData(e.currentTarget).get("payload") ?? "");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return setParseError("That is not valid JSON. Check for a missing comma or bracket.");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return setParseError("The schedule must be a JSON object.");
    const r = await run({ payload });
    if (r?.ok) router.push(`/clinic/${clinicId}/clinical/schedules/${r.data.versionId}`);
  }
  return (
    <form onSubmit={submit} className="border-t border-line pt-4">
      <h3 className="mb-1 font-bold">Import a schedule draft</h3>
      <p className="mb-3 text-sm text-ink-soft">
        Paste the structured schedule (rules, dependencies and test cases). The import only creates a draft; it is checked again in the database. It does not go live until a clinical lead approves it and every test case passes.
      </p>
      <div className="mb-4">
        <label htmlFor="sched-json" className="mb-1 block font-semibold">
          Schedule (JSON)
        </label>
        <textarea id="sched-json" name="payload" rows={10} spellCheck={false} className="block w-full rounded-control border border-ink-soft bg-surface p-3 font-mono text-sm" required aria-describedby={parseError ? "sched-err" : undefined} />
        {parseError ? (
          <p id="sched-err" role="alert" className="mt-1 text-sm font-semibold text-danger">
            {parseError}
          </p>
        ) : null}
      </div>
      <Outcome state={state} ok="Draft created" />
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Importing…" : "Import draft"}
      </Button>
    </form>
  );
}
