import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageTitle, Section, StatusChip } from "@/components/ui";
import { formatClinicDateTime } from "@/lib/format";
import { requireViewer } from "@/lib/server/viewer";
import { pageCursor, pageQuery, timestampCursor } from "@/lib/api/list-cursors";
import { portalHref, resolvePortalContext } from "@/lib/portal-context";
import { MarkAllRead } from "./mark-read";

export const metadata: Metadata = { title: "Messages" };

interface Inbox {
  unread: number;
  items: { id: string; kind: string; title: string; body: string; childId: string | null; createdAt: string; read: boolean }[];
}

interface ChildZone {
  childId: string;
  clinicTimezone: string | null;
}

/** The clinics table default zone, used when a message has no child or the child has no clinic. */
const PRODUCT_TIMEZONE = "Asia/Manila";

export default async function Messages({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = searchParams ? await searchParams : {};
  const query = pageQuery(raw);
  const cursor = pageCursor(() => timestampCursor(query));
  const { rpc, ctx } = await requireViewer();
  const contextQuery = new URLSearchParams();
  for (const key of ["portal", "clinic"]) {
    const value = raw[key];
    if (typeof value === "string") contextQuery.set(key, value);
    else value?.forEach(v => contextQuery.append(key, v));
  }
  const context = resolvePortalContext("/messages", contextQuery, ctx?.memberships ?? []);
  const inboxHref = portalHref("/messages", context);
  const [box, children] = await Promise.all([
    rpc.rpc<Inbox>("my_messages", { p_limit: 51, p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null }),
    rpc.rpc<ChildZone[]>("my_children"),
  ]);
  if (!box) throw new Error("Messages could not be loaded. Sign in again and retry.");
  if (!children) throw new Error("Children could not be loaded. Please try again.");
  const items = box.items.slice(0, 50);
  const last = items.at(-1);
  // Message times are shown in the child's clinic zone (families read clinic time, never UTC).
  const zoneOf = new Map((children ?? []).filter((c) => c.clinicTimezone).map((c) => [c.childId, c.clinicTimezone!]));
  const zones = new Set(zoneOf.values());
  const defaultZone = zones.size === 1 ? [...zones][0]! : PRODUCT_TIMEZONE;
  const when = (m: Inbox["items"][number]) => formatClinicDateTime(m.createdAt, (m.childId && zoneOf.get(m.childId)) || defaultZone);
  return (
    <div className="w-full">
      <PageTitle dashboard title="Messages" lead="Clinic updates, visit confirmations and certificate notifications." action={box.unread > 0 ? <MarkAllRead /> : undefined} />
      <p className="mb-5 text-sm text-ink-soft"><strong className="text-ink">{box.unread} unread</strong> · {items.length} messages on this page</p>
      {box.items.length === 0 ? (
        <EmptyState title={cursor ? "No older messages" : "No messages yet"}>{cursor ? "Return to the newest messages to see recent clinic updates." : "Booking confirmations and certificate updates will appear here."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface" aria-label="Messages">
          {items.map((m) => (
            <li key={m.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{m.title}</h2>
                {m.read ? null : <StatusChip tone="info">New</StatusChip>}
              </div>
              <p className="mt-1">{m.body}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                <time dateTime={m.createdAt}>{when(m)}</time>
                {m.childId ? (
                  <Link href={`/children/${m.childId}`} className="inline-flex min-h-11 items-center font-semibold text-primary">
                    Open record
                  </Link>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {cursor || box.items.length > 50 ? (
        <nav aria-label="Message pages" className="mt-4 flex flex-wrap gap-4">
          {cursor ? <Link href={inboxHref} className="inline-flex min-h-11 items-center font-semibold text-primary">Newest messages</Link> : null}
          {box.items.length > 50 && last ? <Link href={`${inboxHref}&${new URLSearchParams({ before: last.createdAt, beforeId: last.id })}`} className="inline-flex min-h-11 items-center font-semibold text-primary">Older messages</Link> : null}
        </nav>
      ) : null}
      <Section id="txt-h" title="Contact preferences" className="mt-8">
        <p className="text-sm text-ink-soft">Manage your clinic contact number and language preference in Account.</p>
        <Link href={`${portalHref("/account", context)}#contact-h`} className="inline-flex min-h-11 items-center font-semibold text-primary">Open contact preferences</Link>
      </Section>
    </div>
  );
}
