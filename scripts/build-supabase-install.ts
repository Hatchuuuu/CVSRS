/**
 * Supabase install packager.
 *
 *   npm run db:install-sql               -> writes supabase/install/fresh-install.sql and supabase/install/verify.sql
 *   npm run db:install-sql -- --check    -> exits non-zero when either committed file differs from what would be generated
 *
 * fresh-install.sql is ONLY for a brand-new, empty Supabase project. It concatenates supabase/migrations/NNNN_name.sql in
 * version order inside one transaction, behind a guard that refuses a second run or a database that already holds CVSRS
 * objects, and records every applied version in supabase_migrations.schema_migrations (the Supabase CLI history table) so a
 * later `supabase migration list` / `db push` can reconcile. supabase/bootstrap.sql is never included: it is the local
 * stand-in for roles and the auth schema that a real Supabase project already provides.
 *
 * Checksums are SHA-256 of each migration with CRLF normalised to LF and a UTF-8 BOM removed (the form git stores, because
 * .gitattributes sets eol=lf), so Windows and Linux checkouts produce byte-identical output.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const INSTALL_FILE = join(ROOT, "supabase", "install", "fresh-install.sql");
export const VERIFY_FILE = join(ROOT, "supabase", "install", "verify.sql");
/** The application's RPC allowlist: the exact set of public functions the web app calls through PostgREST. */
export const RPC_PORT_FILE = join(ROOT, "src", "lib", "db", "port.ts");

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const TABLE = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(public|private)\.([a-z_][a-z0-9_]*)\s*\(/gim;

/** Functions anon may execute. Derived from the migrations' explicit `grant execute ... to anon` (0004, 0013, 0017). */
export const ANON_EXECUTE_ALLOWLIST = ["list_public_clinics", "public_queue_display", "verify_certificate"] as const;
/** Relations anon may SELECT (0001): reference geography and the curated public clinic view. Nothing else, no writes. */
export const ANON_SELECT_ALLOWLIST = ["barangays", "public_clinics"] as const;
/** Private helpers granted to authenticated for RLS policy evaluation (0001, 0003 and repeated re-grants). */
export const AUTHENTICATED_PRIVATE_EXECUTE_ALLOWLIST = ["clinics_with", "guardian_can_read_child", "has_capability", "my_guardian_ids", "session_ok"] as const;
/** Least-privilege runtime groups created by 0028 and the private functions each may execute. */
export const RUNTIME_ROLES: Record<string, string[]> = {
  cvsrs_outbox_worker: ["claim_sms", "mark_sms", "process_outbox"],
  cvsrs_sms_webhook: ["record_sms_event"],
};
/** Extensions the migrations call schema-qualified as extensions.* but never create. */
export const REQUIRED_EXTENSIONS = ["pg_trgm", "pgcrypto", "unaccent"] as const;

export interface Migration {
  file: string;
  version: string;
  name: string;
  sql: string;
  sha256: string;
}

export function normalizeSql(text: string): string {
  const lf = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  return lf.endsWith("\n") ? lf : `${lf}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Every .sql file in the migrations directory, version-ordered. Anything not named NNNN_name.sql is an error, not skipped. */
export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);
  const seen = new Set<string>();
  return files.map((file) => {
    const m = MIGRATION_FILE.exec(file);
    if (!m) throw new Error(`unexpected migration file name: ${file} (expected NNNN_snake_name.sql)`);
    const [, version, name] = m as unknown as [string, string, string];
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`);
    seen.add(version);
    const sql = normalizeSql(readFileSync(join(dir, file), "utf8"));
    return { file, version, name, sql, sha256: sha256(sql) };
  });
}

/** Tables created by the migrations, as schema-qualified names, sorted. */
export function migrationTables(migrations: readonly Migration[]): { schema: string; table: string }[] {
  const found = new Map<string, { schema: string; table: string }>();
  for (const m of migrations) for (const t of m.sql.matchAll(TABLE)) found.set(`${t[1]}.${t[2]}`, { schema: t[1]!, table: t[2]! });
  return [...found.keys()].sort().map((k) => found.get(k)!);
}

