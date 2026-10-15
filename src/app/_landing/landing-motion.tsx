"use client";

import { useEffect } from "react";

/**
 * Plays each motion group (`[data-reveal]`) once, when it scrolls into view. Every animation is declared in
 * landing.css and ends on the element's visible resting state, so the page reads the same without this script: it only
 * rewinds groups that start below the fold and holds them on their first frame until they arrive. Groups already on
 * screen keep the animations they began on first paint. Reduced motion declares no animations, so there is nothing to
 * hold.
 */
export function LandingMotion() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // Only clock-driven animations: a scroll-driven one (the phone tab row's edge fade) follows its scroller, and
    // rewinding it to a plain number throws.
    const timed = (group: Element) => group.getAnimations({ subtree: true }).filter((a) => a.timeline === document.timeline);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          for (const animation of timed(entry.target)) animation.play();
        }
      },
      // A group starts once its top clears the lowest eighth of the screen, so the first lines are seen moving.
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const group of document.querySelectorAll(".landing-page [data-reveal]")) {
      if (group.getBoundingClientRect().top < window.innerHeight) continue;
      for (const animation of timed(group)) {
        animation.pause();
        animation.currentTime = 0;
      }
      observer.observe(group);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
