import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError, fromDbError, safeMessage } from "@/lib/api/errors";
import { serverSessionCookiePolicy, sessionCookieMethods } from "@/lib/auth/cookies";
import { RPC_ALLOWLIST, type RpcClient, type RpcName, type SessionInfo } from "./port";

/** Supabase-backed client. Uses only the publishable key: authorization is enforced by the database, not this file. */
export async function createSupabaseClient(url: string, key: string, requestId: string): Promise<RpcClient> {
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    global: { headers: { "x-request-id": requestId } },
    // Writes fail inside Server Components; the proxy refreshes the session cookie there instead.
    cookies: sessionCookieMethods(jar, serverSessionCookiePolicy(process.env), { ignoreWriteErrors: true }),
  });
  return {
    async session(): Promise<SessionInfo | null> {
      // getUser() revalidates the JWT with Auth; getSession() alone would trust the cookie.
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          // Match credential routes: a service outage or throttle is not a rejected session.
          const status = error.status ?? 0;
          if (status === 429) throw new AppError("rate_limited", 429, safeMessage("rate_limited"), undefined, true);
          if (status === 0 || status >= 500) throw new AppError("unavailable", 503, safeMessage("unavailable"), undefined, true);
          return null;
        }
        if (!data.user) return null;
        return { userId: data.user.id, email: data.user.email ?? null };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("unavailable", 503, safeMessage("unavailable"), undefined, true);
      }
    },
    async rpc<T>(fn: RpcName, args: Record<string, unknown> = {}): Promise<T | null> {
      if (!(RPC_ALLOWLIST as readonly string[]).includes(fn)) throw new AppError("internal", 500, "unknown command");
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw fromDbError({ code: error.code, message: error.message, hint: error.hint });
      return (data ?? null) as T | null;
    },
  };
}
