"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRightLeft, BarChart3, BookOpenText, ChevronDown, LayoutDashboard, Settings, CalendarClock, PhoneCall, MessageCircleQuestion, FileText, ClipboardCheck, FlaskConical, KeyRound, PackageOpen, Search } from "lucide-react";
import { useCloseOnPathChange, useDisclosure } from "@/components/disclosure";


export interface NavItem {
  group: "daily" | "records" | "management";
  href: string;
  label: string;
  icon: "today" | "search" | "review" | "stock" | "clinical" | "access" | "reports" | "forms" | "questions" | "followup" | "transfers" | "content" | "settings" | "admin";
  exact?: boolean;
}
const ICONS = { today: CalendarClock, search: Search, review: ClipboardCheck, stock: PackageOpen, clinical: FlaskConical, access: KeyRound, reports: BarChart3, forms: FileText, questions: MessageCircleQuestion, followup: PhoneCall, transfers: ArrowRightLeft, content: BookOpenText, settings: Settings, admin: LayoutDashboard };

/**
 * Clinic task navigation. From `lg` it is the persistent sidebar list. Below `lg` every item sits behind one
 * "Clinic menu" disclosure (naming the current page) instead of a horizontally scrolling strip that hid most items.
 */
export function StaffNav({ items, embedded = false }: { items: NavItem[]; embedded?: boolean }) {
  const path = usePathname();

  const { open, setOpen, containerProps, triggerProps, panelProps } = useDisclosure();
  useCloseOnPathChange(path, open, setOpen);
  const isActive = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  const current = items.find(isActive);

  return (
    <nav aria-label="Clinic Navigation" {...containerProps}>
      {!embedded ? <button
        type="button"
        {...triggerProps}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control border border-line-strong bg-surface px-3.5 text-left text-sm font-semibold text-ink hover:bg-sunken lg:hidden"
      >
        <span className="min-w-0 truncate">
          Clinic menu{current ? <span className="font-normal text-ink-soft"> · {current.label}</span> : null}
        </span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-ink-soft ${open ? "rotate-180" : ""}`} />
      </button> : null}
      <div
        {...panelProps}
        className={embedded ? "flex flex-col gap-1" : `${open ? "mt-2 grid" : "hidden"} gap-1 sm:grid-cols-2 lg:mt-0 lg:flex lg:flex-col`}
      >
        {([ ["daily", "Clinic day"], ["records", "Records and review"], ["management", "Management"] ] as const).map(([group, label]) => {
          const grouped = items.filter(item => item.group === group);
          if (!grouped.length) return null;
          return <div key={group} role="group" aria-label={label} className="flex min-w-0 flex-col gap-1">
            <p className="px-4 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</p>
            {grouped.map((i) => {
          const Icon = ICONS[i.icon];
          const active = isActive(i);
          return (
            <Link
              key={i.href}
              href={i.href}


              aria-current={active ? "page" : undefined}
              className={`focus-inset group relative inline-flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold no-underline transition-colors duration-150 ${
                active
                  ? "border-transparent bg-primary text-on-primary font-bold"
                  : "border-transparent text-ink hover:bg-sunken hover:text-primary-strong"
              }`}
            >
              <Icon aria-hidden className={`size-4.5 shrink-0 transition-colors ${active ? "text-on-primary" : "text-ink-soft group-hover:text-primary"}`} />
              <span>{i.label}</span>
            </Link>
          );
            })}
          </div>;
        })}
      </div>
    </nav>
  );
}
