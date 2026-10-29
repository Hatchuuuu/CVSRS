"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Mood = "neutral" | "sad" | "happy";
const Feedback = createContext<{ mood: Mood; setMood: (mood: Mood) => void } | null>(null);

export function SignInFeedback({ children, failed = false }: { children: ReactNode; failed?: boolean }) {
  const [mood, setMood] = useState<Mood>(failed ? "sad" : "neutral");
  return <Feedback.Provider value={{ mood, setMood }}>{children}</Feedback.Provider>;
}

export function useSignInFeedback() { return useContext(Feedback); }
