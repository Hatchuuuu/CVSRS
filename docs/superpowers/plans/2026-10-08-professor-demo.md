# Professor Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing application repeatably presentable on this laptop with synthetic records, working role access, and a complete vaccination visit.

**Architecture:** Reuse the isolated E2E Supabase stack and browser journeys. Add a small local demo launcher and preparation entry point, preserving real Supabase Auth, MFA, approvals, and application commands. Do not modify the main local database or build new clinical features.

**Tech Stack:** Node.js 22+, TypeScript/tsx, Next.js 16, local Supabase/Docker, existing Playwright tests.

**Spec:** User-authorized local professor presentation; [project rules](../../../AGENTS.md), [current readiness](../../audit/2026-10-08-local-readiness.md), and [role guides](../../operations/training.md).

## Global Constraints

- Preserve the dirty worktree and existing main accounts/data at app 3000, API 54321, database 54322.
- Demo uses app 3100, API 55321, database 55322 and ignored `.local/e2e` state.
- New accounts are automatically confirmed: no verification or confirmation email.
- Staff MFA and two-person approvals remain required.
- Only fictional clinical fixtures and synthetic people; SMS stays off.
- No hosted deployment, new dependency, clinical policy, or unrelated feature work.

## Review Focus

- A wrong database address must be refused before any destructive preparation.
- An occupied app port must not allow a stale server to satisfy readiness.
- Restart must keep certificate secrets and enrolled MFA consistent with the database.
- A completed test run must not leave the demonstration assistant revoked or its only certificate invalid.
- A new presentation day requires a current session and current date checks, not stale bookings.

## Task 1: Repeatable Isolated Demo

**Files:** Add the minimal demo script under `scripts/`; modify `package.json`; reuse `scripts/e2e-stack.ts`, `scripts/e2e.ts`, and existing journeys. Add one focused runnable safety check in `tests/unit/` for new nontrivial launcher logic.

**Interfaces:** `demo:prepare` prepares only the isolated stack; `demo` serves its existing state without resetting; local credential/MFA access uses ignored files. Final command names belong in the operator guide.

- [ ] Prove reset rejects a non-loopback address or a database port other than 55322; preserve the existing guarded reset implementation.
- [ ] Implement non-reset start with a free-port check and consistent certificate/worker secrets; check a restart still downloads an existing certificate.
- [ ] Prepare through existing 01-04 journeys, 06 staff onboarding, and 09 follow-up journey, or an equivalently small reuse that leaves all staff active and a valid certificate.
- [ ] Keep credentials/TOTP local and ignored; verify new signups still send no confirmation mail and staff still need an MFA session.
- [ ] Run the focused check, typecheck/lint, and actual prepare/start flow. Stop only task-owned processes.

## Task 2: Presentation and Evidence

**Files:** Create `docs/operations/professor-demo.md`; correct stale confirmation wording in `docs/operations/runbook.md`. Record fresh verification results in the local-readiness evidence document as appropriate.

**Interfaces:** The guide consumes Task 1's tested commands and actual prepared state. It explains recovery and remaining external launch requirements without putting secrets in tracked files.

- [ ] Run `npm run test:all`, `npm run build`, and the complete existing E2E journeys; record actual exit codes/counts and any failures.
- [ ] Prepare a clean presentation state after destructive regression journeys; exercise restart and readiness at `http://localhost:3100/api/v1/health/ready`.
- [ ] Verify a fresh synthetic child: register, identity/guardian verification, book, check in, call/start, sign a dose, finish, stock minus one, family history/message, certificate PDF and anonymous validity.
- [ ] Verify all six staff capabilities across the prepared accounts: administration, clinical lead, nurse, inventory clerk, assistant, and barangay health worker; verify family/admin cannot read unauthorized clinical data.
- [ ] Verify lead reports/CSV/audit, BHW follow-up contact, and usable desktop/mobile screens. Document any feature requiring further external approval.
- [ ] Confirm the main database's existing accounts and lack of clinical fixtures are unchanged; leave the isolated demo running with operator commands and a concise result.
