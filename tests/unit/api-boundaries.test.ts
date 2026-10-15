import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import { readBoundedText } from "@/lib/api/body";
import { positiveQueryInt } from "@/lib/api/query";
import { isSameOrigin } from "@/lib/security/origin";
import { publicBase } from "@/lib/certificates/service";
import { canonicalPublicUrl } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bounded request bodies", () => {
  it("counts UTF-8 bytes, including across stream chunks", async () => {
    const raw = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("é"));
        controller.enqueue(new TextEncoder().encode("é"));
        controller.close();
      },
    });
    const req = new Request("https://app.example/api", { method: "POST", body: raw, duplex: "half" } as RequestInit);
    await expect(readBoundedText(req, 3)).rejects.toMatchObject({ code: "invalid_request", status: 413 });
  });
  it("rejects declared oversized bodies before consuming the stream", async () => {
    const req = new Request("https://app.example/api", { method: "POST", headers: { "content-length": "11" }, body: "x" });
    await expect(readBoundedText(req, 10)).rejects.toMatchObject({ status: 413 });
  });
});

describe("query limits", () => {
  it("accepts only positive whole numbers within the endpoint bound", () => {
    expect(positiveQueryInt(null, 50, 100)).toBe(50);
    expect(positiveQueryInt("100", 50, 100)).toBe(100);
    for (const value of ["-1", "0", "1.5", "Infinity", "101", "abc", ""]) {
      expect(() => positiveQueryInt(value, 50, 100)).toThrow(AppError);
    }
  });
});

describe("canonical origins", () => {
  it("requires scheme and host to match, even with a forged Host header", () => {
    expect(isSameOrigin(new Request("https://app.example/api", { headers: { host: "app.example", origin: "http://app.example" } }))).toBe(false);
    expect(isSameOrigin(new Request("https://app.example/api", { headers: { host: "evil.example", origin: "https://evil.example" } }))).toBe(false);
  });
  it("requires a clean HTTPS public URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://attacker.example/api");
    vi.stubEnv("CVSRS_PUBLIC_URL", "");
    expect(() => publicBase(req)).toThrow(AppError);
    for (const value of ["http://app.example", "https://app.example/path", "https://user@app.example", "https://app.example?x=1"]) {
      vi.stubEnv("CVSRS_PUBLIC_URL", value);
      expect(() => publicBase(req)).toThrow(AppError);
    }
    vi.stubEnv("CVSRS_PUBLIC_URL", "https://app.example/");
    expect(publicBase(req)).toBe("https://app.example");
    expect(canonicalPublicUrl("https://app.example/")).toBe("https://app.example");
  });
  it("pins production mutation requests to the configured public origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_PUBLIC_URL", "https://app.example");
    expect(isSameOrigin(new Request("https://app.example/api", { headers: { origin: "https://app.example" } }))).toBe(true);
    expect(isSameOrigin(new Request("https://evil.example/api", { headers: { origin: "https://evil.example", host: "app.example" } }))).toBe(false);
  });
});

describe("health endpoint", () => {
  it("returns ok status and version metadata", async () => {
    const { GET } = await import("@/app/api/v1/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("cvsrs-web");
    expect(data.version).toBe("0.1.0");
  });
});

