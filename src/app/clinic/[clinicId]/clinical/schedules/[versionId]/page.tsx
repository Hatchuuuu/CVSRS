import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Card, Notice, PageTitle, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { ScheduleActions } from "./schedule-actions";

export const metadata: Metadata = { title: "Schedule version" };

type Age = { value: number; unit: string } | null;
interface Version {
  id: string;
  program: string;
  label: string;
  status: string;
  isDemo: boolean;
  source: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  proposedBy: string | null;
  approvedBy: string | null;
  cohort: Record<string, string>;
  rules: {
    sequence: number;
    requirement: string;
    antigen: string;
    series: string;
    ordinal: number;
    targetOffset: Age;
    minimumAge: Age;
    maximumAge: Age;
    dueWindow: { start?: Age; end?: Age } | null;
    acceptedProducts: string[];
    dependsOn: { predecessor: string; interval: { value: number; unit: string } }[];
  }[];
  fixtures: { name: string; passed: boolean; differences: { requirement: string; expected: string; actual: string }[] }[];
}
const age = (a: Age | undefined) => (a ? `${a.value} ${a.unit}` : "—");

export default async function ScheduleVersion({ params }: { params: Promise<{ clinicId: string; versionId: string }> }) {
  const { clinicId, versionId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("admin.config") && !caps.has("rules.propose") && !caps.has("rules.approve")) notFound();
  // A mistyped address is "not found", as in the API (src/lib/api/handler.ts), not a database error page.
  if (!z.uuid().safeParse(versionId).success) notFound();
  // Both reads start together. An unknown version still shows the unavailable page, whatever the impact read did.
  const versionRead = rpc.rpc<Version>("get_schedule_version", { p_clinic_id: clinicId, p_version_id: versionId });
  const impactRead = caps.has("rules.propose") || caps.has("rules.approve") ? rpc.rpc<{ cohortChildren: number; childrenOnAnotherVersion: number }>("preview_schedule_impact", { p_clinic_id: clinicId, p_version_id: versionId }) : Promise.resolve(null);
  impactRead.catch(() => undefined); // handled below; this only stops an unhandled rejection while the version is awaited
  const v = await versionRead;
  if (!v) notFound();
  const impact = await impactRead;
  const allPass = v.fixtures.length > 0 && v.fixtures.every((f) => f.passed);

  return (
    <>
      <PageTitle title={`${v.program} · ${v.label}`} lead={`Source: ${v.source || "not stated"}`} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusChip tone={v.status === "active" ? "success" : v.status === "retired" ? "neutral" : "attention"}>{v.status.replace("_", " ")}</StatusChip>
        <span className="text-sm text-ink-soft">
          Effective {v.effectiveFrom ? formatDate(v.effectiveFrom) : "not set"}
          {v.effectiveTo ? ` to ${formatDate(v.effectiveTo)}` : ""}
        </span>
      </div>

      <Card className="mb-6" aria-labelledby="act-h">
        <h2 id="act-h" className="mb-3 text-xl font-bold">
          Review and decisions
        </h2>
        {!allPass ? (
          <Notice tone="danger" role="alert" title="Test cases are not all passing">
            A schedule cannot be approved or activated until every test case passes.
          </Notice>
        ) : null}
        {impact ? (
          <p className="mb-3">
            Children matching this version&apos;s cohort: <strong>{impact.cohortChildren}</strong>. Children currently on another version: <strong>{impact.childrenOnAnotherVersion}</strong> (they move to this version when next evaluated).
          </p>
        ) : null}
        <ScheduleActions
          clinicId={clinicId}
          versionId={v.id}
          status={v.status}
          canPropose={caps.has("rules.propose")}
          canApprove={caps.has("rules.approve")}
          isProposer={v.proposedBy === ctx.profileId}
        />
      </Card>

      <Card className="mb-6" aria-labelledby="rules-h">
        <h2 id="rules-h" className="mb-3 text-xl font-bold">
          Rules
        </h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Rules table, scrolls sideways on small screens">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <caption className="sr-only">Schedule rules in evaluation order</caption>
            <thead>
              <tr className="border-b border-line">
                {["#", "Requirement", "Antigen", "Target", "Minimum age", "Maximum age", "Due window", "Depends on"].map((h) => (
                  <th key={h} scope="col" className="p-2 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.rules.map((r) => (
                <tr key={r.requirement} className="border-b border-line align-top">
                  <td className="p-2">{r.sequence}</td>
                  <th scope="row" className="p-2 font-semibold">
                    {r.requirement}
                  </th>
                  <td className="p-2">{r.antigen}</td>
                  <td className="p-2">{age(r.targetOffset)}</td>
                  <td className="p-2">{age(r.minimumAge)}</td>
                  <td className="p-2">{age(r.maximumAge)}</td>
                  <td className="p-2">{r.dueWindow ? `${age(r.dueWindow.start)} → ${age(r.dueWindow.end)}` : "—"}</td>
                  <td className="p-2">{r.dependsOn.length ? r.dependsOn.map((d) => `${d.predecessor} +${d.interval.value} ${d.interval.unit}`).join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card aria-labelledby="fx-h">
        <h2 id="fx-h" className="mb-3 text-xl font-bold">
          Test cases
        </h2>
        {v.fixtures.length === 0 ? (
          <p className="text-ink-soft">No test cases. Add at least one before review.</p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {v.fixtures.map((f) => (
              <li key={f.name} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{f.name}</p>
                  {f.passed ? <StatusChip tone="success">Passes</StatusChip> : <StatusChip tone="danger">Fails</StatusChip>}
                </div>
                {f.differences.map((d) => (
                  <p key={d.requirement} className="text-sm text-danger">
                    {d.requirement}: expected {d.expected}, got {d.actual}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
