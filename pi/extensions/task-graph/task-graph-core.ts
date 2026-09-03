import { existsSync, realpathSync } from "node:fs"
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path"

export const TASK_GRAPH_USAGE = "Usage: /graph <objective-or-plan-path>"

export interface TaskGraphTask {
	id: string
	goal: string
	depends_on: string[]
	repository?: string
	owns: string[]
	specialty: string
	thinking: "medium" | "high"
	done_when: string[]
	validation: string
}

export interface TaskGraphPlan {
	objective: string
	mode: "plan-only" | "execute"
	tasks: TaskGraphTask[]
}

export function normalizeTaskGraphOwnership(plan: TaskGraphPlan, repositoryRoot: string): TaskGraphPlan {
	return {
		...plan,
		tasks: plan.tasks.map((task) => {
			const requestedRoot = resolve(repositoryRoot, task.repository?.trim() || ".")
			const taskRoot = existsSync(requestedRoot) ? realpathSync(requestedRoot) : requestedRoot
			return {
				...task,
				repository: relative(repositoryRoot, taskRoot).split(sep).join("/") || ".",
				owns: task.owns.map((owner) => {
					const raw = owner.trim()
					if (!isAbsolute(raw)) return owner
					const local = relative(taskRoot, raw)
					return local && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local)
						? local.split(sep).join("/")
						: owner
				}),
			}
		}),
	}
}

