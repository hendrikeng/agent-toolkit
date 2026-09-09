import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { repositoryIdentity, taskGraphOwnershipRoot, type TaskGraphPlan } from "./task-graph-core.ts"

export interface GraphInput { path: string; hash: string | null; executable: boolean }
export interface GraphWorkspace {
	name: string
	base: string
	launchBase?: string
	path?: string
	branch?: string
	id?: string
	phase: "creating" | "capturing" | "ready"
}
export interface GraphRepository {
	source: string
	identity: string
	base: string
	sourceBranch: string
	inputs: GraphInput[]
	captureComplete?: boolean
	captureCommit?: string
	captureCheckpoint?: string
	captureBaseInputs?: GraphInput[]
	workspace?: GraphWorkspace
}
export interface GraphWorkerWorkspace extends GraphWorkspace {
	task: string
	approvedTask: string
	source: string
	owns: string[]
	terminal?: string
	launch?: { title: string; command: string }
	previousTerminals?: string[]
	prerequisites?: Record<string, string>
	setupComplete?: boolean
	integrated?: string
	integration?: { before: string; tip: string }
}
export interface GraphWorkspaces {
	version: 1
	key: string
	contractHash: string
	runId?: string
	currentCheckout: boolean
	mode: "plan-only" | "execute"
	completion?: { evidence: string; deliveryPending: boolean }
	repositories: GraphRepository[]
	workers: GraphWorkerWorkspace[]
}
export interface GraphInputSelection { repository?: string; paths: string[] }

function graphGitEnv(): NodeJS.ProcessEnv {
	// Repository selection and alternate indexes belong to this operation, not the caller's shell.
	return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1", ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_(AUTHOR|COMMITTER)_/.test(key))) }
}

export function graphGit(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: graphGitEnv() }).trimEnd()
}

// Like the trusted push tool, internal Git operations use the installed Git executable.
// Only checked graph operations belong here. Raw snapshots skip hooks and file filters.
function snapshotGit(root: string, args: string[], input?: Buffer, index?: string): Buffer {
	const git = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"].find(existsSync)
	if (!git) throw new Error("Graph input snapshots require an installed system Git executable.")
	return execFileSync(git, ["-C", root, ...args], { input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, env: { ...graphGitEnv(), ...(index ? { GIT_INDEX_FILE: index } : {}) } })
}

export function assertGraphMode(mode: GraphWorkspaces["mode"], path: string): void {
	if (mode === "plan-only" && (!path.startsWith("docs/") || !path.endsWith(".md") || path.startsWith("docs/exec-plans/"))) throw new Error("Planning-only changes must be Markdown documentation outside the execution-plan lifecycle.")
}

// Paths are literal. Never allow a glob, symlink, nested checkout, or Git metadata to widen a write.
export function graphFile(root: string, path: string): string {
	if (!path || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /^\.env(?:\.|$)/i.test(part) && part !== ".env.example") || /[\x00-\x1f*?{}]/.test(path)) throw new Error(`Graph paths must be literal repository-relative files: ${path}`)
	const parts = path.split("/")
	let target = realpathSync(root)
	for (const [index, part] of parts.entries()) {
		target = join(target, part)
		try {
			const stat = lstatSync(target)
			if (stat.isSymbolicLink() || index < parts.length - 1 && !stat.isDirectory() || index === parts.length - 1 && !stat.isFile()) throw new Error(`Graph path is not a regular file: ${path}`)
			if (stat.isDirectory() && existsSync(join(target, ".git"))) throw new Error(`Graph path crosses a nested repository: ${path}`)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	}
	return target
}

export function graphInput(root: string, path: string): GraphInput {
	const file = graphFile(root, path)
	if (!existsSync(file)) return { path, hash: null, executable: false }
	const bytes = readFileSync(file)
	return { path, hash: createHash("sha256").update(bytes).digest("hex"), executable: Boolean(lstatSync(file).mode & 0o111) }
}

