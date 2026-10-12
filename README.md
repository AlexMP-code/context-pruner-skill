# Context Pruner Skill ✂️

A deterministic, single-file context preservation protocol for AI Coding Agents (OpenCode, Claude Code, Cursor, Aider).

> ⚠️ **When NOT to use this skill:** If your project already keeps both durable instructions and ephemeral task state in a single tracked file like `AGENTS.md`, do not use `context-pruner` — you already have the single-file anchor. The reason to split is that transient state in a tracked file gets committed into your PRs.

## Why Context Pruner?
Two problems compound in long sessions. Agents forget where state lives after compaction, and state files grow until the context window is spent on history instead of work. `context-pruner` fixes both: one predictable file (`.agent/state.md`), pruned in a fixed order before every compaction, with durable decisions kept in Git where they belong.

## Key Mechanisms
- **Durable vs. Transient Split:** Permanent decisions live in Git-tracked files (`AGENTS.md`); transient work state lives in `.agent/state.md`.
- **Single-File Anchor:** No fragmented state files. Everything stays in one predictable location.
- **Heartbeat Cadence:** Updates on task start, after milestones, and pre-compact to prevent stale state.
- **Fallback Degradation Ladder:** Deterministic section-dropping priority when state reaches capacity.
- **Compaction Hook:** A plugin that prunes the state file and injects it into every compaction — manual or automatic.

## Quick Start

1. **Install Skill:** Copy `SKILL.md` into your agent's skills directory (e.g., `.claude/skills/`, `.opencode/skills/`).
2. **Initialize State:** Copy `.agent/state.md.template` to `.agent/state.md` in your project root.
3. **Configure Git:** Add `.agent/state.md` to your project's `.gitignore` so transient state is never committed:
   ```bash
   echo ".agent/state.md" >> .gitignore
   ```
   > Ignore the state file, not the directory — `.agent/state.md.template` must stay tracked so others can use it.
4. **Install Compaction Hook:** Copy `integrations/opencode/plugins/context-pruner.ts` to `.opencode/plugins/` and run `cd .opencode && bun add @opencode-ai/plugin`. See the [integration guide](integrations/opencode.md).
   > Durable decisions found in the state file are parked under `## Needs Relocation` for you to move by hand. The plugin never edits tracked files.
5. **Add Heartbeat:** Copy the Heartbeat section from the [integration guide](integrations/opencode.md) into `.opencode/instructions.md`.

## Integrations
- [OpenCode CLI hooks](integrations/opencode.md)
- [Claude Code / Cursor](integrations/claude-code.md)

## License

MIT