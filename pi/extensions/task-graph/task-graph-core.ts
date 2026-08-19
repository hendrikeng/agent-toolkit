import { posix } from "node:path"

export const TASK_GRAPH_USAGE = "Usage: /graph <objective-or-plan-path>"

export interface TaskGraphTask {
	id: string
	goal: string
	depends_on: string[]
	owns: string[]
	specialty: string
	done_when: string[]
	validation: string
}

export interface TaskGraphPlan {
	objective: string
	mode: "plan-only" | "execute"
	tasks: TaskGraphTask[]
}

export function validateTaskGraph(plan: TaskGraphPlan): void {
	if (plan.tasks.length < 2 || plan.tasks.length > 6) throw new Error("A task graph must contain two to six tasks.")

	const ids = new Set<string>()
	const owners: string[] = []
	for (const task of plan.tasks) {
		if (!task.id.trim() || ids.has(task.id)) throw new Error(`Task IDs must be non-empty and unique: ${task.id || "(empty)"}`)
		if (!task.goal.trim() || !task.specialty.trim() || !task.validation.trim() || task.done_when.length === 0 || task.done_when.some((criterion) => !criterion.trim())) {
			throw new Error(`Task ${task.id} needs a goal, specialty, non-empty completion criteria, and validation.`)
		}
		ids.add(task.id)
		for (const owner of task.owns) {
			const raw = owner.trim()
			if (!raw) throw new Error("Write ownership must be non-empty and disjoint: (empty)")
			let normalized = posix.normalize(raw.replaceAll("\\", "/"))
			if (posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
				throw new Error(`Write ownership must be repository-relative: ${owner}`)
			}
			const globIndex = normalized.search(/[*?[\]{}]/)
			if (globIndex >= 0) {
				const slash = normalized.slice(0, globIndex).lastIndexOf("/")
				normalized = slash >= 0 ? normalized.slice(0, slash) : "."
			}
			normalized = normalized.replace(/\/$/, "") || "."
			if (!normalized || owners.some((current) => current === "." || normalized === "." || current === normalized || current.startsWith(`${normalized}/`) || normalized.startsWith(`${current}/`))) {
				throw new Error(`Write ownership must be non-empty and disjoint: ${owner}`)
			}
			owners.push(normalized)
		}
	}

	for (const task of plan.tasks) {
		for (const dependency of task.depends_on) {
			if (!ids.has(dependency)) throw new Error(`Task ${task.id} has unknown dependency ${dependency}.`)
			if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself.`)
		}
	}

	const byId = new Map(plan.tasks.map((task) => [task.id, task]))
	const depth = (id: string, path = new Set<string>()): number => {
		if (path.has(id)) throw new Error(`The task graph contains a cycle at ${id}.`)
		const nextPath = new Set(path).add(id)
		return 1 + Math.max(0, ...byId.get(id)!.depends_on.map((dependency) => depth(dependency, nextPath)))
	}
	if (Math.max(...plan.tasks.map((task) => depth(task.id))) > 4) throw new Error("Task dependency chains must be at most four tasks deep.")
}

export function formatTaskGraph(plan: TaskGraphPlan): string {
	return [
		`${plan.objective}\nmode: ${plan.mode}`,
		...plan.tasks.map((task) => `${task.id} [${task.specialty}]${task.depends_on.length ? ` ← ${task.depends_on.join(", ")}` : ""}\n  ${task.goal}\n  owns: ${task.owns.join(", ") || "read-only"}\n  done: ${task.done_when.join("; ")}\n  validate: ${task.validation}`),
	].join("\n\n")
}

interface TaskGraphReviewUi {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>
}

export type TaskGraphReview =
	| { status: "approved" | "plan-approved" }
	| { status: "revise"; feedback: string }
	| { status: "cancelled" }

export async function reviewTaskGraph(plan: TaskGraphPlan, ui: TaskGraphReviewUi, signal?: AbortSignal): Promise<TaskGraphReview> {
	validateTaskGraph(plan)
	const approveLabel = plan.mode === "execute" ? "Approve and execute" : "Approve plan only"
	const options = signal ? { signal } : undefined
	const choice = await ui.select(`Review task graph\n\n${formatTaskGraph(plan)}`, [approveLabel, "Revise the plan", "Cancel"], options)
	if (choice === approveLabel) return { status: plan.mode === "execute" ? "approved" : "plan-approved" }
	if (choice === "Revise the plan") {
		const feedback = (await ui.input("Plan revisions", "What must change?", options))?.trim()
		if (feedback) return { status: "revise", feedback }
	}
	return { status: "cancelled" }
}

export function planRequiresPlanOnly(markdown: string): boolean {
	const start = markdown.search(/^## Metadata\s*$/im)
	if (start < 0) return true
	const remainder = markdown.slice(start).replace(/^## Metadata\s*$/im, "")
	const end = remainder.search(/^##\s+/m)
	const metadata = end < 0 ? remainder : remainder.slice(0, end)
	const status = metadata.match(/^- Status:\s*([^\n]+)/im)?.[1].trim().toLowerCase()
	return !status || !["queued", "in-progress", "in-review", "validation"].includes(status)
}

export function taskGraphPrompt(objective: string): string {
	return `Coordinate this objective with a task graph:

${objective}

First inspect the repository and the real execution path with read and search tools. The bash tool stays blocked until an executable graph is approved. If the objective names a future or active plan file, read that file and its repository planning rules first. Treat its status, dependencies, must-land checklist, approval gates, and write targets as authoritative.

A draft or blocked plan permits planning and blocker-resolution work only. Set graph mode to plan-only and do not dispatch implementation workers. A ready future must follow repository promotion rules before execution. Set mode to execute only for an active executable slice whose dependencies and approval gates are satisfied.

Keep one future file per executable slice. If one future contains independent outcomes, propose separate future files linked by Dependencies. Use graph tasks only for parallel work inside one executable slice; do not use them to hide multiple durable slices in one plan.

Then decide whether parallel workers provide a clear benefit. If the work is small or tightly coupled, explain that decision and stop. The user can run that work directly without graph overhead.

If a graph helps, call propose_task_graph with plan-only or execute mode and a DAG of two to six bounded tasks. Give each task an id, goal, dependencies, owned files or areas, specialty, completion criteria, and validation. Keep dependency chains at most four tasks deep. Include integration and focused validation work when necessary.

The tool validates the graph and asks the user to approve, revise, or cancel it. If the user requests revisions, update the graph and call propose_task_graph again. Do not dispatch workers until an execute-mode graph is approved.

After execute approval, run \`orca skills get orchestration\` and follow that version-matched guide. Confirm Orca is ready. Create or bind one Run, create the tasks with their dependencies, and start every ready independent worker before waiting. Every graph worker must run \`pi-yolo\`, not plain \`pi\`. Use an Orca launch path that explicitly starts the \`pi-yolo\` command, then attach the tracked dispatch as required by the current orchestration guide. Do not use Orca's generic \`--agent pi\` launcher unless its launch receipt confirms that the effective executable is \`pi-yolo\`. Use Orca for task state, dispatch, worker lifecycle, and messages. Do not recreate those features in Pi or in project files.

Specialize workers through their task briefs and tools instead of permanent role classes. Keep work in the current worktree unless the user requested another worktree or a concrete file conflict requires isolation. Supervise until every dispatch settles. Release completed workers, integrate the results, and run the smallest focused checks. Replan only a failed or blocked task, and allow at most one replacement attempt unless the user approves more.`
}
