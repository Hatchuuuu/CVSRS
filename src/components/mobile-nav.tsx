"use client";

import type { MouseEvent, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useCloseOnPathChange, useDisclosure } from "@/components/disclosure";

/**
 * Header navigation below `sm`: one labelled menu button (with the unread count) opens every destination, the
 * theme choice and sign-out in a panel under the header. Closes on Escape (focus returns), outside press, or
 * navigation. The links themselves are rendered on the server and passed in as children.
 */
export function MobileNav({ unread, children, sidebar = false }: { unread: number | null; children: ReactNode; sidebar?: boolean }) {
  const path = usePathname();
  const { open, setOpen, close, containerProps, triggerProps, panelProps } = useDisclosure();
  useCloseOnPathChange(path, open, setOpen);

  const count = unread && unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null;
  const label = count ? `Menu, ${count} unread message${unread === 1 ? "" : "s"}` : "Menu";

  // A tap on a link (even to the page already shown) closes the menu.
  const onPanelClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (link) close(link.pathname === path && link.search === window.location.search && !link.hash);
  };

  return (
    <nav aria-label="Main navigation" className={sidebar ? "lg:hidden" : "sm:hidden"} {...containerProps}>
      <button
        type="button"
        {...triggerProps}
        aria-label={label}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-sunken"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        <span>Menu</span>
        {count ? <span aria-hidden className="tnum inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">{count}</span> : null}
      </button>
      <div
        {...panelProps}
        hidden={!open}
        onClick={onPanelClick}
        className={sidebar ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[calc(100dvh-var(--header-h)-5rem)] overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-4 shadow-lg" : "absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-h))] overflow-y-auto overscroll-contain border-b border-line bg-surface px-4 py-3 shadow-lg"}
      >
        {children}
      </div>
    </nav>
  );
}
