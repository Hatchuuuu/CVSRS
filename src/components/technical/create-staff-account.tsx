"use client";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { STAFF_ROLES } from "@/lib/staff-roles";

interface Created { email: string; role: string; applicationStatus: string; mfaRequired: boolean }

export function CreateStaffAccount({ clinicId }: { clinicId: string }) {
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const router = useRouter();
  const { state, run } = useMutation<Created>(`/api/v1/clinics/${clinicId}/staff-accounts`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("temporaryPassword") ?? "");
    const result = await run({
      fullName: String(data.get("fullName") ?? "").trim(), email: String(data.get("email") ?? "").trim(),
      temporaryPassword: password, role: String(data.get("role") ?? ""), positionTitle: String(data.get("positionTitle") ?? "").trim() || undefined,
      barangay: String(data.get("barangay") ?? "").trim() || undefined,
      cityMunicipality: String(data.get("cityMunicipality") ?? "").trim() || undefined,
    });
    if (result?.ok) { form.reset(); router.refresh(); }
  }
  const errors = state.phase === "error" ? state.error.fieldErrors ?? {} : {};
  return (
    <form method="post" onSubmit={submit} className="max-w-3xl">
      <p className="mb-5 text-sm text-ink-soft">A different clinical approver must approve nurse or midwife access. BHW, registration, inventory and technical access require a different access administrator. Arrange that approver before creating the account; the creator cannot approve it.</p>
      <fieldset disabled={!hydrated} className="min-w-0 grid gap-x-4 sm:grid-cols-2">
        <legend className="sr-only">Staff account details</legend>
        <TextField id="staff-name" name="fullName" label="Full name" required error={errors.fullName} />
        <TextField id="staff-email" name="email" type="email" label="Email address" autoComplete="off" required error={errors.email} />
        <SelectField id="staff-role" name="role" label="Clinic role" required error={errors.role} defaultValue="">
          <option value="" disabled>Choose a role</option>
          {STAFF_ROLES.map((role) => <option key={role.role} value={role.role}>{role.label}</option>)}
        </SelectField>
        <TextField id="staff-title" name="positionTitle" label="Job title (optional)" placeholder="Nurse, midwife, BHW…" maxLength={80} />
        <TextField id="staff-barangay" name="barangay" label="Assigned barangay (optional)" placeholder="e.g. Bunao" maxLength={120} error={errors.barangay} />
        <TextField id="staff-city" name="cityMunicipality" label="City / municipality (optional)" placeholder="e.g. Dumaguete City" maxLength={120} error={errors.cityMunicipality} hint="Enter both location fields, or leave both blank." />
        <TextField id="staff-password" name="temporaryPassword" type="password" label="Temporary password" hint="At least 12 characters. Give it directly to the staff member." minLength={12} autoComplete="new-password" required error={errors.temporaryPassword} />
      </fieldset>
      <ResultRegion>
        {state.phase === "error" ? <Notice tone="danger" role="alert" title="Account creation needs attention">{state.error.message}</Notice> : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Staff account created">
          <p><strong>Email:</strong> {state.data.email}</p>
          <p>The account can sign in immediately. The temporary password has been cleared from this form. Return to Staff accounts to follow independent access approval. The staff member follows the clinic’s sign-in requirements after approval.</p>
        </Notice> : null}
      </ResultRegion>
      <Button type="submit" disabled={!hydrated} pending={state.phase === "pending"}>{state.phase === "pending" ? "Creating…" : "Create staff account"}</Button>
    </form>
  );
}



