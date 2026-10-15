import type { WorkerResult } from "./outbox";

/**
 * The `npm run worker` loop. A failed pass (database unreachable, a timeout) is logged and retried with a capped backoff instead of
 * ending the process, so a short outage does not silently stop message delivery. `--once` reports a failed pass through its exit code
 * so a scheduler marks the run failed. Every line is one JSON event (`worker_pass` / `worker_pass_failed`) for log-based alerts; error
 * messages are not logged because driver messages can name hosts and users.
 */
export interface WorkerLoopOptions {
  once: boolean;
  intervalMs: number;
  maxBackoffMs: number;
  run: () => Promise<WorkerResult>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  log: (line: string) => void;
  /** Aborted on SIGINT/SIGTERM: the loop finishes the pass in progress and starts no other. */
  signal: AbortSignal;
}

export async function runWorkerLoop(o: WorkerLoopOptions): Promise<number> {
  let failures = 0;
  for (;;) {
    try {
      const result = await o.run();
      failures = 0;
      o.log(JSON.stringify({ event: "worker_pass", ...result }));
      if (o.once) return 0;
    } catch (e) {
      failures += 1;
      const err = (e ?? {}) as { code?: unknown; name?: unknown };
      o.log(JSON.stringify({ event: "worker_pass_failed", code: String(err.code ?? err.name ?? "error"), consecutiveFailures: failures }));
      if (o.once) return 1;
    }
    if (o.signal.aborted) return 0;
    const wait = failures === 0 ? o.intervalMs : Math.min(o.intervalMs * 2 ** (failures - 1), o.maxBackoffMs);
    await o.sleep(wait, o.signal);
    if (o.signal.aborted) return 0;
  }
}

/** A sleep that ends early when the signal is aborted. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
