"use client";

import { Toaster as SonnerToaster } from "sonner";

export function AppToaster() {
  return (
    <SonnerToaster
      theme="light"
      position="bottom-right"
      toastOptions={{
        className: "rounded-card font-sans text-sm shadow-lg border border-line bg-surface text-ink",
      }}
    />
  );
}
