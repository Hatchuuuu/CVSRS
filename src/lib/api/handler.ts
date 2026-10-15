import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import "@/lib/validation/messages";
import { getRpcClient, type RpcClient } from "@/lib/db";
import type { SessionInfo } from "@/lib/db/port";
import { isSameOrigin } from "@/lib/security/origin";
import { clientAddress, limitRequest, routePattern, type StoreFailurePolicy } from "@/lib/security/rate-limit";
import { AppError, errorResponse, safeMessage } from "./errors";
import { readBoundedText } from "./body";

export interface ApiCtx<B> {
  req: Request;
  requestId: string;
  rpc: RpcClient;
  session: SessionInfo | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: B;
  /** Client-generated Idempotency-Key (mutations only). */
  opKey: string;
}

interface Opts<B> {
  /** Defaults to true. Public routes must opt out explicitly. */
  auth?: boolean;
  body?: z.ZodType<B>;
  maxBodyBytes?: number;
  /**
   * Requests per window. Authenticated routes: `limit` per signed-in user per route, after authentication, plus a pre-authentication
   * ceiling of PRE_AUTH_FACTOR × `limit` per client address (several staff can share one clinic address). Public routes: `limit` per
   * client address per route (× SHARED_FACTOR when production explicitly accepts shared buckets). `keyParams` adds route parameters
   * (e.g. the clinic id of a waiting-room display) to the public key. `onStoreFailure` defaults to "degrade".
   */
  rate?: { limit: number; windowMs: number; onStoreFailure?: StoreFailurePolicy; keyParams?: string[] };
}

const DEFAULT_RATE = { limit: 60, windowMs: 60_000 };
/** Pre-authentication allowance per client address, as a multiple of the per-user limit. */
export const PRE_AUTH_FACTOR = 10;
/** Public-route allowance multiplier when there is no client address (CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET=1 or development). */
export const SHARED_FACTOR = 20;

const uuid = z.uuid();

function reply(status: number, payload: Record<string, unknown>, requestId: string, extra: HeadersInit = {}) {
  return Response.json({ ...payload, requestId }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store", ...extra } });
}

export function api<B = undefined>(opts: Opts<B>, fn: (ctx: ApiCtx<B>) => Promise<unknown>) {
  return async (req: Request, routeCtx?: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating && !isSameOrigin(req)) throw new AppError("forbidden", 403, safeMessage("forbidden"));
      const params = (await routeCtx?.params) ?? {};
      for (const [k, v] of Object.entries(params)) if (k.toLowerCase().endsWith("id") && !uuid.safeParse(v).success) throw new AppError("not_found", 404, safeMessage("not_found"));

      const authRequired = opts.auth !== false;
      const rate: NonNullable<Opts<B>["rate"]> = opts.rate ?? DEFAULT_RATE;
      const route = routePattern(req, params);
      const charge = async (key: string, limit: number) => {
        const r = await limitRequest(key, limit, rate.windowMs, { onStoreFailure: rate.onStoreFailure ?? "degrade" });
        if (!r.ok) throw Object.assign(new AppError("rate_limited", 429, safeMessage("rate_limited"), undefined, true), { retryAfter: r.retryAfterSec });
      };
      {
        // Pre-authentication limit, keyed on the trusted client address. Never a deployment-wide bucket for authenticated routes:
        // without a client address, unauthenticated requests are simply refused below (401) and signed-in users are limited per user.
        const client = clientAddress(req);
        if (authRequired) {
          if (!client.shared) await charge(`pre|${client.key}|${route}`, rate.limit * PRE_AUTH_FACTOR);
        } else {
          const scoped = rate.keyParams?.map((k) => params[k] ?? "").join(",");
          await charge(`pre|${client.key}|${route}${scoped ? `|${scoped}` : ""}`, client.shared ? rate.limit * SHARED_FACTOR : rate.limit);
          if (scoped && !client.shared) await charge(`pre|${client.key}|${route}`, rate.limit * PRE_AUTH_FACTOR);
        }
      }

      let opKey = "";
      if (mutating) {
        opKey = req.headers.get("idempotency-key") ?? "";
        if (!uuid.safeParse(opKey).success) throw new AppError("invalid_request", 400, "An Idempotency-Key header (UUID) is required.");
      }
      let body = undefined as B;
      if (opts.body) {
        let raw: unknown;
        try {
          raw = JSON.parse(await readBoundedText(req, opts.maxBodyBytes ?? 1_000_000));
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError("invalid_request", 400, safeMessage("invalid_request"));
        }
        const parsed = opts.body.safeParse(raw);
        if (!parsed.success) {
          const fieldErrors: Record<string, string> = {};
          for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
          throw new AppError("unprocessable", 422, safeMessage("unprocessable"), fieldErrors);
        }
        body = parsed.data;
      }

      const rpc = await getRpcClient(requestId);
      const session = await rpc.session();
      if (authRequired && !session) throw new AppError("unauthenticated", 401, safeMessage("unauthenticated"));
      // Post-authentication limit: every signed-in user has their own bucket per route.
      if (authRequired && session) await charge(`user|${session.userId}|${route}`, rate.limit);

      const data = await fn({ req, requestId, rpc, session, params, query: new URL(req.url).searchParams, body, opKey });
      if (data === null) throw new AppError("not_found", 404, safeMessage("not_found"));
      return reply(200, { data }, requestId);
    } catch (e) {
      if (e instanceof AppError) {
        if ([401, 403, 429, 503].includes(e.status)) console.warn(JSON.stringify({ event: "api_denied", requestId, code: e.code, status: e.status }));
        const retryAfter = (e as AppError & { retryAfter?: number }).retryAfter;
        return errorResponse(e, requestId, retryAfter);
      }
      // Log class + request id only: messages may contain identifiers.
      console.error(`[${requestId}] unhandled ${(e as Error)?.name ?? "error"}`);
      return errorResponse(new AppError("internal", 500, safeMessage("internal")), requestId);
    }
  };
}
