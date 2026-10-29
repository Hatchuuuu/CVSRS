"use client";

import { useState, useSyncExternalStore } from "react";
import { Heart } from "lucide-react";
import { useSignInFeedback } from "./sign-in-feedback";
import { Mascot } from "page-mascot";

function subscribeToMotion(change: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotion = () => false;

export function NurseMascot({ size = 120, className = "lp-nurse-mascot", variant = "nurse" }: { size?: number; className?: string; variant?: "nurse" | "staff" }) {
  const reactions = `/mascots/${variant}-reactions.webp`;
  const character = variant === "staff" ? "clinic staff" : "nurse";
  const feedback = useSignInFeedback();
  const mood = feedback?.mood ?? "neutral";
  const [welcomeDone, setWelcomeDone] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, serverMotion);
  const waving = Boolean(feedback) && !welcomeDone && !reducedMotion;
  return (
    <div className={`${className} relative`}>
      {feedback && mood === "neutral" ? (
        <>
        <span className="signin-welcome-face" style={{ visibility: welcomeDone ? "hidden" : undefined, backgroundImage: `url(${reactions})` }} aria-hidden="true" onAnimationEnd={() => setWelcomeDone(true)} />
        <svg className="signin-welcome-arm" style={{ visibility: welcomeDone ? "hidden" : undefined }} viewBox="0 0 88 88" aria-hidden="true">
          <defs>
            <linearGradient id="welcome-sleeve" x2="1" y2="1">
              <stop stopColor={variant === "staff" ? "#3373ef" : "#b5e1d2"} /><stop offset="1" stopColor={variant === "staff" ? "#0648ef" : "#72bbaa"} />
            </linearGradient>
            <linearGradient id="welcome-skin" x2="1" y2=".4">
              <stop stopColor="#f9d4bc" /><stop offset="1" stopColor="#edb291" />
            </linearGradient>
          </defs>
          <g transform="translate(88 -9) scale(-1 1)" stroke="#927566" strokeWidth=".65" strokeLinejoin="round" strokeLinecap="round">
            <path fill="url(#welcome-sleeve)" stroke="#79b5a5" d="M50 69Q55 68 59 71Q62 73 65 75Q69 77 68 79Q67 82 64 81Q60 80 57 77L53 75" />
            <g transform="translate(65 77) scale(.8) translate(-65 -77)">
            <g className="signin-welcome-forearm">
              <path fill="url(#welcome-skin)" d="M62 78Q60 76 63 71L67 61Q68 59 67 57L64 54Q63 52 64 51Q65 50 67 52L69 54 68 46Q68 44 69.5 44Q71 44 71 46L72 52 72 43Q72 41 74 42L75 52 77 45Q78 43 79.5 44Q81 45 79 48L78 54 81 50Q82 48 83 50Q84 51 82 54L79 61Q77 64 74 65L69 77Q68 80 65 80Q63 80 62 78Z" />
              <path fill="none" stroke="#d99d81" d="M69 58Q73 57 75 61M72 54 73 56M76 54 76 56" />
            </g>
            </g>
          </g>
        </svg>
        </>
      ) : null}
      {mood === "neutral" ? (waving ? <div data-nurse-waving role="img" aria-label={variant === "staff" ? "Clinic staff waving hello" : "Nurse waving hello"} style={{ width: size, height: size, background: `url(${reactions}) 0 0 / 300% 300% no-repeat` }} /> : <Mascot
        directions={`/mascots/${variant}-directions.webp`}
        reactions={reactions}
        size={size}
        label={`${character} mascot`}
      />) : (
        <div className="signin-mascot-reaction" role="img" aria-label={mood === "happy" ? `Happy ${character} with hearts: sign-in successful` : `Sad ${character}: sign-in unsuccessful`} style={{ width: size, height: size }}>
          <span className={`signin-nurse-${mood}`} style={variant === "staff" ? { backgroundImage: `url(${reactions})`, backgroundSize: "300% 300%", backgroundPosition: mood === "sad" ? "0% 100%" : "50% 0%" } : undefined} aria-hidden />
          {mood === "happy" ? [0, 1, 2, 3, 4, 5].map(index => <Heart key={index} aria-hidden className={`signin-mascot-heart signin-heart-${index}`} />) : null}
        </div>
      )}
    </div>
  );
}
