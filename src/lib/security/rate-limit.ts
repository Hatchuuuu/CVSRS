import "server-only";
import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { AppError, safeMessage } from "../api/errors";
import { clientAddressSource, ConfigError } from "@/lib/env";

/**
 * Development-only fixed-window limiter, also the degraded fallback while the shared store's circuit is open. Production uses the
 * atomic shared store below. Bounded: at MEMORY_BUCKET_CAP live entries the oldest are evicted, so a flood of fresh keys cannot grow
 * process memory (or the cost of a sweep) without limit. Forgetting an old count is the lesser harm than refusing every new client.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
export const MEMORY_BUCKET_CAP = 10_000;

function makeRoom(now: number) {
  if (buckets.size < MEMORY_BUCKET_CAP) return;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  // Evict down to 90 % so a full sweep runs at most once per MEMORY_BUCKET_CAP / 10 new keys. Map order is insertion order.
  const target = Math.floor(MEMORY_BUCKET_CAP * 0.9);
  for (const k of buckets.keys()) {
    if (buckets.size <= target) break;
    buckets.delete(k);
  }
}

/** `count` is the number of requests charged to the key in the current window, including this one. */
export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
  count: number;
}

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (b) buckets.delete(key); // re-inserted below, so eviction order follows the start of the window
    else makeRoom(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0, count: 1 };
  }
  b.count += 1;
  return { ok: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)), count: b.count };
}

/** Live entries in the in-process limiter (tests and diagnostics). */
export function memoryBucketCount(): number {
  return buckets.size;
}

export function resetRateLimits() {
  buckets.clear();
  circuit.consecutiveFailures = 0;
  circuit.openUntil = 0;
}

/** A client identity for request limits. `shared` means no trusted address source is configured, so every client looks the same. */
export interface ClientAddress {
  key: string;
  shared: boolean;
}

/**
 * The client address comes only from the header named by CVSRS_TRUSTED_CLIENT_IP_HEADER, which the ingress must overwrite on every
 * request (direct origin access blocked). Caller-supplied forwarding headers are never trusted otherwise. A request without the header
 * gets one strict bucket rather than being exempt. Production without a trusted source (or the explicit opt-in) is a 503.
 *
 * The header must hold exactly one IP literal. A list (an appending proxy), a port, a zone index or any other text is treated like a
 * missing header, so a caller-controlled prefix can never mint a fresh identity per request. IPv6 clients are keyed by their /64
 * prefix, the unit one host or subscriber normally controls, so rotating through a /64 does not escape per-address limits.
 */
