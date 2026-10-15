import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BackLink, ChildBanner, EmptyState, Notice, Section, StatusChip, recordStatusChip, relationshipChip } from "@/components/ui";
import { ScheduleView, type ScheduleRequirement } from "@/components/schedule-view";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import type { RpcName } from "@/lib/db/port";
import { ConfirmIdentity, EditIdentity, GuardianActions, StaffQr } from "./actions";
import { OutsideDoseForm, VerifyEvidence, type ProductOption } from "./evidence";
import { StartTransfer } from "../../transfers/forms";
import { HoldsPanel, type Hold } from "./holds";
import { CatchupPanel, type CatchupPlan } from "./catchup";
import { VerifyContact, type GuardianContact } from "./contacts";
import { CertificatesPanel, type StaffCertificate } from "./certificates";
import { AdministerPanel, CorrectionForm, ExceptionForm, type StockLocationOption, type StockLotOption } from "./administration";
import { StaffVisits, type BookableSession, type ChildAppointment } from "./visits";
import { RecordStatus } from "./record-status";
import { StaffNotes, type ChildNote } from "./notes";
import { CardReview } from "./card-review";
import type { CardSubmission } from "@/app/children/[childId]/vaccination-card";

export const metadata: Metadata = { title: "Child record" };

interface ChildView {
  childId: string;
  aliasResolved: boolean;
  localRecordNo: string;
  displayName: string;
  dob: string | null;
  dobPrecision: string;
  estimatedBirthStart: string | null;
  estimatedBirthEnd: string | null;
  sex: string;
  addressText: string | null;
  recordStatus: string;
  version: number;
  guardians: { relationshipId: string; name: string; relationship: string; status: string; hasAccount: boolean; phone: string | null; email: string | null }[];
}
interface StaffSchedule {
  status: "evaluated" | "no_active_schedule";
  asOf?: string;
  versionLabel?: string;
  isDemo?: boolean;
  pendingEvidence?: number;
  requirements?: ScheduleRequirement[];
}
interface StaffHistoryItem {
  eventId: string;
  origin: string;
  verificationStatus: "verified" | "pending_verification" | "rejected";
  administeredOn: string | null;
  datePrecision: string;
  product: string | null;
  reportedProduct: string | null;
  provider: string | null;
  amended: boolean;
}