export function graphDirtyPaths(root: string): string[] {
	return [...new Set([
		...graphGit(root, "diff", "--name-only", "--no-renames", "-z", "HEAD", "--").split("\0"),
		...graphGit(root, "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--").split("\0"),
		...graphGit(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0"),
	].filter(Boolean))]
}

export function captureGraphWorkspaces(root: string, plan: TaskGraphPlan, selections: GraphInputSelection[] = [], currentCheckout = false): GraphWorkspaces {
	const sources = [...new Set(plan.tasks.map((task) => realpathSync(resolve(root, task.repository ?? "."))))]
	const selected = new Map<string, string[]>()
	for (const selection of selections) {
		const source = realpathSync(resolve(root, selection.repository ?? "."))
		if (!sources.includes(source) || selected.has(source)) throw new Error("Input selection must name each approved repository at most once.")
		selected.set(source, selection.paths)
	}
	const repositories = sources.map((source) => {
		const paths = selected.get(source) ?? []
		const dirty = graphDirtyPaths(source)
		if (new Set(paths).size !== paths.length || paths.some((path) => !dirty.includes(path))) throw new Error("Import only explicitly selected dirty files, without duplicates.")
		const writing = plan.tasks.some((task) => realpathSync(resolve(root, task.repository ?? ".")) === source && task.owns.length > 0)
		if (!writing && paths.length) throw new Error("Read-only repositories cannot import dirty files.")
		return { source, identity: repositoryIdentity(source), base: graphGit(source, "rev-parse", "HEAD"), sourceBranch: graphGit(source, "rev-parse", "--abbrev-ref", "HEAD"), inputs: paths.map((path) => graphInput(source, path)), ...(writing ? { workspace: { name: `pi-graph-${randomUUID()}`, base: graphGit(source, "rev-parse", "HEAD"), phase: "creating" as const } } : {}) }
	})
	if (new Set(repositories.map((repo) => repo.identity)).size !== repositories.length) throw new Error("Use one source checkout per Git repository in a graph.")
	if (currentCheckout && repositories.some((repo) => graphDirtyPaths(repo.source).length > 0)) throw new Error("The current-checkout override requires clean repositories; use isolation for dirty inputs.")
	for (const repo of repositories) for (const input of repo.inputs) assertGraphMode(plan.mode, input.path)
	return { version: 1, key: randomUUID(), contractHash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"), currentCheckout, mode: plan.mode, repositories, workers: [] }
}

export function assertGraphInputs(repository: GraphRepository): void {
	if (repositoryIdentity(repository.source) !== repository.identity || graphGit(repository.source, "rev-parse", "HEAD") !== repository.base || graphGit(repository.source, "rev-parse", "--abbrev-ref", "HEAD") !== repository.sourceBranch) throw new Error("Graph source identity changed during approval or capture.")
	for (const input of repository.inputs) if (JSON.stringify(graphInput(repository.source, input.path)) !== JSON.stringify(input)) throw new Error(`Graph input changed: ${input.path}. Reapprove before capture.`)
}

export function saveGraphWorkspaces(path: string, state: GraphWorkspaces): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
	const temporary = `${path}.${randomUUID()}.tmp`
	writeFileSync(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 })
	renameSync(temporary, path)
}

export function readGraphWorkspaces(path: string): GraphWorkspaces {
	const state = JSON.parse(readFileSync(path, "utf8")) as GraphWorkspaces
	if (state.version !== 1 || typeof state.key !== "string" || !state.key || !/^[a-f0-9]{64}$/.test(state.contractHash) || !["plan-only", "execute"].includes(state.mode) || typeof state.currentCheckout !== "boolean" || !Array.isArray(state.repositories) || !Array.isArray(state.workers)) throw new Error("Unsupported graph workspace record.")
	const validWorkspace = (workspace: GraphWorkspace) => workspace && typeof workspace.name === "string" && /^[a-f0-9]{40,64}$/.test(workspace.base) && ["creating", "capturing", "ready"].includes(workspace.phase) && (!workspace.path || isAbsolute(workspace.path))
	if (state.repositories.some((repo) => !isAbsolute(repo.source) || !isAbsolute(repo.identity) || !/^[a-f0-9]{40,64}$/.test(repo.base) || !Array.isArray(repo.inputs) || repo.workspace && !validWorkspace(repo.workspace)) || new Set(state.repositories.map((repo) => repo.identity)).size !== state.repositories.length || state.workers.some((worker) => !validWorkspace(worker) || !/^task_[a-zA-Z0-9_-]+$/.test(worker.task) || !Array.isArray(worker.owns) || worker.owns.some((path) => typeof path !== "string") || !state.repositories.some((repo) => repo.source === worker.source)) || new Set(state.workers.map((worker) => worker.task)).size !== state.workers.length) throw new Error("Invalid graph workspace identity record.")
	return state
}

