import { personName } from "@/lib/person-name";
import { Baby, Building2, CalendarDays, ClipboardCheck, FileText, ShieldCheck } from "lucide-react";
import { RefreshRecord } from "./refresh-record";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink, EmptyState, Section, StatusChip, recordStatusChip } from "@/components/ui";
import { ScheduleView, type ScheduleRequirement } from "@/components/schedule-view";
import { formatClinicDate, formatDate } from "@/lib/format";
import { staffRoleLabel } from "@/lib/staff-roles";
import { requireViewer } from "@/lib/server/viewer";
import { DownloadCertificateButton } from "@/components/download-button";
import { MoveRecord, type MyTransfers } from "./move-record";
import { EditRequestForm } from "./edit-request";
import { AskTheClinic, type CheckinView } from "./checkin";
import { VaccinationCard, type CardSubmission } from "./vaccination-card";
import { ReportDoseForm } from "./report-dose";
import { AppointmentItem, BookVisit, type MyAppointment, type OpenSession } from "./visits";

export const metadata: Metadata = { title: "Child record" };

interface MyChild {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
  recordStatus: string;
  accessScope: "identity_only" | "full";
  clinicId: string | null;
  clinicName: string | null;
  clinicTimezone: string | null;
}
interface QueueStatus {
  ticket: string;
  status: "waiting" | "called" | "in_service" | "held";
  station: string | null;
  peopleAhead: number | null;
  updatedAt: string;
}
interface Schedule {
  status: "evaluated" | "no_active_schedule";
  asOf?: string;
  versionLabel?: string;
  isDemo?: boolean;
  pendingEvidence?: number;
  requirements?: ScheduleRequirement[];
}
interface GuardianCertificate {
  id: string;
  certificateNo: string;
  status: "issued" | "revoked";
  reviewNeeded: boolean;
  issuedAt: string | null;
}
interface GuardianPlan {
  id: string;
  items: { id: string; label: string; targetDate: string | null; note: string | null; status: "planned" | "done" | "dropped" }[];
}
interface HistoryItem {
  eventId: string;
  administeredOn: string | null;
  datePrecision: string;
  product: string | null;
  status: "verified" | "pending_verification" | "not_accepted";
  source: "clinic" | "recorded_elsewhere";
}
interface FamilyNote { noteId: string; category: string; note: string; createdAt: string; authorName: string; clinicName: string; authorRole?: string | null; eventId?: string | null }

