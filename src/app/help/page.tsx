import type { Metadata } from "next";
import { EmptyState, Notice, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireViewer } from "@/lib/server/viewer";

export const metadata: Metadata = { title: "Care information" };

interface Item {
  code: string;
  title: string;
  body: string;
  source: string;
  reviewedOn: string | null;
  clinic: string;
  language: string;
  fallback: boolean;
}

export default async function Help() {
  const { rpc } = await requireViewer();
  const items = (await rpc.rpc<Item[]>("guardian_care_content")) ?? [];
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageTitle title="Care information" lead="Information from your child's clinic. It is written by the clinic and checked by a second person before you see it." />
      {items.length === 0 ? (
        <EmptyState title="Your clinic has not published any information here yet">If you have a question, please contact the clinic.</EmptyState>
      ) : (
        <div className="space-y-6">
          {items.map((i) => (
            <article key={`${i.clinic}-${i.code}`} className="rounded-card border border-line bg-surface p-5">
              <h2 className="text-xl font-bold">{i.title}</h2>
              <p className="mb-3 text-sm text-ink-soft">
                {i.clinic}
                {i.reviewedOn ? ` · reviewed ${formatDate(i.reviewedOn)}` : ""}
              </p>
              {i.fallback ? (
                <Notice tone="info" title="Shown in English">
                  This information is not available in your language yet.
                </Notice>
              ) : null}
              <div className="max-w-prose whitespace-pre-line text-lg leading-relaxed">{i.body}</div>
              <p className="mt-3 text-sm text-ink-soft">Source: {i.source}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
