import { expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: stub.spawn }));
import { supabaseCli } from "../../scripts/local-stack";

it("redacts printed CLI credentials but preserves captured settings for the status parser", () => {
  const raw = 'Applying migration\n{"SECRET_KEY":"private-test-value"}\n';
  stub.spawn.mockReturnValue({ status: 0, stdout: raw, stderr: "" });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    expect(supabaseCli(["status"], true)).toMatchObject({ ok: true, stdout: raw });
    expect(stdout).toHaveBeenCalledWith("Applying migration\n");
    expect(stderr).toHaveBeenCalledWith("");
  } finally { stdout.mockRestore(); stderr.mockRestore(); }
});

it("reports a captured CLI process failure without exposing its error's credentials", () => {
  stub.spawn.mockReturnValue({ status: null, stdout: "", stderr: "", error: new Error("private-test-value") });
  expect(() => supabaseCli(["start"])).toThrow("The Supabase CLI could not complete");
});

it("can capture setup diagnostics larger than Node's default one-MiB limit", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  stub.spawn.mockImplementation((_command, _args, options) => actual.spawnSync(process.execPath, ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"], options));
  const result = supabaseCli(["status"]);
  expect(result.ok).toBe(true);
  expect(result.stdout.length).toBe(2 * 1024 * 1024);
});
