/**
 * Shown inside the clinic layout (the staff menu and clinic name stay put) while a clinic page loads, so a menu click
 * is acknowledged at once. A plain placeholder: it implies no data, and the pulse stops for reduced-motion users.
 */
export default function ClinicLoading() {
  return (
    <div role="status" aria-live="polite">
      <p className="mb-4 text-sm text-ink-soft">Loading this page…</p>
      <div aria-hidden className="motion-safe:animate-pulse">
        <div className="mb-8 border-b border-line pb-6">
          <div className="h-9 w-72 max-w-full rounded-control bg-sunken" />
          <div className="mt-3 h-5 w-[32rem] max-w-full rounded-control bg-sunken" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {[0, 1].map((card) => (
            <div key={card} className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <div className="mb-4 h-6 w-40 rounded-control bg-sunken" />
              <div className="space-y-3">
                <div className="h-4 w-full rounded-control bg-sunken" />
                <div className="h-4 w-5/6 rounded-control bg-sunken" />
                <div className="h-11 w-36 rounded-control bg-sunken" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
