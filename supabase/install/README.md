# Supabase install package

Evidence labels used below: **[static]** reviewed from source only · **[local]** executed on the project-local PostgreSQL 18.2 cluster with `supabase/bootstrap.sql` standing in for Supabase (not Supabase) · **[live]** awaiting a real Supabase project; never executed there.

| File | Purpose |
|---|---|
| `fresh-install.sql` | GENERATED. Every `supabase/migrations/NNNN_*.sql` in order, in one transaction, behind a refuse-to-rerun guard, plus extension prerequisites and migration-history rows. **Brand-new empty project only.** |
| `verify.sql` | GENERATED. One read-only `SELECT` returning one row per check (`PASS` / `FAIL` / `INFO`). Run after any install or upgrade. |
| `README.md` | This file. The full operator procedure (Auth settings, secrets, first staff, smoke tests) is in `docs/engineering/manual-setup.md`. |

Regenerate after any migration change: `npm run db:install-sql`. Consistency gate (CI/pre-commit): `npm run db:install-sql -- --check` exits 1 when either generated file is stale. `tests/unit/supabase-install.test.ts` asserts the same.

**Never apply `supabase/bootstrap.sql` to Supabase.** It fakes `anon`/`authenticated`/`service_role`, `auth.users` and `auth.uid()` for local PostgreSQL only.

## A. Fresh install (new, empty project)

1. Take note: the project must be new. If anything was applied before (any CVSRS table, a `private` schema, or rows in `supabase_migrations.schema_migrations`), the guard refuses and nothing changes; use section B instead.
2. Dashboard → **SQL Editor** → new query → paste the whole of `fresh-install.sql` → Run. [live]
   - It creates `pgcrypto`, `pg_trgm` and `unaccent` in schema `extensions` itself (same as Dashboard → Database → Extensions with schema `extensions`). If one of them was already enabled in another schema (for example `public`), the script refuses; move it first: `alter extension pg_trgm set schema extensions;`.
   - The file is about 650 KB. The SQL Editor's maximum query size and timeout are **unknown** [live]. If the editor rejects or times out, either (a) run it with psql over the direct connection: `psql "<direct connection string>" -v ON_ERROR_STOP=1 -f supabase/install/fresh-install.sql`, or (b) use the per-file procedure in section C.
   - Any error rolls back everything (single transaction). Fix the cause and run again.
3. Paste `verify.sql` → Run. Every row must be `PASS` or `INFO`. [local: 18 PASS, 2 INFO]
4. PostgREST schema reload is issued by the script (`notify pgrst, 'reload schema'`). If the API still returns "function not found" (PGRST202), run `notify pgrst, 'reload schema';` once more.

Running `fresh-install.sql` a second time fails at the guard with `CVSRS install refused: supabase_migrations.schema_migrations already has 33 row(s)` and changes nothing. [local]

## B. Upgrading a database that already has CVSRS

1. **Back up first.** On paid plans confirm PITR or take a manual backup (Dashboard → Database → Backups); otherwise `pg_dump` over the direct connection. Do not proceed without a restorable copy. [live]
2. List what is applied:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   ```
3. For each file in `supabase/migrations` whose 4-digit prefix is **not** listed, in ascending order, run one SQL Editor query consisting of:
   ```sql
   begin;
   -- paste the entire migration file here
   insert into supabase_migrations.schema_migrations (version, name, statements)
   values ('NNNN', 'rest_of_file_name_without_.sql', null);
   commit;
   ```
   Example for `0034_example_change.sql`: `values ('0034', 'example_change', null)`. Stop at the first error (the transaction rolls back that file only) and investigate before continuing.
4. Run `verify.sql`; then `notify pgrst, 'reload schema';`.
5. Deploy the matching application version only after the database is upgraded (see "irreversible" below for signature changes).

[local] This exact wrapper was exercised: 0001–0030 applied per file with history rows, then the missing 0031–0033 discovered from the history table and applied; `verify.sql` all PASS/INFO.

### Migrations with irreversible or risky steps [static]

No migration drops a table, deletes or rewrites rows, or changes a column type. Rolling back still needs a restore, because these are not reversed by any script:

| Migration | Operation | Rollback / risk |
|---|---|---|
| 0009 | `alter table record_review_cases add column` + composite FK | FK validation scans the table |
| 0011, 0012 | drop and re-add `record_review_cases_kind_check` | Re-add validates every existing row under an exclusive lock |
| 0015 | drop and re-add `vaccination_revisions_source_check` | Same |
| 0020 | `drop function private.notify_guardians(uuid, uuid, text, text, text, text)` | Old body only recoverable from history/backups |
| 0021, 0023 | rename `private.handle_outbox_job` to `_base` / `_prev` and wrap | Reverse renames needed by hand |
| 0022 | rename `create_child_provisional`, `request_guardian_link` to `*_base` | Same |
| 0025 | rename six public commands to `*_prev` and wrap | Same |
| 0026 | `drop function private.mark_sms(uuid, text, text, text, text)` | A worker built before 0026 fails until upgraded |
| 0027 | `drop function public.store_certificate_pdf(uuid, uuid, text, text)` | An app built before 0027 cannot store certificates |
| 0028 | `create role cvsrs_outbox_worker`, `cvsrs_sms_webhook` | Roles are cluster objects: a database-only dump/restore does not remove or recreate them |
| 0001, 0011, 0018 | seed `private.settings` keys (`on conflict do nothing` from 0011) | Harmless on rerun; 0001 has no conflict clause |

Recovery = restore the backup/PITR point taken in step 1 (Supabase restores roles and data together), then re-apply the intended migrations. A local restore drill exists (`npm run drill:restore`) but a Supabase restore has never been rehearsed (known-limitations L27/L34).

## C. Alternative fresh install, one file at a time

Use when the editor cannot take the whole file. First run this prerequisite query once:

```sql
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
```

Then apply `0001` … the last file exactly as in section B step 3 (one query per file, each with its history `insert`), then `verify.sql`, then `notify pgrst, 'reload schema';`. This path has **no** fresh-database guard; only use it on an empty project. [local: per-file result produced a schema identical (pg_dump) to `fresh-install.sql`]

## D. First organization, clinic and staff

After a fresh install (and after both people have signed up through the app), run once in the SQL Editor:

```sql
select private.bootstrap_initial_staff('Municipal Health Office', 'Main Health Center', 'Asia/Manila',
                                       'tech.admin@example.org', 'clinical.lead@example.org');
```

It creates the organization, the first clinic and two mutually approved memberships (`tech_admin`, `clinical_lead`) with one `staff.bootstrap` audit row, and refuses (`CV409`) once any live staff membership exists. Only the database owner can run it. Full procedure and refusals: `docs/engineering/manual-setup.md` §7. [local]

## Migration history format

`supabase_migrations.schema_migrations(version text primary key, statements text[], name text)` is the Supabase CLI's table. CVSRS writes `version` = the 4-digit prefix (`0001`), `name` = the remainder (`foundation`), `statements` = NULL. That lets `supabase migration list` / `db push` compare against `supabase/migrations` later. Whether the CLI accepts 4-digit versions and NULL `statements` is **unverified** [live]. Each file's SHA-256 (LF-normalised) is listed in the header of `fresh-install.sql` for drift detection; compare with `npm run db:install-sql -- --check`.
