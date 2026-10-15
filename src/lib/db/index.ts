import "server-only";
import { AppError, safeMessage } from "@/lib/api/errors";
import { ConfigError, getConfig } from "@/lib/env";
import type { RpcClient } from "./port";
import { createSupabaseClient } from "./supabase";

export type { RpcClient } from "./port";

export async function getRpcClient(requestId: string): Promise<RpcClient> {
  try {
    const cfg = getConfig();
    return await createSupabaseClient(cfg.supabaseUrl, cfg.supabaseKey, requestId);
  } catch (e) {
    if (e instanceof ConfigError) {
      // The detail names deployment settings: it stays in the server log, keyed by the request id the client receives.
      console.error(`[${requestId}] configuration error: ${e.message}`);
      throw new AppError("misconfigured", 503, safeMessage("misconfigured"));
    }
    throw e;
  }
}
