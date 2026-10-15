import { describe, expect, it, vi } from "vitest";
import { AppError, fromDbError } from "@/lib/api/errors";
import { isSameOrigin } from "@/lib/security/origin";
import { hit } from "@/lib/security/rate-limit";

const req = (headers: Record<string, string>) => new Request("http://localhost:3100/api/v1/children", { method: "POST", headers });

describe("isSameOrigin (CSRF defence)", () => {
  it("accepts a matching Origin", () => {
    expect(isSameOrigin(req({ host: "localhost:3100", origin: "http://localhost:3100" }))).toBe(true);
  });
  it("uses the actual loopback Host when Next rewrites the development request URL", () => {
    expect(isSameOrigin(req({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }))).toBe(true);
    expect(isSameOrigin(req({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3101" }))).toBe(false);
    expect(isSameOrigin(req({ host: "evil.example:3100", origin: "http://evil.example:3100" }))).toBe(false);
    expect(isSameOrigin(req({ host: "127.0.0.1:3101", origin: "http://127.0.0.1:3101" }))).toBe(false);
  });
  it("never trusts the loopback Host alias in production", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CVSRS_PUBLIC_URL", "https://clinic.example");
      const request = new Request("https://clinic.example/api", { headers: { host: "127.0.0.1", origin: "https://127.0.0.1" } });
      expect(isSameOrigin(request)).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
  it("rejects a foreign Origin", () => {
    expect(isSameOrigin(req({ host: "localhost:3100", origin: "http://evil.example" }))).toBe(false);
  });
  it("never accepts the literal null origin on its own", () => {
    expect(isSameOrigin(req({ host: "localhost:3100", origin: "null" }))).toBe(false);
  });
  it("falls back to Sec-Fetch-Site when Origin is absent", () => {
    expect(isSameOrigin(req({ host: "localhost:3100", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(req({ host: "localhost:3100", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3100" }))).toBe(false);
  });
  it("rejects absent Origin in production even with sec-fetch-site same-origin", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CVSRS_PUBLIC_URL", "http://localhost:3100");
      expect(isSameOrigin(req({ host: "localhost:3100", "sec-fetch-site": "same-origin" }))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("rejects malformed Origin values", () => {
    expect(isSameOrigin(req({ host: "localhost:3100", origin: "not a url" }))).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit then blocks with a retry hint, and recovers after the window", () => {
    const key = "unit-" + Math.random();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hit(key, 3, 60_000, t0 + i).ok).toBe(true);
    const blocked = hit(key, 3, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(hit(key, 3, 60_000, t0 + 60_001).ok).toBe(true);
  });
});

describe("database error mapping", () => {
  it.each([
    ["CV403", 403, "forbidden"],
    ["CV404", 404, "not_found"],
    ["CV409", 409, "conflict"],
    ["42501", 403, "forbidden"],
    ["23505", 409, "conflict"],
    ["23514", 422, "unprocessable"],
  ])("maps %s to %i %s", (code, status, appCode) => {
    const e = fromDbError({ code, message: "raw text" });
    expect(e).toBeInstanceOf(AppError);
    expect([e.status, e.code]).toEqual([status, appCode]);
  });

  it("never leaks raw database text for non-authored errors", () => {
    const e = fromDbError({ code: "23505", message: 'duplicate key value violates unique constraint "children_pkey" Key (id)=(secret)' });
    expect(e.message).not.toMatch(/children_pkey|secret|duplicate key/);
    const unknown = fromDbError({ code: "XX000", message: "relation public.children does not exist" });
    expect(unknown.status).toBe(500);
    expect(unknown.message).not.toMatch(/relation|children/);
  });

  it("passes through only our own authored messages (CV422 input, CV409 state)", () => {
    expect(fromDbError({ code: "CV422", message: "child name is required" }).message).toBe("child name is required");
    expect(fromDbError({ code: "CV409", message: "a visit is in progress at the current clinic; finish it first" }).message).toBe("a visit is in progress at the current clinic; finish it first");
    expect(fromDbError({ code: "CV403", message: "forbidden" }).message).not.toBe("forbidden");
    expect(fromDbError({ code: "CV404", message: "not found: child 123" }).message).not.toMatch(/123/);
    expect(fromDbError({ code: "23505", message: "duplicate key" }).message).not.toMatch(/duplicate/);
  });

  it("reports a reused operation key as already saved, never as an ordinary conflict", () => {
    const e = fromDbError({ code: "CV409", message: "raw", hint: "cvsrs:operation_key_reused" });
    expect([e.status, e.code, e.retryable]).toEqual([409, "already_saved", false]);
    expect(e.message).toMatch(/already saved/);
    expect(fromDbError({ code: "CV409", message: "state", hint: "something else" }).code).toBe("conflict");
    expect(fromDbError({ code: "CV422", message: "x", hint: "cvsrs:operation_key_reused" }).code).toBe("unprocessable");
  });

  it("marks deadlocks retryable", () => {
    expect(fromDbError({ code: "40P01" }).retryable).toBe(true);
    expect(fromDbError({ code: "CV403" }).retryable).toBe(false);
  });
});
