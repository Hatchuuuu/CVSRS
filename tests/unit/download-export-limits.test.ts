import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SEC-01 follow-up for the two custom (non-api()) download routes: limits are per trusted client address before authentication
// and per user after it, so one signed-in user exhausting the export limit never blocks another.
const state = vi.hoisted(() => ({ getRpcClient: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRpcClient: state.getRpcClient }));

import { GET as download } from "@/app/api/v1/certificates/[certificateId]/download/route";
import { GET as exportCsv } from "@/app/api/v1/clinics/[clinicId]/reports/[name]/export/route";
import { resetRateLimits } from "@/lib/security/rate-limit";

const ORIGIN = "http://localhost:3000";
const clinic = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cert = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

function signedIn(user: string | null, result: unknown) {
  state.getRpcClient.mockImplementation(async () => ({
    session: async () => (user ? { userId: user, email: null } : null),
    rpc: async () => result,
  }));
}

const reportName = () => "daily-activity";
const exportReq = (ip: string) => exportCsv(
  new Request(`${ORIGIN}/api/v1/clinics/${clinic}/reports/${reportName()}/export?from=2026-10-01&to=2026-10-01`, { headers: { "x-client-ip": ip } }),
  { params: Promise.resolve({ clinicId: clinic, name: reportName() }) },
);
const downloadReq = (ip: string) => download(
  new Request(`${ORIGIN}/api/v1/certificates/${cert}/download`, { headers: { "x-client-ip": ip } }),
  { params: Promise.resolve({ certificateId: cert }) },
);

beforeEach(() => {
  resetRateLimits();
  state.getRpcClient.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
  vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
});
afterEach(() => { vi.unstubAllEnvs(); resetRateLimits(); });

describe("report CSV export limits", () => {
  it("one user exhausting the export limit does not block another user", async () => {
    signedIn(userA, { rows: [] });
    for (let i = 0; i < 20; i++) expect((await exportReq("203.0.113.1")).status).toBe(200);
    expect((await exportReq("203.0.113.1")).status).toBe(429);
    signedIn(userB, { rows: [] });
    expect((await exportReq("203.0.113.1")).status).toBe(200);
  });
  it("without a trusted address header, signed-in users still get separate buckets", async () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    signedIn(userA, { rows: [] });
    for (let i = 0; i < 20; i++) await exportReq("203.0.113.1");
    expect((await exportReq("203.0.113.1")).status).toBe(429);
    signedIn(userB, { rows: [] });
    expect((await exportReq("198.51.100.9")).status).toBe(200);
  });
  it("refuses an unauthenticated export with 401", async () => {
    signedIn(null, null);
    expect((await exportReq("203.0.113.1")).status).toBe(401);
  });
});

describe("certificate PDF download limits", () => {
  const doc = { certificateNo: "CV-1", pdfBase64: Buffer.from("%PDF-1.7").toString("base64"), sha256: "ab" };
  it("one user exhausting the download limit does not block another user", async () => {
    signedIn(userA, doc);
    for (let i = 0; i < 60; i++) expect((await downloadReq("203.0.113.1")).status).toBe(200);
    expect((await downloadReq("203.0.113.1")).status).toBe(429);
    signedIn(userB, doc);
    expect((await downloadReq("203.0.113.1")).status).toBe(200);
  });
  it("one client address flooding unauthenticated requests does not block another address", async () => {
    signedIn(null, null);
    for (let i = 0; i < 600; i++) await downloadReq("203.0.113.66");
    expect((await downloadReq("203.0.113.66")).status).toBe(429);
    expect((await downloadReq("198.51.100.7")).status).toBe(401);
  });
});