export function validateTaskGraphRepositories(plan: TaskGraphPlan, repositoryRoot: string): void {
	for (const task of plan.tasks) {
		const repository = resolve(repositoryRoot, task.repository ?? ".")
		if (!existsSync(join(repository, ".git"))) throw new Error(`Task ${task.id} repository is not a Git repository root: ${task.repository ?? "."}`)
	}
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
		const repository = posix.normalize((task.repository ?? ".").trim().replaceAll("\\", "/"))
		if (!repository || posix.isAbsolute(repository)) throw new Error(`Task ${task.id} repository must be relative to the current repository: ${task.repository || "(empty)"}`)
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
			const ownership = posix.resolve("/workspace/current", repository, normalized)
			if (!normalized || owners.some((current) => current === ownership || current.startsWith(`${ownership}/`) || ownership.startsWith(`${current}/`))) {
				throw new Error(`Write ownership must be non-empty and disjoint across repositories: ${repository}/${owner}`)
			}
			owners.push(ownership)
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
		...plan.tasks.map((task) => `${task.id} [${task.specialty}, ${task.thinking}]${task.depends_on.length ? ` ← ${task.depends_on.join(", ")}` : ""}\n  ${task.goal}\n  repo: ${task.repository ?? "."}\n  owns: ${task.owns.join(", ") || "read-only"}\n  done: ${task.done_when.join("; ")}\n  validate: ${task.validation}`),
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

export function taskGraphPromotionSource(command: string): string | undefined {
	const match = command.trim().match(/^mv (((?:(?:\.\.|[a-zA-Z0-9._-]+)\/)*)docs\/future\/[a-z0-9][a-z0-9._-]*\.md) (((?:(?:\.\.|[a-zA-Z0-9._-]+)\/)*)docs\/exec-plans\/active\/$)/)
	return match && match[2] === match[4] ? match[1] : undefined
}

export function taskGraphPromotionDestination(source: string): string | undefined {
	const match = source.match(/^((?:(?:\.\.|[a-zA-Z0-9._-]+)\/)*)docs\/future\/([a-z0-9][a-z0-9._-]*\.md)$/)
	return match ? `${match[1]}docs/exec-plans/active/${match[2]}` : undefined
}

export function isTaskGraphQueueEdit(path: string, edits: Array<{ oldText: string; newText: string }>): boolean {
	return /^docs\/exec-plans\/active\/[a-z0-9][a-z0-9._-]*\.md$/.test(path.replaceAll("\\", "/"))
		&& edits.length === 1
		&& edits[0].oldText.trim() === "- Status: ready-for-promotion"
		&& edits[0].newText.trim() === "- Status: queued"
}

function planStatus(markdown: string): string | undefined {
	const start = markdown.search(/^##\s+Metadata\s*$/im)
	if (start < 0) return undefined
	const remainder = markdown.slice(start).replace(/^##\s+Metadata\s*$/im, "")
	const end = remainder.search(/^##\s+/m)
	const metadata = end < 0 ? remainder : remainder.slice(0, end)
	return metadata.match(/^\s*-\s*Status:\s*([^\n]+)/im)?.[1].trim().toLowerCase()
}

export function planIsReadyForPromotion(markdown: string): boolean {
	return planStatus(markdown) === "ready-for-promotion"
}

export function planIsQueued(markdown: string): boolean {
	return planStatus(markdown) === "queued"
}

export function planRequiresPlanOnly(markdown: string): boolean {
	const status = planStatus(markdown)
	return !status || !["queued", "in-progress", "in-review", "validation"].includes(status)
}

export function planningDocumentRequiresPlanOnly(path: string, markdown: string): boolean {
	const local = path.replaceAll("\\", "/")
	if (/^docs\/future\/[^/]+\.md$/.test(local)) return true
	if (/^docs\/exec-plans\/active\/[^/]+\.md$/.test(local)) return planRequiresPlanOnly(markdown)
	return /^docs\/exec-plans\/.*\.md$/.test(local)
}

export function taskGraphPrompt(objective: string): string {
	return `Coordinate this objective with a task graph:

${objective}

First inspect the repository and the real execution path with read and search tools. The bash tool stays blocked until an executable graph is approved, except for moving the objective's ready-for-promotion Markdown plan from \`docs/future/\` to \`docs/exec-plans/active/\`. After the move, change only that plan's \`Status\` from \`ready-for-promotion\` to \`queued\`. Continue the same \`/graph\` run, propose an executable graph, and start the workers as soon as the user approves it. If the objective names a future or active plan file, read that file and its repository planning rules first. Treat its status, dependencies, must-land checklist, approval gates, and write targets as authoritative.

A draft or blocked plan permits planning and blocker-resolution work only. Set graph mode to plan-only and do not dispatch implementation workers. Promote a ready future before proposing its executable graph. Set mode to execute only for an active executable slice whose dependencies and approval gates are satisfied.

Keep one future file per executable slice. If one future contains independent outcomes, propose separate future files linked by Dependencies. Use graph tasks only for parallel work inside one executable slice; do not use them to hide multiple durable slices in one plan.

Then decide whether parallel workers provide a clear benefit. If the work is small or tightly coupled, explain that decision and stop. The user can run that work directly without graph overhead.

If a graph helps, call propose_task_graph with plan-only or execute mode and a DAG of two to six bounded tasks. A graph may span local Git repositories. For each task outside the current repository, set its repository to that Git root relative to the current repository (for example, \`../tracn-api\`), and keep its owned paths relative to that repository. Give each task an id, goal, dependencies, repository, owned files or areas, specialty, thinking level, completion criteria, and validation. Use medium thinking for bounded implementation work. Use high thinking for architecture, authentication or security, concurrency, data migrations, public API contracts, or difficult debugging. Keep dependency chains at most four tasks deep. Include integration and focused validation work when necessary.

The tool validates the graph and asks the user to approve, revise, or cancel it. If the user requests revisions, update the graph and call propose_task_graph again. Do not dispatch workers until an execute-mode graph is approved.

After execute approval, run \`orca skills get orchestration\` and follow that version-matched guide. Confirm Orca is ready. For active-plan execution, the coordinator owns plan lifecycle updates; set the plan's truthful execution status before dispatch instead of delegating that state to a worker. Create or bind one Run, create the tasks with their dependencies, and start every ready independent worker before waiting. Every graph worker must run \`pi-yolo\`, not plain \`pi\`. Use an Orca launch path that explicitly starts the \`pi-yolo\` command, then attach the tracked dispatch as required by the current orchestration guide. Do not use Orca's generic \`--agent pi\` launcher unless its launch receipt confirms that the effective executable is \`pi-yolo\`. Use Orca for task state, dispatch, worker lifecycle, and messages. Do not recreate those features in Pi or in project files.

Launch each worker with \`pi-yolo --thinking <task-thinking>\` in the task's repository. Resolve that repository's exact Orca selector and pass it when the worker is outside the current repository. Specialize workers through their task briefs and tools instead of permanent role classes. Keep work in each repository's current worktree unless the user requested another worktree or a concrete file conflict requires isolation. Supervise until every dispatch settles. Release completed workers, integrate the results, and run the smallest focused checks. If a medium worker fails or requests escalation, use high thinking for its one replacement attempt. Replan only a failed or blocked task, and allow at most one replacement attempt unless the user approves more.

For active-plan execution, focused task checks do not replace plan closeout. After integration, re-read the active plan and repository planning rules. Complete every must-land item, satisfy review and approval gates, run the exact validation lanes and required full verification, record evidence, update Done-Evidence and status, move the plan from active to completed, update any required evidence index, and run the repository's plan-closeout check. Do not report completion unless all required checks pass and the plan is closed. If closeout cannot finish, leave the plan in a truthful active status and report the blocker. Never close or edit dependent future plans; they remain future work until separately promoted.`
}