/** Names in `export const RPC_ALLOWLIST = [...]`, sorted. Throws when the list cannot be found. */
export function loadRpcAllowlist(file = RPC_PORT_FILE): string[] {
  const body = /export const RPC_ALLOWLIST\s*=\s*\[([\s\S]*?)\]/.exec(readFileSync(file, "utf8"))?.[1];
  if (!body) throw new Error(`RPC_ALLOWLIST not found in ${file}`);
  return [...new Set([...body.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]!))].sort();
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const textArray = (items: readonly string[]) => `array[${items.map(quote).join(", ")}]::text[]`;
const rule = (c = "-") => `-- ${c.repeat(117)}`;

export function buildFreshInstall(migrations: readonly Migration[]): string {
  const publicTables = migrationTables(migrations).filter((t) => t.schema === "public").map((t) => t.table);
  const last = migrations[migrations.length - 1]!;
  const out: string[] = [];
  out.push(
    rule("="),
    "-- CVSRS fresh install for a BRAND-NEW, EMPTY Supabase project.",
    "-- GENERATED by scripts/build-supabase-install.ts. Do not edit by hand: run `npm run db:install-sql` after changing a",
    "-- migration; `npm run db:install-sql -- --check` fails when this file is stale.",
    "--",
    "-- Target       : a new Supabase project whose database has never had CVSRS (or any other app schema) applied.",
    "-- NOT SAFE FOR : an existing database, a restored backup, or a project that already ran some migrations. For those,",
    "--                apply only the missing supabase/migrations files in order (see supabase/install/README.md).",
    "-- Never include: supabase/bootstrap.sql. That file fakes Supabase roles and auth.* for local PostgreSQL only.",
    "-- Rerun        : refused. The guard below raises before any change when supabase_migrations.schema_migrations has rows,",
    "--                when schema `private` exists, or when public already holds a CVSRS table. Everything runs in ONE",
    "--                transaction: any error rolls back the whole install, leaving the project as it was.",
    "-- Prerequisites: the Supabase-provided roles anon/authenticated/service_role, auth.users, auth.uid(), auth.jwt() and the",
    "--                `extensions` schema. The extensions pgcrypto, pg_trgm and unaccent are created in `extensions` below",
    "--                (equivalent to enabling them in Dashboard > Database > Extensions with schema `extensions`).",
    "-- History      : rows are written to supabase_migrations.schema_migrations(version, name, statements) with",
    "--                version = the 4-digit file prefix and name = the rest of the file name; statements is left NULL.",
    "-- After running: run supabase/install/verify.sql (every row must be PASS or INFO).",
    "--",
    `-- Migrations (${migrations.length}, ${migrations[0]!.version}..${last.version}); sha256 of the LF-normalised file:`,
    ...migrations.map((m) => `--   ${m.version}  ${m.sha256}  ${m.file}`),
    rule("="),
    "",
    "begin;",
    "",
    "-- Match the local test harness (psql default) regardless of the SQL Editor's session search_path; the editor may also",
    "-- impose a statement timeout that a full install can exceed.",
    `set local search_path = "$user", public;`,
    "set local statement_timeout = 0;",
    "",
    rule(),
    "-- Guard: refuse anything that is not a brand-new Supabase project. Raises before any change.",
    rule(),
    "do $cvsrs_install_guard$",
    "declare",
    "  v_rows bigint;",
    "  v_found text[];",
    "begin",
    "  if (select count(*) from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3",
    "     or pg_catalog.to_regclass('auth.users') is null",
    "     or pg_catalog.to_regprocedure('auth.uid()') is null",
    "     or pg_catalog.to_regprocedure('auth.jwt()') is null",
    "     or pg_catalog.to_regnamespace('extensions') is null then",
    "    raise exception 'CVSRS install refused: Supabase roles/auth schema/extensions schema not found. This script targets a Supabase project (local PostgreSQL needs supabase/bootstrap.sql first).';",
    "  end if;",
    "  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then",
    "    execute 'select count(*) from supabase_migrations.schema_migrations' into v_rows;",
    "    if v_rows > 0 then",
    "      raise exception 'CVSRS install refused: supabase_migrations.schema_migrations already has % row(s). fresh-install.sql is for a brand-new empty project only; to upgrade, apply only the missing migration files (supabase/install/README.md).', v_rows;",
    "    end if;",
    "  end if;",
    "  if pg_catalog.to_regnamespace('private') is not null then",
    "    raise exception 'CVSRS install refused: schema \"private\" already exists. Use a brand-new project or the upgrade procedure.';",
    "  end if;",
    "  select pg_catalog.array_agg(t order by t) into v_found",
    `    from pg_catalog.unnest(${textArray(publicTables)}) t`,
    "   where pg_catalog.to_regclass(pg_catalog.format('public.%I', t)) is not null;",
    "  if v_found is not null then",
    "    raise exception 'CVSRS install refused: public already contains table(s) that CVSRS creates: %', pg_catalog.array_to_string(v_found, ', ');",
    "  end if;",
    "end",
    "$cvsrs_install_guard$;",
    "",
    rule(),
    "-- Extension prerequisites. Migrations call extensions.unaccent, extensions.similarity, extensions.gin_trgm_ops,",
    "-- extensions.gen_random_bytes and extensions.hmac but never create the extensions. A copy installed in another schema",
    "-- (e.g. public) would leave those names unresolved, so the check below refuses it.",
    rule(),
    ...REQUIRED_EXTENSIONS.map((e) => `create extension if not exists ${e} with schema extensions;`),
    "do $cvsrs_extension_check$",
    "declare v_bad text;",
    "begin",
    "  select pg_catalog.string_agg(e.extname || ' in ' || n.nspname, ', ') into v_bad",
    "    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace",
    `   where e.extname = any (${textArray(REQUIRED_EXTENSIONS)}) and n.nspname <> 'extensions';`,
    "  if v_bad is not null then",
    "    raise exception 'CVSRS install refused: extension(s) installed outside schema extensions: %. Move them (alter extension ... set schema extensions) first.', v_bad;",
    "  end if;",
    "end",
    "$cvsrs_extension_check$;",
    "",
  );
  for (const m of migrations) {
    out.push(rule("="), `-- BEGIN ${m.file}  sha256=${m.sha256}`, rule("="), m.sql.replace(/\n$/, ""), `-- END ${m.file}`, "");
  }
  out.push(
    rule("="),
    "-- Migration history (Supabase CLI table). Recorded in the same transaction as the schema.",
    rule("="),
    "create schema if not exists supabase_migrations;",
    "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);",
    "insert into supabase_migrations.schema_migrations (version, name, statements) values",
    migrations.map((m) => `  (${quote(m.version)}, ${quote(m.name)}, null)`).join(",\n") + ";",
    "",
    "-- Ask PostgREST to reload its schema cache (delivered at commit).",
    "notify pgrst, 'reload schema';",
    "",
    "commit;",
    "",
  );
  return out.join("\n");
}

