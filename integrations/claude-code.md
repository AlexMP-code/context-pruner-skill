# Claude Code / Cursor Integration Guide

Claude Code and Cursor have no compaction hook equivalent to OpenCode's, so this integration is prompt-guided: the agent must choose to run the protocol. Nothing fires automatically.

## Installation

Claude Code — create `.claude/commands/compact.md`:

```markdown
---
description: Prune .agent/state.md, then compact the session
---

## Current Agent State

!`cat .agent/state.md 2>/dev/null || echo "_No .agent/state.md found._"`

## Instructions

1. Prune `.agent/state.md` using the context-pruner protocol: move completed `[x]` items out of `Pending Tasks` into `## Completed This Session`, drop dormant module notes, compress inactive stack traces, truncate pending tasks to phase titles, and move any durable decision into a `## Needs Relocation` section at the end of the same file. Never delete a completed item or a durable decision, and do not edit any tracked file.
2. Never drop `Active Goal` or `Active Errors / Roadblocks`. If the file still exceeds 150 lines, accept the overage.
3. Write the pruned file back to `.agent/state.md`.
4. Run `/compact` to compress the session history.
```

Cursor — create `.cursor/rules/context-pruner.mdc`:

```markdown
---
description: context-pruner state protocol
globs: ["*"]
alwaysApply: true
---

Before compacting or summarizing conversation history, prune `.agent/state.md` per the context-pruner protocol: move completed `[x]` items out of `Pending Tasks` into `## Completed This Session`, drop notes from dormant modules, compress inactive stack traces to one line each, truncate pending tasks to phase titles, and move durable decisions into a `## Needs Relocation` section at the end of the same file — never delete them and never edit tracked files. Never drop Active Goal or Active Errors. Write the file back, then continue.
```

## Heartbeat

Add to `.claude/CLAUDE.md` (Claude Code) or a second Cursor rule:

```markdown
## Context Pruner Heartbeat
Update `.agent/state.md` immediately when: the user issues a new instruction redefining the task, a checklist item is completed, a failing test passes or a blocking error is fixed, or a public interface/schema changes.
```

## Verification

1. Create a `.agent/state.md` with completed `[x]` items, a multi-line stack trace, and more than 150 lines.
2. Run `/compact` (Claude Code) or ask Cursor to summarize the conversation.
3. Confirm every `[x]` sits under `## Completed This Session` rather than `Pending Tasks`, the stack trace is one line, and the file is within the 150-line limit and each section within its own limit — or overage was accepted with `Active Goal` and `Active Errors/Roadblocks` intact.

If nothing changes, the agent did not act on the instruction — that is the expected failure mode of prompt-guided integration. Use OpenCode's integration instead if deterministic behavior is required.