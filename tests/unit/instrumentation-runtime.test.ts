import { afterEach, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/worker/outbox", () => ({ startOutboxWorker: start }));
import { register } from "../../src/instrumentation";

afterEach(() => { vi.unstubAllEnvs(); start.mockClear(); });

it("starts the local worker in the Node runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  await register();
  expect(start).toHaveBeenCalledOnce();
});

it("does not start a database worker in the Edge runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  await register();
  expect(start).not.toHaveBeenCalled();
});
