"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const FOCUS_FIRST = '[data-autofocus], input:checked, [aria-current="page"]';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const HIDDEN_ANCESTOR = '[hidden], [aria-hidden="true"], [inert]';

/** `focus()` on an element that is hidden (itself or through an ancestor) or not rendered does nothing, so skip it. */
const shown = (el: HTMLElement) => el.closest(HIDDEN_ANCESTOR) === null && el.getClientRects().length > 0;

/**
 * Where focus goes when a panel opens: the first visible `data-autofocus`, checked input or current-page link, otherwise
 * the first visible focusable element. A nested sub-panel that is still hidden (the sign-out confirm inside the menu)
 * can no longer swallow the initial focus.
 */
export function firstFocusTarget(panel: HTMLElement | null): HTMLElement | null {
  if (!panel) return null;
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(`${FOCUSABLE}, [data-autofocus]`)).filter(shown);
  return candidates.find((el) => el.matches(FOCUS_FIRST)) ?? candidates[0] ?? null;
}

/**
 * Disclosure (button + panel) behaviour shared by the header menu, the theme and sign-out popovers and the clinic
 * menu: focus moves into the panel on open, Escape closes and returns focus to the trigger, and a press outside
 * closes. Spread `containerProps` on the element wrapping trigger and panel; Escape is handled there (and stops), so
 * a disclosure nested inside another closes first.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    firstFocusTarget(panel ?? null)?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panel?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  return {
    open,
    setOpen,
    close,
    containerProps: { onKeyDown },
    triggerProps: { ref: triggerRef, "aria-expanded": open, "aria-controls": panelId, onClick: () => setOpen((value) => !value) },
    panelProps: { ref: panelRef, id: panelId },
  };
}

/** Closes a disclosure when the route changes (adjusting state during render, not in an effect). */
export function useCloseOnPathChange(path: string, open: boolean, setOpen: (open: boolean) => void) {
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    if (open) setOpen(false);
  }
}
