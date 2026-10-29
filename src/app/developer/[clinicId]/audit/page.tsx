import Link from "next/link";
import { EmptyState, Notice, PageTitle } from "@/components/ui";
import { requireDeveloper } from "@/lib/server/developer";
import { formatClinicDateTime } from "@/lib/format";
import { personName } from "@/lib/person-name";
interface Audit { items: { id: string; action: string; actorName: string | null; createdAt: string; targetType: string; outcome: string | null }[]; nextCursor: { before: string; beforeId: string } | null }
export const metadata = { title: "Technical audit · Developer Console" };
export default async function TechnicalAudit({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireDeveloper(clinicId);
  const { before, beforeId } = await searchParams;
  if (Boolean(before) !== Boolean(beforeId) || (before && !Number.isFinite(Date.parse(before))) || (beforeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId))) return <><PageTitle title="Technical audit" lead="Staff access, clinic configuration and operations events." /><Notice tone="danger" title="Invalid audit cursor"><Link href={`/developer/${clinicId}/audit`}>Return to newest events</Link></Notice></>;
  const audit = await rpc.rpc<Audit>("list_technical_audit", { p_clinic_id: clinicId, p_limit: 50, p_before: before ?? null, p_before_id: beforeId ?? null });
  if (!audit) throw new Error("Technical audit unavailable");
  return <>
    <PageTitle title="Technical audit" lead="Staff access, clinic configuration and operations events. Patient records and raw payloads are excluded." />
    {before ? <p className="mb-4"><Link href={`/developer/${clinicId}/audit`}>Newest events</Link></p> : null}
    {!audit.items.length ? <EmptyState title="No technical events in this page" /> : <ul className="divide-y divide-line rounded-card border border-line">{audit.items.map((item) => <li key={item.id} className="break-words p-4"><p className="font-bold">{item.action}</p><p>{item.actorName ? personName(item.actorName) : "System or unavailable actor"} · {formatClinicDateTime(item.createdAt, membership.clinicTimezone)}</p><p className="text-sm">{item.targetType} · {item.outcome ?? "Outcome not recorded"}</p></li>)}</ul>}
    {audit.nextCursor ? <p className="mt-5"><Link className="inline-flex min-h-11 items-center" href={`/developer/${clinicId}/audit?${new URLSearchParams(audit.nextCursor)}`}>Older technical events</Link></p> : null}
  </>;
}
