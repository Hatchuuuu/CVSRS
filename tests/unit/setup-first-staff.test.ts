import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

function setupWithTimezone(timezone: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/setup-first-staff.ts", "--hosted", "--org", "Test office", "--clinic", "Test clinic", "--admin", "admin@example.test", "--lead", "lead@example.test", "--timezone", timezone], {
    env: { ...process.env, CVSRS_OWNER_DB_URL: "" }, encoding: "utf8", windowsHide: true,
  });
  expect(result.status).toBe(1);
  return result.stderr;
}

it("accepts UTC before requiring the hosted owner's connection", () => {
  expect(setupWithTimezone("UTC")).toContain("--hosted needs CVSRS_OWNER_DB_URL");
});

it("rejects an invalid timezone before trying any connection", () => {
  expect(setupWithTimezone("Invalid/Zone")).toContain("is not an IANA time zone");
});
