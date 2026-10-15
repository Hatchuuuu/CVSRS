import { afterAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { assertProjectCluster, disposableTestName } from "../../scripts/db";

const cluster = mkdtempSync(resolve(tmpdir(), "cvsrs-cluster-guard-"));
afterAll(() => rmdirSync(cluster));

describe("disposable database identity", () => {
  it("never lets test configuration select the development or restore database", () => {
    expect(() => disposableTestName("cvsrs_dev")).toThrow("refusing");
    expect(() => disposableTestName("cvsrs_drill_restore")).toThrow("refusing");
    expect(disposableTestName("cvsrs_test")).toBe("cvsrs_test");
    expect(disposableTestName("cvsrs_audit_runtime")).toBe("cvsrs_audit_runtime");
  });
  it("rejects a different connected cluster even when this checkout has a local marker", async () => {
    const client = { query: async () => ({ rows: [{ data_directory: resolve(".") }] }) };
    await expect(assertProjectCluster(client, cluster)).rejects.toThrow("refusing");
  });
  it("rejects a server directory that cannot be resolved", async () => {
    const client = { query: async () => ({ rows: [{ data_directory: resolve(".local/not-a-cluster") }] }) };
    await expect(assertProjectCluster(client, cluster)).rejects.toThrow("refusing");
  });
  it("accepts the actual project cluster directory", async () => {
    const client = { query: async () => ({ rows: [{ data_directory: cluster }] }) };
    await expect(assertProjectCluster(client, cluster)).resolves.toBeUndefined();
  });
});
