# OpenCode Integration Guide

One plugin handles both cases. It hooks `experimental.session.compacting`, which fires before OpenCode generates a summary on manual `/compact` **and** on automatic compaction — no command override required.

## What it does

1. Reads `.agent/state.md` at the repository root.
2. Checks whether pruning is needed: over 150 lines, contains `[x]` items, a multi-line stack trace, or a leaked `Architecture Snapshot`.
3. If so, opens a throwaway session, has the model prune the file in place, then deletes the session. Skipped entirely when there is nothing to prune.
4. Injects the final state into the compaction prompt with an instruction to reproduce it verbatim.

If the prune round-trip fails, the original unpruned state is injected and the error is logged to `client.app.log` — compaction still proceeds, never blocked.

## Installation

```bash
mkdir -p .opencode/plugins
cp integrations/opencode/plugins/context-pruner.ts .opencode/plugins/context-pruner.ts
```

Install the SDK for types:

```bash
cd .opencode && bun add @opencode-ai/plugin
```

Requires a model configured — the plugin delegates pruning to whichever model the session uses.

## Cost

Each compaction that needs pruning costs one extra short session. When the file is already lean (the common case once Heartbeat is installed), that round-trip is skipped entirely and the hook only reads a file.

## 2. Heartbeat (prompt-guided)

Pruning only helps if the state file is current. Add to `.opencode/instructions.md`:

```markdown
## Context Pruner Heartbeat
Update `.agent/state.md` immediately when any of these occur:
- The user issues a new instruction that redefines the primary task.
- A checklist item is completed (`[ ]` -> `[x]`).
- A failing test passes or an active blocking error is fixed.
- A public API contract, DB migration, or core interface is updated.
```

This is prompt-guided, not a trigger: the agent must choose to act on it. The state file is designed to tolerate staleness (Capacity Guard, Step E) rather than depend on perfect cadence.

## 3. Verification

1. Create a `.agent/state.md` with completed `[x]` items, a multi-line stack trace, and more than 150 lines.
2. Run `/compact`.
3. Confirm the session compacted and `.agent/state.md` now has no `[x]` items, the stack trace is one line, and the file is within the 150-line limit and each section within its own limit — or overage was accepted with `Active Goal` and `Active Errors/Roadblocks` intact.
4. Confirm any durable decision that was in the state file now sits under `## Needs Relocation`, verbatim, and that no tracked file was modified.
4. Run `/compact` again on an already-lean file. No prune session should be created, and the anchor should still appear in the summary.

If step 3 leaves the file untouched, check that the plugin compiled (`cd .opencode && bun install`) and that the plugin directory is `.opencode/plugins/`. Errors from the prune round-trip appear in the session log with service name `context-pruner`.