import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  INSTALL_FILE,
  MIGRATIONS_DIR,
  VERIFY_FILE,
  buildFreshInstall,
  buildVerify,
  loadMigrations,
  loadRpcAllowlist,
  migrationTables,
  normalizeSql,
  sha256,
} from "../../scripts/build-supabase-install";

const migrations = loadMigrations();
const install = buildFreshInstall(migrations);
const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const temp = mkdtempSync(join(tmpdir(), "cvsrs-install-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("Supabase fresh-install generator", () => {
  it("is deterministic", () => {
    expect(buildFreshInstall(loadMigrations())).toBe(install);
    expect(buildVerify(loadMigrations(), loadRpcAllowlist())).toBe(buildVerify(migrations, loadRpcAllowlist()));
  });

  it("contains every migration exactly once, in version order, with its checksum", () => {
    expect(migrations.map((m) => m.file)).toEqual(onDisk);
    let last = -1;
    for (const m of migrations) {
      const marker = `-- BEGIN ${m.file}  sha256=${m.sha256}`;
      expect(install.split(marker).length - 1).toBe(1);
      const at = install.indexOf(marker);
      expect(at).toBeGreaterThan(last);
      last = at;
      expect(m.sha256).toBe(sha256(normalizeSql(readFileSync(join(MIGRATIONS_DIR, m.file), "utf8"))));
      expect(install).toContain(normalizeSql(readFileSync(join(MIGRATIONS_DIR, m.file), "utf8")).replace(/\n$/, ""));
      expect(install).toContain(`--   ${m.version}  ${m.sha256}  ${m.file}`);
    }
  });

  it("never includes the local bootstrap shim", () => {
    const bootstrap = readFileSync(join(MIGRATIONS_DIR, "..", "bootstrap.sql"), "utf8");
    expect(install).not.toContain("bootstrap for the DISPOSABLE LOCAL test database");
    expect(install).not.toMatch(/create\s+role\s+(anon|authenticated|service_role)\b/i);
    expect(install).not.toMatch(/create\s+(or\s+replace\s+)?function\s+auth\./i);
    expect(install).not.toContain(bootstrap.trim().split("\n").find((l) => l.startsWith("create table if not exists auth.users"))!);
  });

  it("wraps everything in one transaction behind a guard, and records history last", () => {
    const begin = install.indexOf("\nbegin;\n");
    const guard = install.indexOf("do $cvsrs_install_guard$");
    const first = install.indexOf(`-- BEGIN ${migrations[0]!.file}`);
    const lastEnd = install.indexOf(`-- END ${migrations[migrations.length - 1]!.file}`);
    const history = install.indexOf("insert into supabase_migrations.schema_migrations (version, name, statements) values");
    const commit = install.lastIndexOf("\ncommit;\n");
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(guard);
    expect(guard).toBeLessThan(first);
    expect(lastEnd).toBeLessThan(history);
    expect(history).toBeLessThan(commit);
    expect(install.match(/^begin;$/gm)).toHaveLength(1);
    expect(install.match(/^commit;$/gm)).toHaveLength(1);
    expect(install).toContain("select count(*) from supabase_migrations.schema_migrations");
    expect(install).toContain("pg_catalog.to_regnamespace('private') is not null");
    expect(install).toContain("notify pgrst, 'reload schema';");
    for (const t of migrationTables(migrations).filter((x) => x.schema === "public")) expect(install).toContain(`'${t.table}'`);
    for (const m of migrations) expect(install).toContain(`  ('${m.version}', '${m.name}', null)`);
  });

  it("creates the extensions the migrations call but never create", () => {
    const all = migrations.map((m) => m.sql).join("\n");
    expect(all).toMatch(/extensions\.similarity|extensions\.gin_trgm_ops/);
    // 0000_extensions.sql (SUP-01) makes the migrations self-contained; the installer's own block stays as a harmless guard.
    for (const e of ["pgcrypto", "pg_trgm", "unaccent"]) expect(migrations[0]!.sql).toContain(`create extension if not exists ${e} with schema extensions;`);
    for (const e of ["pgcrypto", "pg_trgm", "unaccent"]) expect(install).toContain(`create extension if not exists ${e} with schema extensions;`);
  });

  it("rejects unexpected file names and duplicate versions instead of skipping them", () => {
    writeFileSync(join(temp, "0001_a.sql"), "select 1;\n");
    writeFileSync(join(temp, "0001_b.sql"), "select 2;\n");
    expect(() => loadMigrations(temp)).toThrow("duplicate migration version 0001");
    rmSync(join(temp, "0001_b.sql"));
    writeFileSync(join(temp, "bootstrap.sql"), "select 3;\n");
    expect(() => loadMigrations(temp)).toThrow("unexpected migration file name");
  });

  it("normalises line endings so checksums are platform independent", () => {
    expect(normalizeSql("﻿a\r\nb")).toBe("a\nb\n");
    expect(sha256(normalizeSql("x\r\n"))).toBe(sha256("x\n"));
  });

  it("the committed fresh-install.sql and verify.sql are up to date", () => {
    expect(normalizeSql(readFileSync(INSTALL_FILE, "utf8"))).toBe(install);
    expect(normalizeSql(readFileSync(VERIFY_FILE, "utf8"))).toBe(buildVerify(migrations, loadRpcAllowlist()));
  });
});
