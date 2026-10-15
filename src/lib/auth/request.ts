import "server-only";
import { NextResponse } from "next/server";
import { readBoundedText } from "@/lib/api/body";
import { AppError } from "@/lib/api/errors";
import { clientAddress, limitRequest, releaseRequest } from "@/lib/security/rate-limit";

export const isJsonAuthRequest = (req: Request) => (req.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() === "application/json";

/** Preserve the browser's origin and its host-only session cookie. */
export function authRedirect(destination: string) {
  return new NextResponse(null, { status: 303, headers: { location: destination, "cache-control": "no-store" } });
}

/** A single bounded parser for credential JSON and native forms. Never coerce objects or files. */
export async function readAuthFields(req: Request): Promise<Record<string, string>> {
  const text = await readBoundedText(req, 16_384);
  const invalid = () => new AppError("invalid_request", 400, "Please check the submitted details.");
  let input: Record<string, unknown>;
  try {
    if (isJsonAuthRequest(req)) {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
      input = value as Record<string, unknown>;
    } else {
      const type = req.headers.get("content-type") ?? "";
      const normalizedType = type.toLowerCase();
      if (!normalizedType.startsWith("application/x-www-form-urlencoded") && !normalizedType.startsWith("multipart/form-data")) throw invalid();
      const form = await new Request(req.url, { method: "POST", headers: { "content-type": type }, body: text }).formData();
      input = Object.create(null) as Record<string, unknown>;
      for (const [key, value] of form.entries()) {
        if (Object.hasOwn(input, key)) throw invalid();
        input[key] = value;
      }
    }
    const fields: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      if (typeof value !== "string" || value.length > 2_000) throw invalid();
      fields[key] = value;
    }
    return fields;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid();
  }
}

export function authFailure(req: Request, page: "sign-in" | "sign-up", message: string, status: number, code: string, headers?: HeadersInit) {
  if (isJsonAuthRequest(req)) return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });
  const response = authRedirect(`/${page}?error=${encodeURIComponent(code)}`);
  response.headers.set("cache-control", "no-store");
  if (headers) new Headers(headers).forEach((value, key) => response.headers.set(key, value));
  return response;
}

/**
 * Auth-service failures that are not about the person's credentials: rate limits (429) and outages or network errors (status 0
 * or 5xx). Saying "invalid credentials" for those would send people hunting for a password that was right. Null otherwise.
 */
export function authServiceFailure(req: Request, page: "sign-in" | "sign-up", error: { status?: number } | null | undefined) {
  if (!error) return null;
  const status = error.status ?? 0;
  if (status === 429) return authFailure(req, page, "Too many attempts. Wait a moment and try again.", 429, "rate_limited", { "retry-after": "60" });
  if (status === 0 || status >= 500) return authFailure(req, page, "Sign-in service is temporarily unavailable. Please try again.", 503, "unavailable");
  return null;
}

export function authException(req: Request, page: "sign-in" | "sign-up", error: unknown) {
  return error instanceof AppError
    ? authFailure(req, page, error.message, error.status, error.code)
    : authFailure(req, page, "Sign-in service is temporarily unavailable. Please try again.", 503, "unavailable");
}

/**
 * Per minute. `account` is per (client address, normalized email): one client's failures never lock the same account for another
 * client. `address` stops one client from guessing across many accounts (skipped when no client address is configured). `global`
 * counts attempts across the deployment. With a trusted client address it only marks a distributed flood: while it is exceeded,
 * each address falls to the stricter `addressUnderAttack` allowance, so the addresses that keep failing are stopped and a fresh
 * client still gets through. Without a client address (every caller looks the same) it remains a hard safety valve.
 */
export const AUTH_LIMITS = {
  "sign-in": { account: 10, address: 100, addressUnderAttack: 10, global: 1_000 },
  "sign-up": { account: 5, address: 30, addressUnderAttack: 5, global: 300 },
} as const;

/** The limit keys one attempt is charged to, most specific first. */
function authLimitKeys(req: Request, page: "sign-in" | "sign-up", email?: string) {
  const client = clientAddress(req);
  return {
    account: email === undefined ? null : `auth/${page}|account|${client.key}|${email.trim().toLowerCase().slice(0, 320)}`,
    address: client.shared ? null : `auth/${page}|address|${client.key}`,
    global: `auth/${page}|global`,
  };
}

/**
 * Sign-in/sign-up throttling. Fails closed (503) while the shared store is unavailable. With an `email`, attempts are also counted
 * per account. Every attempt is charged before it runs; a successful sign-in is given back
 * through `authAttemptSucceeded`, so only failures use up an allowance (staff behind one clinic address are never locked out by
 * their own successful sign-ins).
 */
export async function authRateLimit(req: Request, page: "sign-in" | "sign-up", email?: string) {
  const limits = AUTH_LIMITS[page];
  const keys = authLimitKeys(req, page, email);
  const tooMany = (retryAfterSec: number) =>
    authFailure(req, page, "Too many attempts. Wait a moment and try again.", 429, "rate_limited", { "retry-after": String(retryAfterSec) });
  // Most specific first: a client that is already throttled stops consuming the shared counters.
  if (keys.account) {
    const account = await limitRequest(keys.account, limits.account, 60_000, { onStoreFailure: "closed" });
    if (!account.ok) return tooMany(account.retryAfterSec);
  }
  const address = keys.address ? await limitRequest(keys.address, limits.address, 60_000, { onStoreFailure: "closed" }) : null;
  if (address && !address.ok) return tooMany(address.retryAfterSec);
  const global = await limitRequest(keys.global, limits.global, 60_000, { onStoreFailure: "closed" });
  if (!global.ok) {
    if (!address) return tooMany(global.retryAfterSec);
    if (address.count > limits.addressUnderAttack) return tooMany(Math.max(address.retryAfterSec, global.retryAfterSec));
  }
  return null;
}

/** Gives back what a successful attempt was charged by `authRateLimit` (best effort; never throws). */
export async function authAttemptSucceeded(req: Request, page: "sign-in" | "sign-up", email?: string) {
  const keys = authLimitKeys(req, page, email);
  await Promise.all([keys.account, keys.address, keys.global].filter((k): k is string => k !== null).map((k) => releaseRequest(k)));
}
