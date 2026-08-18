import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { taskGraphPrompt, TASK_GRAPH_USAGE } from "./task-graph-core.ts"

export default function taskGraphExtension(pi: ExtensionAPI): void {
	pi.registerCommand("graph", {
		description: "Plan and run suitable work as an Orca task graph",
		handler: async (rawArgs, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish, then run /graph again.", "warning")
				return
			}

			let objective = rawArgs.trim()
			if (!objective && ctx.hasUI) objective = (await ctx.ui.input("Task graph objective", "Build or change..."))?.trim() ?? ""

			if (!objective) {
				ctx.ui.notify(TASK_GRAPH_USAGE, "warning")
				return
			}

			try {
				pi.sendUserMessage(taskGraphPrompt(objective))
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
			}
		},
	})
}