export default async function ChildPage({ params }: { params: Promise<{ clinicId: string; childId: string }> }) {
  const { clinicId, childId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  // A mistyped address is "not found", as in the API (src/lib/api/handler.ts), not a database error page.
  if (!z.uuid().safeParse(childId).success) notFound();
  const caps = new Set(membership.capabilities);
  const tz = membership.clinicTimezone;
  async function read<T>(name: RpcName, args: Record<string, unknown>): Promise<T> {
    const data = await rpc.rpc<T>(name, args);
    if (data == null) throw new Error(`Child record data could not be loaded (${name}).`);
    return data;
  }
  if (!caps.has("child.search")) notFound();
  const c = await rpc.rpc<ChildView>("staff_get_child", { p_clinic_id: clinicId, p_child_id: childId });
  if (!c) notFound();

  const canClinical = caps.has("child.read_clinical");
  const canEvidence = caps.has("evidence.verify");
  const canRecord = caps.has("vaccination.record");
  const canVerifyGuardians = caps.has("guardian.verify");
  const canIssue = caps.has("certificate.issue");
  const canSeeVisits = caps.has("appointment.manage") || caps.has("queue.manage");
  const none = <T,>(value: T) => Promise.resolve(value);
  // One stage after the child is found: every read below is independent. Each stays behind its capability, and any
  // failure rejects the page (to the clinic error boundary) rather than showing an empty section.
  const [schedule, history, productList, encounter, stockView, contacts, catchupPlans, holds, transferTargets, certificates, visits, sessions, notes, cards] = await Promise.all([
    canClinical ? read<StaffSchedule>("evaluate_child", { p_clinic_id: clinicId, p_child_id: c.childId, p_as_of: null }) : none(null),
    canClinical ? read<StaffHistoryItem[]>("list_child_history", { p_clinic_id: clinicId, p_child_id: c.childId }) : none(null),
    canClinical && canEvidence ? read<ProductOption[]>("list_active_products", { p_clinic_id: clinicId }) : none([] as ProductOption[]),
    canRecord ? rpc.rpc<{ encounterId: string }>("get_open_encounter", { p_clinic_id: clinicId, p_child_id: c.childId }) : none(null),
    canRecord ? read<{ locations: StockLocationOption[]; lots: StockLotOption[] }>("list_stock", { p_clinic_id: clinicId }) : none(null),
    canVerifyGuardians ? read<GuardianContact[]>("list_child_guardian_contacts", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as GuardianContact[]),
    canClinical ? read<CatchupPlan[]>("list_catchup_plans", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as CatchupPlan[]),
    canClinical ? read<Hold[]>("list_clinical_holds", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as Hold[]),
    canVerifyGuardians ? read<{ clinics: { id: string; name: string }[] }>("list_record_transfers", { p_clinic_id: clinicId }).then((t) => t.clinics) : none([] as { id: string; name: string }[]),
    canIssue ? read<StaffCertificate[]>("list_child_certificates", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as StaffCertificate[]),
    canSeeVisits ? read<ChildAppointment[]>("list_child_appointments", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as ChildAppointment[]),
    caps.has("appointment.manage") ? read<BookableSession[]>("list_sessions", { p_clinic_id: clinicId, p_from: null, p_to: null }) : none([] as BookableSession[]),
    read<ChildNote[]>("list_child_notes", { p_clinic_id: clinicId, p_child_id: c.childId }),
    canClinical ? read<CardSubmission[]>("staff_list_card_submissions", { p_clinic_id: clinicId, p_child_id: c.childId }) : none([] as CardSubmission[]),
  ]);
  const contactOf = new Map(contacts.map((x) => [x.relationshipId, x]));
  const stockLots = stockView?.lots ?? [];
  const stockLocations = stockView?.locations ?? [];

  const born =
    c.dobPrecision === "exact"
      ? `Born ${formatDate(c.dob)}`
      : c.dobPrecision === "estimated"
        ? `Born between ${formatDate(c.estimatedBirthStart)} and ${formatDate(c.estimatedBirthEnd)} (estimated)`
        : "Birth date not recorded";
  const pending = schedule?.pendingEvidence ? ` ${schedule.pendingEvidence} reported dose(s) are waiting for verification and are not counted.` : "";

  return (
    <>
      <BackLink href={`/clinic/${clinicId}`}>Find or register</BackLink>
      <ChildBanner sticky name={c.displayName} recordNo={c.localRecordNo} meta={`${born} · Sex ${c.sex.replace("_", " ")}`} chips={recordStatusChip(c.recordStatus)} />
      {c.recordStatus === "inactive" ? (
        <Notice tone="attention" title="Inactive record">
          This child is no longer seen at this clinic. The history stays readable; the family gets no messages and the record cannot be booked.
        </Notice>
      ) : null}
      {c.aliasResolved ? (
        <Notice tone="review" title="Merged record">
          The record you opened was merged into this one. Its history is preserved.
        </Notice>
      ) : null}

      <div className="space-y-10">
        {canClinical ? <Section id="cards-h" title="Family vaccination cards" description="Check submitted card entries against documentary evidence. Approval records historical doses without issuing clinic stock.">
          {cards.length ? cards.map(card => <CardReview key={card.submissionId} clinicId={clinicId} submission={card} products={productList} canReview={canEvidence} />) : <p className="text-ink-soft">No family card submissions.</p>}
        </Section> : null}
        {canClinical ? (
          <Section id="sch-h" title="Schedule" className="border-t-0 pt-0" description={schedule?.status === "evaluated" ? `As of ${formatDate(schedule.asOf)}, version ${schedule.versionLabel}. Decision support only: confirm eligibility, identity and consent before care.${pending}` : undefined}>
            {schedule?.status === "evaluated" && schedule.requirements ? (
              <ScheduleView requirements={schedule.requirements} showInternals />
            ) : (
              <EmptyState title="No approved schedule is active">Calculated dates are unavailable until a clinical lead approves and activates a schedule. Care still follows clinic practice.</EmptyState>
            )}
          </Section>
        ) : null}

        {canRecord ? (
          <Section
            id="give-h"
            title="Give a vaccine"
            className={canClinical ? "" : "border-t-0 pt-0"}
            description={encounter ? "The visit is open. Check the child, then record what you gave." : "Start the visit from Today (call the child, then Start service) before recording a vaccine."}
          >
            {c.recordStatus !== "active" ? (
              <Notice tone="attention" title="Confirm the child's identity first">Confirm the identity of this child (Record actions) before any care is recorded.</Notice>
            ) : encounter ? (
              <AdministerPanel clinicId={clinicId} clinicTimezone={tz} encounterId={encounter.encounterId} childName={c.displayName} recordNo={c.localRecordNo} lots={stockLots} locations={stockLocations} />
            ) : (
              <EmptyState title="No open visit for this child">The queue creates the visit when service starts. If care has already been given, use the form below.</EmptyState>
            )}
            <details className="mt-6 rounded-control border border-line bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 font-semibold text-primary">Record care already given (exception)</summary>
              <div className="border-t border-line p-4 sm:p-5">
                <ExceptionForm clinicId={clinicId} clinicTimezone={tz} childId={c.childId} encounterId={encounter?.encounterId ?? null} products={productList} lots={stockLots} locations={stockLocations} />
              </div>
            </details>
          </Section>
        ) : null}

        {canSeeVisits ? (
          <Section id="vis-h" title="Visits" description="Book, move or cancel a visit for a family who phones in or comes to the desk. The family is told each change in the app.">
            <StaffVisits childId={c.childId} childName={c.displayName} appointments={visits} sessions={sessions} clinicTimezone={tz} canManage={caps.has("appointment.manage")} recordActive={c.recordStatus === "active" || c.recordStatus === "provisional"} />
          </Section>
        ) : null}

        <Section id="notes-h" title="Staff notes" description="Observations and follow-up information recorded by authorized clinic staff. These notes do not replace a clinical assessment.">
          <StaffNotes clinicId={clinicId} childId={c.childId} notes={notes} capabilities={[...caps]} clinicTimezone={tz} events={history ?? []} />
        </Section>

        <div className="grid gap-10 xl:grid-cols-2">
          <Section id="g-h" title="Guardians" className={canClinical ? "" : "border-t-0 pt-0"}>
            {/* Removed guardians leave this list, so their confirmation is shown here rather than in their row. */}
            <OutcomeNoticeView noticeKey={`guardians:${childId}`} />
            {c.guardians.length === 0 ? (
              <p className="text-ink-soft">No guardian is recorded.</p>
            ) : (
              <ul className="divide-y divide-line rounded-control border border-line bg-surface">
                {c.guardians.map((g) => (
                  <li key={g.relationshipId} className="p-4">
                    <p className="font-bold">
                      {g.name} <span className="font-normal text-ink-soft">({g.relationship.replace("_", " ")})</span>
                    </p>
                    <div className="my-1.5 flex flex-wrap items-center gap-2">
                      {relationshipChip(g.status)}
                      {g.hasAccount ? null : <span className="text-sm text-ink-soft">No app account</span>}
                    </div>
                    {g.phone || g.email ? <p className="tnum text-sm">{[g.phone, g.email].filter(Boolean).join(" · ")}</p> : null}
                    {contactOf.get(g.relationshipId) ? <VerifyContact clinicId={clinicId} contact={contactOf.get(g.relationshipId)!} /> : null}
                    {caps.has("guardian.verify") ? <GuardianActions clinicId={clinicId} childId={childId} guardianName={g.name} relationshipId={g.relationshipId} status={g.status} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="a-h" title="Record actions">
            {caps.has("child.register") ? (
              <div className="space-y-5">
                {/* Always mounted, so its "Identity confirmed" outcome survives the refresh that removes the button. */}
                <ConfirmIdentity clinicId={clinicId} childId={c.childId} version={c.version} provisional={c.recordStatus === "provisional"} />
                <StaffQr clinicId={clinicId} childId={c.childId} childName={c.displayName} />
                {caps.has("review.resolve") ? <RecordStatus clinicId={clinicId} childId={c.childId} childName={c.displayName} recordStatus={c.recordStatus} /> : null}
              </div>
            ) : (
              <p className="text-ink-soft">Your role can view identity details only.</p>
            )}
          </Section>
        </div>

        {canClinical ? (
          <>
            <Section id="his-h" title="Vaccination history">
              <OutcomeNoticeView noticeKey={`history:${childId}`} />
              {!history || history.length === 0 ? (
                <EmptyState title="No vaccinations recorded" />
              ) : (
                <ul className="divide-y divide-line rounded-control border border-line bg-surface">
                  {history.map((h) => (
                    <li key={h.eventId} id={`event-${h.eventId}`} className="p-4 scroll-mt-32">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="block font-bold">{h.product ?? h.reportedProduct ?? "Vaccine not identified"}</span>
                          <span className="text-sm text-ink-soft">
                            {h.datePrecision === "exact" ? formatDate(h.administeredOn) : `${h.datePrecision} precision`} · {h.origin.replace("_", " ")}
                            {h.provider ? ` · ${h.provider}` : ""}
                            {h.amended ? " · amended" : ""}
                          </span>
                        </span>
                        {h.verificationStatus === "verified" ? (
                          <StatusChip tone="success">Verified</StatusChip>
                        ) : h.verificationStatus === "pending_verification" ? (
                          <StatusChip tone="review">Pending verification</StatusChip>
                        ) : (
                          <StatusChip tone="neutral">Rejected</StatusChip>
                        )}
                      </div>
                      {canRecord && h.verificationStatus !== "rejected" && h.origin !== "parent_reported" ? <CorrectionForm clinicId={clinicId} clinicTimezone={tz} eventId={h.eventId} lots={stockLots} locations={stockLocations} /> : null}
                      {h.verificationStatus === "pending_verification" && canEvidence ? (
                        <VerifyEvidence clinicId={clinicId} childId={childId} eventId={h.eventId} products={productList} defaultDate={h.datePrecision === "exact" ? h.administeredOn : null} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="hold-h" title="Clinical hold" description="Stops planned doses until a clinical lead has reviewed the child.">
              <HoldsPanel clinicId={clinicId} clinicTimezone={tz} childId={c.childId} holds={holds} canPlace={canRecord} canRelease={caps.has("review.resolve")} />
            </Section>

            <Section id="cu-h" title="Catch-up plan" description="A plan written by a clinician and approved by a second person.">
              <CatchupPanel clinicId={clinicId} childId={c.childId} plans={catchupPlans} me={ctx.profileId} canAuthor={canRecord} canReview={caps.has("rules.approve")} />
            </Section>

            {canIssue ? (
              <Section id="cert-h" title="Certificates" description="A clinic-issued record of verified vaccinations. It is frozen when issued; later corrections mark it “under review” instead of changing it.">
                <CertificatesPanel clinicId={clinicId} childId={c.childId} certificates={certificates} canIssue={canIssue} clinicTimezone={tz} />
              </Section>
            ) : null}

            {canEvidence ? (
              <Section id="od-h" title="Record a dose given elsewhere">
                <OutsideDoseForm clinicId={clinicId} childId={c.childId} products={productList} />
              </Section>
            ) : null}
          </>
        ) : (
          <Section id="n-h" title="Vaccination history and schedule">
            <p className="text-ink-soft">Your role does not include clinical history.</p>
          </Section>
        )}

        {canVerifyGuardians && transferTargets.length > 0 && c.recordStatus === "active" ? (
          <Section id="mv-h" title="Move this child's record" description="For a family that is moving to another clinic of this organization.">
            <StartTransfer clinicId={clinicId} childId={c.childId} clinics={transferTargets} />
          </Section>
        ) : null}

        {caps.has("child.register") ? (
          <Section id="e-h" title="Correct identity details" description="Changes to name or birth date need a reason and are kept in the audit trail.">
            <EditIdentity clinicId={clinicId} childId={c.childId} version={c.version} initial={{ displayName: c.displayName, dob: c.dob ?? "", addressText: c.addressText ?? "", precision: c.dobPrecision }} />
          </Section>
        ) : null}
      </div>
    </>
  );
}
