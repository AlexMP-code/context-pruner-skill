---
name: context-pruner
description: Use when a long coding session approaches context limits — during large refactors, when switching focus between modules, or before context compaction. Keeps project goals, pending work, and active errors from being lost when history is compressed.
---

# Context Pruner

Maintain a lean, single-file state anchor (`.agent/state.md`) to survive context compression without losing active task goals, pending bugs, or key constraints.

## Core Principle: Durable vs. Transient Data

- **Durable Decisions (Grounded in Git):** Long-term architectural constraints, tech stack rules, and DB schemas MUST be written to tracked repository files (e.g., `AGENTS.md`, `CLAUDE.md`, or `README.md`) FIRST. Durable decisions never belong in `.agent/state.md`.
- **Transient State (In `.agent/state.md`):** `.agent/state.md` ONLY holds ephemeral workspace context — current goal, focus files, pending tasks, active errors. Because durable decisions live in Git-tracked files, a state file that has been pruned back to its transient sections is complete on its own.

## Trigger & Write Cadence (Heartbeat Protocol)

Prompt and update `.agent/state.md` at three verifiable events:

1. **Cold-Start (Task Initialization):** On starting any task involving >= 2 files or multi-step execution, immediately populate `Goal` and `Focus File(s)`. Never leave placeholder text.
2. **Post-Milestone (Observable Events):** Rewrite state immediately when:
   - The user issues a new instruction that redefines the primary task.
   - A pending checklist item (`[ ]`) is completed (`[x]`).
   - A previously failing test passes or a blocking error is resolved.
   - A public interface or schema is modified.
3. **Pre-Compact / Module Switch:** Execute compaction logic before invoking `/compact` or switching module contexts.

---

## Protocol Rules

### 1. Single-File State Discipline
- Keep ALL transient workspace state inside `.agent/state.md`. **DO NOT create multiple state files** (e.g., `auth.md`, `infra.md`) to avoid agent discovery failures post-compact.
- **Overall capacity: Max 150 lines.** This is a diagnostic threshold, not a hard rule — exceeding it after Step E means something of the wrong kind is in the file.
- **Scope & Isolation:** Ensure `.agent/state.md` is strictly scoped to the local repository root and added to `.gitignore`.

### 2. Per-Section Limits

Each section has its own budget. Breaking one signals a specific problem, so check the section before cutting content.

| Section | Limit | Reading it means |
|---|---|---|
| Active Context | 5 | The goal is written too long |
| Active Errors / Roadblocks | 20 | ~10 errors at one line each; more means resolved errors were not removed |
| Pending Tasks | 40 | ~20 tasks at phase-title length; more means completed items were not deleted |
| Architecture Snapshot | 0 | Always a mistake — durable decisions get moved to `## Needs Relocation` by Step E |
| Needs Relocation | 20 | ~10 parked decisions; more means they are never being moved out by hand |

### 3. Hard-Cap Fallback Ladder (When over limit)

Execute pruning in this **strict order of priority**:

- **Step A:** Delete completed checklist items (`[x]`) and resolved bugs.
- **Step B:** Drop context notes and code snippets from dormant/inactive modules.
- **Step C:** Compress inactive stack traces into single-line error summaries.
- **Step D:** Truncate pending task descriptions to phase-level titles only.
- **Step E:** Move any durable decision that leaked into the state file out of the active sections and into a `## Needs Relocation` section at the end of the same file. Do not delete it and do not write it to `AGENTS.md` or any other tracked file — a human decides where it belongs.
- **PROTECTED SECTIONS:** `Active Goal` and `Current Active Errors/Roadblocks`.

### 4. Capacity Guard
- Verify line count <= 150 and each section within its limit after pruning.
- **Capacity Guard:** If limits are still exceeded after Step E, **keep protected sections intact and accept the overage**. Never trim `Active Goal` or `Active Errors`.

---

## Examples

### BAD: Bloated State Example (Over 150 lines, rotting completed logs, durable decisions in the wrong file)

```markdown
# Current Agent State

## Active Context
- Goal: Refactor Auth Service

## Architecture Snapshot (MISPLACED — durable decisions get parked by Step E)
- Use JWT with RS256 signing
- Store refresh tokens in Redis
- Role-based access control with Spatie

## Completed Tasks (ROTTING LOGS - SHOULD BE DELETED)
- [x] Installed JWT package
- [x] Generated RSA keys
- [x] Updated User model with JWTSubject
- [x] Configured auth.php guards

## Pending Tasks
- [ ] Implement RefreshTokenRepository with full error handling and retry mechanisms
- [ ] Add unit tests for expired token handler with mock Redis client

## Active Errors / Roadblocks (BLOATED STACK TRACES)
- TokenExpiredException on AuthService.php:42
  Stack trace:
  #0 /vendor/laravel/framework/src/Illuminate/Auth/AuthManager.php(60): AuthService->validateToken()
  #1 /app/Http/Controllers/AuthController.php(25): AuthManager->guard()
  ... [30 lines of trace]
```

### GOOD: Pruned State Example (Under 25 lines, clear active focus)

Durable decisions (JWT RS256, Redis refresh tokens, Spatie RBAC) are not in an active section — Step E parks them under `## Needs Relocation` for a human to move.

```markdown
# Current Agent State

## Active Context
- **Goal:** Refactor Auth Service
- **Focus File(s):** `app/Services/AuthService.php`

## Pending Tasks
- [ ] Implement RefreshTokenRepository
- [ ] Add unit tests for expired token handler

## Active Errors / Roadblocks (NEVER DROP)
- `TokenExpiredException` on `AuthService.php:42` during token refresh handling.

## Needs Relocation
- JWT RS256 signing
- Refresh tokens in Redis
- Spatie RBAC
```