import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, Notice, PageTitle, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { PrivacyNoticeForm } from "./privacy-form";
import { AddAntigenForm, AddProductForm, ImportScheduleForm, MasterStatusButton } from "./config-forms";

export const metadata: Metadata = { title: "Clinical setup" };

interface Master {
  demoMode: boolean;
  antigens: { id: string; code: string; name: string; status: string; createdBy: string | null }[];
  products: { id: string; code: string; name: string; presentation: string; status: string; createdBy: string | null; antigens: string[] }[];
  schedules: { id: string; program: string; label: string; status: string; isDemo: boolean; effectiveFrom: string | null; effectiveTo: string | null; rules: number; fixtures: number }[];
}

const tone = (s: string) => (s === "active" ? "success" : s === "retired" ? "neutral" : s === "draft" || s === "clinical_review" || s === "approved" ? "attention" : "info");

export default async function ClinicalConfig({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("admin.config") && !caps.has("rules.propose") && !caps.has("rules.approve")) notFound();
  const [m, notice] = await Promise.all([
    rpc.rpc<Master>("list_clinical_master", { p_clinic_id: clinicId }),
    caps.has("admin.config") ? rpc.rpc<{ configured: boolean; version?: string; text?: string }>("get_privacy_notice", { p_clinic_id: clinicId }) : Promise.resolve(null),
  ]);
  if (!m) notFound();
  const canApprove = caps.has("rules.approve");
  const canStage = caps.has("admin.config") || caps.has("rules.propose");

  return (
    <>
      <PageTitle
        title="Clinical setup"
        lead="Vaccines, antigens and vaccination schedules. Nothing takes effect until a clinical lead, who is a different person from whoever prepared it, approves it."
      />
      <Notice tone="info" title="Your clinic supplies the clinical content">
        Every schedule must cite its authoritative source and be approved by your clinical lead before use. This system does not supply clinical rules.
      </Notice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="ag-h">
          <h2 id="ag-h" className="mb-3 text-xl font-bold">
            Antigens
          </h2>
          {m.antigens.length === 0 ? (
            <EmptyState title="No antigens yet" />
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {m.antigens.map((a) => (
                <li key={a.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      {a.code} <span className="font-normal text-ink-soft">{a.name}</span>
                    </p>
                    <StatusChip tone={tone(a.status)}>{a.status}</StatusChip>
                  </div>
                  {a.status === "draft" && canApprove ? (
                    a.createdBy === ctx.profileId ? (
                      <p className="text-sm text-ink-soft">You created this; someone else must activate it.</p>
                    ) : (
                      <MasterStatusButton clinicId={clinicId} kind="antigen" id={a.id} status="active" label={`Activate ${a.code}`} />
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canStage ? <AddAntigenForm clinicId={clinicId} /> : null}
        </Card>

        <Card aria-labelledby="pr-h">
          <h2 id="pr-h" className="mb-3 text-xl font-bold">
            Vaccine products
          </h2>
          {m.products.length === 0 ? (
            <EmptyState title="No products yet" />
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {m.products.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      {p.name} <span className="font-normal text-ink-soft">({p.code})</span>
                    </p>
                    <StatusChip tone={tone(p.status)}>{p.status}</StatusChip>
                  </div>
                  <p className="text-sm text-ink-soft">
                    {p.presentation} · antigens: {p.antigens.join(", ")}
                  </p>
                  {p.status === "draft" && canApprove ? (
                    p.createdBy === ctx.profileId ? (
                      <p className="text-sm text-ink-soft">You created this; someone else must activate it.</p>
                    ) : (
                      <MasterStatusButton clinicId={clinicId} kind="product" id={p.id} status="active" label={`Activate ${p.code}`} />
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canStage ? <AddProductForm clinicId={clinicId} /> : null}
        </Card>

        <Card className="lg:col-span-2" aria-labelledby="sc-h">
          <h2 id="sc-h" className="mb-3 text-xl font-bold">
            Vaccination schedules
          </h2>
          {m.schedules.length === 0 ? (
            <EmptyState title="No schedule has been imported">Until one is approved and activated, the system shows no calculated dates.</EmptyState>
          ) : (
            <ul className="mb-4 divide-y divide-line rounded-control border border-line">
              {m.schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <Link href={`/clinic/${clinicId}/clinical/schedules/${s.id}`} className="font-bold underline underline-offset-4">
                      {s.program} · {s.label}
                    </Link>
                    <span className="block text-sm text-ink-soft">
                      {s.rules} rules · {s.fixtures} test cases · {s.effectiveFrom ? `from ${formatDate(s.effectiveFrom)}` : "no start date"}
                      {s.effectiveTo ? ` to ${formatDate(s.effectiveTo)}` : ""}
                    </span>
                  </span>
                  <StatusChip tone={tone(s.status)}>{s.status.replace("_", " ")}</StatusChip>
                </li>
              ))}
            </ul>
          )}
          {caps.has("rules.propose") ? <ImportScheduleForm clinicId={clinicId} /> : null}
        </Card>
        {notice ? (
          <Card className="lg:col-span-2" aria-labelledby="pn-h">
            <h2 id="pn-h" className="mb-3 text-xl font-bold">
              Privacy notice for families
            </h2>
            <PrivacyNoticeForm clinicId={clinicId} current={notice} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
