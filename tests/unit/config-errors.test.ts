import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as publicClinics } from "@/app/api/v1/clinics/route";
import { resetRateLimits } from "@/lib/security/rate-limit";

// Promoted from the SEC-06 reproduction with the inverted expectation.
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetRateLimits(); });

describe("configuration errors", () => {
  it("return only the safe message to clients and log the detail with the request id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    // A leftover local database setting is not a sign-in mode; the log names the replacement, the client sees nothing of it.
    vi.stubEnv("CVSRS_LOCAL_DB_URL", "postgresql://db.internal.example:5432/x");
    const res = await publicClinics(new Request("http://localhost:3000/api/v1/clinics"));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatchObject({ code: "misconfigured", message: "The service is not configured." });
    expect(JSON.stringify(body)).not.toMatch(/loopback|CVSRS_|internal\.example/);
    expect(log.mock.calls.flat().join(" ")).toContain(body.requestId);
    expect(log.mock.calls.flat().join(" ")).toContain("npm run dev");
  });
});
