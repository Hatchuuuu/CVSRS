import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { requireDeveloper } from "@/lib/server/developer";
export const metadata = { title: "Local operations runbook" };
export default async function Runbook({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  await requireDeveloper(clinicId);
  const runbook = await readFile(path.join(process.cwd(), "docs/operations/runbook.md"), "utf8");
  return <><PageTitle title="Local operations runbook" lead="Owner recovery and restore procedures run from the trusted local command line." /><p className="mb-4"><Link href={`/developer/${clinicId}/operations`}>Back to operations</Link></p><pre className="whitespace-pre-wrap break-words rounded-card border border-line bg-surface p-4 text-sm">{runbook}</pre></>;
}
