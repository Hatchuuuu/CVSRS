import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
mkdirSync(join(root, ".local"), { recursive: true });
const temp = mkdtempSync(join(root, ".local", "matrix-check-"));
const artifact = join(temp, "requirements-matrix.md");
const script = join(temp, "matrix.ts");
// Exercise the real CLI with a disposable output, preserving its real test-evidence root.
writeFileSync(script, readFileSync(join(root, "scripts/matrix.ts"), "utf8")
  .replace('resolve(import.meta.dirname, "..")', `resolve(${JSON.stringify(root)})`)
  .replaceAll('"docs/implementation/requirements-matrix.md"', JSON.stringify(artifact)));
const current = readFileSync(join(root, "docs/implementation/requirements-matrix.md"), "utf8").replaceAll("\r\n", "\n");
const check = () => spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), script, "--check"], { cwd: root, encoding: "utf8", windowsHide: true });
beforeEach(() => writeFileSync(artifact, current));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

it("accepts the current generated matrix without writing it", () => {
  const result = check();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("matrix ok:");
  expect(readFileSync(artifact, "utf8")).toBe(current);
});

it("accepts CRLF checkout line endings without rewriting them", () => {
  const crlf = current.replaceAll("\n", "\r\n");
  writeFileSync(artifact, crlf);
  const result = check();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(artifact, "utf8")).toBe(crlf);
});

it("rejects stale generated Markdown and leaves it unchanged", () => {
  const stale = current + "drift\n";
  writeFileSync(artifact, stale);
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("run npm run matrix");
  expect(readFileSync(artifact, "utf8")).toBe(stale);
});

it("rejects a missing generated matrix without creating it", () => {
  rmSync(artifact);
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("run npm run matrix");
  expect(existsSync(artifact)).toBe(false);
});
