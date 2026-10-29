import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageTitle, StatusChip } from "@/components/ui";
import { personName } from "@/lib/person-name";
import { requireViewer } from "@/lib/server/viewer";

export const metadata: Metadata = { title: "Vaccination records" };

interface Child {
  childId: string;
  displayName: string;
  localRecordNo: string;
  accessScope: "identity_only" | "full";
  clinicName: string | null;
}
const action = "inline-flex min-h-11 items-center font-semibold text-primary";

export default async function VaccinationRecords() {
  const { rpc } = await requireViewer();
  const children = await rpc.rpc<Child[]>("my_children");
  if (!children) throw new Error("Children could not be loaded. Please try again.");
  return (
    <div className="w-full">
      <PageTitle title="Vaccination records" lead="Choose a child to see clinic-reviewed vaccinations, next steps and available certificates." />
      {children.length === 0 ? (
        <EmptyState title="No children linked yet">
          <p>Register a child or link an existing clinic record to get started.</p>
          <Link href="/children#add-h" className={action}>Register or link a child</Link>
        </EmptyState>
      ) : (
        <div className="space-y-6">
        <nav aria-label="Choose a child" className="flex flex-wrap gap-x-6 rounded-card border border-line bg-sunken px-5 py-2">
          {children.map(child => <a key={child.childId} href={`#record-${child.childId}`} className={action}>{personName(child.displayName)}</a>)}
        </nav>
        <ul aria-label="Children's vaccination records" className="divide-y divide-line rounded-card border border-line bg-surface">
          {children.map(child => (
            <li id={`record-${child.childId}`} key={child.childId} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{personName(child.displayName)}</h2>
                  <p className="mt-1 text-sm text-ink-soft">Record #{child.localRecordNo} · {child.clinicName ?? "Clinic not assigned"}</p>
                </div>
                <StatusChip tone={child.accessScope === "full" ? "success" : "review"}>{child.accessScope === "full" ? "Vaccination access" : "Clinic verification needed"}</StatusChip>
              </div>
              {child.accessScope === "full" ? (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                  <Link href={`/children/${child.childId}#his-h`} className={action}>View vaccination history</Link>
                  <Link href={`/children/${child.childId}#sch-h`} className={action}>View next steps</Link>
                  <Link href={`/children/${child.childId}#cert-h`} className={action}>Certificates</Link>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-ink-soft">Clinic staff must verify your guardian access before vaccination history is available.</p>
                  <Link href={`/children/${child.childId}`} className={action}>View verification details</Link>
                </div>
              )}
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
