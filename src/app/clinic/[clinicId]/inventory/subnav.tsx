import Link from "next/link";

const item = "inline-flex min-h-11 items-center rounded-control border px-4 font-semibold no-underline";

/** Sub-navigation for the stock area. */
export function StockNav({ clinicId, current, canManage = true }: { clinicId: string; current: "lots" | "transfers" | "cold-chain"; canManage?: boolean }) {
  const links = [
    { key: "lots", href: `/clinic/${clinicId}/inventory`, label: "Lots and counts" },
    { key: "transfers", href: `/clinic/${clinicId}/inventory/transfers`, label: "Transfers" },
    { key: "cold-chain", href: `/clinic/${clinicId}/inventory/cold-chain`, label: "Cold chain" },
  ] as const;
  return (
    <nav aria-label="Stock sections" className="mb-6 flex flex-wrap gap-2">
      {links.filter((l) => l.key === "lots" || canManage).map((l) => (
        <Link key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined} className={`${item} ${l.key === current ? "border-primary/30 bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink hover:bg-sunken"}`}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
