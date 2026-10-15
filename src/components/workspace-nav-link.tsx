"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceNavLink({ href, label, children }: { href: string; label?: string; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`focus-inset flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm font-semibold no-underline ${active ? "bg-primary-soft text-primary-strong" : "text-ink hover:bg-sunken"}`}>
    {children}
  </Link>;
}
