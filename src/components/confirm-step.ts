"use client";

import { useEffect, useId, useRef } from "react";
import { firstFocusTarget } from "@/components/disclosure";

type StepState = { open: boolean; pending: boolean };

/** Focus has nowhere to be: the focused element was removed or disabled (the browser falls back to <body>). */
function focusLost() {
  const active = document.activeElement as (Element & { isConnected?: boolean }) | null;
  return !active || active === document.body || active.isConnected === false;
}

/**
 * Where focus should go after a confirm step changes:
 * - the step opened: into the group, on the safe "keep / cancel" control;
 * - the step closed (cancel, or success) and focus was lost with the group: back to the trigger;
 * - an attempt ended (failure) while the step is still open and the disabled button dropped focus: back into the group.
 * Focus is otherwise left alone, so typing in the form (which closes the time zone and retire steps) is never interrupted.
 */
export function confirmFocusMove(prev: StepState, next: StepState, lost: boolean): "group" | "trigger" | null {
  if (next.open && !prev.open) return "group";
  if (!lost) return null;
  if (!next.open && prev.open) return "trigger";
  if (next.open && prev.pending && !next.pending) return "group";
  return null;
}

/**
 * Focus management for the inline "are you sure?" step that replaces a consequential button (FE-14 / RV1-01).
 * The trigger and the confirm group swap places, so without this the focused button unmounts and keyboard and
 * screen-reader users land on <body> when the step opens and again when they cancel.
 *
 * Spread `groupProps` on the confirm group (give it an `aria-label`), `textProps` on the consequence text,
 * `cancelProps` on the safe "keep / cancel" button, and pass `triggerRef` as the trigger's `ref`.
 * Success and failure are still announced by the flow's own notice (live region / toast); this only keeps focus.
 */
export function useConfirmStep(open: boolean, pending = false) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const textId = useId();
  const last = useRef<StepState>({ open, pending });

  useEffect(() => {
    const move = confirmFocusMove(last.current, { open, pending }, focusLost());
    last.current = { open, pending };
    if (move === "group") firstFocusTarget(groupRef.current)?.focus();
    else if (move === "trigger") triggerRef.current?.focus();
  }, [open, pending]);

  return {
    triggerRef,
    groupProps: { ref: groupRef, role: "group" as const },
    textProps: { id: textId },
    cancelProps: { "data-autofocus": true as const, "aria-describedby": textId },
  };
}
