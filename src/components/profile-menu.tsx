"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, UserRound } from "lucide-react";
import { useCloseOnPathChange, useDisclosure } from "@/components/disclosure";
import { SignOutButton } from "@/components/sign-out-button";
import type { MembershipLike } from "@/lib/auth/clinic-access";
import { isPortalPage, portalHref } from "@/lib/portal-context";
import { usePortalContext } from "@/components/portal-navigation";

export function ProfileMenu({ name, initial, memberships = [] }: { name: string; initial: string; memberships?: MembershipLike[] }) {
  const path = usePathname();
  const context = usePortalContext(memberships);
  const accountHref = isPortalPage(path) ? portalHref("/account", context) : "/account";
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { open, setOpen, close, containerProps, triggerProps, panelProps } = useDisclosure();
  useCloseOnPathChange(path, open, setOpen);
  return (
    <div className="relative min-w-0" {...containerProps}>
      <button type="button" {...triggerProps} disabled={!hydrated} aria-label={`Account menu for ${name}`} className="flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-semibold text-ink-soft hover:bg-sunken">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">{initial}</span>
        <span className="max-w-20 truncate sm:max-w-64">{name}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0" />
      </button>
      <div {...panelProps} hidden={!open} role="group" aria-label="Account options" className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-3 shadow-lg">
        <Link href={accountHref} onClick={() => close(path === "/account")} className="mb-3 flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-ink no-underline hover:bg-sunken">
          <UserRound aria-hidden className="size-4" /> Account
        </Link>
        <div className="border-t border-line pt-3"><SignOutButton inline /></div>
      </div>
    </div>
  );
}
