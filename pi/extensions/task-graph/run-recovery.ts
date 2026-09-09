import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { posix, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { repositoryIdentity, validateTaskGraph, validateTaskGraphRepositories, type TaskGraphPlan } from "./task-graph-core.ts"
import { verifyGraphWorkspace, type GraphWorkspaces } from "./workspaces.ts"

interface RecoveryTask {
	id: string
	run_id: string
	parent_id: string | null
	spec: string
	deps: string
	status: string
}
interface RecoveryWorker {
	dispatchId: string
	taskId: string
	runId: string
	dispatchStatus: string
	agentTerminalHandle: string
}
interface RecoveryDispatch {
	id: string
	task_id: string
	run_id: string
	status: string
	assignee_handle: string
}
export interface RunRecoverySnapshot {
	run: { id: string; objective: string }
	tasks: RecoveryTask[]
	workers: RecoveryWorker[]
	dispatches: Record<string, RecoveryDispatch | null>
	terminalInventory: {
		terminals: Array<{ handle: string; worktreePath?: string; worktreeId?: string }>
		truncated?: boolean
		hostScope?: { omittedHostIds?: string[] }
	}
}

// ponytail: recover complete top-level ledgers only; nested or partial ledgers need a separate reconciliation flow.
export function validateRunRecovery(root: string, runId: string, previous: TaskGraphPlan, approved: TaskGraphPlan, snapshot: RunRecoverySnapshot, workspaces?: GraphWorkspaces) {
	const { run, tasks, workers, dispatches, terminalInventory } = snapshot
	if (workspaces) {
		if (workspaces.runId !== runId) throw new Error("Recovery workspace contract belongs to another Run.")
		for (const worker of workspaces.workers) verifyGraphWorkspace(workspaces.repositories.find((repo) => repo.source === worker.source)!, worker)
	}
	if (run?.id !== runId || !run.objective?.startsWith(`Pi task graph: ${repositoryIdentity(root)}::objective:`)) throw new Error("Recovery Run belongs to a different repository or graph kind.")
	for (const plan of [previous, approved]) {
		validateTaskGraph(plan)
		validateTaskGraphRepositories(plan, root)
		if (plan.mode !== "execute") throw new Error("Run recovery requires two approved execute contracts.")
	}
	const shape = (plan: TaskGraphPlan) => plan.tasks.map((task) => ({
		id: task.id,
		repository: repositoryIdentity(resolve(root, task.repository ?? ".")),
		owns: task.owns.map((path) => posix.normalize(path).replace(/\/$/, "")).sort(),
		dependencies: [...task.depends_on].sort(),
	})).sort((a, b) => a.id.localeCompare(b.id))
	if (!isDeepStrictEqual(shape(previous), shape(approved))) throw new Error("Recovery must preserve task identities, repositories, ownership and dependencies.")
	if (!Array.isArray(tasks) || tasks.length !== previous.tasks.length || new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Recovery requires a complete, unique task ledger.")
	const markers = previous.tasks.map((task) => `[graph-task:${task.id}][graph-contract:${createHash("sha256").update(JSON.stringify(task)).digest("hex")}]`)
	const ledger = previous.tasks.map((task, index) => {
		const matches = tasks.filter((entry) => entry.parent_id == null && typeof entry.spec === "string" && entry.spec.startsWith(markers[index]))
		if (matches.length !== 1) throw new Error(`Recovery task ${task.id} has a missing, duplicate or changed contract marker.`)
		return matches[0]
	})
	for (const [index, entry] of ledger.entries()) {
		if (!/^task_[a-zA-Z0-9_-]+$/.test(entry.id) || entry.run_id !== runId || !["pending", "ready", "dispatched", "completed", "failed", "blocked"].includes(entry.status)) throw new Error("Recovery task identity, Run or status is invalid.")
		const expected = previous.tasks[index].depends_on.map((id) => ledger[previous.tasks.findIndex((task) => task.id === id)].id).sort()
		const deps: unknown = JSON.parse(entry.deps)
		if (!Array.isArray(deps) || !isDeepStrictEqual([...deps].sort(), expected)) throw new Error(`Recovery task ${entry.id} changed dependencies.`)
	}
	if (ledger.every((task) => task.status === "completed")) throw new Error("The recovery Run is already complete.")
	if (!Array.isArray(workers) || !dispatches || !Array.isArray(terminalInventory?.terminals) || terminalInventory.truncated || terminalInventory.hostScope?.omittedHostIds?.length) throw new Error("Recovery dispatch or terminal inventory is incomplete.")
	if (Object.keys(dispatches).length !== ledger.length || ledger.some((task) => !Object.hasOwn(dispatches, task.id))) throw new Error("Recovery must inspect every task dispatch.")
	const seen = new Set<string>()
	const liveHandles = new Set<string>()
	for (const worker of workers) {
		const index = ledger.findIndex((task) => task.id === worker.taskId)
		if (index < 0 || worker.runId !== runId || typeof worker.dispatchId !== "string" || seen.has(worker.dispatchId) || !["active", "dispatched", "completed", "failed"].includes(worker.dispatchStatus)) throw new Error("Recovery has an orphan, duplicate or invalid dispatch.")
		seen.add(worker.dispatchId)
		if (["completed", "failed"].includes(worker.dispatchStatus)) continue
		const dispatch = dispatches[worker.taskId]
		if (dispatch?.id !== worker.dispatchId || ledger[index].status !== "dispatched" || liveHandles.has(worker.agentTerminalHandle)) throw new Error("Recovery live dispatch does not match the task ledger.")
		liveHandles.add(worker.agentTerminalHandle)
		const terminals = terminalInventory.terminals.filter((terminal) => terminal.handle === worker.agentTerminalHandle)
		const path = terminals[0]?.worktreePath || terminals[0]?.worktreeId?.split("::").at(-1)
		const task = approved.tasks.find((task) => task.id === previous.tasks[index].id)!
		const recorded = workspaces?.workers.find((item) => item.task === worker.taskId && item.approvedTask === task.id && item.terminal === worker.agentTerminalHandle)
		const expectedPath = workspaces ? recorded?.path : resolve(root, task.repository ?? ".")
		if (terminals.length !== 1 || !path || !expectedPath || realpathSync(path) !== realpathSync(expectedPath)) throw new Error("Recovery live worker is unavailable or in a different worktree.")
	}
	for (const task of ledger) {
		const dispatch = dispatches[task.id]
		if (dispatch === null) {
			if (task.status === "dispatched" || workers.some((worker) => worker.taskId === task.id)) throw new Error("Recovery task is missing its dispatch.")
			continue
		}
		const matches = workers.filter((worker) => worker.dispatchId === dispatch?.id)
		const worker = matches[0]
		if (!dispatch || matches.length !== 1 || dispatch.task_id !== task.id || dispatch.run_id !== runId || worker.taskId !== task.id || worker.dispatchStatus !== dispatch.status || worker.agentTerminalHandle !== dispatch.assignee_handle) throw new Error("Recovery dispatch identity or settlement is inconsistent.")
		const expected = ["completed", "failed"].includes(dispatch.status) ? dispatch.status : "dispatched"
		if (task.status !== expected) throw new Error("Recovery task and dispatch statuses disagree.")
	}
	// Only stable identity/authority fields enter the confirmation snapshot; heartbeats may advance while the user reads it.
	return {
		objective: run.objective,
		...(workspaces ? { workspaces } : {}),
		markers: approved.tasks.map((task) => markers[previous.tasks.findIndex((candidate) => candidate.id === task.id)]),
		tasks: ledger.map(({ id, spec, deps, status }) => ({ id, spec, deps, status })),
		workers: workers.map(({ dispatchId, taskId, dispatchStatus, agentTerminalHandle }) => ({ dispatchId, taskId, dispatchStatus, agentTerminalHandle })).sort((a, b) => a.dispatchId.localeCompare(b.dispatchId)),
	}
}
