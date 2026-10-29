"use client";
import { personName } from "@/lib/person-name";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Notice, ResultRegion, SelectField, StatusChip } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { formatClinicDateTime, formatDate } from "@/lib/format";
import { staffRoleLabel } from "@/lib/staff-roles";

export interface ChildNote { noteId: string; category: string; note: string; familyVisible: boolean; createdAt: string; authorName: string; authorRole?: string | null; eventId?: string | null }

export function StaffNotes({ clinicId, childId, notes, capabilities, clinicTimezone, events }: { clinicId: string; childId: string; notes: ChildNote[]; capabilities: string[]; clinicTimezone: string; events: { eventId: string; product: string | null; reportedProduct: string | null; administeredOn: string | null }[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ noteId: string }>(`/api/v1/clinics/${clinicId}/children/${childId}/notes`);
  const choices = [
    ...(capabilities.includes("vaccination.record") ? [{ value: "post_vaccination", label: "After-vaccination observation" }] : []),
    ...(capabilities.includes("bhw.followup") || capabilities.includes("vaccination.record") ? [{ value: "follow_up", label: "Follow-up note" }] : []),
    ...(capabilities.includes("child.register") ? [{ value: "intake", label: "Registration / intake note" }] : []),
    ...(capabilities.includes("child.register") ? [{ value: "operational", label: "Operational note" }] : []),
  ];
  const [visible, setVisible] = useState(true);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const result = await run({ category: String(data.get("category")), note: String(data.get("note")), familyVisible: visible, eventId: String(data.get("eventId") ?? "") || undefined });
    if (result?.ok) { form.reset(); setVisible(true); router.refresh(); }
  }
  return <div className="space-y-5">
    {choices.length ? <form onSubmit={submit}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField id="note-category" name="category" label="Note type" required defaultValue=""><option value="" disabled>Choose a note type</option>{choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</SelectField>
        {events.length ? <SelectField id="note-event" name="eventId" label="Related vaccination (optional)" defaultValue=""><option value="">General child / follow-up note</option>{events.map((event,index)=><option key={event.eventId} value={event.eventId}>{event.product ?? event.reportedProduct ?? "Vaccination record"} · {formatDate(event.administeredOn)} · Entry {index+1}</option>)}</SelectField> : null}
        <div className="sm:col-span-2"><Field id="child-note" label="Staff observation" hint="Write what was observed or explained. Do not record an unsupported diagnosis."><textarea id="child-note" name="note" rows={4} aria-describedby="child-note-hint" required minLength={3} maxLength={1000} className="block min-h-28 w-full rounded-control border border-line-strong bg-surface px-3.5 py-2.5" /></Field></div>
      </div>
      <label className="mb-4 flex min-h-11 items-center gap-2"><input className="size-5" type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show this note to the family</label>
      <ResultRegion>{state.phase === "error" ? <Notice tone="danger" role="alert" title="Note not saved">{state.error.message}</Notice> : state.phase === "success" ? <Notice tone="success" role="status" title="Note saved" /> : null}</ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>{state.phase === "pending" ? "Saving…" : "Add note"}</Button>
    </form> : null}
    {notes.length ? <ul className="divide-y divide-line rounded-control border border-line bg-surface">{notes.map((note) => <li key={note.noteId} className="p-4"><div className="mb-1 flex flex-wrap items-center gap-2"><strong>{personName(note.authorName)}</strong>{note.authorRole ? <span className="text-sm">{staffRoleLabel(note.authorRole)}</span> : null}<StatusChip tone="neutral">{note.category.replaceAll("_", " ")}</StatusChip>{note.familyVisible ? <span className="text-sm text-ink-soft">Visible to family</span> : null}</div><p className="whitespace-pre-wrap break-words">{note.note}</p>{note.eventId ? <a href={`#event-${note.eventId}`}>Related vaccination</a> : null}<time className="block text-sm text-ink-soft" dateTime={note.createdAt}>{formatClinicDateTime(note.createdAt, clinicTimezone)}</time></li>)}</ul> : <p className="text-ink-soft">No staff notes yet.</p>}
  </div>;
}
