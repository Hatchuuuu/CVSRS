import { personName } from "@/lib/person-name";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Baby, Building2, Calendar, ShieldAlert } from "lucide-react";
import { EmptyState, PageTitle, Section, recordStatusChip, relationshipChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/lib/server/viewer";
import { QrPanel } from "./forms";


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

export default async function MyChildren() {
  const { rpc } = await requireViewer();
  const children = await rpc.rpc<MyChild[]>("my_children");
  if (!children) throw new Error("Children could not be loaded. Please try again.");
  const list = children;

  return (
    <div className="space-y-8">
      <PageTitle
        dashboard
        action={<div className="flex flex-wrap gap-2"><Link href="/children/register" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-strong">Register a child <ArrowRight aria-hidden className="size-4" /></Link><Link href="/children/link" className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-sunken">Link a clinic record</Link></div>}
        title="My Children"
        lead="Find each child’s clinic-reviewed vaccinations and next steps. Register a new child or request access to an existing clinic record."
      />

      <section aria-label="Your family records" className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-lg font-bold">Your family records</h2><p className="text-sm text-ink-soft">{list.length} linked {list.length === 1 ? "child" : "children"} · {list.filter(c => c.accessScope === "full").length} with vaccination access · {list.filter(c => c.accessScope !== "full").length} with limited access</p></div>
        <Link href="/messages?portal=parents" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold no-underline">Clinic messages <ArrowRight aria-hidden className="size-4" /></Link>
      </section>

      {list.length === 0 ? (
        <EmptyState title="No children linked to your account yet">
          Register a child to get started, or request to link a child record already on file at your local health center.
        </EmptyState>
      ) : (
        <ul className="family-records divide-y divide-line rounded-card border border-line bg-surface" aria-label="Children">
          {list.map((c) => {
            return (
              <li key={c.childId}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                      <Baby aria-hidden className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold tracking-tight text-ink break-words">{personName(c.displayName)}</h2>
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
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <Link
                      href={`/children/${c.childId}`}
                      className="group/cta inline-flex min-h-11 items-center gap-2 rounded-control bg-primary-soft px-4 py-2 text-sm font-bold text-primary-strong no-underline hover:bg-sunken hover:shadow-xs transition-[background-color,box-shadow]"
                    >
                      <span>Vaccination schedule and history</span>
                      <ArrowRight aria-hidden className="size-4 transition-transform group-hover/cta:translate-x-1" />
                    </Link>
                    <QrPanel childId={c.childId} childName={personName(c.displayName)} />
                  </div>
                ) : (
                  <div className="mt-5 flex items-start gap-3 border-t border-line pt-4 text-sm text-ink-soft">
                    <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
                    <div>
                      <p className="font-semibold text-ink">Clinic verification needed to see vaccination history</p>
                      <p className="mt-0.5">
                        Bring a valid ID on your next visit so staff can verify your guardian identity in person.
                      </p>
                      <Link href={`/children/${c.childId}`} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-primary-strong no-underline hover:underline">
                        View details <ArrowRight aria-hidden className="size-4" />
                      </Link>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-14 space-y-12">

        <Section id="add-h" title="Register a new child record" description="For children who do not have an existing record at the health center. Staff will verify details during your first visit.">
          <Link href="/children/register" className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary">Open registration form <ArrowRight aria-hidden className="size-4" /></Link>
        </Section>
        <Section id="link-h" title="Link an existing clinic record" description="Request guardian access to a child already registered at the clinic. Privacy rules require in-person clinic verification.">
          <Link href="/children/link" className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary">Request guardian access <ArrowRight aria-hidden className="size-4" /></Link>
        </Section>
      </div>
    </div>
  );
}
