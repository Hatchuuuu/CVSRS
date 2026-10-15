/** Guardian area: acknowledge the tap at once on slow phone connections. A plain placeholder that implies no data. */
export default function ChildrenLoading() {
  return (
    <div role="status" aria-live="polite">
      <p className="mb-4 text-sm text-ink-soft">Loading…</p>
      <div aria-hidden className="space-y-6 motion-safe:animate-pulse">
        <div className="border-b border-line pb-6">
          <div className="h-9 w-56 max-w-full rounded-control bg-sunken" />
          <div className="mt-3 h-5 w-full rounded-control bg-sunken" />
        </div>
        {[0, 1].map((card) => (
          <div key={card} className="rounded-card border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="size-12 shrink-0 rounded-control bg-sunken" />
              <div className="flex-1 space-y-2">
                <div className="h-7 w-48 max-w-full rounded-control bg-sunken" />
                <div className="h-4 w-64 max-w-full rounded-control bg-sunken" />
              </div>
            </div>
            <div className="mt-6 h-11 w-64 max-w-full rounded-control bg-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
