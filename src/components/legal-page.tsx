import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/format";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const tocLink =
  "focus-inset flex min-h-11 items-baseline gap-2.5 rounded-control px-2.5 py-2.5 text-sm leading-snug text-ink-soft no-underline hover:bg-primary-soft hover:text-primary-strong";

function Contents({ sections }: { sections: LegalSection[] }) {
  return (
    <ol className="grid">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} className={tocLink}>
            <span className="tnum w-5 shrink-0 text-right font-semibold text-ink-soft">{i + 1}.</span>
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Frame for the public legal documents (Terms of Use, Privacy Policy, Accessibility): a switcher between the documents, the title,
 * the date it took effect, an optional plain-language summary, and numbered sections listed in a contents list (a sticky rail from
 * 1024px, a collapsed list above the text on smaller screens). Sections are numbered so the documents can refer to each other.
 */
export function LegalPage({ current, title, lead, updated, summary, sections }: {
  current: (typeof LEGAL_DOCUMENTS)[number]["href"];
  title: string;
  lead: ReactNode;
  /** ISO date (YYYY-MM-DD) the current text took effect. */
  updated: string;
  summary?: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav aria-label="Legal documents" className="mb-6">
        <ul className="flex flex-wrap gap-1.5">
          {LEGAL_DOCUMENTS.map((doc) => (
            <li key={doc.href}>
              <Link
                href={doc.href}
                aria-current={doc.href === current ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-3.5 text-sm font-semibold text-ink no-underline hover:border-primary hover:text-primary-strong aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-strong"
              >
                {doc.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <header className="border-b border-line pb-8">
        <h1 className="text-3xl font-bold text-ink sm:text-[2.25rem] sm:leading-tight">{title}</h1>
        <p className="mt-3 max-w-[68ch] text-lg leading-relaxed text-ink-soft">{lead}</p>
        <p className="mt-4 text-sm font-semibold text-ink-soft">
          Effective and last updated <time dateTime={updated}>{formatDate(updated)}</time>
        </p>
      </header>

      <div className="mt-8 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-14">
        <aside className="hidden lg:block">
          <nav
            aria-labelledby="legal-contents-h"
            className="sticky top-[calc(var(--header-h,72px)+1.5rem)] max-h-[calc(100dvh-var(--header-h,72px)-3rem)] overflow-y-auto overscroll-contain pb-4"
          >
            <h2 id="legal-contents-h" className="mb-2 px-2.5 text-sm font-bold text-ink">
              On this page
            </h2>
            <Contents sections={sections} />
          </nav>
        </aside>

        <div className="min-w-0">
          <details className="no-print group mb-8 rounded-card border border-line bg-surface lg:hidden">
            <summary className="focus-inset flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              On this page
              <ChevronDown aria-hidden className="size-5 text-ink-soft transition-transform group-open:rotate-180" />
            </summary>
            <nav aria-label="On this page" className="border-t border-line p-2">
              <Contents sections={sections} />
            </nav>
          </details>

          <article className="legal-prose">
            {summary ? (
              <section aria-labelledby="legal-summary-h" className="legal-summary">
                <h2 id="legal-summary-h">In brief</h2>
                {summary}
              </section>
            ) : null}
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                <h2 id={`${s.id}-h`}>
                  <span className="tnum">{i + 1}.</span> {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
