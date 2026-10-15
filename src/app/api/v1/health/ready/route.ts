import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/env";
import { checkReadiness, type Readiness } from "@/lib/health";
import { assertRateLimitStoreConfigured } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

// One check per 5 s per process: the endpoint is public, so callers cannot turn it into a database load generator.
const CACHE_MS = 5000;
let cached: { at: number; result: Readiness } | undefined;
let inFlight: Promise<void> | undefined;

/** Readiness: 200 only when configuration is valid and the database answers (audit F14). Liveness stays at /api/v1/health. */
export async function GET() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    inFlight ??= checkReadiness({
      config: () => {
        getConfig();
        assertRateLimitStoreConfigured();
      },
      // A cookie-less anonymous client: the caller's session (valid, expired or malformed) never affects the answer. The public
      // clinic directory is the cheapest call the anonymous role may make, and it exercises PostgREST, not just a socket.
      probe: async (signal) => {
        const cfg = getConfig();
        const supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const { error } = await supabase.rpc("list_public_clinics").abortSignal(signal);
        if (error) throw new Error(error.code ?? "rpc failed");
      },
    }).then((result) => {
      cached = { at: Date.now(), result };
      if (!result.ready) console.error(JSON.stringify({ event: "readiness_failed", requestId: randomUUID(), reason: result.reason }));
    }).finally(() => { inFlight = undefined; });
    await inFlight;
  }
  const headers = { "cache-control": "no-store" };
  return cached?.result.ready
    ? NextResponse.json({ status: "ready" }, { headers })
    : NextResponse.json({ status: "unavailable" }, { status: 503, headers });
}
