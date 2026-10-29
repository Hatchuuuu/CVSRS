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
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_APP_PORT, prepareE2eStack, provisionE2e } from "./e2e-stack";
import { ROOT, SetupError, localWebEnvironment, requireFreeLoopbackPort } from "./local-stack";
import { warmE2eApp } from "./e2e-warmup";
import { e2ePhases, runE2ePhases, waitForE2ePortRelease } from "./e2e-phases";

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

async function stop(server: ChildProcess) {
  const running = server.exitCode === null && server.signalCode === null && Boolean(server.pid);
  const exited = running ? new Promise<void>(resolve => server.once("exit", () => resolve())) : Promise.resolve();
  if (running) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else server.kill("SIGTERM");
  }
  await waitForE2ePortRelease(exited, () => requireFreeLoopbackPort(E2E_APP_PORT));
}

async function main() {
  await requireFreeLoopbackPort(E2E_APP_PORT);
  // A reused dev cache can omit newly added API routes and return HTML 404s during otherwise valid workflows.
  rmSync(join(ROOT, ".next-e2e"), { recursive: true, force: true });
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
  const cliArgs = process.argv.slice(2);
  const fullSuite = cliArgs.length === 0;
  const files = readdirSync(join(ROOT, "tests/e2e")).filter(name => name.endsWith(".spec.ts")).map(name => `tests/e2e/${name}`);
  const phases = e2ePhases(files, cliArgs);
  const runDir = join(ROOT, "tmp/three-portals", `phases-${new Date().toISOString().replaceAll(":", "-")}`);
  if (fullSuite) mkdirSync(runDir, { recursive: true });
  const summary: { phase: number; files: string[]; exitCode: number; stats: Record<string, number> | null }[] = [];
  const results = await runE2ePhases(phases, async (args, index) => {
    await requireFreeLoopbackPort(E2E_APP_PORT);
    // Only this runner's server is recycled; the isolated database, journey state and secrets survive every phase.
    const server = spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "localhost", "--port", String(E2E_APP_PORT)], {
      cwd: ROOT, env: appEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const log: string[] = [];
    const keep = (data: unknown) => { log.push(String(data)); if (log.length > 2000) log.splice(0, log.length - 2000); };
    server.stdout?.on("data", keep);
    server.stderr?.on("data", keep);
    const phaseDir = join(runDir, `phase-${index + 1}`);
    if (fullSuite) mkdirSync(phaseDir, { recursive: true });
    let code = 1;
    let stats: Record<string, number> | null = null;
    try {
      console.log(`Starting E2E phase ${index + 1}/${phases.length} at ${baseUrl}…`);
      await waitForReady(`${baseUrl}/api/v1/health/ready`, server, 180_000);
      await warmE2eApp(baseUrl, undefined, args);
      // Keep draining server output while Playwright runs; blocking the event loop can stall Next's logging pipes.
      const playwright = spawn(process.execPath, [join(ROOT, "node_modules/@playwright/test/cli.js"), "test", ...args,
        ...(fullSuite ? ["--max-failures=1", "--reporter=list,html,json", `--output=${join(phaseDir, "test-results")}`] : []),
      ], {
        cwd: ROOT, stdio: "inherit", windowsHide: true,
        env: { ...process.env, E2E_BASE_URL: baseUrl, E2E_DB_URL: stack.dbUrl, E2E_INBOX_URL: stack.inboxUrl ?? "", E2E_API_URL: stack.apiUrl, E2E_PUBLISHABLE_KEY: stack.publishableKey,
          ...(fullSuite ? { PLAYWRIGHT_HTML_OPEN: "never", PLAYWRIGHT_HTML_OUTPUT_DIR: join(phaseDir, "html"), PLAYWRIGHT_JSON_OUTPUT_FILE: join(phaseDir, "results.json") } : {}),
        },
      });
      code = await new Promise<number>(resolve => {
        playwright.once("error", () => resolve(1));
        playwright.once("exit", result => resolve(result ?? 1));
      });
      if (fullSuite) {
        try { stats = JSON.parse(readFileSync(join(phaseDir, "results.json"), "utf8")).stats; }
        catch { code = 1; }
      }
      return code;
    } finally {
      let shutdownError: unknown;
      try { await stop(server); } catch (error) { code = 1; shutdownError = error; }
      summary.push({ phase: index + 1, files: args, exitCode: code, stats });
      if (fullSuite) {
        writeFileSync(join(phaseDir, "server.log"), log.join(""));
        writeFileSync(join(runDir, "summary.json"), JSON.stringify({ plannedPhases: phases.length, completedPhases: summary.length, passed: summary.every(phase => phase.exitCode === 0) && summary.length === phases.length,
          totals: { passed: summary.reduce((n, phase) => n + (phase.stats?.expected ?? 0), 0), failed: summary.reduce((n, phase) => n + (phase.stats?.unexpected ?? 0), 0), skipped: summary.reduce((n, phase) => n + (phase.stats?.skipped ?? 0), 0) }, phases: summary,
        }, null, 2));
      }
      if (code !== 0) {
        const tail = log.join("").split("\n").filter(line => /error|warn|fail/i.test(line)).slice(-40).join("\n");
        if (tail) console.log(`\nWeb server messages (errors and warnings, last 40):\n${tail}`);
      }
      if (shutdownError) throw shutdownError;
    }
  });
  if (fullSuite) console.log(`Phase reports and aggregate result: ${runDir}`);
  process.exit(results.length === phases.length && results.every(code => code === 0) ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof SetupError ? e.message : `test:e2e failed: ${e instanceof Error ? `${e.name}: ${e.message}` : "unexpected error"}`);
  process.exit(1);
});
