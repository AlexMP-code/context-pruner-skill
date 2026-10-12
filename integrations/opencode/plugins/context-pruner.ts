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
  completed: 10,
  architecture: 0,
  relocation: 20,
}

/**
 * Counts the body lines of the first `## <heading>` section. Returns -1 when the
 * section is absent.
 */
function sectionLines(markdown: string, heading: string): number {
  const lines = markdown.split("\n")
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l))
  if (start === -1) return -1

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).filter((l) => l.trim().length > 0).length
}

const buildInstructions = (sessionTag: string) => `You are pruning an agent state file. Rewrite it in place using the Write tool. Do not explain your work — just perform the edits.

Apply in strict order:

- 0. RESET the completion log first.
  The file may carry a \`## Completed This Session\` section stamped \`${sessionTag}\`
  from an earlier compaction in this session — keep its contents and restamp it.
  Any \`## Completed This Session\` section stamped with a DIFFERENT tag belongs to a
  session that has already ended: delete it entirely. Do not carry finished work
  across sessions.

- A. Move completed checklist items (\`[x]\`) out of "Pending Tasks" into the
  \`## Completed This Session\` section, stamped \`${sessionTag}\`.
  Never delete a \`[x]\` outright — a deleted one erases the record that the work
  was done, and the agent will redo it after compaction.

- B. Drop context notes and code snippets from dormant/inactive modules.

- C. Collapse inactive stack traces into single-line error summaries.

- D. Reduce pending task descriptions to phase-level titles only.

- E. For each durable decision that leaked into the state file (architecture
  constraints, tech stack rules, schemas):
  1. Move it out of the active sections into a "## Needs Relocation" section at
     the end of the SAME file.
  2. Keep the decision verbatim. Never delete it.
  3. Never write it to AGENTS.md, CLAUDE.md, README.md, or any other tracked file —
     relocating is a human decision.

- NEVER DROP: the \`Active Goal\` and \`Active Errors / Roadblocks\` sections.

- Capacity guard: if the file still exceeds ${MAX_LINES} lines after step E, keep the
  protected sections intact and accept the overage.

Per-section limits — check these to find what is wrong:
- Active Context: ${SECTION_LIMITS.context} lines
- Active Errors / Roadblocks: ${SECTION_LIMITS.errors} lines
- Pending Tasks: ${SECTION_LIMITS.tasks} lines
- Completed This Session: ${SECTION_LIMITS.completed} lines
- Architecture Snapshot: ${SECTION_LIMITS.architecture} lines (always a mistake — Step E parks it under Needs Relocation)
- Needs Relocation: ${SECTION_LIMITS.relocation} lines (durable decisions parked for a human to move)

If \`.agent/state.md\` does not exist yet, create it with these sections in this
order, using the compaction context to populate Goal and Focus File(s), and never
leave template placeholder text.

Preserve the file's existing section headers and ordering.`

type PromptResult = {
  data?: {
    info?: { error?: { name?: string; message?: string } }
    parts?: { type?: string; text?: string }[]
  }
}

const log = (client: any, level: "info" | "warn" | "error", message: string) =>
  client.app
    .log({ body: { service: "context-pruner", level, message } })
    .catch(() => {})

export const ContextPrunerPlugin: Plugin = async ({ client, directory }) => {
  return {
    "experimental.session.compacting": async (_input, output) => {
      const statePath = join(directory, ".agent", "state.md")
      if (!existsSync(statePath)) {
        await log(client, "info", "no .agent/state.md — run Cold-Start to create it")
        return
      }

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
        // Tag this compaction so stale completion logs can be told apart from
        // the ones produced by the current session.
        const sessionTag = `<!-- session:${new Date().toISOString().slice(0, 19)}Z -->`

        const session = await client.session.create({ body: { title: "context-pruner" } }).catch((err: unknown) => {
          void log(client, "error", `could not open prune session: ${String(err)}`)
          return null
        })

        if (session) {
          try {
            const result = (await client.session.prompt({
              path: { id: session.data.id },
              body: {
                noReply: false,
                parts: [
                  {
                    type: "text",
                    text: `${buildInstructions(sessionTag)}\n\nFile to rewrite: ${statePath}\n\n\`\`\`markdown\n${before}\n\`\`\``,
                  },
                ],
              },
            })) as PromptResult

            const failed = result.data?.info?.error
            if (failed) {
              await log(
                client,
                "error",
                `prune failed (${failed.name ?? "error"}), injecting unpruned state: ${failed.message ?? ""}`,
              )
            } else {
              const rewritten = readFileSync(statePath, "utf8").trim()

              // Compare the Goal by value, not by header name — an LLM may
              // rename headers, but changing the goal itself is the one failure
              // that loses the thread of the task. The pattern tolerates both
              // `- **Goal:** x` and `- Goal: x`.
              const GOAL_RE = /^\s*-\s*\**\s*Goal\s*:\s*\**\s*(.+)$/im
              const goalBefore = before.match(GOAL_RE)?.[1]?.trim()
              const goalAfter = rewritten.match(GOAL_RE)?.[1]?.trim()

              const hasCoreHeader = /^##\s+Active Context/im.test(rewritten)

              if (!rewritten) {
                await log(client, "warn", "prune emptied the file, keeping original")
              } else if (!hasCoreHeader) {
                await log(client, "warn", "prune dropped Active Context section, keeping original")
              } else if (goalBefore && (!goalAfter || goalBefore !== goalAfter)) {
                await log(client, "warn", "prune modified or dropped the Active Goal, keeping original")
              } else if (rewritten.length > Math.max(before.length + 200, before.length * 1.25)) {
                await log(client, "warn", "prune abnormally increased file size, keeping original")
              } else {
                state = rewritten
              }
            }
          } catch (err) {
            await log(client, "error", `prune threw, injecting unpruned state: ${String(err)}`)
          } finally {
            await client.session.delete({ path: { id: session.data.id } }).catch(() => {})
          }
        }
      }

      const relocationLines = sectionLines(state, "Needs Relocation")
      if (relocationLines > SECTION_LIMITS.relocation) {
        await log(
          client,
          "warn",
          `Needs Relocation has ${relocationLines} lines (limit ${SECTION_LIMITS.relocation}) — parked decisions are not being moved out by hand`,
        )
      }

      output.context.push(`## Agent State Anchor

The file below is the authoritative record of active work. Reproduce it in the
continuation summary verbatim. Never drop the Active Goal or the Active Errors /
Roadblocks section — those are unrecoverable if lost.

${state}`)
    },
  }
}