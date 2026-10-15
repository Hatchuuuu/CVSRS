"use client";
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { browserSessionCookiePolicy, sessionCookieOptions } from "@/lib/auth/cookies";

// Publishable key only. Nothing here grants access by itself: the database enforces authorization.
// Cookie writes use the shared session cookie policy (src/lib/auth/cookies.ts) instead of the SDK's 400-day default.
export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  const policy = browserSessionCookiePolicy();
  return createBrowserClient(url, key, {
    cookies: {
      getAll: () => parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll: (list) => {
        for (const c of list) document.cookie = serializeCookieHeader(c.name, c.value, sessionCookieOptions(c.options, policy));
      },
    },
  });
}
