import { createRequire } from "node:module"
import { join } from "node:path"
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { orcaJson } from "./index.ts"
import { findUnstartedGraphRetirement, retireUnstartedGraph } from "./workspaces.ts"

export default function graphRetirementExtension(pi: ExtensionAPI): void {
 const agentDir = () => process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir()
 const resourceHelper = () => createRequire(import.meta.url)(join(process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE!, "local-resources.cjs"))
 pi.registerCommand("graph-retire", {
  description: "Retire one eligible current-v4 graph and preserve all retained state. /graph-retire <run-id>",
  handler: async (args, ctx) => {
   const runId = args.trim()
   if (!ctx.isIdle() || !/^run_[a-zA-Z0-9_-]+$/.test(runId)) { ctx.ui.notify("Usage: /graph-retire <run-id> from an idle session.", "warning"); return }
   const directory = join(agentDir(), "task-graphs"), retired = join(agentDir(), "task-graphs-retired", "v4")
   try {
    const file = findUnstartedGraphRetirement(directory, retired, runId)
    if (!ctx.hasUI || !await ctx.ui.confirm("Retire settled graph?", `Retire Run ${runId} only if all recorded work is settled. Preserve all worktrees, lanes, resources, commits, receipts, and orchestration evidence. Release only repository ownership.`)) return
    const helper = resourceHelper(), result = retireUnstartedGraph(file, retired, helper.dockerRuntime(), orcaJson, helper.verifyResource)
    ctx.ui.notify(`Retired ${result.runId}; preserved record at ${result.record}`, "info")
   } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error") }
  },
 })
}
