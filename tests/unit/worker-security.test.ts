import { afterEach, describe, expect, it, vi } from "vitest";
import { startOutboxWorker, workerDbUrl } from "../../src/lib/worker/outbox";

afterEach(() => vi.unstubAllEnvs());

describe("worker connection", () => {
  it("uses only the dedicated worker login, never a general database URL, in any environment", () => {
    expect(workerDbUrl({ NODE_ENV: "development", CVSRS_LOCAL_DB_URL: "postgresql://postgres@127.0.0.1/x" })).toBeNull();
    expect(workerDbUrl({ NODE_ENV: "development", CVSRS_WORKER_DB_URL: "postgresql://cvsrs_worker_dev@127.0.0.1/x" })).toBe("postgresql://cvsrs_worker_dev@127.0.0.1/x");
  });
});

describe("production worker isolation", () => {
  it("requires a dedicated URL and never starts an in-process poller", () => {
    expect(workerDbUrl({ NODE_ENV: "production", CVSRS_LOCAL_DB_URL: "postgresql://local" })).toBeNull();
    expect(workerDbUrl({ NODE_ENV: "production", CVSRS_WORKER_DB_URL: "postgresql://worker" })).toBe("postgresql://worker");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_WORKER_DB_URL", "postgresql://worker");
    const interval = vi.spyOn(globalThis, "setInterval");
    try {
      startOutboxWorker();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
    }
  });
});
