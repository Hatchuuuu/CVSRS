import { readFileSync } from "node:fs";
import { abortableSleep, runWorkerLoop } from "../src/lib/worker/loop";
import { runOutboxOnce, workerDbUrl } from "../src/lib/worker/outbox";

// Usage: npm run worker            (a pass every 10 s; after a failed pass, retries with a backoff of up to 2 min; stops on SIGINT/SIGTERM)
//        npm run worker -- --once  (one bounded pass, e.g. from a scheduler; exit code 1 when the pass failed)
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local: rely on the environment */
}

const url = workerDbUrl();
if (!url) {
  console.error("Set CVSRS_WORKER_DB_URL to a login that is a member of cvsrs_outbox_worker. (npm run dev already runs the worker for local development.)");
  process.exit(1);
}
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
process.exitCode = await runWorkerLoop({
  once: process.argv.includes("--once"),
  intervalMs: 10_000,
  maxBackoffMs: 120_000,
  run: () => runOutboxOnce(url),
  sleep: abortableSleep,
  log: (line) => console.log(line),
  signal: stop.signal,
});
