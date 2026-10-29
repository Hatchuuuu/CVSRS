import { personName } from "@/lib/person-name";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState, Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { formatClinicDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { DeclineTransfer, TransferButton } from "./forms";

export const metadata: Metadata = { title: "Record transfers" };

interface Out {
  id: string;
  childId: string;
  status: "requested" | "ready" | "completed" | "declined" | "cancelled";
  childName: string;
  recordNo: string;
  toClinic: string;
  consent: "app" | "in_person";
  requestedAt: string;
  releasedAt: string | null;
  note: string | null;
}
interface In {
  id: string;
  status: Out["status"];
  fromClinic: string;
  childName: string | null;
  recordNo: string | null;
  childId: string | null;
  consent: "app" | "in_person";
  requestedAt: string;
}

const STATUS = {
  requested: { tone: "attention", label: "Waiting for release" },
  ready: { tone: "review", label: "Released, waiting for the new clinic" },
  completed: { tone: "success", label: "Moved" },
  declined: { tone: "neutral", label: "Declined" },
  cancelled: { tone: "neutral", label: "Cancelled" },
} as const;
export default async function Transfers({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const day = (iso: string) => formatClinicDate(iso, membership.clinicTimezone);
  const caps = new Set(membership.capabilities);
  if (!caps.has("guardian.verify") && !caps.has("review.resolve") && !caps.has("child.register")) notFound();
  const t = await rpc.rpc<{ outgoing: Out[]; incoming: In[] }>("list_record_transfers", { p_clinic_id: clinicId });
  if (!t) notFound();
  const base = `/api/v1/clinics/${clinicId}/record-transfers`;

  return (
    <>
      <PageTitle title="Record transfers" lead="A family that moves can have the child's record moved to another clinic of this organization. It needs the guardian's consent, a release from a clinical lead here, and acceptance by the new clinic." />

      <Section id="in-h" title="Coming to this clinic" className="border-t-0 pt-0" description="You see the child's name only after the current clinic has released the record.">
        {t.incoming.length === 0 ? (
          <EmptyState title="Nothing coming in" />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line bg-surface">
            {t.incoming.map((x) => (
              <li key={x.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {x.childName ? (
                      <>
                        {x.childId ? (
                          <Link href={`/clinic/${clinicId}/children/${x.childId}`} className="text-primary">
                            {personName(x.childName)}
                          </Link>
                        ) : (
                          x.childName
                        )}{" "}
                        <span className="tnum font-normal text-ink-soft">· {x.recordNo}</span>
                      </>
                    ) : (
                      "A child from " + x.fromClinic
                    )}
                  </p>
                  <StatusChip tone={STATUS[x.status].tone}>{STATUS[x.status].label}</StatusChip>
                </div>
                <p className="text-sm text-ink-soft">
                  From {x.fromClinic} · asked {day(x.requestedAt)} · consent {x.consent === "app" ? "given by the guardian in the app" : "recorded in person"}
                </p>
                {x.status === "ready" && caps.has("child.register") ? (
                  <div className="flex flex-wrap gap-3">
                    <TransferButton label="Accept and take over the record" path={`${base}/${x.id}/accept`} />
                    <DeclineTransfer path={`${base}/${x.id}/decline`} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="out-h" title="Leaving this clinic" description="To start one, open the child and choose “Move this child's record”, or the family can ask in the app.">
        {t.outgoing.length === 0 ? (
          <EmptyState title="Nothing going out" />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line bg-surface">
            {t.outgoing.map((x) => (
              <li key={x.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    <Link href={`/clinic/${clinicId}/children/${x.childId}`} className="text-primary">
                      {personName(x.childName)}
                    </Link>{" "}
                    <span className="tnum font-normal text-ink-soft">· {x.recordNo}</span> <span className="font-normal text-ink-soft">to {x.toClinic}</span>
                  </p>
                  <StatusChip tone={STATUS[x.status].tone}>{STATUS[x.status].label}</StatusChip>
                </div>
                <p className="text-sm text-ink-soft">
                  Asked {day(x.requestedAt)} · consent {x.consent === "app" ? "given by the guardian in the app" : "recorded in person"}
                  {x.note ? ` · ${x.note}` : ""}
                </p>
                {x.status === "requested" && caps.has("review.resolve") ? (
                  <div className="flex flex-wrap gap-3">
                    <TransferButton
                      label="Release the record"
                      path={`${base}/${x.id}/release`}
                      confirm={{
                        text: `Release ${personName(x.childName)}'s record to ${x.toClinic}? ${x.toClinic} can then see the child's name and take over the record. When they accept, the enrollment moves there, future bookings here are cancelled and the family is told.`,
                        yes: "Yes, release the record",
                        no: "Not now",
                      }}
                    />
                    <DeclineTransfer path={`${base}/${x.id}/decline`} />
                  </div>
                ) : null}
                {x.status === "requested" && !caps.has("review.resolve") ? <p className="text-sm text-ink-soft">A clinical lead has to release it.</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Notice tone="info" title="What moves">
        Access moves with the enrollment. Vaccination history, certificates and the audit trail stay as they are. Future bookings here are cancelled and the family is told. Transfers to clinics of other organizations are not supported.
      </Notice>
    </>
  );
}
