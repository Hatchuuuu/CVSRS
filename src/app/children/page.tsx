import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Baby, Building2, Calendar, ShieldAlert } from "lucide-react";
import { EmptyState, PageTitle, Section, recordStatusChip, relationshipChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/lib/server/viewer";
import { AddChildForm, LinkRequestForm, QrPanel } from "./forms";
import { PrivacyNotices, type ClinicNotice } from "./privacy-notice";

export const metadata: Metadata = { title: "My Children" };

interface MyChild {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
  dobPrecision: string;
  recordStatus: string;
  relationshipStatus: string;
  accessScope: "identity_only" | "full";
  relationship: string;
  clinicName: string | null;
}
interface Clinic {
  id: string;
  name: string;
}

export default async function MyChildren() {
  const { rpc } = await requireViewer();
  // One privacy read for every clinic (0031). A failure reaches the error boundary: the add and link forms must not
  // appear while an unacknowledged notice could not be checked.
  const [children, clinics, pendingNotices] = await Promise.all([
    rpc.rpc<MyChild[]>("my_children"),
    rpc.rpc<Clinic[]>("list_public_clinics"),
    rpc.rpc<ClinicNotice[]>("get_pending_privacy_notices"),
  ]);
  const list = children ?? [];
  const clinicList = clinics ?? [];
  if (!pendingNotices) throw new Error("Privacy notices could not be loaded.");
  const notices = pendingNotices;

  return (
    <div className="space-y-8">
      <PageTitle
        badge="Family Dashboard"
        title="My Children"
        lead="Manage vaccination records, view upcoming schedules, and generate digital check-in passes for your family."
      />

      {list.length === 0 ? (
        <EmptyState title="No children linked to your account yet">
          Add a child below to get started, or request to link a child record already on file at your local health center.
        </EmptyState>
      ) : (
        <div className="grid gap-6" aria-label="Children">
          {list.map((c) => {
            return (
              <div key={c.childId} className="card-elevated p-5 sm:p-6 group">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary font-bold shadow-xs">
                      <Baby className="size-6" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-2xl font-bold tracking-tight text-ink break-words">{c.displayName}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-ink-soft">
                        <span className="tnum rounded-md bg-sunken px-2 py-0.5 text-ink break-all">Record #{c.localRecordNo}</span>
                        {c.dobPrecision === "exact" ? (
                          <span className="flex items-center gap-1">
                            <Calendar aria-hidden className="size-3" />
                            Born {formatDate(c.dob)}
                          </span>
                        ) : c.dobPrecision === "estimated" ? (
                          <span>Birth date estimated</span>
                        ) : null}
                        {c.clinicName ? (
                          <span className="flex min-w-0 items-center gap-1 break-words">
                            <Building2 aria-hidden className="size-3" />
                            {c.clinicName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {recordStatusChip(c.recordStatus)}
                    {relationshipChip(c.relationshipStatus)}
                  </div>
                </div>

                {c.accessScope === "full" ? (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
                    <Link
                      href={`/children/${c.childId}`}
                      className="group/cta inline-flex min-h-11 items-center gap-2 rounded-control bg-primary-soft px-4 py-2 text-sm font-bold text-primary-strong no-underline hover:bg-sunken hover:shadow-xs transition-[background-color,box-shadow]"
                    >
                      <span>Vaccination schedule and history</span>
                      <ArrowRight aria-hidden className="size-4 transition-transform group-hover/cta:translate-x-1" />
                    </Link>
                    <QrPanel childId={c.childId} childName={c.displayName} />
                  </div>
                ) : (
                  <div className="mt-6 flex items-start gap-3 rounded-control border border-review bg-review-bg p-4 text-sm text-review shadow-2xs">
                    <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Clinic verification needed to see vaccination history</p>
                      <p className="mt-0.5">
                        Vaccination schedules appear after clinic staff verify your guardian identity in person. Bring a valid ID on your next visit.{" "}
                        <Link href={`/children/${c.childId}`} className="font-bold underline">
                          View details →
                        </Link>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-14 space-y-12">
        <PrivacyNotices notices={notices} />
        <Section id="add-h" title="Register a new child record" description="For children who do not have an existing record at the health center. Staff will verify details during your first visit.">
          <AddChildForm clinics={clinicList} />
        </Section>
        <Section id="link-h" title="Link an existing clinic record" description="Request guardian access to a child already registered at the clinic. Privacy rules require in-person clinic verification.">
          <LinkRequestForm clinics={clinicList} />
        </Section>
      </div>
    </div>
  );
}
