"use client";

import { useEffect, useId, useRef, useState } from "react";



export function SignOutButton({ inline = false }: { inline?: boolean }) {
  const [pending, setPending] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const previousOverflow = useRef<string | null>(null);
  const id = useId();

  function restoreScroll() {
    if (previousOverflow.current !== null) {
      document.body.style.overflow = previousOverflow.current;
      previousOverflow.current = null;
    }
  }

  useEffect(() => restoreScroll, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
          previousOverflow.current = document.body.style.overflow;
          document.body.style.overflow = "hidden";
          cancel.current?.focus();
        }}

        className={`min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-sunken${inline ? " w-full" : ""}`}
      >
        Sign out
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
          if (event.key === "Tab" && !pending) {
            if (event.shiftKey && document.activeElement === cancel.current) {
              event.preventDefault(); confirm.current?.focus();
            } else if (!event.shiftKey && document.activeElement === confirm.current) {
              event.preventDefault(); cancel.current?.focus();
            }
          }
        }}
        onClose={() => { restoreScroll(); trigger.current?.focus(); }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <div className="p-6 sm:p-8">
          <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight">Sign out of eVacTrack?</h2>
          <p id={`${id}-description`} className="mt-3 text-sm leading-relaxed text-ink-soft">
            You’ll need to sign in again to access your account.
          </p>
          <form
            action="/auth/sign-out"
            method="post"
            className="mt-7 flex justify-end gap-3"
            onSubmit={(event) => {
              if (pending) event.preventDefault();
              else setPending(true);
            }}
          >
            <button ref={cancel} type="button" disabled={pending} onClick={() => dialog.current?.close()} className="min-h-11 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold hover:bg-sunken disabled:opacity-70">
              Cancel
            </button>
            <button ref={confirm} type="submit" disabled={pending} aria-busy={pending} className="min-h-11 min-w-24 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70">
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
