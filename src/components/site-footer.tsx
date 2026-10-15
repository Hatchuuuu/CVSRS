"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/brand";
import { LANDING_SECTIONS } from "@/components/public-nav";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

const footerLink =
  "inline-flex min-h-11 items-center rounded-control text-[0.9375rem] text-[var(--lp-text)] no-underline transition-colors hover:text-[var(--lp-blue)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lp-blue)]";

const YEAR = new Date().getFullYear();

/** The legal documents, with the Privacy Policy's cookie section as its own entry, as visitors expect to find it. */
const LEGAL_LINKS = [...LEGAL_DOCUMENTS.slice(0, 2), { href: "/privacy#cookies", label: "Cookies" }, LEGAL_DOCUMENTS[2]];

/**
 * The landing page closes with a full footer (brand, routes, legal documents, project credit). Operational pages keep a compact
 * footer (brand and the legal documents) so working screens stay quiet.
 */
export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();

  if (path !== "/") {
    return (
      <footer className="mt-auto border-t border-line bg-surface py-5 text-sm text-ink-soft">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 text-center sm:px-6 md:flex-row md:justify-between md:text-left">
          <div>
            <p className="flex items-center justify-center gap-2 font-semibold md:justify-start">
              <BrandMark className="size-5 shrink-0" />
              <span>eVacTrack · Children&apos;s vaccination records</span>
            </p>
            <p className="mt-1">Contact your clinic about privacy and accessibility needs.</p>
          </div>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap justify-center gap-x-1">
              {LEGAL_DOCUMENTS.map((doc) => (
                <li key={doc.href}>
                  <Link
                    href={doc.href}
                    aria-current={path === doc.href ? "page" : undefined}
                    className="inline-flex min-h-11 items-center rounded-control px-2.5 font-semibold text-ink-soft no-underline hover:text-primary-strong hover:underline aria-[current=page]:text-primary-strong"
                  >
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    );
  }

  const families = signedIn
    ? [
        { href: "/children", label: "My children" },
        { href: "/messages", label: "Messages" },
        { href: "/help", label: "Care information" },
        { href: "/account/security", label: "Account security" },
      ]
    : [
        { href: "/sign-up", label: "Create a family account" },
        { href: "/sign-in", label: "Sign in" },
        { href: "/account/forgot-password", label: "Forgot your password?" },
      ];

  return (
    <footer className="site-footer mt-auto border-t border-[var(--lp-line)] bg-white text-[var(--lp-text)]">
      <div className="lp-container grid grid-cols-2 gap-x-6 gap-y-10 pb-12 pt-16 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-10">
        <div className="col-span-2 max-w-sm sm:col-span-3 lg:col-span-1">
          <Link href="/" aria-label="eVacTrack home" className="inline-flex min-h-11 items-center text-[2.125rem] no-underline">
            <BrandLogo />
          </Link>
          <p className="mt-4 text-[0.9375rem] leading-relaxed">
            Children&apos;s vaccination records, kept by community health centers and shared with the families they serve.
          </p>
          <p className="mt-6 text-sm text-[var(--lp-muted)]">NORSU BSInfoTech Students CVSRS Project System.</p>
        </div>
        {/* Family-facing only: clinic staff use their own unlisted sign-in (src/lib/auth/staff-entry.ts), never linked here. */}
        <FooterColumn title="Families" links={families} />
        <FooterColumn title="On this page" links={LANDING_SECTIONS.map((s) => ({ href: `#${s.id}`, label: s.label }))} />
        <FooterColumn title="Legal" links={LEGAL_LINKS} />
      </div>
      <div className="border-t border-[var(--lp-line)]">
        <div className="lp-container flex flex-col gap-4 py-6 text-sm text-[var(--lp-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl">
            &copy; {YEAR} eVacTrack. Each clinic publishes its own privacy notice in the portal. Contact your health center about privacy or accessibility needs.
          </p>
          <a href="#main" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control font-semibold text-[var(--lp-blue)] no-underline hover:text-[var(--lp-blue-strong)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lp-blue)]">
            Back to top <ArrowUp aria-hidden className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-[var(--lp-ink)]">{title}</h2>
      <ul className="mt-2 grid">
        {links.map((l) => (
          <li key={l.href + l.label}>
            {l.href.startsWith("#") ? (
              <a href={l.href} className={footerLink}>{l.label}</a>
            ) : (
              <Link href={l.href} className={footerLink}>{l.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
