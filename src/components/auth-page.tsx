import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Shared frame for the account pages (family and staff sign-in and sign-up): an icon tile, the page title and lead, the form
 * card, and an optional note below it. One frame keeps the four pages identical apart from their words.
 */
export function AuthPage({ Icon, headingVisual, title, lead, width = "narrow", children, after }: {
  Icon?: LucideIcon;
  headingVisual?: ReactNode;
  title: string;
  lead: ReactNode;
  width?: "narrow" | "wide";
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className={`mx-auto py-3 sm:py-6 ${width === "wide" ? "max-w-xl" : "max-w-lg"}`}>
      <div className="mb-7 flex items-center gap-4">
        {headingVisual ?? (Icon ? <div className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary shadow-xs">
          <Icon aria-hidden className="size-6" />
        </div> : null)}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{lead}</p>
        </div>
      </div>
      <div className="rounded-card border border-line bg-surface p-5 shadow-sm sm:p-7">{children}</div>
      {after}
    </div>
  );
}