export function verifyGraphWorkspace(repository: GraphRepository, workspace: GraphWorkspace, exactHead = false, allowCapture = false): string {
	if (!workspace.path || !workspace.branch || workspace.phase !== "ready" && !(allowCapture && workspace.phase === "capturing")) throw new Error("Graph workspace preparation is incomplete; reconcile its recorded resource, never recreate it.")
	const path = realpathSync(workspace.path)
	if (path !== workspace.path || realpathSync(graphGit(path, "rev-parse", "--show-toplevel")) !== path || repositoryIdentity(path) !== repository.identity || graphGit(path, "rev-parse", "--abbrev-ref", "HEAD") !== workspace.branch) throw new Error("Graph workspace path, repository or branch changed.")
	graphGit(path, "merge-base", "--is-ancestor", workspace.base, "HEAD")
	const head = graphGit(path, "rev-parse", "HEAD")
	if (exactHead && head !== (workspace.launchBase ?? workspace.base)) throw new Error("Graph worker starting commit changed before dispatch.")
	return head
}

type OrcaJson = (args: string[]) => any

export function createGraphWorkspace(repository: GraphRepository, workspace: GraphWorkspace, orca: OrcaJson, persist: () => void): void {
	if (workspace.path) {
		verifyGraphWorkspace(repository, workspace)
		return
	}
	// Persist the name before RPC. An uncertain create is recovered by exact name, never a second create.
	persist()
	const inventory = orca(["worktree", "list", "--repo", `path:${repository.source}`, "--json"])?.result
	if (!Array.isArray(inventory?.worktrees) || inventory.truncated) throw new Error("Orca worktree inventory is incomplete.")
	const matches = inventory.worktrees.filter((item: any) => item.displayName === workspace.name || item.branch === `refs/heads/${workspace.name}`)
	if (matches.length > 1) throw new Error("Duplicate graph worktrees; reconcile before continuing.")
	const receipt = matches[0] ?? orca(["worktree", "create", "--repo", `path:${repository.source}`, "--name", workspace.name, "--base-branch", workspace.base, "--no-parent", "--setup", "skip", "--json"])?.result?.worktree
	if (!receipt?.path || !receipt?.id) throw new Error(`Orca creation has no verified receipt. Preserve and inspect ${workspace.name}.`)
	const path = realpathSync(receipt.path)
	if (path === repository.source || path.startsWith(`${repository.source}${sep}`) || repositoryIdentity(path) !== repository.identity || graphGit(path, "rev-parse", "HEAD") !== workspace.base || graphDirtyPaths(path).length) throw new Error("Orca workspace does not match the clean approved base.")
	const branch = graphGit(path, "rev-parse", "--abbrev-ref", "HEAD")
	if (receipt.branch !== `refs/heads/${branch}`) throw new Error(`Orca workspace branch does not match its receipt: expected ${receipt.branch}, found refs/heads/${branch}.`)
	Object.assign(workspace, { path, branch, id: receipt.id, phase: "ready" })
	persist()
}

function inputCommit(repository: GraphRepository, raw: boolean): string {
	const root = repository.workspace!.path!
	const directory = mkdtempSync(join(tmpdir(), "graph-input-index-"))
	const index = join(directory, "index")
	try {
		snapshotGit(root, ["read-tree", repository.base], undefined, index)
		if (raw) for (const input of repository.inputs) {
			if (input.hash === null) snapshotGit(root, ["update-index", "--force-remove", "--", input.path], undefined, index)
			else {
				const bytes = readFileSync(graphFile(repository.source, input.path))
				if (createHash("sha256").update(bytes).digest("hex") !== input.hash) throw new Error(`Graph input changed: ${input.path}`)
				const blob = snapshotGit(root, ["hash-object", "-w", "--stdin"], bytes).toString().trim()
				snapshotGit(root, ["update-index", "--add", "--cacheinfo", input.executable ? "100755" : "100644", blob, input.path], undefined, index)
			}
		}
		else if (repository.inputs.length) snapshotGit(root, ["add", "--", ...repository.inputs.map((input) => input.path)], undefined, index)
		const tree = snapshotGit(root, ["write-tree"], undefined, index).toString().trim()
		return tree === graphGit(root, "rev-parse", `${repository.base}^{tree}`) ? repository.base : snapshotGit(root, ["commit-tree", tree, "-p", repository.base, "-m", "Checkpoint approved graph inputs"]).toString().trim()
	} finally { rmSync(directory, { recursive: true, force: true }) }
}

