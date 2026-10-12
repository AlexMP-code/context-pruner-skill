import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const MAX_LINES = 150

/**
 * Per-section line budgets. Exceeding one names the problem instead of just
 * reporting that the file is too long.
 */
const SECTION_LIMITS = {
  context: 5,
  errors: 20,
  tasks: 40,
  architecture: 0,
  relocation: 20,
}

const PRUNE_INSTRUCTIONS = `You are pruning an agent state file. Rewrite it in place using the Write tool. Do not explain your work — just perform the edits.

Apply in strict order:
- A. Delete completed checklist items (\`[x]\`) and resolved bugs.
- B. Drop context notes and code snippets from dormant/inactive modules.
- C. Collapse inactive stack traces into single-line error summaries.
- D. Reduce pending task descriptions to phase-level titles only.
- E. For each durable decision that leaked into the state file (architecture constraints, tech stack rules, schemas):
  1. Move it out of the active sections into a "## Needs Relocation" section at the end of the SAME file.
  2. Keep the decision verbatim. Never delete it.
  3. Never write it to AGENTS.md, CLAUDE.md, README.md, or any other tracked file — relocating is a human decision.
- NEVER DROP: the \`Active Goal\` and \`Active Errors / Roadblocks\` sections.
- Capacity guard: if the file still exceeds ${MAX_LINES} lines after step E, keep the protected sections intact and accept the overage.

Per-section limits — check these to find what is wrong:
- Active Context: ${SECTION_LIMITS.context} lines
- Active Errors / Roadblocks: ${SECTION_LIMITS.errors} lines
- Pending Tasks: ${SECTION_LIMITS.tasks} lines
- Architecture Snapshot: ${SECTION_LIMITS.architecture} lines (always a mistake — Step E parks it under Needs Relocation)
- Needs Relocation: ${SECTION_LIMITS.relocation} lines (durable decisions parked for a human to move)

Preserve the file's existing section headers and ordering.`

type PromptResult = {
  data?: {
    info?: { error?: { name?: string; message?: string } }
    parts?: { type?: string; text?: string }[]
  }
}

export const ContextPrunerPlugin: Plugin = async ({ client, directory }) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      const statePath = join(directory, ".agent", "state.md")
      if (!existsSync(statePath)) return

      const before = readFileSync(statePath, "utf8").trim()
      if (!before) return

      // Only pay for the prune round-trip when there is something to prune.
      const lineCount = before.split("\n").length
      const hasPrunable =
        lineCount > MAX_LINES ||
        /^\s*-\s*\[x\]/m.test(before) ||
        before.includes("  Stack trace:") ||
        /##\s*Architecture Snapshot/i.test(before)

      let state = before

      if (hasPrunable) {
        const session = await client.session.create({ body: { title: "context-pruner" } })

        const result = (await client.session.prompt({
          path: { id: session.data.id },
          body: {
            noReply: false,
            parts: [{
              type: "text",
              text: `${PRUNE_INSTRUCTIONS}\n\nFile to rewrite: ${statePath}\n\n\`\`\`markdown\n${before}\n\`\`\``,
            }],
          },
        })) as PromptResult

        const failed = result.data?.info?.error
        if (failed) {
          await client.app.log({
            body: {
              service: "context-pruner",
              level: "error",
              message: `prune failed, injecting unpruned state: ${failed.name ?? "error"} ${failed.message ?? ""}`,
            },
          })
        } else {
          const rewritten = readFileSync(statePath, "utf8").trim()
          if (rewritten) state = rewritten
        }

        await client.session.delete({ path: { id: session.data.id } }).catch(() => {})
      }

      output.context.push(`## Agent State Anchor

The file below is the authoritative record of active work. Reproduce it in the
continuation summary verbatim. Never drop the Active Goal or the Active Errors /
Roadblocks section — those are unrecoverable if lost.

${state}`)
    },
  }
}