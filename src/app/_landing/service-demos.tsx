import type { CSSProperties } from "react";

/**
 * Small, fictional previews of real portal screens for the landing page's service tiles. Each is decorative (the
 * tile's heading and text carry the meaning), so every preview is hidden from assistive technology. Values match the
 * sample child in the hero record and are labelled "Sample" where a visitor could mistake them for real data.
 */

const STOPS = [
  { age: "Birth", vaccines: ["BCG", "Hep B"], state: "given" },
  { age: "6 wks", vaccines: ["Penta", "OPV", "PCV"], state: "given" },
  { age: "10 wks", vaccines: ["Penta", "OPV", "PCV"], state: "given" },
  { age: "14 wks", vaccines: ["Penta", "OPV", "PCV", "IPV"], state: "given" },
  { age: "9 mos", vaccines: ["MMR"], state: "due" },
] as const;

export function ScheduleDemo() {
  return (
    <div aria-hidden className="lp-demo lp-demo--schedule">
      <div className="lp-demo-card">
        <div className="lp-demo-bar">
          <div className="lp-demo-title-group">
            <span className="lp-demo-avatar">M</span>
            <div>
              <span className="lp-demo-title">Mika&apos;s schedule</span>
              <span className="lp-demo-subtitle">Approved immunization path</span>
            </div>
          </div>
          <span className="lp-demo-badge">Up to date</span>
        </div>
        <div className="lp-track-container">
          <ol className="lp-track">
            {STOPS.map((stop, i) => (
              <li key={stop.age} className={`lp-track-stop is-${stop.state}`} style={{ "--i": i } as CSSProperties}>
                <span className="lp-track-mark">
                  {stop.state === "given" ? (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m4.8 10.3 3.2 3.2 7.2-7.5" />
                    </svg>
                  ) : (
                    <span className="lp-track-due-dot" />
                  )}
                </span>
                <span className="lp-track-age">{stop.age}</span>
                <span className="lp-track-vaccines">
                  {stop.vaccines.map((v, idx) => (
                    <span key={v} className="lp-track-vtag">
                      {v}{idx < stop.vaccines.length - 1 ? <span className="lp-vsep">·</span> : null}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {/* The same "Next due" strip as the hero record: one component for one piece of information. */}
        <div className="lp-record-next">
          <span>
            <strong>Next due</strong> MMR, dose 1
          </span>
          <span className="lp-record-when">at 9 months</span>
        </div>
      </div>
    </div>
  );
}

const SESSIONS = [
  { day: "Tue", time: "8:00 – 11:00 AM", left: "6 spots left" },
  { day: "Thu", time: "8:00 – 11:00 AM", left: "2 spots left", picked: true },
  { day: "Thu", time: "1:00 – 4:00 PM", left: "Full", full: true },
] as const;

export function BookingDemo() {
  return (
    <div aria-hidden className="lp-demo lp-demo--booking">
      {SESSIONS.map((s) => (
        <div key={s.day + s.time} className={`lp-slot${"picked" in s ? " is-picked" : ""}${"full" in s ? " is-full" : ""}`}>
          <span className="lp-slot-day">{s.day}</span>
          <span className="lp-slot-time">{s.time}</span>
          <span className="lp-slot-left">{s.left}</span>
        </div>
      ))}
    </div>
  );
}

/** A fixed 9 × 9 pattern drawn once; it encodes nothing. */
const QR = [
  "111111101",
  "100000101",
  "101110100",
  "101110111",
  "100000001",
  "111111101",
  "001010011",
  "110101110",
  "101001011",
];

export function CertificateDemo() {
  return (
    <div aria-hidden className="lp-demo lp-demo--certificate">
      <div className="lp-cert">
        <span className="lp-cert-title">Vaccination certificate</span>
        <span className="lp-cert-line" />
        <span className="lp-cert-line lp-cert-line--short" />
        {/* The wrapper carries the scan line that passes over the code once when the window opens. */}
        <span className="lp-cert-qr">
          <svg viewBox="0 0 9 9" shapeRendering="crispEdges">
            {QR.flatMap((row, y) => [...row].map((cell, x) => (cell === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null)))}
          </svg>
        </span>
      </div>
      <span className="lp-cert-check">
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="10" />
          <path d="m5.8 10.3 2.8 2.7 5.6-5.8" />
        </svg>
        Genuine
      </span>
    </div>
  );
}

export function QueueDemo() {
  return (
    <div aria-hidden className="lp-demo lp-demo--queue">
      <span className="lp-queue-label">Now calling</span>
      {/* When the window opens the previous ticket rolls out and the called one rolls in; at rest only 014 shows. */}
      <span className="lp-queue-roll tnum">
        <span className="lp-queue-was">1112-013</span>
        <span className="lp-queue-ticket">1112-014</span>
      </span>
      <span className="lp-queue-station">Station 2</span>
      <span className="lp-queue-waiting tnum">
        <span>015</span>
        <span>016</span>
        <span>017</span>
      </span>
    </div>
  );
}

export function MessagesDemo() {
  return (
    <div aria-hidden className="lp-demo lp-demo--messages">
      <div className="lp-msg">
        <span className="lp-msg-from">Barangay Health Center</span>
        <span className="lp-msg-text">Your booking for Thursday morning is confirmed.</span>
      </div>
      <div className="lp-msg lp-msg--care">
        <span className="lp-msg-from">Care information</span>
        <span className="lp-msg-text">What to expect after your child&apos;s vaccination</span>
      </div>
    </div>
  );
}
