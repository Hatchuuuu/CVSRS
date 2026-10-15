# Loop Safety Policy & Scoping Guidelines (`docs/safety.md`)

## 1. High-Risk Path Denylist

The following directories and files are strictly off-limits for automated modification by loop agents without prior human sign-off:

```yaml
denylist_paths:
  - "src/lib/auth/**"
  - "src/lib/security/**"
  - "src/proxy.ts"
  - "src/lib/env.ts"
  - "supabase/migrations/**"
  - "package.json"
  - "package-lock.json"
  - ".env*"
```

If an issue requires modifying any file in the denylist:
- The Implementer agent MUST immediately abort code mutation.
- The Triage agent MUST flag the item as `ESCALATE_HUMAN` in `STATE.md`.

---

## 2. Auto-Merge & PR Policy

1. **L1 Cadence (Report Only)**:
   - No direct commits or automated PR merges.
   - Outputs daily report into `STATE.md` and `loop-run-log.md`.

2. **L2 Cadence (Checked Auto-Fix)**:
   - Branch naming: `loop/triage-<timestamp>-<short-description>`
   - Isolated worktrees: `.worktrees/loop-*`
   - Must pass `loop-verifier` validation before PR submission.
   - Require 1 human approval before merging to `main`.

---

## 3. Tool & MCP Least Privilege Scopes

| Role | Allowed Shell Tools | Allowed MCP Scopes |
|---|---|---|
| Triage Agent | `git status`, `git log`, `npm test` | GitHub: `repo:read`, `issues:read` |
| Implementer Agent | `git worktree`, `git checkout`, `npm test` | None (Local files only) |
| Verifier Agent | `git diff`, `npm test`, `vitest` | GitHub: `comments:write` |

---

## 4. Emergency Stop & Loop Circuit Breakers

- **Flapping Detection**: If a test fails 3 consecutive times post-fix attempt, quarantine the test and escalate to human.
- **Budget Exceeded**: Automatically kill active worktree tasks if cost exceeds $5.00/day or execution exceeds 15 minutes.
