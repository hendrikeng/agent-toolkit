import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import {
	formatTaskGraph,
	planRequiresPlanOnly,
	reviewTaskGraph,
	taskGraphPrompt,
	TASK_GRAPH_USAGE,
	validateTaskGraph,
} from "./task-graph-core.ts"

const taskSchema = Type.Object({
	id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$", description: "Stable lowercase task ID" }),
	goal: Type.String({ minLength: 1, description: "One bounded outcome" }),
	depends_on: Type.Array(Type.String({ minLength: 1 }), { maxItems: 5, description: "Hard prerequisite task IDs" }),
	owns: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20, description: "Exclusive repository-relative write paths or contract areas; empty for read-only work" }),
	specialty: Type.String({ minLength: 1, description: "Worker expertise needed for this task" }),
	done_when: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10, description: "Observable completion criteria" }),
	validation: Type.String({ minLength: 1, description: "Smallest focused validation command or manual check" }),
}, { additionalProperties: false })

const graphSchema = Type.Object({
	objective: Type.String({ minLength: 1 }),
	mode: Type.Union([Type.Literal("plan-only"), Type.Literal("execute")], {
		description: "plan-only for draft or blocked work; execute only for an approved active slice",
	}),
	tasks: Type.Array(taskSchema, { minItems: 2, maxItems: 6 }),
}, { additionalProperties: false })

function repositoryRoot(cwd: string): string {
	let current = realpathSync(cwd)
	while (!existsSync(join(current, ".git"))) {
		const parent = dirname(current)
		if (parent === current) return realpathSync(cwd)
		current = parent
	}
	return current
}

function localPlanRequiresPlanOnly(cwd: string, objective: string): boolean {
	const path = resolve(cwd, objective)
	if (extname(path) !== ".md" || !existsSync(path)) return false
	const target = realpathSync(path)
	const local = relative(repositoryRoot(cwd), target)
	if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return true
	return planRequiresPlanOnly(readFileSync(target, "utf8"))
}

export default function taskGraphExtension(pi: ExtensionAPI): void {
	let pending: { prompt: string; planOnlyRequired: boolean } | null = null
	let planning = false
	let approved = false
	let reviewClosed = false
	let planOnlyRequired = false

	pi.registerTool({
		name: "propose_task_graph",
		label: "Propose Task Graph",
		description: "Submit a candidate DAG for validation and interactive approval during an active /graph planning run.",
		parameters: graphSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!planning) throw new Error("propose_task_graph requires an active /graph command.")
			if (reviewClosed) throw new Error("This graph review is closed. Start another /graph command to propose a new graph.")
			if (planOnlyRequired && params.mode !== "plan-only") throw new Error("This plan status permits a plan-only graph, not implementation dispatch.")
			const graph = formatTaskGraph(params)
			if (!ctx.hasUI) {
				validateTaskGraph(params)
				return {
					content: [{ type: "text", text: `${graph}\n\nInteractive approval is unavailable. Show the plan and stop without dispatching.` }],
					details: { status: "approval-required", plan: params },
				}
			}

			const review = await reviewTaskGraph(params, ctx.ui, signal)
			approved = review.status === "approved"
			reviewClosed = review.status !== "revise"
			if (review.status === "cancelled" || review.status === "plan-approved") ctx.abort()
			const text = review.status === "approved"
				? "The user approved this task graph. Execute it through Orca orchestration."
				: review.status === "plan-approved"
					? "The user approved this plan-only graph. Update planning artifacts if requested, but do not dispatch implementation workers."
					: review.status === "revise"
						? `Revise the graph and call propose_task_graph again. User feedback: ${review.feedback}`
						: "The user cancelled task graph execution. Stop without dispatching."
			return {
				content: [{ type: "text", text }],
				details: { ...review, plan: params },
			}
		},
	})

	pi.registerCommand("graph", {
		description: "Interactively plan and run suitable work as an Orca task graph",
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

			const prompt = taskGraphPrompt(objective)
			try {
				pending = { prompt, planOnlyRequired: localPlanRequiresPlanOnly(ctx.cwd, objective) }
				pi.sendUserMessage(prompt)
			} catch (error) {
				pending = null
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
			}
		},
	})

	pi.on("before_agent_start", (event) => {
		if (!pending || event.prompt !== pending.prompt) return
		planning = true
		approved = false
		reviewClosed = false
		planOnlyRequired = pending.planOnlyRequired
		pending = null
	})

	pi.on("tool_call", (event) => {
		if (planning && !approved && ["bash", "edit", "write"].includes(event.toolName)) {
			return { block: true, reason: "Mutation tools are disabled until the user approves an executable task graph. Use read and search tools while planning." }
		}
	})

	pi.on("agent_settled", () => {
		pending = null
		planning = false
		approved = false
		reviewClosed = false
		planOnlyRequired = false
	})
}
