import { createHash } from "node:crypto"
import { existsSync, readdirSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { join } from "node:path"
import { acquireTaskGraphMutationLock, releaseTaskGraphLock, taskGraphTerminalTitle, taskGraphWorkspaceRecordForLock, validateTaskGraph, type TaskGraphPlan } from "./task-graph-core.ts"
import { graphDirtyPaths, graphGit, readGraphWorkspaces, verifyGraphChanges, verifyGraphWorkspace, type GraphWorkspaces } from "./workspaces.ts"

type OrcaJson = (args: string[]) => any

// Reconcile only dormant Runs whose entire approved ledger never reached dispatch.
// No fabricated workspace manifest, terminal closure, task mutation or lock deletion.
export function verifyUndispatchedGraphRun(orca: OrcaJson, runKey: string, runId: string, contract: string): void {
	const plan = JSON.parse(contract) as TaskGraphPlan
	validateTaskGraph(plan)
	const read = (args: string[]) => {
		const response = orca([...args, "--json"])
		const result = response?.result
		if (response?.ok === false || !result || result.truncated || result.hostScope?.omittedHostIds?.length) throw new Error(`Undispatched Run ${runId} has unavailable or incomplete ${args[1]} evidence.`)
		return result
	}
	const snapshot = () => ({
		run: read(["orchestration", "run-show", "--id", runId]).run,
		tasks: read(["orchestration", "task-list", "--run", runId]),
		workers: read(["orchestration", "worker-list", "--run", runId]),
	})
	const before = snapshot()
	const { run, tasks, workers } = before
	if (run?.id !== runId || ![`Pi task graph: ${runKey}`, `Pi plan chain: ${runKey}`].includes(run.objective) || typeof run.coordinator_handle !== "string" || !run.coordinator_handle) throw new Error(`Undispatched Run ${runId} identity or coordinator metadata does not match its lock.`)
	if (!Array.isArray(tasks.tasks) || tasks.tasks.length !== plan.tasks.length || tasks.count !== undefined && tasks.count !== tasks.tasks.length || new Set(tasks.tasks.map((task: any) => task.id)).size !== tasks.tasks.length) throw new Error(`Undispatched Run ${runId} requires a complete, unique approved task ledger.`)
	if (!Array.isArray(workers.workers) || workers.workers.length || Object.values(workers.counts ?? {}).some((count) => count !== 0)) throw new Error(`Run ${runId} has worker history; workspace recovery is required.`)
	const terminals = read(["terminal", "list", "--limit", "1000"])
	if (!Array.isArray(terminals.terminals) || terminals.totalCount !== undefined && terminals.totalCount !== terminals.terminals.length || terminals.terminals.some((terminal: any) => typeof terminal.handle !== "string" || terminal.handle === run.coordinator_handle || terminal.title?.startsWith(taskGraphTerminalTitle(run.objective)))) throw new Error(`Run ${runId} still has a coordinator/graph terminal, or terminal evidence is incomplete.`)
	const kind = run.objective.startsWith("Pi plan chain:") ? "plan" : "graph-task"
	const ledger = plan.tasks.map((task) => {
		const marker = `[${kind}:${task.id}][graph-contract:${createHash("sha256").update(JSON.stringify(task)).digest("hex")}]`
		const matches = tasks.tasks.filter((entry: any) => entry.parent_id === null && typeof entry.spec === "string" && entry.spec.startsWith(marker))
		if (matches.length !== 1) throw new Error(`Run ${runId} task ${task.id} has missing or changed approval evidence.`)
		return matches[0]
	})
	for (const [index, task] of ledger.entries()) {
		if (typeof task.id !== "string" || !/^task_[a-zA-Z0-9_-]+$/.test(task.id) || task.run_id !== runId || !["pending", "ready"].includes(task.status) || task.result != null || task.completed_at != null) throw new Error(`Run ${runId} task ${task.id} is not demonstrably undispatched.`)
		const expected = plan.tasks[index].depends_on.map((id) => ledger[plan.tasks.findIndex((task) => task.id === id)].id).sort()
		const deps = JSON.parse(task.deps)
		if (!Array.isArray(deps) || !isDeepStrictEqual([...deps].sort(), expected)) throw new Error(`Run ${runId} task ${task.id} changed dependencies.`)
		if (read(["orchestration", "dispatch-show", "--task", task.id]).dispatch !== null) throw new Error(`Run ${runId} task ${task.id} has dispatch history or missing dispatch evidence.`)
	}
	if (!isDeepStrictEqual(before, snapshot())) throw new Error(`Run ${runId} changed during reconciliation; retry cleanup.`)
}

// Cleanup only reads completed records. Active graph recovery never needs missing worker paths.
export function cleanupGraphWorkers(state: GraphWorkspaces, lockRoot: string, orca: OrcaJson, persist: () => void) {
	const lock = acquireTaskGraphMutationLock(lockRoot)
	try { return cleanupGraphWorkersLocked(state, lockRoot, orca, persist) }
	finally { releaseTaskGraphLock(lock) }
}

function cleanupGraphWorkersLocked(state: GraphWorkspaces, lockRoot: string, orca: OrcaJson, persist: () => void) {
	if (!state.completion || !state.runId || state.cleanupWorkers !== true) throw new Error("Completed worker cleanup requires explicit approval and local closeout.")
	const removed: string[] = []
	const retained: Array<{ path: string; reason: string }> = []
	const assertNoActiveGraph = (identity: string) => {
		for (const entry of readdirSync(lockRoot).filter((name) => name.endsWith(".lock"))) {
			const file = taskGraphWorkspaceRecordForLock(lockRoot, entry, (key, run, contract) => verifyUndispatchedGraphRun(orca, key, run, contract))
			if (!file) continue
			let active: GraphWorkspaces
			try { active = readGraphWorkspaces(file) }
			catch { throw new Error(`Graph workspace record ${file} is invalid; cleanup must wait.`) }
			if (active.repositories.some((repo) => repo.identity === identity)) throw new Error(`An unfinished graph uses this repository (Run ${active.runId ?? "unbound"}, workspace record ${file}); cleanup must wait.`)
		}
	}
	const tasks = orca(["orchestration", "task-list", "--run", state.runId, "--json"])?.result
	const dispatches = orca(["orchestration", "worker-list", "--run", state.runId, "--json"])?.result
	if (!Array.isArray(tasks?.tasks) || tasks.truncated || tasks.hostScope?.omittedHostIds?.length || !Array.isArray(dispatches?.workers) || dispatches.truncated || dispatches.hostScope?.omittedHostIds?.length) throw new Error("Cleanup requires complete task and worker inventories.")
	for (const worker of state.workers) {
		if (!worker.owns.length || worker.cleanup === "removed") continue
		const path = worker.path ?? worker.name
		try {
			const repo = state.repositories.find((repo) => repo.source === worker.source)
			if (!repo?.workspace || !worker.path || !worker.id || !worker.integrated || state.repositories.some((repo) => repo.source === worker.path || repo.workspace?.path === worker.path)) throw new Error("Only isolated, integrated worker worktrees can be removed.")
			assertNoActiveGraph(repo.identity)
			const archives = join(lockRoot, "completed")
			for (const entry of existsSync(archives) ? readdirSync(archives).filter((name) => name.endsWith(".json")) : []) {
				const archived = readGraphWorkspaces(join(archives, entry))
				if (archived.repositories.some((repo) => repo.source === worker.path || repo.workspace?.path === worker.path)) throw new Error("Worker is a source or delivery worktree in another archived graph.")
			}
			const task = tasks.tasks.find((task: any) => task.id === worker.task && task.run_id === state.runId)
			const dispatch = dispatches.workers.find((dispatch: any) => dispatch.taskId === worker.task && dispatch.runId === state.runId && dispatch.agentTerminalHandle === worker.terminal)
			if (task?.status !== "completed" || dispatch?.dispatchStatus !== "completed" || !(["released", "closed"].includes(dispatch.workerState) || ["released", "closed"].includes(dispatch.terminalState) || dispatch.workerState === "unsupervised" && dispatch.resource == null)) throw new Error("Worker task and dispatch must be completed and released.")
			verifyGraphWorkspace(repo, repo.workspace)
			graphGit(repo.workspace.path!, "merge-base", "--is-ancestor", worker.integrated, "HEAD")
			if (graphDirtyPaths(repo.workspace.path!).length) throw new Error("Delivery worktree has uncheckpointed changes.")
			if (!existsSync(worker.path)) {
				if (worker.cleanup !== "pending") throw new Error("Worker path disappeared without a recorded cleanup intent.")
				const inventory = orca(["worktree", "list", "--repo", `id:${worker.id.split("::")[0]}`, "--json"])?.result
				if (!Array.isArray(inventory?.worktrees) || inventory.truncated || inventory.worktrees.some((item: any) => item.id === worker.id || item.path === worker.path)) throw new Error("Orca still tracks the missing worker, or inventory is incomplete.")
				worker.cleanup = "removed"
				persist()
				removed.push(path)
				continue
			}
			verifyGraphChanges(repo, worker, worker.owns, state.mode)
			if (verifyGraphWorkspace(repo, worker) !== worker.integrated || graphDirtyPaths(worker.path).length) throw new Error("Worker has dirty or unintegrated changes.")
			const receipt = orca(["worktree", "show", "--worktree", `id:${worker.id}`, "--json"])?.result?.worktree
			if (receipt?.id !== worker.id || receipt.path !== worker.path || receipt.branch !== `refs/heads/${worker.branch}` || receipt.isMainWorktree) throw new Error("Orca worker identity changed.")
			const terminals = orca(["terminal", "list", "--worktree", `id:${worker.id}`, "--limit", "1000", "--json"])?.result
			if (!Array.isArray(terminals?.terminals) || terminals.truncated || terminals.hostScope?.omittedHostIds?.length || terminals.terminals.length) throw new Error("Worker worktree still has terminals, or terminal inventory is incomplete.")
			worker.cleanup = "pending"
			persist()
			assertNoActiveGraph(repo.identity)
			if (verifyGraphWorkspace(repo, worker) !== worker.integrated || graphDirtyPaths(worker.path).length) throw new Error("Worker changed before removal.")
			// Explicitly approved graph-owned paths only. No force, hooks, shell, or manual filesystem fallback.
			orca(["worktree", "rm", "--worktree", `id:${worker.id}`, "--json"])
			if (existsSync(worker.path)) throw new Error("Orca did not remove the worker worktree.")
			worker.cleanup = "removed"
			persist()
			removed.push(path)
		} catch (error) { retained.push({ path, reason: error instanceof Error ? error.message : String(error) }) }
	}
	const deliveries: Array<{ path: string; label: string }> = []
	for (const repo of state.repositories) {
		const workspace = repo.workspace
		if (!workspace?.path || !workspace.id || workspace.path === repo.source) continue
		try {
			assertNoActiveGraph(repo.identity)
			verifyGraphWorkspace(repo, workspace)
			const receipt = orca(["worktree", "show", "--worktree", `id:${workspace.id}`, "--json"])?.result?.worktree
			if (receipt?.id !== workspace.id || receipt.path !== workspace.path || receipt.branch !== `refs/heads/${workspace.branch}` || receipt.isMainWorktree) throw new Error("Orca delivery identity changed.")
			const label = receipt.displayName && receipt.displayName !== workspace.name ? receipt.displayName : `${state.label?.slice(0, 80) || state.runId} · delivery`
			if (receipt.displayName !== label) orca(["worktree", "set", "--worktree", `id:${workspace.id}`, "--display-name", label, "--json"])
			deliveries.push({ path: workspace.path, label })
		} catch (error) { retained.push({ path: workspace.path, reason: `Delivery label unchanged: ${error instanceof Error ? error.message : String(error)}` }) }
	}
	return { removed, retained, deliveries }
}