export function clientAddress(source: Request | Headers): ClientAddress {
  let header: string | null;
  try {
    header = clientAddressSource(process.env).header;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[rate-limit] configuration error: ${error.message}`);
      throw new AppError("misconfigured", 503, safeMessage("misconfigured"));
    }
    throw error;
  }
  if (!header) return { key: "shared", shared: true };
  const headers = source instanceof Headers ? source : source.headers;
  const raw = headers.get(header);
  const key = raw ? addressKey(raw) : null;
  if (raw && !key) warnUnusableHeaderOnce(header);
  return key ? { key, shared: false } : { key: "missing-client-header", shared: false };
}

let warnedUnusableHeader = false;
function warnUnusableHeaderOnce(header: string) {
  if (warnedUnusableHeader) return;
  warnedUnusableHeader = true;
  // Never log the value: it is caller-influenced and may identify a person.
  console.warn(`[rate-limit] the ${header} header held something other than one IP address; such requests share one strict bucket. Check that the ingress overwrites it with the client address only.`);
}

/** The limiter identity for one IP literal (the IPv4 address, or the IPv6 /64 prefix), or null when the value is anything else. */
export function addressKey(value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 64) return null;
  if (isIPv4(v)) return v;
  if (v.includes("%") || !isIPv6(v)) return null;
  const groups = ipv6Groups(v);
  if (!groups) return null;
  // IPv4-mapped (::ffff:a.b.c.d) is the same client as its IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 literal already accepted by isIPv6, including an embedded dotted IPv4 tail. */
function ipv6Groups(v: string): number[] | null {
  let text = v.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) return null;
    const o = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const filler = Array<string>(halves.length === 2 ? missing : 0).fill("0");
  const groups = [...head, ...filler, ...rest].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
}

/**
 * Route scope for limit keys. Given the route's parameters (api() has them), every parameter value is replaced by its name, so the
 * scope is the route template (`/api/v1/clinics/:clinicId/reports/:name`) and changing a path segment never mints a fresh bucket.
 * Without parameters, ids (UUIDs) and verification tokens are removed.
 */
export function routePattern(req: Request, params?: Record<string, string | string[]>): string {
  const path = new URL(req.url).pathname;
  const names = new Map<string, string>();
  for (const [name, value] of Object.entries(params ?? {})) for (const v of Array.isArray(value) ? value : [value]) if (v) names.set(v, name);
  if (names.size > 0) {
    return path.split("/").map((segment) => {
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch { /* malformed escape: keep the raw segment */ }
      const name = names.get(decoded);
      return name ? `:${name}` : segment;
    }).join("/").replace(/[0-9a-f-]{36}/gi, ":id");
  }
  return path.replace(/[0-9a-f-]{36}/gi, ":id").replace(/\/verify\/[^/]+$/, "/verify/:token");
}

/** `client|route` key for callers outside api(). Authenticated callers should also limit per user (see api()). */
export function requestLimitKey(req: Request, scope?: string): string {
  return `${clientAddress(req).key}|${scope ?? routePattern(req)}`;
}

const increment = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}";
/** DECR keeps the key's expiry; a missing or empty key is left alone. */
const decrement = "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n>0 then return redis.call('DECR',KEYS[1]) end; return 0";

interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntil: number;
}
const circuit: CircuitBreakerState = {
  consecutiveFailures: 0,
  openUntil: 0,
};

/**
 * What a limit does while the shared store is unreachable and the circuit is open:
 * - "closed": answer 503. For anonymous, abuse-sensitive scopes (sign-in, sign-up, certificate verification, guardian links,
 *   QR resolution, SMS webhook), where a per-process limit multiplied by the number of instances is no real limit.
 * - "degrade" (default): fall back to a halved per-process limit. For authenticated traffic, where the database authorizes every call
 *   and availability matters more than exact throttling.
 * The first failures before the circuit opens are 503 under both policies.
 */
export type StoreFailurePolicy = "closed" | "degrade";

const unavailable = () => new AppError("unavailable", 503, safeMessage("unavailable"), undefined, true);

/** The shared store's endpoint and token, or null when they are missing or malformed. */
function storeSettings(): { endpoint: URL; token: string } | null {
  try {
    const endpoint = new URL(process.env.CVSRS_RATE_LIMIT_URL ?? "");
    const token = process.env.CVSRS_RATE_LIMIT_TOKEN;
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" || !token) return null;
    return { endpoint, token };
  } catch {
    return null;
  }
}

/** For readiness: production without valid store settings answers 503 on every limited route, so it must not report ready. */
export function assertRateLimitStoreConfigured(): void {
  if (process.env.NODE_ENV === "production" && !storeSettings()) {
    throw new ConfigError("Production needs CVSRS_RATE_LIMIT_URL (an HTTPS origin) and CVSRS_RATE_LIMIT_TOKEN for the shared rate-limit store");
  }
}

const storeKey = (key: string) => `cvsrs:rate:${createHash("sha256").update(key).digest("hex")}`;

/** Redis REST command contract: https://upstash.com/docs/redis/features/restapi */
export async function limitRequest(key: string, limit: number, windowMs: number, opts: { onStoreFailure?: StoreFailurePolicy } = {}): Promise<LimitResult> {
  if (process.env.NODE_ENV !== "production") return hit(key, limit, windowMs);

  const store = storeSettings();
  if (!store) throw new AppError("misconfigured", 503, safeMessage("misconfigured"));

  const now = Date.now();
  // Circuit breaker: if open after sustained store failures, fail closed or degrade to a local memory limiter with a reduced limit.
  if (circuit.openUntil > now) {
    if (opts.onStoreFailure === "closed") throw unavailable();
    const degradedLimit = Math.max(5, Math.floor(limit / 2));
    return hit(`degraded:${key}`, degradedLimit, windowMs, now);
  }

  try {
    const res = await fetch(store.endpoint, {
      method: "POST", headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
      body: JSON.stringify(["EVAL", increment, 1, storeKey(key), windowMs]),
      cache: "no-store", signal: AbortSignal.timeout(2500), redirect: "error",
    });
    if (!res.ok) throw new Error("store unavailable");
    const payload = await res.json() as { result?: unknown };
    if (!Array.isArray(payload.result) || payload.result.length !== 2) throw new Error("invalid store response");
    const [count, ttl] = payload.result;
    if (!Number.isSafeInteger(count) || (count as number) < 1 || !Number.isSafeInteger(ttl) || (ttl as number) < 0) throw new Error("invalid store response");

    circuit.consecutiveFailures = 0;
    circuit.openUntil = 0;
    return { ok: (count as number) <= limit, retryAfterSec: (count as number) <= limit ? 0 : Math.max(1, Math.ceil((ttl as number) / 1000)), count: count as number };
  } catch {
    circuit.consecutiveFailures += 1;
    if (circuit.consecutiveFailures >= 5) {
      circuit.openUntil = Date.now() + 15_000;
      console.warn(`[rate-limit] Circuit breaker OPEN after ${circuit.consecutiveFailures} consecutive store failures; authenticated scopes degrade to a memory limiter, closed scopes answer 503`);
    }
    throw unavailable();
  }
}

/**
 * Gives back one unit charged by limitRequest in the current window (a reservation that turned out not to count, such as a
 * successful sign-in). Best effort: it never throws and never waits long, because the caller has already succeeded. A lost refund
 * only leaves the count one higher until the window ends.
 */
export async function releaseRequest(key: string): Promise<void> {
  const now = Date.now();
  const giveBack = (k: string) => {
    const b = buckets.get(k);
    if (b && b.resetAt > now && b.count > 0) b.count -= 1;
  };
  if (process.env.NODE_ENV !== "production") return giveBack(key);
  if (circuit.openUntil > now) return giveBack(`degraded:${key}`);
  const store = storeSettings();
  if (!store) return;
  try {
    await fetch(store.endpoint, {
      method: "POST", headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
      body: JSON.stringify(["EVAL", decrement, 1, storeKey(key)]),
      cache: "no-store", signal: AbortSignal.timeout(1000), redirect: "error",
    });
  } catch {
    // Best effort (see above).
  }
}
