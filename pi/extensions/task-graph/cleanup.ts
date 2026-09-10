import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { acquireTaskGraphMutationLock, releaseTaskGraphLock, taskGraphWorkspaceRecordForLock } from "./task-graph-core.ts"
import { graphDirtyPaths, graphGit, readGraphWorkspaces, verifyGraphChanges, verifyGraphWorkspace, type GraphWorkspaces } from "./workspaces.ts"

type OrcaJson = (args: string[]) => any

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
			const file = taskGraphWorkspaceRecordForLock(lockRoot, entry)
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
