"use client";
import { useCallback, useRef, useState } from "react";

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId?: string;
  /** Network failure, timeout, or an earlier attempt already saved: the record must be checked. Retrying with the same key never duplicates. */
  unknown?: boolean;
  /** A stable reason the server sets for conflicts the interface words specially (from a database hint, never from message text). */
  reason?: ApiFailureReason;
}
export type ApiFailureReason = "duplicate_session_booking";
const KNOWN_REASONS: ReadonlySet<string> = new Set<ApiFailureReason>(["duplicate_session_booking"]);
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

const fieldLabel = (path: string) => {
  const last = path.split(".").filter((p) => !/^\d+$/.test(p)).pop() ?? path;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Database-authored conflict messages are terse ("insufficient stock"); people read them as a sentence ("Insufficient stock."). */
export function asSentence(message: string): string {
  const s = message.trim();
  if (!s) return s;
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
}

/** Forms show some field errors inline; the summary names every field so none is left unexplained. */
export function withFieldDetails(message: string, fieldErrors?: Record<string, string>): string {
  const entries = Object.entries(fieldErrors ?? {});
  if (entries.length === 0) return message;
  const details = entries.map(([path, text]) => (path === "_" ? text : `${fieldLabel(path)}: ${text}`));
  return `${message} ${details.join(" ")}`;
}

export async function callApi<T>(path: string, init: { method?: string; body?: unknown; key?: string; timeoutMs?: number } = {}): Promise<ApiSuccess<T> | ApiFailure> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.key ? { "idempotency-key": init.key } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctl.signal,
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string; fieldErrors?: Record<string, string>; reason?: string }; requestId?: string };
    if (res.ok && json.data !== undefined) return { ok: true, data: json.data, requestId: json.requestId ?? "" };
    const code = json.error?.code ?? "internal";
    const base = asSentence(json.error?.message ?? "Something went wrong.");
    const mutating = !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
    const uncertain = code === "already_saved" || (mutating && (res.status >= 500 || res.ok));
    return {
      ok: false,
      status: res.status,
      code,
      message: withFieldDetails(base, json.error?.fieldErrors),
      fieldErrors: json.error?.fieldErrors,
      requestId: json.requestId,
      // A server/gateway failure or unreadable success can arrive after commit. Preserve the operation key for a safe retry.
      ...(uncertain ? { unknown: true } : {}),
      ...(json.error?.reason && KNOWN_REASONS.has(json.error.reason) ? { reason: json.error.reason as ApiFailureReason } : {}),
    };
  } catch {
    return { ok: false, status: 0, code: "network", message: "We could not confirm whether this was saved. Check the connection and try again — repeating it is safe.", unknown: true };
  } finally {
    clearTimeout(timer);
  }
}

export type MutationState<T> =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "success"; data: T; requestId: string }
  | { phase: "error"; error: ApiFailure };

/**
 * One idempotency key per logical submission. The key is reused for retries (double click, timeout, retry button)
 * and only replaced after a definitive outcome, so a lost response can never duplicate care or records (T05).
 */
export function useMutation<T, B = unknown>(path: string | ((b: B) => string), method = "POST") {
  const [state, setState] = useState<MutationState<T>>({ phase: "idle" });
  const key = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  const unresolved = useRef(false);

  const run = useCallback(
    async (body?: B, override?: { path?: string; method?: string }) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setState({ phase: "pending" });
      const p = override?.path ?? (typeof path === "function" ? path(body as B) : path);
      let res = await callApi<T>(p, { method: override?.method ?? method, body, key: key.current });
      inFlight.current = false;
      if (res.ok) {
        unresolved.current = false;
        key.current = crypto.randomUUID();
        setState({ phase: "success", data: res.data, requestId: res.requestId });
      } else {
        if (res.unknown) unresolved.current = true;
        else if (unresolved.current) res = {
          ...res, unknown: true,
          message: `An earlier attempt is still unconfirmed. Check the record before changing it. ${res.message}`,
        };
        // A definitive client-syntax rejection (e.g. 400, 404) rotates the key for the next distinct attempt.
        // State conflicts (409) and business-rule/state rejections (422 / CV422) preserve the key for safe retries.
        // A rejected retry says nothing about an earlier unconfirmed save, so its key remains until success.
        if (!unresolved.current && res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 422) {
          key.current = crypto.randomUUID();
        }
        setState({ phase: "error", error: res });
      }
      return res;
    },
    [path, method],
  );
  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset };
}
