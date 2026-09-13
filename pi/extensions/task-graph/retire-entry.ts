import { createRequire } from "node:module"
import { join } from "node:path"
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { findUnstartedGraphRetirement, retireUnstartedGraph } from "./workspaces.ts"

export default function graphRetirementExtension(pi: ExtensionAPI): void {
 const agentDir = () => process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir()
 const resourceHelper = () => createRequire(import.meta.url)(join(process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE!, "local-resources.cjs"))
 pi.registerCommand("graph-retire", {
  description: "Retire an unstarted failed graph while preserving its record. /graph-retire <run-id>",
  handler: async (args, ctx) => {
   const runId = args.trim()
   if (!ctx.isIdle() || !/^run_[a-f0-9]+$/.test(runId)) { ctx.ui.notify("Usage: /graph-retire <run-id> from an idle session.", "warning"); return }
   const directory = join(agentDir(), "task-graphs"), retired = join(agentDir(), "task-graphs-retired", "v4")
   try {
    const file = findUnstartedGraphRetirement(directory, retired, runId)
    if (!ctx.hasUI || !await ctx.ui.confirm("Retire failed graph?", `Retire Run ${runId} only if it never launched a task, every integration workspace is clean and unchanged, and no declared resource exists. Preserve its record and release only its repository ownership. Do not delete worktrees, resources, commits, or evidence.`)) return
    const result = retireUnstartedGraph(file, retired, resourceHelper().dockerRuntime())
    ctx.ui.notify(`Retired ${result.runId}; preserved record at ${result.record}`, "info")
   } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error") }
  },
 })
}
