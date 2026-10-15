"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { useCloseOnPathChange, useDisclosure } from "@/components/disclosure";

/** Landing-page sections, in page order. Each id exists in src/app/page.tsx. */
export const LANDING_SECTIONS = [
  { id: "services", label: "Services" },
  { id: "how-it-works", label: "How it works" },
  { id: "clinics", label: "Clinics" },
  { id: "privacy", label: "Privacy" },
  { id: "questions", label: "FAQ" },
] as const;

/** Which landing section is in the reading band (upper third of the viewport); null above the first one. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const sections = LANDING_SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActive(LANDING_SECTIONS.find((s) => visible.has(s.id))?.id ?? null);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [enabled]);
  return enabled ? active : null;
}

const sectionLink =
  "relative inline-flex min-h-11 items-center rounded-control px-3 text-[0.9375rem] font-semibold text-ink-soft no-underline transition-colors hover:text-primary-strong aria-[current=true]:text-primary-strong after:absolute after:inset-x-3 after:bottom-1.5 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-200 aria-[current=true]:after:scale-x-100";
// Button styles carry no display value: each use sets it, so `hidden sm:inline-flex` is never fighting a base `inline-flex`.
const secondaryButton =
  "min-h-11 items-center justify-center rounded-control border border-line-strong/60 bg-surface px-4 text-[0.9375rem] font-semibold text-ink no-underline transition-[background-color,border-color,transform] hover:border-primary hover:bg-primary-soft active:scale-[0.97]";
const primaryButton =
  "group min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 text-[0.9375rem] font-bold text-on-primary no-underline shadow-[0_1px_2px_rgb(6_72_239/0.2),0_4px_12px_-4px_rgb(6_72_239/0.45)] transition-[background-color,transform,box-shadow] hover:bg-primary-strong active:scale-[0.97]";

/**
 * Header navigation for visitors who are not signed in. On the landing page the section links are in-page anchors
 * with a scroll-position indicator; elsewhere they return to the landing page. Below `lg` the section links and both
 * account actions move into a menu panel.
 */
export function PublicNav() {
  const path = usePathname();
  const onLanding = path === "/";
  const active = useActiveSection(onLanding);
  const { open, setOpen, close, containerProps, triggerProps, panelProps } = useDisclosure();
  useCloseOnPathChange(path, open, setOpen);

  const href = (id: string) => (onLanding ? `#${id}` : `/#${id}`);
  const accountHref = "/sign-up";
  const accountLabel = "Create account";

  const onPanelClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a[href]")) close(false);
  };

  return (
    <nav aria-label="Main navigation" className="flex items-center gap-2" {...containerProps}>
      <ul className="hidden items-center gap-1 lg:flex">
        {LANDING_SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={href(s.id)} className={sectionLink} aria-current={active === s.id ? "true" : undefined}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
      <span aria-hidden className="mx-2 hidden h-6 w-px bg-line lg:block" />
      <Link href="/sign-in" className={`${secondaryButton} hidden sm:inline-flex`}>
        Sign in
      </Link>
      <Link href={accountHref} className={`${primaryButton} hidden sm:inline-flex`}>
        {accountLabel}
        <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>

      <button
        type="button"
        {...triggerProps}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong/60 bg-surface px-3.5 text-[0.9375rem] font-semibold text-ink hover:border-primary hover:bg-primary-soft lg:hidden"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        <span>Menu</span>
      </button>
      <div
        {...panelProps}
        hidden={!open}
        onClick={onPanelClick}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-h))] overflow-y-auto overscroll-contain border-b border-line bg-surface px-4 pb-5 pt-2 shadow-lg animate-in fade-in slide-in-from-top-1 duration-200 lg:hidden"
      >
        <ul className="mx-auto grid max-w-3xl">
          {LANDING_SECTIONS.map((s) => (
            <li key={s.id} className="border-b border-line last:border-b-0">
              <a
                href={href(s.id)}
                aria-current={active === s.id ? "true" : undefined}
                className="focus-inset flex min-h-13 items-center justify-between rounded-control px-2 text-lg font-semibold text-ink no-underline hover:text-primary-strong aria-[current=true]:text-primary-strong"
              >
                {s.label}
                <ArrowRight aria-hidden className="size-4 text-primary" />
              </a>
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-4 grid max-w-3xl gap-2 sm:hidden">
          <Link href={accountHref} className={`${primaryButton} flex min-h-12 text-base`}>
            {accountLabel}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
          <Link href="/sign-in" className={`${secondaryButton} flex min-h-12 text-base`}>
            Sign in
          </Link>
        </div>
      </div>
    </nav>
  );
}
