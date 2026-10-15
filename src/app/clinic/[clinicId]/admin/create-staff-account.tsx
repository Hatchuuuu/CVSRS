"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { STAFF_ROLES } from "@/lib/staff-roles";

interface Created { email: string; role: string; applicationStatus: string; mfaRequired: boolean }

export function CreateStaffAccount({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation<Created>(`/api/v1/clinics/${clinicId}/staff-accounts`);
  const [createdPassword, setCreatedPassword] = useState("");
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
    if (result?.ok) { setCreatedPassword(password); form.reset(); router.refresh(); }
  }
  const errors = state.phase === "error" ? state.error.fieldErrors ?? {} : {};
  return (
    <form onSubmit={submit} className="max-w-3xl">
      <div className="grid gap-x-4 sm:grid-cols-2">
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
      </div>
      <ResultRegion>
        {state.phase === "error" ? <Notice tone="danger" role="alert" title="Account not created">{state.error.message}</Notice> : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Staff account created">
          <p><strong>Email:</strong> {state.data.email}</p><p><strong>Temporary password:</strong> <span className="font-mono">{createdPassword}</span></p>
          <p>Give these details directly to the staff member. This password will disappear when you leave this page. The access request is ready for a different authorized person to approve below. The staff member follows the clinic’s sign-in requirements after approval.</p>
        </Notice> : null}
      </ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>{state.phase === "pending" ? "Creating…" : "Create staff account"}</Button>
    </form>
  );
}
