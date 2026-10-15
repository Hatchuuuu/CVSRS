import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageTitle, Section, StatusChip } from "@/components/ui";
import { formatClinicTime, formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { canOpenChildRecord, childRecordHref } from "../followup/record-link";
import { AppointmentRow, AutoRefresh, CheckInRegion, CreateSessionForm, QueueBoard, WalkInPanel, type QueueEntry } from "./board";
import { appointmentStatusLabel, splitAppointments } from "./queue-logic";
import { DayBacklog, SessionTools, type BacklogDay, type ClosedDay } from "./session-tools";

export const metadata: Metadata = { title: "Clinic today" };

interface Session {
  sessionId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  serviceCode: string;
  status: string;
  totalCapacity: number;
  onlineCapacity: number;
  walkinCapacity: number;
  booked: number;
  remainingOnline: number;
  version: number;
}
interface Appointment {
  appointmentId: string;
  status: string;
  channel: string;
  childId: string;
  childName: string;
  recordNo: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export default async function ClinicToday({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const timeOf = (iso: string) => formatClinicTime(iso, membership.clinicTimezone);
  const caps = new Set(membership.capabilities);
  const canQueue = caps.has("queue.manage");
  const canAppt = caps.has("appointment.manage");
  const canOpenRecord = canOpenChildRecord(caps);
  if (!canQueue && !canAppt && !caps.has("child.read_clinical")) notFound();

  const [sessions, appts, queue, backlog] = await Promise.all([
    rpc.rpc<Session[]>("list_sessions", { p_clinic_id: clinicId, p_from: null, p_to: null }),
    canQueue || canAppt ? rpc.rpc<Appointment[]>("list_appointments", { p_clinic_id: clinicId, p_date: null }) : Promise.resolve([] as Appointment[]),
    canQueue ? rpc.rpc<QueueEntry[]>("list_queue", { p_clinic_id: clinicId, p_date: null }) : Promise.resolve([] as QueueEntry[]),
    canQueue || canAppt ? rpc.rpc<{ open: BacklogDay[]; recentlyClosed: ClosedDay[] }>("service_day_backlog", { p_clinic_id: clinicId }) : Promise.resolve(null),
  ]);
  const upcoming = (sessions ?? []).filter((s) => s.status !== "cancelled");
  const q = queue ?? [];
  const waiting = q.filter((e) => e.status === "waiting").length;
  const beingSeen = q.filter((e) => e.status === "called" || e.status === "in_service").length;
  const finished = q.filter((e) => e.status === "completed" || e.status === "deferred").length;
  const expected = (appts ?? []).filter((a) => a.status === "confirmed").length;
  const { expected: expectedList, cancelled: cancelledList } = splitAppointments(appts ?? []);
  const apptRow = (a: Appointment) => {
    const href = childRecordHref(clinicId, a.childId, caps);
    const chip = appointmentStatusLabel(a.status);
    return (
      <li key={a.appointmentId} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words">
            {href ? (
              <Link href={href} className="flex min-h-11 items-center font-bold text-primary">
                {a.childName}
              </Link>
            ) : (
              <span className="block font-bold">{a.childName}</span>
            )}
            <span className="tnum text-sm text-ink-soft">
              {a.recordNo} · {timeOf(a.startsAt)}–{timeOf(a.endsAt)} · {a.channel === "online" ? "booked online" : "booked by staff"}
            </span>
          </span>
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </div>
        {a.status === "confirmed" && canQueue ? <AppointmentRow clinicId={clinicId} childId={a.childId} appointmentId={a.appointmentId} name={a.childName} /> : null}
      </li>
    );
  };

  return (
    <>
      <PageTitle
        title="Clinic today"
        lead={
          <span className="tnum">
            <strong>{waiting}</strong> waiting · <strong>{beingSeen}</strong> being seen · <strong>{finished}</strong> finished · <strong>{expected}</strong> booked and not yet arrived
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            {canQueue ? (
              <Link href={`/display/${clinicId}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline">
                Open waiting-room display
              </Link>
            ) : null}
            <AutoRefresh confirmedLabel={new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: membership.clinicTimezone })} />
          </div>
        }
      />

      {backlog ? <DayBacklog clinicId={clinicId} open={backlog.open ?? []} recentlyClosed={backlog.recentlyClosed ?? []} canClose={canQueue} /> : null}

      {canQueue ? (
        <Section id="q-h" title="Arrival queue" className="border-t-0 pt-0">
          <QueueBoard clinicId={clinicId} entries={q} canOpenRecord={canOpenRecord} />
        </Section>
      ) : null}

      {/* min-w-0 lets each column shrink below its content at large text sizes instead of overflowing the page. */}
      <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-2 [&>*]:min-w-0">
        <Section id="ap-h" title="Expected today">
          <CheckInRegion>
            {expectedList.length === 0 ? (
              <EmptyState title="No appointments today" />
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line bg-surface">{expectedList.map(apptRow)}</ul>
            )}
            {cancelledList.length > 0 ? (
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">Cancelled today ({cancelledList.length})</summary>
                <ul className="divide-y divide-line rounded-control border border-line bg-surface">{cancelledList.map(apptRow)}</ul>
              </details>
            ) : null}
          </CheckInRegion>
        </Section>

        {canQueue ? (
          <Section id="wi-h" title="Walk-in arrival" description="Search for the child, then add them to the queue.">
            <WalkInPanel clinicId={clinicId} />
          </Section>
        ) : null}
      </div>

      <Section id="se-h" title="Sessions" description="Next 14 days. Families can book only the places marked for booking; the rest are held for walk-ins." className="mt-10">
        {upcoming.length === 0 ? (
          <EmptyState title="No sessions scheduled">Create a session so families can book and walk-ins have a reserved allocation.</EmptyState>
        ) : (
          <ul className="mb-6 divide-y divide-line rounded-control border border-line bg-surface">
            {upcoming.map((s) => (
              <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <span>
                  <span className="tnum block font-bold">
                    {formatDate(s.serviceDate)} · {timeOf(s.startsAt)}–{timeOf(s.endsAt)}
                  </span>
                  <span className="tnum text-sm text-ink-soft">
                    {s.serviceCode} · {s.booked} of {s.onlineCapacity} bookable places taken · {s.walkinCapacity} held for walk-ins · {s.totalCapacity} in all
                  </span>
                </span>
                {s.status === "closed" ? <StatusChip tone="neutral">Closed</StatusChip> : s.remainingOnline === 0 ? <StatusChip tone="attention">Full</StatusChip> : <StatusChip tone="success">{s.remainingOnline} {s.remainingOnline === 1 ? "place" : "places"} left</StatusChip>}
                <SessionTools clinicId={clinicId} s={s} canManage={canAppt} recordHrefBase={canOpenRecord ? `/clinic/${clinicId}/children` : null} />
              </li>
            ))}
          </ul>
        )}
        {canAppt ? (
          <details className="rounded-control border border-line bg-surface">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 font-semibold text-primary">Create a session</summary>
            <div className="border-t border-line p-4 sm:p-5">
              <CreateSessionForm clinicId={clinicId} />
            </div>
          </details>
        ) : null}
      </Section>
    </>
  );
}
