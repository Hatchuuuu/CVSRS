"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Notice, ResultRegion } from "@/components/ui";

/**
 * A confirmation that outlives the control that caused it. Many record actions remove their own control on success (a revoked
 * certificate has no Revoke button, a released hold no Release button, a removed guardian no row), and `router.refresh()` then
 * unmounts the component together with any notice it owned. The control announces here instead, and an `OutcomeNoticeView`
 * placed beside the list shows the newest notice for that key, moves focus to it (the button that had focus is gone) and clears it
 * when the page is left. Errors stay next to the form that caused them.
 */
export interface OutcomeNotice {
  id: number;
  tone: "success" | "attention";
  title: string;
  message?: string;
}

const notices = new Map<string, OutcomeNotice>();
const listeners = new Set<() => void>();
let nextId = 1;
const emit = () => listeners.forEach((listener) => listener());

export function announceOutcome(key: string, notice: Omit<OutcomeNotice, "id" | "tone"> & { tone?: OutcomeNotice["tone"] }) {
  notices.set(key, { tone: "success", ...notice, id: nextId++ });
  emit();
}
export function getOutcomeNotice(key: string): OutcomeNotice | null {
  return notices.get(key) ?? null;
}
export function clearOutcomeNotice(key: string) {
  if (notices.delete(key)) emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function OutcomeNoticeView({ noticeKey }: { noticeKey: string }) {
  const notice = useSyncExternalStore(subscribe, () => getOutcomeNotice(noticeKey), () => null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  useEffect(() => () => clearOutcomeNotice(noticeKey), [noticeKey]);
  return (
    <ResultRegion>
      {notice ? (
        <div ref={ref} tabIndex={-1} className="mb-3 rounded-card focus-visible:outline-offset-2">
          <Notice tone={notice.tone} role="status" title={notice.title}>
            {notice.message}
          </Notice>
        </div>
      ) : null}
    </ResultRegion>
  );
}