export function importGraphInputs(repository: GraphRepository, persist: () => void): void {
	const workspace = repository.workspace!
	const head = verifyGraphWorkspace(repository, workspace, false, true)
	if (repository.captureComplete) return
	if (!repository.captureCommit) {
		if (head !== repository.base || graphDirtyPaths(workspace.path!).length) throw new Error("Input capture has no snapshot and an unexpected destination; preserve it for explicit reconciliation.")
		assertGraphInputs(repository)
		const baseInputs = repository.inputs.map((input) => graphInput(workspace.path!, input.path))
		const snapshot = inputCommit(repository, true)
		assertGraphInputs(repository)
		repository.captureBaseInputs = baseInputs
		repository.captureCommit = snapshot
		workspace.phase = "capturing"
	}
	persist() // An immutable raw-byte snapshot exists before the first destination mutation, including after a failed save.
	const commit = repository.captureCommit
	if (![repository.base, commit, repository.captureCheckpoint].includes(head)) throw new Error("Input capture HEAD changed; preserve the workspace for reconciliation.")
	const selected = repository.inputs.map((input) => input.path)
	if (graphDirtyPaths(workspace.path!).some((path) => !selected.includes(path))) throw new Error("Input capture contains unrelated changes; preserve them for reconciliation.")
	const bytes = repository.inputs.map((input) => input.hash === null ? undefined : snapshotGit(workspace.path!, ["show", `${commit}:${input.path}`]))
	// Resume only a base/approved file mixture. Never overwrite a user's third version.
	for (const [index, input] of repository.inputs.entries()) {
		if (bytes[index] && createHash("sha256").update(bytes[index]!).digest("hex") !== input.hash) throw new Error("Input snapshot does not match approval.")
		if (graphGit(workspace.path!, "diff", "--cached", "--name-only", repository.base, "--", input.path) && graphGit(workspace.path!, "diff", "--cached", "--name-only", repository.captureCheckpoint ?? commit, "--", input.path)) throw new Error(`Input capture contains a changed index: ${input.path}. Preserve it for reconciliation.`)
		const actual = graphInput(workspace.path!, input.path)
		if (JSON.stringify(actual) === JSON.stringify(input)) continue
		let base: GraphInput = { path: input.path, hash: null, executable: false }
		const entry = graphGit(workspace.path!, "ls-tree", repository.base, "--", input.path)
		if (entry) {
			if (!/^100(?:644|755) blob /.test(entry)) throw new Error("Input base is not a regular file.")
			base = { path: input.path, hash: createHash("sha256").update(snapshotGit(workspace.path!, ["show", `${repository.base}:${input.path}`])).digest("hex"), executable: entry.startsWith("100755") }
		}
		if (JSON.stringify(actual) !== JSON.stringify(repository.captureBaseInputs?.[index] ?? base)) throw new Error(`Input capture contains a changed destination: ${input.path}. Preserve it for reconciliation.`)
	}
	for (const [index, input] of repository.inputs.entries()) {
		const destination = graphFile(workspace.path!, input.path)
		if (input.hash === null) { if (existsSync(destination)) unlinkSync(destination) }
		else {
			mkdirSync(dirname(destination), { recursive: true })
			writeFileSync(destination, bytes[index]!)
			chmodSync(destination, input.executable ? 0o755 : 0o644)
		}
	}
	if (!repository.captureCheckpoint) {
		repository.captureCheckpoint = inputCommit(repository, false) // Normal Git conversions, still using a private index and no commit hooks.
	}
	persist()
	for (const input of repository.inputs) if (JSON.stringify(graphInput(workspace.path!, input.path)) !== JSON.stringify(input)) throw new Error("Git input conversion changed working files; preserve them for reconciliation.")
	snapshotGit(workspace.path!, ["read-tree", repository.captureCheckpoint])
	if (head !== repository.captureCheckpoint) snapshotGit(workspace.path!, ["update-ref", "HEAD", repository.captureCheckpoint, head])
	if (graphDirtyPaths(workspace.path!).length) throw new Error("Input checkpoint left unexpected dirty files; preserve them for reconciliation.")
	repository.captureComplete = true
	workspace.phase = "ready"
	persist()
}

