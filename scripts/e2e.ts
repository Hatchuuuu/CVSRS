/**
 * npm run test:e2e [-- <playwright args>] — browser tests against real Supabase Auth, PostgREST and PostgreSQL.
 *
 * 1. prepares the isolated end-to-end stack (scripts/e2e-stack.ts) and resets its database to the migrations;
 * 2. provisions a throwaway certificate secret and worker login;
 * 3. starts `next dev` on http://localhost:3100 with its own build folder (.next-e2e), so a running `npm run dev` is untouched;
 * 4. runs Playwright (tests/e2e), then stops the server. The stack keeps running for the next run (`npx supabase stop --workdir .local/e2e`).
 * Development data is never touched; every account the tests create is synthetic and lives only in the end-to-end database.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { E2E_APP_PORT, prepareE2eStack, provisionE2e } from "./e2e-stack";
import { ROOT, SetupError, localWebEnvironment } from "./local-stack";

async function waitForReady(url: string, server: ChildProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new SetupError("The end-to-end web server exited during startup.");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new SetupError(`The end-to-end web server was not ready within ${timeoutMs / 1000} s (${url}).`);
}

function stop(server: ChildProcess) {
  if (server.exitCode !== null || !server.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  else server.kill("SIGTERM");
}

/** A server left over from a crashed run would answer the readiness probe with stale secrets; refuse instead. */
async function requireFreePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new SetupError(`Port ${port} is already in use (a previous end-to-end server?). Stop that process and run again.`)));
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

async function main() {
  await requireFreePort(E2E_APP_PORT);
  const stack = await prepareE2eStack();
  // Journey state (ids, TOTP secrets) describes the database that was just reset; start every run from nothing.
  rmSync(join(ROOT, ".local", "e2e", "state.json"), { force: true });
  const certificateSecret = randomBytes(32).toString("hex");
  const { workerDbUrl } = await provisionE2e(stack, certificateSecret, randomBytes(24).toString("hex"));
  const baseUrl = `http://localhost:${E2E_APP_PORT}`;

  const appEnv: NodeJS.ProcessEnv = {
    ...localWebEnvironment(),
    NODE_ENV: "development",
    CVSRS_DIST_DIR: ".next-e2e",
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    CVSRS_CERTIFICATE_RENDER_SECRET: certificateSecret,
    CVSRS_WORKER_DB_URL: workerDbUrl,
    SMS_PROVIDER: "none",
  };
  const server = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "localhost", "--port", String(E2E_APP_PORT)], {
    cwd: ROOT, env: appEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  // Server output is kept for diagnosis but not interleaved with the test report.
  // Only the recent tail is kept (for the failure summary below); the pipes are drained for the whole run.
  const log: string[] = [];
  const keep = (d: unknown) => {
    log.push(String(d));
    if (log.length > 2000) log.splice(0, log.length - 2000);
  };
  server.stdout?.on("data", keep);
  server.stderr?.on("data", keep);
  let code = 1;
  try {
    console.log(`Starting the app at ${baseUrl} (first compile can take a minute)…`);
    await waitForReady(`${baseUrl}/api/v1/health/ready`, server, 180_000);
    // Asynchronous on purpose: this process must keep draining the web server's stdout/stderr pipes while the tests run. With
    // spawnSync the event loop stopped, the pipe buffers filled after ~8 minutes of server output, and `next dev` then blocked on its
    // next log write, so every request hung (I4-19).
    const playwright = spawn(process.execPath, [join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, E2E_BASE_URL: baseUrl, E2E_DB_URL: stack.dbUrl, E2E_INBOX_URL: stack.inboxUrl ?? "", E2E_API_URL: stack.apiUrl, E2E_PUBLISHABLE_KEY: stack.publishableKey },
    });
    code = await new Promise<number>((resolve) => {
      playwright.once("error", () => resolve(1));
      playwright.once("exit", (c) => resolve(c ?? 1));
    });
  } finally {
    stop(server);
    if (code !== 0) {
      const tail = log.join("").split("\n").filter((l) => /error|warn|fail/i.test(l)).slice(-40).join("\n");
      if (tail) console.log(`\nWeb server messages (errors and warnings, last 40):\n${tail}`);
    }
  }
  process.exit(code);
}

main().catch((e: unknown) => {
  console.error(e instanceof SetupError ? e.message : `test:e2e failed: ${e instanceof Error ? `${e.name}: ${e.message}` : "unexpected error"}`);
  process.exit(1);
});