export default async function GuardianChild({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const { rpc } = await requireViewer();
  const mine = (await rpc.rpc<MyChild[]>("my_children")) ?? [];
  const child = mine.find((c) => c.childId === childId);
  if (!child) notFound();
  const cards = await rpc.rpc<CardSubmission[]>("guardian_list_card_submissions", { p_child_id: childId });
  const full = child.accessScope === "full";
  // Times are shown in the child's clinic zone; Asia/Manila (the clinics table default) when no clinic is enrolled.
  const clinicTimezone = child.clinicTimezone ?? "Asia/Manila";
  const [schedule, history, sessions, appointments, queue, certificates, plan, checkins, moves, notes] = full
    ? await Promise.all([
        rpc.rpc<Schedule>("guardian_get_schedule", { p_child_id: childId }),
        rpc.rpc<HistoryItem[]>("guardian_child_history", { p_child_id: childId }),
        child.clinicId ? rpc.rpc<OpenSession[]>("guardian_list_sessions", { p_clinic_id: child.clinicId, p_from: null, p_to: null }) : Promise.resolve([] as OpenSession[]),
        rpc.rpc<MyAppointment[]>("my_appointments"),
        rpc.rpc<QueueStatus>("guardian_queue_status", { p_child_id: childId }),
        rpc.rpc<GuardianCertificate[]>("guardian_list_certificates", { p_child_id: childId }),
        rpc.rpc<GuardianPlan>("guardian_get_catchup_plan", { p_child_id: childId }),
        rpc.rpc<CheckinView>("my_checkins", { p_child_id: childId }),
        rpc.rpc<MyTransfers>("my_record_transfers", { p_child_id: childId }),
        rpc.rpc<FamilyNote[]>("guardian_child_notes", { p_child_id: childId }),
      ])
    : [null, null, null, null, null, null, null, null, null, null];
  const myAppts = (appointments ?? []).filter((a) => a.childId === childId && ["confirmed", "checked_in", "fulfilled"].includes(a.status));

  return (
    <>
      <BackLink href="/children">My children</BackLink>
      <header className="mb-6 rounded-card border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary"><Baby aria-hidden className="size-6" /></span>
            <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight text-ink sm:text-3xl">{personName(child.displayName)}</h1>
          </div>
          <div className="flex flex-wrap gap-2">{recordStatusChip(child.recordStatus)}</div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div><dt className="flex items-center gap-2 text-ink-soft"><FileText aria-hidden className="size-4" />Record number</dt><dd className="mt-1 break-words font-semibold text-ink">{child.localRecordNo}</dd></div>
          <div><dt className="flex items-center gap-2 text-ink-soft"><Building2 aria-hidden className="size-4" />Health center</dt><dd className="mt-1 break-words font-semibold text-ink">{child.clinicName ?? "Not assigned"}</dd></div>
          <div><dt className="flex items-center gap-2 text-ink-soft"><CalendarDays aria-hidden className="size-4" />Birth date</dt><dd className="mt-1 font-semibold text-ink">{child.dob ? formatDate(child.dob) : "Clinic to confirm"}</dd></div>
        </dl>
      </header>

      {!full ? (
        <section aria-labelledby="verification-h" className="mb-8 rounded-card border border-line bg-surface p-5 sm:p-6">
          <div className="flex items-start gap-3"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" /><div><h2 id="verification-h" className="text-lg font-bold text-ink">Waiting for the clinic to verify you</h2><p className="mt-1 text-sm leading-relaxed text-ink-soft">You can prepare your vaccination card now. Clinical history and shared care notes unlock after the clinic verifies your guardian access.</p></div></div>
          <ol className="my-5 grid gap-4 sm:grid-cols-3">
            {[{ Icon: FileText, title: "Bring your records", text: "Bring an ID and any available vaccination card or child records." }, { Icon: ClipboardCheck, title: "Visit your health center", text: "Staff check your child's details and your relationship to the child." }, { Icon: ShieldCheck, title: "Check your record", text: "After verification, view vaccinations, next steps and care instructions here." }].map(({ Icon, title, text }) => <li key={title} className="flex gap-3 border-t border-line pt-3 sm:block"><Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary sm:mb-2" /><div><h3 className="text-sm font-semibold text-ink">{title}</h3><p className="mt-1 text-sm leading-relaxed text-ink-soft">{text}</p></div></li>)}
          </ol>
          <RefreshRecord />
        </section>
      ) : (
        <div className="space-y-10">
          {queue ? (
            <section
              aria-labelledby="que-h"
              className={`rounded-card border-2 p-5 shadow-sm transition-[border-color,background-color] ${
                queue.status === "called"
                  ? "border-attention bg-attention-bg ring-4 ring-attention/30 pulse-border"
                  : queue.status === "in_service"
                  ? "border-primary bg-primary-soft/80"
                  : "border-attention/60 bg-attention-bg"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-attention/20 pb-3">
                <h2 id="que-h" className="text-xs font-bold uppercase tracking-wider text-attention">
                  Today&apos;s Clinic Queue Status
                </h2>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-ink shadow-2xs border border-line">
                  Reload to update
                </span>
              </div>
              <p className="tnum mt-3 inline-block rounded-xl border border-primary/30 bg-surface px-4 py-1.5 text-3xl font-black text-ink shadow-xs">Ticket #{queue.ticket}</p>
              <p className="mt-2 text-lg" role="status">
                {queue.status === "waiting"
                  ? queue.peopleAhead === 0
                    ? "You are next."
                    : `${queue.peopleAhead} ${queue.peopleAhead === 1 ? "person is" : "people are"} ahead of you.`
                  : queue.status === "called"
                    ? `You are being called${queue.station ? ` to ${queue.station}` : ""}. Please go now.`
                    : queue.status === "in_service"
                      ? "Your child is being seen."
                      : "Your ticket is on hold. Please speak to the staff."}
              </p>
              <p className="mt-1 text-sm text-ink-soft">A guide only: it can change if someone needs urgent care. Reload this page for the latest.</p>
            </section>
          ) : null}

          <Section id="sch-h" title="Next steps" className="border-t-0 pt-0" description={schedule?.status === "evaluated" ? `As of ${formatDate(schedule.asOf)}, schedule version ${schedule.versionLabel}. A guide, not medical advice: clinic staff decide what is right for your child.` : undefined}>
            {schedule?.status === "evaluated" && schedule.requirements ? (
              <>
                <ScheduleView requirements={schedule.requirements} />
                {schedule.pendingEvidence ? (
                  <p className="mt-3 text-sm text-ink-soft">
                    {schedule.pendingEvidence} vaccination{schedule.pendingEvidence === 1 ? "" : "s"} you reported {schedule.pendingEvidence === 1 ? "is" : "are"} waiting for the clinic to check {schedule.pendingEvidence === 1 ? "it" : "them"}. {schedule.pendingEvidence === 1 ? "It does" : "They do"} not count until then.
                  </p>
                ) : null}
              </>
            ) : (
              <EmptyState title="No approved schedule yet">Your clinic has not published a vaccination schedule in this system yet. Please ask the clinic what your child needs next.</EmptyState>
            )}
          </Section>

          {plan ? (
            <Section id="plan-h" title="Care plan from the clinic" description="Written by clinic staff for your child. Please follow what staff tell you at the clinic; this list is a reminder.">
              <ul className="divide-y divide-line rounded-control border border-line bg-surface">
                {plan.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <span>
                      <span className="block font-bold">{i.label}</span>
                      <span className="text-sm text-ink-soft">
                        {i.targetDate ? `Around ${formatDate(i.targetDate)}` : ""}
                        {i.targetDate && i.note ? " · " : ""}
                        {i.note ?? ""}
                      </span>
                    </span>
                    {i.status === "done" ? <StatusChip tone="success">Done</StatusChip> : i.status === "dropped" ? <StatusChip tone="neutral">No longer planned</StatusChip> : <StatusChip tone="attention">Planned</StatusChip>}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section id="vis-h" title="Clinic visits" description="Booking reserves a place. Staff check that your child is ready on the day.">
            {myAppts.length > 0 ? (
              <ul className="mb-6 divide-y divide-line rounded-control border border-line bg-surface">
                {myAppts.map((a) => (
                  <AppointmentItem key={a.appointmentId} a={a} sessions={sessions ?? []} currentClinicTimezone={child.clinicTimezone} />
                ))}
              </ul>
            ) : null}
            <h3 className="mb-3 text-lg font-bold">Book a visit</h3>
            <BookVisit childId={childId} sessions={sessions ?? []} clinicTimezone={child.clinicTimezone} />
          </Section>

          <Section id="his-h" title="Vaccination history">
            {!history || history.length === 0 ? (
              <EmptyState title="No vaccinations recorded here yet">If your child was vaccinated somewhere else, you can tell the clinic below.</EmptyState>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line bg-surface">
                {history.map((h) => (
                  <li key={h.eventId} id={`event-${h.eventId}`} className="flex scroll-mt-32 flex-wrap items-center justify-between gap-2 p-4">
                    <span>
                      <span className="block font-bold">{h.product ?? "Vaccine not identified"}</span>
                      <span className="text-sm text-ink-soft">
                        {h.datePrecision === "exact" ? formatDate(h.administeredOn) : h.administeredOn ? `Around ${formatDate(h.administeredOn)}` : "Date not known"} ·{" "}
                        {h.source === "clinic" ? "Given at this clinic" : "Recorded from another provider"}
                      </span>
                    </span>
                    {h.status === "verified" ? (
                      <StatusChip tone="success">Checked by clinic</StatusChip>
                    ) : h.status === "pending_verification" ? (
                      <StatusChip tone="review">Waiting for clinic check</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Not accepted</StatusChip>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {notes && notes.length ? <Section id="notes-h" title="Notes from the clinic" description="Observations and follow-up information written by clinic staff. Contact the clinic if symptoms worsen or you are worried.">
            <ul className="divide-y divide-line rounded-control border border-line bg-surface">{notes.map((note) => <li key={note.noteId} className="p-4"><p className="whitespace-pre-wrap break-words">{note.note}</p><p className="mt-1 text-sm text-ink-soft">{personName(note.authorName)}{note.authorRole ? ` · ${staffRoleLabel(note.authorRole)}` : ""} · {note.clinicName} · {formatClinicDate(note.createdAt, clinicTimezone)}</p>{note.eventId ? <a href={`#event-${note.eventId}`}>Related vaccination</a> : null}</li>)}</ul>
          </Section> : null}

          <Section id="cert-h" title="Certificates" description="A clinic-issued record of the vaccinations the clinic has checked. Whether another institution accepts it is that institution's decision.">
            {!certificates || certificates.length === 0 ? (
              <EmptyState title="No certificate yet">If you need one, ask the clinic. It lists only vaccinations the clinic has checked.</EmptyState>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line bg-surface">
                {certificates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span>
                      <span className="tnum block font-bold">{c.certificateNo}</span>
                      <span className="text-sm text-ink-soft">{c.issuedAt ? `Issued ${formatClinicDate(c.issuedAt, clinicTimezone)}` : ""}</span>
                    </span>
                    {c.status === "revoked" ? (
                      <StatusChip tone="neutral">No longer valid</StatusChip>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        {c.reviewNeeded ? <StatusChip tone="review">Being reviewed by the clinic</StatusChip> : <StatusChip tone="success">Valid</StatusChip>}
                        <DownloadCertificateButton certificateId={c.id} />


                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {checkins ? (
            <Section id="ask-h" title="Ask the clinic" description="Send a question to clinic staff. Their reply appears here and in Messages.">
              <AskTheClinic childId={childId} view={checkins} clinicTimezone={clinicTimezone} />
            </Section>
          ) : null}

          {moves && (moves.transfers.length > 0 || moves.clinics.length > 0) ? (
            <Section id="mv-h" title="Moving to another clinic?" description="If your family is moving, you can ask for your child's record to go to another clinic of this organization.">
              <MoveRecord childId={childId} data={moves} />
            </Section>
          ) : null}

          <Section id="fix-h" title="Something wrong on the record?" description="You cannot change the record yourself. Ask the clinic and staff will check.">
            <EditRequestForm childId={childId} current={{ displayName: child.displayName, dob: child.dob ?? null }} />
          </Section>
          <Section id="outside-h" title="Tell the clinic about a vaccination given elsewhere" description="For a single dose, describe what was given. For a whole paper card, use Vaccination card below.">
            <ReportDoseForm childId={childId} />
          </Section>

        </div>
      )}
      <section aria-labelledby="rep-h" className="mt-8 rounded-card border border-line bg-surface p-5 sm:p-6">
        <div className="mb-6"><h2 id="rep-h" className="text-xl font-bold text-ink">Vaccination card</h2><p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">Add entries from your paper card, then send them for clinic review. Submitted entries count only after the clinic verifies them.</p></div>
        <VaccinationCard childId={childId} submissions={cards ?? []} />
      </section>
    </>
  );
}
