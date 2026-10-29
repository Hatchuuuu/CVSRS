import { afterEach, expect, it, vi } from "vitest";
import { e2ePhases, runE2ePhases, waitForE2ePortRelease } from "../../scripts/e2e-phases";
it("sorts full-suite files into phases of at most six without omitting or duplicating a file", () => {
  const files = Array.from({ length: 14 }, (_, i) => `${String(i).padStart(2, "0")}.spec.ts`).reverse();
  const phases = e2ePhases(files, []);
  expect(phases.map(p => p.length)).toEqual([6, 6, 2]);
  expect(phases.flat()).toEqual([...files].sort());
});
it("preserves explicit CLI arguments as one phase", () => {
  const args = ["tests/e2e/07-records.spec.ts", "--grep", "correction"];
  expect(e2ePhases(["01.spec.ts"], args)).toEqual([args]);
});
it("stops before dependent phases when an earlier phase fails", async () => {
  const run = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  expect(await runE2ePhases([["a"], ["b"], ["c"]], run)).toEqual([0, 1]);
  expect(run).toHaveBeenCalledTimes(2);
});


afterEach(() => vi.useRealTimers());
it("waits for the owned child exit before retrying a transient port-release failure", async () => {
  vi.useFakeTimers();
  let exited!: () => void;
  const exit = new Promise<void>(resolve => { exited = resolve; });
  const probe = vi.fn().mockRejectedValueOnce(new Error("still releasing")).mockResolvedValue(undefined);
  const waiting = waitForE2ePortRelease(exit, probe, 1000);
  expect(probe).not.toHaveBeenCalled();
  exited();
  await vi.advanceTimersByTimeAsync(0);
  expect(probe).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  await expect(waiting).resolves.toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(2);
});
it("fails within the shutdown deadline if another listener keeps the port", async () => {
  vi.useFakeTimers();
  const waiting = waitForE2ePortRelease(Promise.resolve(), vi.fn().mockRejectedValue(new Error("occupied")), 500);
  const assertion = expect(waiting).rejects.toThrow("did not release");
  await vi.advanceTimersByTimeAsync(500);
  await assertion;
});
it("bounds waiting for a child that never exits", async () => {
  vi.useFakeTimers();
  const probe = vi.fn();
  const waiting = waitForE2ePortRelease(new Promise<void>(() => {}), probe, 500);
  const assertion = expect(waiting).rejects.toThrow("did not release");
  await vi.advanceTimersByTimeAsync(500);
  await assertion;
  expect(probe).not.toHaveBeenCalled();
});