export function buildVerify(migrations: readonly Migration[], rpcAllowlist: readonly string[]): string {
  const tables = migrationTables(migrations).map((t) => `${t.schema}.${t.table}`);
  const versions = migrations.map((m) => m.version);
  const roleRows = Object.entries(RUNTIME_ROLES).flatMap(([role, fns]) => fns.map((fn) => `(${quote(role)}, ${quote(fn)})`));
  return [
    rule("="),
    "-- CVSRS post-install verification. READ-ONLY: a single SELECT, so the Supabase SQL Editor shows every row.",
    "-- GENERATED by scripts/build-supabase-install.ts together with fresh-install.sql; do not edit by hand.",
    "-- Success: every row has status PASS or INFO. Any FAIL row lists the offending objects in `detail`.",
    `-- Expects ${migrations.length} migrations (${versions[0]}..${versions[versions.length - 1]}), ${tables.length} tables and ${rpcAllowlist.length} RPCs.`,
    rule("="),
    "with",
    `expected_tables(name) as (select pg_catalog.unnest(${textArray(tables)})),`,
    `expected_versions(version) as (select pg_catalog.unnest(${textArray(versions)})),`,
    "public_rel as (",
    "  select c.oid, c.relname, c.relkind, c.relrowsecurity from pg_catalog.pg_class c",
    "  join pg_catalog.pg_namespace n on n.oid = c.relnamespace",
    "  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')",
    "    and not exists (select 1 from pg_catalog.pg_depend d where d.objid = c.oid and d.deptype = 'e')",
    "),",
    "private_rel as (",
    "  select c.oid, c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace",
    "  where n.nspname = 'private' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')",
    "),",
    "fn as (",
    "  select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig, p.proacl, p.proowner,",
    "         pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as sig",
    "  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace",
    "  where n.nspname in ('public', 'private')",
    "    and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')",
    "),",
    `allowed(names) as (select ${textArray(rpcAllowlist)}),`,
    "history as (",
    "  select version from supabase_migrations.schema_migrations",
    "),",
    "checks(ord, check_name, offenders, info) as (",
    "  select 1, 'expected tables exist',",
    "    (select pg_catalog.array_agg(name order by name) from expected_tables where pg_catalog.to_regclass(name) is null), null::text",
    "  union all select 2, 'RLS enabled on every public table',",
    "    (select pg_catalog.array_agg(relname order by relname) from public_rel where relkind in ('r', 'p') and not relrowsecurity), null",
    "  union all select 3, 'anon: no table/view privilege beyond SELECT on the allowlist',",
    "    (select pg_catalog.array_agg(relname order by relname) from public_rel",
    "      where pg_catalog.has_table_privilege('anon', oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')",
    "         or pg_catalog.has_any_column_privilege('anon', oid, 'INSERT, UPDATE, REFERENCES')",
    `         or (pg_catalog.has_table_privilege('anon', oid, 'SELECT') and relname <> all (${textArray(ANON_SELECT_ALLOWLIST)}))), null`,
    "  union all select 4, 'authenticated: no table-wide write privilege on public relations',",
    "    (select pg_catalog.array_agg(relname order by relname) from public_rel",
    "      where pg_catalog.has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE, TRUNCATE')), null",
    "  union all select 5, 'authenticated: column UPDATE only on profiles(display_name, locale)',",
    "    (select pg_catalog.array_agg(r.relname || '.' || a.attname order by r.relname, a.attname)",
    "       from public_rel r join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped",
    "      where pg_catalog.has_column_privilege('authenticated', r.oid, a.attnum, 'INSERT, UPDATE')",
    "        and not (r.relname = 'profiles' and a.attname in ('display_name', 'locale'))), null",
    "  union all select 6, 'schema private: no USAGE for anon or PUBLIC',",
    "    (select pg_catalog.array_agg(g order by g) from pg_catalog.unnest(array['anon', 'public']) g",
    "      where pg_catalog.has_schema_privilege(g, 'private', 'USAGE')), null",
    "  union all select 7, 'private relations: no privilege for anon/authenticated/service_role',",
    "    (select pg_catalog.array_agg(distinct relname) from private_rel, pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) g",
    "      where pg_catalog.has_table_privilege(g, oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')), null",
    "  union all select 8, 'every SECURITY DEFINER function in public/private pins search_path to empty',",
    "    (select pg_catalog.array_agg(sig order by sig) from fn",
    "      where prosecdef and not ('search_path=\"\"' = any (coalesce(proconfig, '{}'::text[])))), null",
    "  union all select 9, 'anon: EXECUTE only on the public allowlist',",
    "    (select pg_catalog.array_agg(sig order by sig) from fn",
    "      where pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')",
    `        and not (nspname = 'public' and proname = any (${textArray(ANON_EXECUTE_ALLOWLIST)}))), null`,
    "  union all select 10, 'no function in public/private is executable by PUBLIC',",
    "    (select pg_catalog.array_agg(sig order by sig) from fn",
    "      where exists (select 1 from pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) a",
    "                    where a.grantee = 0 and a.privilege_type = 'EXECUTE')), null",
    "  union all select 11, 'authenticated: EXECUTE on private only for RLS helpers',",
    "    (select pg_catalog.array_agg(sig order by sig) from fn",
    "      where nspname = 'private' and pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')",
    `        and proname <> all (${textArray(AUTHENTICATED_PRIVATE_EXECUTE_ALLOWLIST)})), null`,
    "  union all select 12, 'runtime roles from 0028 exist, cannot log in or bypass RLS, hold their grants',",
    "    (select pg_catalog.array_agg(problem order by problem) from (",
    `       select e.role || ': missing or unsafe' as problem from (values ${roleRows.join(", ")}) e(role, fn)`,
    "        left join pg_catalog.pg_roles r on r.rolname = e.role",
    "        where r.oid is null or r.rolcanlogin or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb",
    "       union",
    "       select e.role || ' lacks EXECUTE on private.' || e.fn",
    `         from (values ${roleRows.join(", ")}) e(role, fn)`,
    "        where exists (select 1 from pg_catalog.pg_roles where rolname = e.role)",
    "          and not exists (select 1 from fn where fn.nspname = 'private' and fn.proname = e.fn",
    "                          and pg_catalog.has_function_privilege(e.role, fn.oid, 'EXECUTE'))",
    "     ) x), null",
    "  union all select 13, 'runtime roles have no table privileges in public/private',",
    "    (select pg_catalog.array_agg(distinct g || ' on ' || relname) from (select oid, relname from public_rel union all select oid, relname from private_rel) r,",
    `       pg_catalog.unnest(${textArray(Object.keys(RUNTIME_ROLES))}) g`,
    "      where exists (select 1 from pg_catalog.pg_roles where rolname = g)",
    "        and pg_catalog.has_table_privilege(g, r.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')), null",
    "  union all select 14, 'required extensions installed in schema extensions',",
    "    (select pg_catalog.array_agg(x order by x) from pg_catalog.unnest(" + textArray(REQUIRED_EXTENSIONS) + ") x",
    "      where not exists (select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace",
    "                        where e.extname = x and n.nspname = 'extensions')), null",
    "  union all select 15, 'profile trigger on auth.users present',",
    "    (select array['on_auth_user_created'] where not exists (select 1 from pg_catalog.pg_trigger",
    "      where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass and not tgisinternal)), null",
    "  union all select 16, 'deployment switches: demo_mode false, require_staff_mfa true',",
    "    (select pg_catalog.array_agg(key || '=' || value::text order by key) from private.settings",
    "      where (key = 'demo_mode' and value <> 'false'::jsonb) or (key = 'require_staff_mfa' and value <> 'true'::jsonb)), null",
    "  union all select 17, 'migration history matches the migration files',",
    "    (select pg_catalog.array_agg(problem order by problem) from (",
    "       select 'missing ' || version as problem from expected_versions where version not in (select version from history)",
    "       union all select 'unexpected ' || version from history where version not in (select version from expected_versions)",
    "     ) x), null",
    "  union all select 18, 'authenticated: public EXECUTE set equals the app RPC allowlist (src/lib/db/port.ts)',",
    "    (select pg_catalog.array_agg(problem order by problem) from (",
    "       select distinct 'not in app allowlist: ' || proname as problem from fn",
    "        where nspname = 'public' and pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE') and proname <> all (allowed.names)",
    "       union all",
    "       select 'not executable: ' || a from pg_catalog.unnest(allowed.names) a",
    "        where not exists (select 1 from fn where nspname = 'public' and proname = a and pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'))",
    "     ) x), null",
    "  from allowed",
    "  union all select 19, 'certificate render secret provisioned (operator step, see README)', null,",
    "    case when exists (select 1 from private.certificate_render_secrets) then 'provisioned'",
    "         else 'not yet provisioned: certificate issuance fails closed until it is' end",
    "  union all select 20, 'organizations and staff grants (operator step)', null,",
    "    (select pg_catalog.format('%s organization(s), %s clinic(s), %s active staff membership(s)',",
    "       (select count(*) from public.organizations), (select count(*) from public.clinics),",
    "       (select count(*) from public.staff_memberships where status = 'active')))",
    ")",
    "select ord, check_name,",
    "       case when info is not null then 'INFO' when offenders is null then 'PASS' else 'FAIL' end as status,",
    "       coalesce(info, pg_catalog.array_to_string(offenders, ', ')) as detail",
    "  from checks order by ord;",
    "",
  ].join("\n");
}

function main(argv: string[]) {
  const migrations = loadMigrations();
  const outputs: [string, string][] = [
    [INSTALL_FILE, buildFreshInstall(migrations)],
    [VERIFY_FILE, buildVerify(migrations, loadRpcAllowlist())],
  ];
  if (argv.includes("--check")) {
    const stale = outputs.filter(([file, text]) => !existsSync(file) || normalizeSql(readFileSync(file, "utf8")) !== text);
    for (const [file] of stale) console.error(`stale: ${file} (run npm run db:install-sql)`);
    if (stale.length) process.exit(1);
    console.log(`supabase/install is up to date (${migrations.length} migrations)`);
    return;
  }
  for (const [file, text] of outputs) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  console.log(`wrote supabase/install/fresh-install.sql and verify.sql (${migrations.length} migrations, ${migrations[0]!.version}..${migrations[migrations.length - 1]!.version})`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/build-supabase-install.ts")) main(process.argv.slice(2));
