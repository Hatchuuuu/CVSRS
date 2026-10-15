"use client";

import { useEffect } from "react";

/**
 * Publishes the sticky site header's rendered height as `--header-h` on <html>, so sticky regions (staff sidebar,
 * child identity banner) and anchor scroll padding clear it even when the header wraps onto more rows.
 */
export function HeaderHeight() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    if (!header) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return null;
}
