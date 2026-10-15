# Multi-Agent Engineering Loop Contract (LOOP.md)

## Active Loops

| Loop Name | Pattern | Cadence | Level | Mode | Command |
|---|---|---|---|---|---|
| Daily Triage | `daily-triage` | 1d | L1 / L2 | Report-Only (L1) / Auto-Fix (L2) | `npx @cobusgreyling/loop run --pattern daily-triage` |
| CI Sweeper | `ci-sweeper` | 12h | L1 | Report-Only | `npx @cobusgreyling/loop run --pattern ci-sweeper` |
| Security & Audit | `security-audit` | 1d | L1 | Report-Only | `npx @cobusgreyling/loop run --pattern security-audit` |

---

## Agent Roles & Hierarchy

### 1. Triage Agent (`loop-triage`)
- **Responsibility**: Scans repository health, recent test results, git changes, and issue queues.
- **Output**: Writes structured updates to `STATE.md`.
- **Constraint**: Strictly read-only. Proposes candidate items for implementer without mutating application code.

### 2. Implementer Agent (`loop-implementer`)
- **Responsibility**: Takes high-priority items from `STATE.md` and implements minimal targeted fixes.
- **Execution Mode**: Runs exclusively in isolated git worktrees (`isolation: worktree`).
- **Constraint**: Must keep diffs minimal and pass local unit/integration test suites before passing to Verifier.

### 3. Verifier Agent (`loop-verifier`)
- **Responsibility**: Acts as independent checker in a maker-checker split (`.claude/agents/loop-verifier.md`).
- **Checklist**:
  1. Scope verification (no denylist paths, no collateral edits).
  2. Intent verification (fix directly matches stated issue).
  3. Execution of full test suite (`npm test` / `vitest`).
  4. No disabled or bypassed tests.
- **Default Stance**: `REJECT` unless all checks pass.

---

## Human-in-the-Loop Gates & Safety Policies

1. **Denylist Paths (Mandatory Human Approval)**:
   - Authentication & Security (`src/lib/auth/`, `src/lib/security/`, `src/proxy.ts`)
   - Database Migrations (`supabase/migrations/`)
   - Core API Handlers (`src/app/api/`)
   - Environment Credentials (`src/lib/env.ts`, `.env*`)

2. **Auto-Merge Policy**:
   - `L1` (Week 1): Report-only mode. No automated commits or pull requests created without human review.
   - `L2`: Automated PR creation allowed only when Verifier returns `APPROVE` and all tests pass.

3. **Worktree Lifecycle**:
   - Every fix attempt must take place in an isolated Git worktree under `.worktrees/loop-*`.
   - Worktree is destroyed immediately upon Verifier `REJECT` or after successful PR submission.

---

## Resource & Token Budgeting

| Metric | Budget Limit |
|---|---|
| Max Sub-Agent Spawns per Cycle | 2 |
| Max Time per Cycle | 15 minutes |
| Max Daily Cost Threshold | $5.00 USD |
| Max Retries per Triage Item | 2 attempts |

---

## Connectors & Tooling Scopes

- **Git & Shell**: Local git commands (`status`, `diff`, `worktree`, `test`).
- **GitHub MCP**: Read-only issues, PR comments, check run status.
- **Least-Privilege Enforcement**: No direct push to `main` branch. All modifications require PR workflow.

---

## References & Design Artifacts

- State File: [`STATE.md`](file:///c:/Users/Nitro/Desktop/CVSRS/STATE.md)
- Safety Spec: [`docs/safety.md`](file:///c:/Users/Nitro/Desktop/CVSRS/docs/safety.md)
- Pattern Registry: [`patterns/registry.yaml`](file:///c:/Users/Nitro/Desktop/CVSRS/patterns/registry.yaml)
- Audit Log: [`loop-run-log.md`](file:///c:/Users/Nitro/Desktop/CVSRS/loop-run-log.md)