export function graphOwns(owners: string[], path: string): boolean {
	return owners.some((owner) => {
		const scope = taskGraphOwnershipRoot(owner)
		return scope === "." || path === scope || path.startsWith(`${scope}/`)
	})
}

export function verifyGraphChanges(repository: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: GraphWorkspaces["mode"] = "execute"): void {
	verifyGraphWorkspace(repository, workspace)
	const check = (path: string) => {
		graphFile(workspace.path!, path)
		assertGraphMode(mode, path)
		if (!graphOwns(owners, path)) throw new Error(`Graph change is outside approved ownership: ${path}`)
	}
	for (const path of graphDirtyPaths(workspace.path!)) check(path)
	// Check imported history, including both sides of merges, not just the final tree.
	for (const commit of graphGit(workspace.path!, "rev-list", `${workspace.base}..HEAD`).split("\n").filter(Boolean)) {
		const paths = graphGit(workspace.path!, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-m", "-z", commit).split("\0").filter(Boolean)
		for (const path of paths) check(path)
		if (paths.length && graphGit(workspace.path!, "ls-tree", "-r", "-z", commit, "--", ...paths).split("\0").some((entry) => entry && !/^100(?:644|755) blob /.test(entry))) throw new Error("Graph history contains a non-regular file change.")
	}
}

export function checkpointGraphChanges(repository: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: GraphWorkspaces["mode"], paths: string[], message: string): string {
	if (!message.trim() || !paths.length || new Set(paths).size !== paths.length) throw new Error("A checkpoint needs a message and unique explicit paths.")
	verifyGraphChanges(repository, workspace, owners, mode)
	for (const path of paths) {
		graphFile(workspace.path!, path)
		assertGraphMode(mode, path)
		if (!graphOwns(owners, path)) throw new Error(`Checkpoint path is outside approved ownership: ${path}`)
	}
	try {
		graphGit(workspace.path!, "add", "--", ...paths)
		if (graphMergeHead(workspace.path!)) return verifyGraphWorkspace(repository, workspace) // Stage only; the checked integration operation owns the merge commit.
		if (graphGit(workspace.path!, "diff", "--cached", "--name-only", "--", ...paths)) graphGit(workspace.path!, "commit", "-m", message, "--", ...paths)
	} finally { verifyGraphChanges(repository, workspace, owners, mode) }
	return verifyGraphWorkspace(repository, workspace)
}

export function reconcileGraphLaunch(worker: GraphWorkerWorkspace, orca: OrcaJson, persist: () => void): void {
	if (!worker.launch || worker.terminal) return
	const inventory = orca(["terminal", "list", "--limit", "1000", "--json"])?.result
	if (!Array.isArray(inventory?.terminals) || inventory.truncated || inventory.hostScope?.omittedHostIds?.length) throw new Error("Launch recovery requires a complete terminal inventory.")
	const matches = inventory.terminals.filter((terminal: any) => terminal.title === worker.launch!.title)
	const terminal = matches[0]
	const path = terminal?.worktreePath || terminal?.worktreeId?.split("::").at(-1)
	if (matches.length !== 1 || typeof terminal.handle !== "string" || !path || realpathSync(path) !== worker.path) throw new Error(`Uncertain worker launch ${worker.launch.title}. Preserve its intent and reconcile Orca; do not launch a duplicate.`)
	worker.terminal = terminal.handle
	persist()
}

export function graphRepositoryMap(state: GraphWorkspaces, worker?: GraphWorkerWorkspace): Record<string, { path: string; head: string }> {
	return Object.fromEntries(state.repositories.map((repo) => {
		const workspace = worker?.source === repo.source ? worker : repo.workspace
		const path = workspace?.path ?? repo.source
		const head = workspace ? verifyGraphWorkspace(repo, workspace) : graphGit(path, "rev-parse", "HEAD")
		if (!workspace && (repositoryIdentity(path) !== repo.identity || head !== repo.base)) throw new Error("Read-only graph repository changed after approval.")
		if (worker?.prerequisites?.[repo.source] && (head !== worker.prerequisites[repo.source] || graphDirtyPaths(path).length)) throw new Error("A pinned prerequisite workspace changed; preserve the worker and reconcile before execution.")
		return [repo.source, { path, head }]
	}))
}

export function graphMergeHead(path: string): string | undefined {
	try { return graphGit(path, "rev-parse", "--verify", "--quiet", "MERGE_HEAD") } catch { return undefined }
}

export function integrateGraphWorker(state: GraphWorkspaces, worker: GraphWorkerWorkspace, persist: () => void): void {
	const repository = state.repositories.find((repo) => repo.source === worker.source)!
	const coordinator = repository.workspace!
	verifyGraphChanges(repository, worker, worker.owns, state.mode)
	const tip = verifyGraphWorkspace(repository, worker)
	if (!worker.integrated && state.workers.some((reader) => reader !== worker && !reader.integrated && reader.prerequisites?.[repository.source])) throw new Error("Finish dependent workers before integrating into their pinned prerequisite workspace.")
	const head = verifyGraphWorkspace(repository, coordinator)
	if (graphDirtyPaths(worker.path!).length) throw new Error("Commit scoped worker changes before integration.")
	const mergeHead = graphMergeHead(coordinator.path!)
	if (mergeHead) {
		if (mergeHead !== tip || worker.integration?.tip !== tip || worker.integration.before !== head) throw new Error("The pending merge does not belong to this integration attempt.")
		if (graphGit(coordinator.path!, "diff", "--name-only", "--diff-filter=U") || graphGit(coordinator.path!, "diff", "--name-only")) throw new Error("Resolve integration conflicts and stage exact paths with checkpoint_task_graph, then retry integration.")
		for (const path of graphDirtyPaths(coordinator.path!)) {
			graphFile(coordinator.path!, path)
			assertGraphMode(state.mode, path)
			if (!graphOwns(worker.owns, path)) throw new Error(`Merge resolution is outside worker ownership: ${path}`)
		}
		graphGit(coordinator.path!, "commit", "-m", `Integrate ${worker.task}`)
	}
	if (graphDirtyPaths(coordinator.path!).length) throw new Error("Commit scoped coordinator changes before integration.")
	if (worker.integrated) {
		if (worker.integrated !== tip) throw new Error("Worker changed after integration.")
		graphGit(coordinator.path!, "merge-base", "--is-ancestor", tip, "HEAD")
		return
	}
	if (worker.integration && worker.integration.tip !== tip) throw new Error("Worker tip changed during integration recovery.")
	worker.integration ??= { before: head, tip }
	persist()
	// Merge preserves worker ancestry, so a crash after Git succeeds is safely replayable.
	try { graphGit(coordinator.path!, "merge-base", "--is-ancestor", tip, "HEAD") }
	catch {
		if (head !== worker.integration.before) throw new Error("Integration branch changed after the recorded merge attempt; reconcile before retrying.")
		graphGit(coordinator.path!, "merge", "--no-edit", tip)
	}
	graphGit(coordinator.path!, "merge-base", "--is-ancestor", tip, "HEAD")
	if (graphDirtyPaths(coordinator.path!).length) throw new Error("Integration left dirty files; resolve and checkpoint them before retrying.")
	worker.integrated = tip
	persist()
}

export function graphWritePath(state: GraphWorkspaces, absolutePath: string, worker?: GraphWorkerWorkspace): void {
	const repository = state.repositories.find((repo) => {
		const root = worker?.source === repo.source ? worker.path : !worker ? repo.workspace?.path : undefined
		return root && absolutePath.startsWith(`${root}${sep}`)
	})
	const workspace = worker ?? repository?.workspace
	if (!repository || !workspace?.path) throw new Error("Graph writes must target the verified isolated workspace, not the source checkout.")
	verifyGraphWorkspace(repository, workspace)
	if (!repository.captureComplete && repository.workspace && !state.currentCheckout) throw new Error("Complete approved input capture before graph writes.")
	const local = relative(workspace.path, absolutePath).split(sep).join("/")
	graphFile(workspace.path, local)
	assertGraphMode(state.mode, local)
	if (worker && !graphOwns(worker.owns, local)) throw new Error(`Worker does not own ${local}.`)
}
