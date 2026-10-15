"use client";

import { useEffect } from "react";

/**
 * ScrollShadow dynamically toggles the data-scrolled attribute on .glass-header
 * to apply an elevated shadow when the user scrolls past the top offset.
 */
export function ScrollShadow() {
  useEffect(() => {
    const handleScroll = () => {
      const header = document.querySelector(".glass-header");
      if (!header) return;
      const scrolled = window.scrollY > 8;
      const current = header.getAttribute("data-scrolled");
      const next = scrolled ? "true" : "false";
      if (current !== next) {
        header.setAttribute("data-scrolled", next);
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return null;
}
