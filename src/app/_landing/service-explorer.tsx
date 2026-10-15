"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarCheck2, Check, ClipboardCheck, ListOrdered, MessagesSquare, type LucideIcon } from "lucide-react";

export type ServiceId = "records" | "booking" | "certificates" | "queue" | "messages";

export interface Service {
  id: ServiceId;
  /** Short name on the tab. */
  name: string;
  /** One line under the name on wide screens. */
  hint: string;
  title: string;
  text: string;
  points: readonly string[];
  action: { href: string; label: string };
  demo: ReactNode;
}

const ICONS: Record<ServiceId, LucideIcon> = {
  records: ClipboardCheck,
  booking: CalendarCheck2,
  certificates: BadgeCheck,
  queue: ListOrdered,
  messages: MessagesSquare,
};

/**
 * The services as one counter with five windows: a tab list beside (or, on phones, above) a single panel that shows a
 * sample of the real screen. WAI-ARIA tabs with automatic activation; arrow keys, Home and End move between tabs.
 */
export function ServiceExplorer({ services }: { services: readonly Service[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const select = (index: number) => {
    const next = (index + services.length) % services.length;
    setActive(next);
    const tab = tabs.current[next];
    tab?.focus({ preventScroll: true });
    // Repeated keyboard selection must not wait for a scrolling animation.
    tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => select(active + 1),
      ArrowDown: () => select(active + 1),
      ArrowLeft: () => select(active - 1),
      ArrowUp: () => select(active - 1),
      Home: () => select(0),
      End: () => select(services.length - 1),
    };
    const run = keys[event.key];
    if (run) {
      event.preventDefault();
      run();
    }
  };

  return (
    <div className="lp-explorer" data-reveal>
      {/* Vertical on wide screens, a scrolling row on phones; both arrow pairs work, so no orientation is declared. */}
      <div role="tablist" aria-label="eVacTrack services" className="lp-tabs" onKeyDown={onKeyDown}>
        {services.map((service, i) => {
          const Icon = ICONS[service.id];
          const selected = i === active;
          return (
            <button
              key={service.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${service.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${service.id}`}
              tabIndex={selected ? 0 : -1}
              className="lp-tab"
              onClick={() => select(i)}
            >
              <span className="lp-tab-icon" aria-hidden>
                <Icon />
              </span>
              <span className="lp-tab-text">
                <span className="lp-tab-name">{service.name}</span>
                <span className="lp-tab-hint">{service.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {services.map((service, i) => (
        <div
          key={service.id}
          role="tabpanel"
          id={`${base}-panel-${service.id}`}
          aria-labelledby={`${base}-tab-${service.id}`}
          hidden={i !== active}
          className="lp-panel"
        >
          <div className="lp-stage">
            {/* Every depicted screen is labelled, so no sample value is mistaken for a real record. The preview itself is hidden from assistive technology, so its label is too. */}
            <span className="lp-stage-tag" aria-hidden>Sample screen</span>
            {service.demo}
          </div>
          <div className="lp-panel-body">
            <h3 className="lp-h3">{service.title}</h3>
            <p>{service.text}</p>
            <ul className="lp-points" role="list">
              {service.points.map((point) => (
                <li key={point}>
                  <Check aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            {service.action.href.startsWith("#") ? (
              <a href={service.action.href} className="lp-link">
                {service.action.label} <ArrowRight aria-hidden />
              </a>
            ) : (
              <Link href={service.action.href} className="lp-link">
                {service.action.label} <ArrowRight aria-hidden />
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
