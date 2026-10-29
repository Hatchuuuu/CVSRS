import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState, Notice, PageTitle, Section, SelectField } from "@/components/ui";
import { AppointmentItem, BookVisit, type MyAppointment, type OpenSession } from "@/app/children/[childId]/visits";
import { personName } from "@/lib/person-name";
import { requireViewer } from "@/lib/server/viewer";

export const metadata: Metadata = { title: "Appointments" };

interface Child {
  childId: string;
  displayName: string;
  localRecordNo: string;
  accessScope: "identity_only" | "full";
  clinicId: string | null;
  clinicName: string | null;
  clinicTimezone: string | null;
}

export default async function Appointments({ searchParams }: { searchParams?: Promise<{ child?: string | string[] }> }) {
  const { rpc } = await requireViewer();
  const query = searchParams ? await searchParams : {};
  const children = await rpc.rpc<Child[]>("my_children");
  if (!children) throw new Error("Children could not be loaded. Please try again.");
  const child = query.child !== undefined
    ? children.find(c => c.childId === query.child)
    : children.find(c => c.accessScope === "full") ?? children[0];
  if (query.child !== undefined && !child) notFound();
  const full = child?.accessScope === "full";
  const [appointments, sessions] = full ? await Promise.all([
    rpc.rpc<MyAppointment[]>("my_appointments"),
    child.clinicId ? rpc.rpc<OpenSession[]>("guardian_list_sessions", { p_clinic_id: child.clinicId, p_from: null, p_to: null }) : Promise.resolve([]),
  ]) : [[], []];
  if (!appointments || !sessions) throw new Error("Appointments could not be loaded. Please try again.");
  const mine = appointments.filter(a => a.childId === child?.childId);
  const current = mine.filter(a => a.status === "confirmed" || a.status === "checked_in").sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const recent = mine.filter(a => a.status !== "confirmed" && a.status !== "checked_in");
  return (
    <div className="w-full">
      <PageTitle title="Appointments" lead="View bookings and recent visits, choose a new time, or cancel a booking for your child." />
      {!child ? (
        <EmptyState title="No children linked yet">
          <p>Register or link a child before booking a clinic visit.</p>
          <Link href="/children#add-h" className="inline-flex min-h-11 items-center font-semibold text-primary">Register or link a child</Link>
        </EmptyState>
      ) : (
        <>
          <form method="get" className="mb-6 grid gap-x-4 sm:max-w-xl sm:grid-cols-[1fr_auto] sm:items-end">
            <SelectField id="appointment-child" name="child" label="Child" defaultValue={child.childId}>
              {children.map(c => <option key={c.childId} value={c.childId}>{personName(c.displayName)} · {c.localRecordNo}{c.accessScope !== "full" ? " · Verification needed" : ""}</option>)}
            </SelectField>
            <div className="mb-4"><Button type="submit">Show appointments</Button></div>
          </form>
          <section aria-label="Selected child" className="mb-6 rounded-card border border-line bg-surface p-5">
          <h2 className="break-words text-xl font-bold">{personName(child.displayName)}</h2>
          <p className="mt-1 text-sm text-ink-soft">Record #{child.localRecordNo}</p>
          <p className="mt-1 text-sm text-ink-soft">{child.clinicName ?? "Clinic not assigned"} · <Link href={`/children/${child.childId}`} className="inline-flex min-h-11 items-center font-semibold text-primary">Open child record</Link></p>
          </section>
          {!full ? (
            <Notice tone="review" title="Clinic verification needed">Clinic staff must verify your guardian access before you can view or book appointments. Open the child record for verification details.</Notice>
          ) : (
            <>
              <nav aria-label="Appointment sections" className="mb-6 flex flex-wrap gap-x-6 border-b border-line pb-3 text-sm font-semibold text-primary">
                <a href="#current-visits-h" className="inline-flex min-h-11 items-center">Current bookings</a>
                <a href="#book-visit-h" className="inline-flex min-h-11 items-center">Book a visit</a>
                <a href="#recent-visits-h" className="inline-flex min-h-11 items-center">Recent visits</a>
              </nav>
              <Section id="current-visits-h" title="Current bookings" className="border-t-0 pt-0">
                {current.length === 0 ? <EmptyState title="No current bookings">Choose an available time below to book a visit.</EmptyState> : (
                  <ul aria-label="Current bookings" className="divide-y divide-line rounded-control border border-line bg-surface">
                    {current.map(a => <AppointmentItem key={a.appointmentId} a={a} sessions={sessions} currentClinicTimezone={child.clinicTimezone} />)}
                  </ul>
                )}
              </Section>
              <Section id="book-visit-h" title={`Book a visit for ${personName(child.displayName)}`} description="Booking reserves a place. Clinic staff check what care is appropriate on the day.">
                <BookVisit key={child.childId} childId={child.childId} sessions={sessions} clinicTimezone={child.clinicTimezone} />
              </Section>
              <Section id="recent-visits-h" title="Recent visits" description="Completed, missed, cancelled and moved bookings from the last 60 days, plus any later dates.">
                {recent.length === 0 ? <EmptyState title="No recent visits">Completed or cancelled bookings will appear here.</EmptyState> : (
                  <ul aria-label="Recent visits" className="divide-y divide-line rounded-control border border-line bg-surface">
                    {recent.map(a => <AppointmentItem key={a.appointmentId} a={a} sessions={sessions} currentClinicTimezone={child.clinicTimezone} />)}
                  </ul>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
