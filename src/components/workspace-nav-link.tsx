"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceNavLink({ href, label, children }: { href: string; label?: string; children: ReactNode }) {
  const path = usePathname();
  const target = href.split("?")[0];
  const active = path === target || path.startsWith(`${target}/`);
  return <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`focus-inset flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold no-underline transition-colors duration-150 ${active ? "bg-primary text-on-primary" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}>
    {children}
  </Link>;
}
