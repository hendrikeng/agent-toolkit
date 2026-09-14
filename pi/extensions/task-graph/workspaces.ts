import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { acquireLease, assertGraphMode, digest, graphGit, graphLeaseState, literalPath, owns, repositoryIdentity, repositoryRoot, saveRecord, validateTaskGraph, type Orca, type TaskGraphPlan } from "./task-graph-core.ts"
export { graphGit } from "./task-graph-core.ts"

export interface GraphInput { path: string; hash: string | null; executable: boolean; bytes: string | null }
export interface GraphWorkspace { role: "integration" | "snapshot" | "lane"; name: string; base: string; path?: string; branch?: string; id?: string; captureCommit?: string }
export interface GraphRepository { source: string; identity: string; base: string; inputs: GraphInput[]; workspace?: GraphWorkspace; sourceSeal?: string; sourceBranches?: string; preparation?: { configuration: unknown; hash: string } }
export interface GraphLane { id: string; source: string; workspace: GraphWorkspace; task?: string; previousTasks: string[]; blocked?: string; cleanup?: "pending" | "removed" }
export interface GraphWorker { task: string; ledgerTask: string; source: string; lane?: string; workspace: string; base: string; prerequisites: Record<string, string>; attempt: number; launch?: { title: string; command: string }; terminal?: string; dispatch?: string; integration?: { before: string; tip: string }; integrated?: string; repair?: { reason: string; integrationHead: string }; validationPending?: string }
export interface GraphRecord {
 version: 4
 key: string
 root: string
 plan: TaskGraphPlan
 workerModel?: string
 repositories: GraphRepository[]
 lanes: GraphLane[]
 workers: Record<string, GraphWorker>
 runId?: string
 resources?: Record<string, any>
 completed: Record<string, { head: string; integrationHead: string; evidence: string; deliveryPending?: boolean; validationPending?: string }>
 plans?: Array<{ id: string; source: string; filename: string }>
 completion?: { evidence: string; deliveryPending: boolean }
}
export function graphFile(root: string, path: string): string {
 literalPath(path)
 let target = realpathSync(root)
 const parts = path.split("/")
 for (const [index, part] of parts.entries()) {
  target = join(target, part)
  if (!existsSync(target)) {
   try { if (lstatSync(target).isSymbolicLink()) throw new Error("Broken symlink in graph path.") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
   continue
  }
  const stat = lstatSync(target)
  if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() || existsSync(join(target, ".git")) : !stat.isFile())) throw new Error(`Graph path must be a regular file without symlinks or nested repositories: ${path}`)
 }
 return target
}
export function graphInput(root: string, path: string): GraphInput {
 const file = graphFile(root, path)
 const bytes = existsSync(file) ? readFileSync(file) : null
 if (bytes && bytes.length > 8 * 1024 * 1024) throw new Error("Graph inputs are limited to 8 MiB per file.")
 return { path, hash: bytes === null ? null : digest(bytes), executable: bytes !== null && Boolean(lstatSync(file).mode & 0o111), bytes: bytes?.toString("base64") ?? null }
}
export function graphDirtyPaths(root: string): string[] {
 return [...new Set([graphGit(root, "diff", "--name-only", "--no-renames", "-z", "HEAD", "--"), graphGit(root, "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"), graphGit(root, "ls-files", "--others", "--exclude-standard", "-z")].flatMap(value => value.split("\0")).filter(Boolean))]
}
export function sourceSeal(root: string): string {
 const index = resolve(root, graphGit(root, "rev-parse", "--git-path", "index"))
 return digest(JSON.stringify([graphGit(root, "rev-parse", "HEAD"), existsSync(index) ? digest(readFileSync(index)) : null, graphGit(root, "diff", "--binary", "HEAD", "--"), graphGit(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).map(path => { const stat = lstatSync(join(root, path), { bigint: true }); return [path, String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)] })]))
}
export function captureGraphWorkspaces(root: string, plan: TaskGraphPlan): GraphRecord {
 validateTaskGraph(plan, root)
 const key = randomUUID(), label = (plan.objective.split("/").at(-1) ?? plan.objective).replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "task"
 const sources = [...new Set(plan.tasks.map(task => realpathSync(resolve(root, task.repository))))]
 const inputs = new Map<string, string[]>()
 for (const selection of plan.inputs ?? []) {
  const source = realpathSync(resolve(root, selection.repository))
  if (!sources.includes(source) || inputs.has(source) || new Set(selection.paths).size !== selection.paths.length || selection.paths.length > 100) throw new Error("Input selections need unique task repositories and exact unique files.")
  inputs.set(source, selection.paths)
 }
 const repositories = sources.map(source => {
  const base = plan.foundations.find(item => realpathSync(resolve(root, item.repository)) === source)!.commit
  const selected = inputs.get(source) ?? []
  if (selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Dirty inputs require the selected source HEAD as foundation.")
  if (selected.some(path => !graphDirtyPaths(source).includes(path))) throw new Error("Capture only explicitly selected dirty inputs.")
  const writing = plan.tasks.some(task => realpathSync(resolve(root, task.repository)) === source && task.owns.length)
  if (!writing && !selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Read-only inspection without a workspace requires source HEAD as its foundation.")
  const role = writing ? "integration" : "snapshot"
  const workspace = writing || selected.length ? { role, name: `graph-${label}-${key.slice(0, 8)}-${role}`, base } as GraphWorkspace : undefined
  return { source, sourceSeal: sourceSeal(source), sourceBranches: graphGit(source, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), identity: repositoryIdentity(source), base, inputs: selected.map(path => graphInput(source, path)), ...(workspace ? { workspace } : {}) }
 })
 const record: GraphRecord = { version: 4, key, root: realpathSync(root), plan: structuredClone(plan), repositories, lanes: [], workers: {}, completed: {} }
 validateSelectedPlan(record)
 return record
}
export function readGraphAdmission(file: string, identities: string[], root?: string): GraphRecord | undefined {
 const saved = JSON.parse(readFileSync(file, "utf8"))
 if (saved.completion) return undefined
 if (saved.version === 4 && root && saved.root === root) return readGraphRecord(file)
 const historical = Array.isArray(saved.repositories) ? saved.repositories.map((repo: any) => repo?.identity).filter((identity: unknown): identity is string => typeof identity === "string") : []
 if (!historical.some((identity: string) => identities.includes(identity))) return undefined
 if (saved.version === 4) return readGraphRecord(file)
 if (!saved.completion) throw new Error(`An unfinished historical graph still owns a selected repository. Preserve it for inspection: ${file}`)
 return undefined
}
export function readGraphRecord(file: string): GraphRecord {
 const record = JSON.parse(readFileSync(file, "utf8"))
 if (record.version !== 4) throw new Error(`Graph ownership [development-roots-v1]: this approval uses an older contract. Preserve it and its Run; do not migrate or restart it. Record: ${file}`)
 if (!/^[a-f0-9-]{36}$/.test(record.key) || !record.root || !Array.isArray(record.repositories) || !Array.isArray(record.lanes) || !record.workers || !record.completed) throw new Error("Invalid graph record. Preserve it for inspection.")
 validateTaskGraph(record.plan, record.root)
 const selected = record.plan.foundations.map((item: any) => ({ source: realpathSync(resolve(record.root, item.repository)), base: item.commit }))
 if (record.repositories.length !== selected.length || record.repositories.some((repo: GraphRepository) => !selected.some((item: any) => item.source === repo.source && item.base === repo.base) || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Workspace foundations no longer match approval.")
 for (const repo of record.repositories as GraphRepository[]) for (const input of repo.inputs) {
  literalPath(input.path)
  if (input.hash !== (input.bytes === null ? null : digest(Buffer.from(input.bytes, "base64")))) throw new Error("Input snapshot hash changed.")
 }
 if (record.lanes.some((lane: GraphLane) => !record.repositories.some((repo: GraphRepository) => repo.source === lane.source) || lane.workspace.role !== "lane") || Object.entries(record.workers as Record<string, GraphWorker>).some(([id, worker]) => worker.task !== id || !record.plan.tasks.some((task: any) => task.id === id))) throw new Error("Invalid lane or worker record.")
 return record
}
export function graphTaskSpec(record: GraphRecord, task: TaskGraphPlan["tasks"][number], legacy = false): string {
 const finish = legacy ? "Use checkpoint_task_graph for commits." : "Checkpoint all final writes first, then run the exact Validation command on the clean checkpoint as your final non-inspection command before reporting completion. Validation before the final checkpoint does not count."
 return `[graph-v4:${record.key}:${task.id}]\n${task.goal}\nOwn only: ${task.owns.join(", ") || "read-only"}.\nDone when:\n${task.done_when.map(item => `- ${item}`).join("\n")}\n${task.setup ? `Setup: ${task.setup}\n` : ""}Validation: ${task.validation}\n${finish} Do not publish, delete worktrees, or modify unrelated paths.`
}
export function matchesGraphTaskSpec(record: GraphRecord, task: TaskGraphPlan["tasks"][number], spec: string): boolean {
 return spec === graphTaskSpec(record, task) || spec === graphTaskSpec(record, task, true)
}

class RetirementBlocker extends Error {
 readonly state: "active" | "running-worker" | "live-resource" | "uncertain"
 constructor(state: RetirementBlocker["state"], message: string) { super(message); this.state = state }
}
const retirementBlock = (state: RetirementBlocker["state"], message: string): never => { throw new RetirementBlocker(state, message) }
function completeInventory(response: any, field: string, label: string): any[] {
 const result = response?.result
 if (!Array.isArray(result?.[field]) || result.truncated || result.hostScope?.omittedHostIds?.length) retirementBlock("uncertain", `Incomplete Orca ${label} inventory.`)
 return result[field]
}
function authoritativeAbsence(path: string): boolean {
 if (!isAbsolute(path) || resolve(path) !== path) retirementBlock("uncertain", "A recorded worktree path is not an exact absolute path.")
 try {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) retirementBlock("uncertain", "A recorded worktree path is a symlink.")
  return false
 } catch (error) {
  if (error instanceof RetirementBlocker) throw error
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") retirementBlock("uncertain", "A recorded worktree path cannot be inspected.")
 }
 let parent = dirname(path)
 while (parent !== dirname(parent)) {
  try {
   const stat = lstatSync(parent)
   if (stat.isSymbolicLink() || realpathSync(parent) !== parent) retirementBlock("uncertain", "A missing worktree path has ambiguous symlink ancestry.")
   return true
  } catch (error) {
   if (error instanceof RetirementBlocker) throw error
   if ((error as NodeJS.ErrnoException).code !== "ENOENT") retirementBlock("uncertain", "A missing worktree path cannot be inspected.")
  }
  parent = dirname(parent)
 }
 retirementBlock("uncertain", "A missing worktree path has no verifiable physical ancestor.")
}
function inspectRecordedWorktrees(state: GraphRecord, orca: Orca, unstarted: boolean) {
 const workspaces = state.repositories.flatMap(repo => [repo.workspace, ...state.lanes.filter(lane => lane.source === repo.source).map(lane => lane.workspace)].filter((workspace): workspace is GraphWorkspace => Boolean(workspace)).map(workspace => ({ repo, workspace })))
 if (!workspaces.length) return []
 let repos: any[]
 try { repos = completeInventory(orca(["repo", "list", "--json"]), "repos", "repository") } catch (error) { if (error instanceof RetirementBlocker) throw error; retirementBlock("uncertain", "Orca repository inventory is unavailable.") }
 if (repos.some((repo, index) => !repo?.id || repos.findIndex(other => other.id === repo.id) !== index)) retirementBlock("uncertain", "Orca repository inventory contains missing or duplicate identities.")
 const inventoried: Array<{ repoId: string; item: any }> = []
 for (const repo of repos) {
  try { for (const item of completeInventory(orca(["worktree", "list", "--repo", `id:${repo.id}`, "--json"]), "worktrees", "worktree")) inventoried.push({ repoId: repo.id, item }) }
  catch (error) { if (error instanceof RetirementBlocker) throw error; retirementBlock("uncertain", "Orca worktree inventory is unavailable.") }
 }
 if (new Set(workspaces.map(({ workspace }) => workspace.id)).size !== workspaces.length || new Set(workspaces.map(({ workspace }) => workspace.path)).size !== workspaces.length) retirementBlock("uncertain", "The graph record contains duplicate worktree identities or paths.")
 return workspaces.map(({ repo, workspace }) => {
  if (!workspace.id || !workspace.path || !workspace.branch) retirementBlock("uncertain", "A recorded worktree receipt is incomplete.")
  const repoId = workspace.id.split("::")[0], owners = repos.filter(item => item.id === repoId)
  if (owners.length !== 1) retirementBlock("uncertain", "A recorded worktree repository identity is missing or duplicated.")
  try { if (!owners[0].path || repositoryIdentity(owners[0].path) !== repo.identity) retirementBlock("uncertain", "A recorded worktree belongs to a foreign repository.") }
  catch (error) { if (error instanceof RetirementBlocker) throw error; retirementBlock("uncertain", "A recorded worktree repository identity is uncertain.") }
  const matches = inventoried.filter(({ item }) => item?.id === workspace.id || item?.path === workspace.path)
  const absent = authoritativeAbsence(workspace.path)
  if (absent) {
   if (matches.length) retirementBlock("uncertain", "Orca and the filesystem disagree about a missing recorded worktree.")
   if (unstarted) retirementBlock("uncertain", "An unstarted graph worktree is missing.")
   return { id: workspace.id, path: workspace.path, branch: workspace.branch, role: workspace.role, status: "verified-absent" }
  }
  if (matches.length !== 1 || matches[0].repoId !== repoId || matches[0].item.id !== workspace.id || matches[0].item.path !== workspace.path || matches[0].item.branch !== `refs/heads/${workspace.branch}`) retirementBlock("uncertain", "An existing recorded worktree does not match its exact Orca identity, repository, path, or branch.")
  let head: string
  try { head = verifyGraphWorkspace(repo, workspace) } catch { retirementBlock("uncertain", "An existing recorded worktree does not match its retained Git identity or state.") }
  const merge = Boolean(graphMergeHead(workspace.path)), dirty = Boolean(graphDirtyPaths(workspace.path).length)
  if (workspace.role === "integration" && (head !== (workspace.captureCommit ?? workspace.base) || merge || dirty)) retirementBlock("uncertain", "An integration worktree has changed or has a mutation in progress.")
  if (unstarted && (head !== workspace.captureCommit || merge || dirty)) retirementBlock("uncertain", "Unstarted retirement requires every integration worktree to be clean and unchanged.")
  return { id: workspace.id, path: workspace.path, branch: workspace.branch, role: workspace.role, status: "verified-existing", head, dirty, merge }
 })
}
function inspectOrchestration(state: GraphRecord, orca: Orca, completedGraph = false): void {
 const runs: any[] = []; let cursor: string | undefined; const cursors = new Set<string>()
 do {
  let result: any
  try { result = orca(["orchestration", "run-list", "--limit", "100", ...(cursor ? ["--cursor", cursor] : []), "--json"])?.result } catch { retirementBlock("uncertain", "Orca Run inventory is unavailable.") }
  if (!Array.isArray(result?.runs) || result.truncated || result.hostScope?.omittedHostIds?.length) retirementBlock("uncertain", "Incomplete Orca Run inventory.")
  runs.push(...result.runs); cursor = result.nextCursor || undefined
  if (cursor && cursors.has(cursor)) retirementBlock("uncertain", "Orca Run inventory repeated a cursor.")
  if (cursor) cursors.add(cursor)
 } while (cursor)
 const objective = `Pi graph v4: ${state.key}: ${state.plan.objective}`, matches = runs.filter(run => run?.id === state.runId || run?.objective === objective)
 if (matches.length !== 1 || matches[0].id !== state.runId || matches[0].objective !== objective) retirementBlock("uncertain", "The graph Run is missing, duplicated, foreign, or changed.")
 let shown: any
 try { shown = orca(["orchestration", "run-show", "--id", state.runId!, "--json"])?.result?.run } catch { retirementBlock("uncertain", "The graph Run receipt is unavailable.") }
 if (shown?.id !== state.runId || shown.objective !== objective) retirementBlock("uncertain", "The graph Run receipt is missing, foreign, or changed.")
 let tasks: any[]
 try { tasks = completeInventory(orca(["orchestration", "task-list", "--run", state.runId!, "--json"]), "tasks", "task") } catch (error) { if (error instanceof RetirementBlocker) throw error; retirementBlock("uncertain", "Orca task inventory is unavailable.") }
 if (tasks.length !== state.plan.tasks.length) retirementBlock("uncertain", `The graph ledger has ${tasks.length} tasks; the graph record declares ${state.plan.tasks.length}.`)
 for (const task of tasks) {
  if (task?.run_id !== state.runId) retirementBlock("uncertain", `Ledger task ${String(task?.id)} belongs to another Run.`)
  if (task.parent_id != null) retirementBlock("uncertain", `Ledger task ${String(task.id)} is not a top-level graph task.`)
  if (completedGraph ? task.status !== "completed" : task.status === "completed") retirementBlock("uncertain", `Ledger task ${String(task.id)} has incompatible status ${String(task.status)}.`)
  if (!state.plan.tasks.some(declaration => matchesGraphTaskSpec(state, declaration, task.spec))) retirementBlock("uncertain", `Ledger task ${String(task.id)} does not match a declared graph task.`)
 }
 for (const declaration of state.plan.tasks) if (tasks.filter(task => matchesGraphTaskSpec(state, declaration, task.spec)).length !== 1) retirementBlock("uncertain", `Declared task ${declaration.id} has a missing or duplicated ledger receipt.`)
 const workers = Object.values(state.workers)
 if (new Set(workers.map(worker => worker.ledgerTask)).size !== workers.length || new Set(workers.map(worker => worker.dispatch)).size !== workers.length) retirementBlock("uncertain", "The graph record contains duplicated worker task or dispatch receipts.")
 for (const declaration of state.plan.tasks) {
  const ledger = tasks.find(task => matchesGraphTaskSpec(state, declaration, task.spec)), worker = workers.find(item => item.task === declaration.id)
  if (!worker && (completedGraph || !["pending", "ready"].includes(ledger.status))) retirementBlock(ledger.status === "dispatched" ? "running-worker" : "uncertain", `Task ${declaration.id} has status ${String(ledger.status)} without a worker receipt.`)
 }
 for (const worker of workers) {
  const declaration = state.plan.tasks.find(task => task.id === worker.task), ledger = declaration && tasks.find(task => task.id === worker.ledgerTask && matchesGraphTaskSpec(state, declaration, task.spec))
  const repo = declaration && state.repositories.find(repo => repo.source === realpathSync(resolve(state.root, declaration.repository)))
  const lane = worker.lane && state.lanes.find(item => item.id === worker.lane)
  if (!declaration) retirementBlock("uncertain", `Worker ${worker.task} has no declared graph task.`)
  if (!ledger) retirementBlock("uncertain", `Worker ${worker.task} has no exact ledger task receipt.`)
  if (!repo || worker.source !== repo.source) retirementBlock("uncertain", `Worker ${worker.task} repository identity changed.`)
  if (worker.integration) retirementBlock("uncertain", `Worker ${worker.task} has an integration mutation in progress.`)
  if (!completedGraph && worker.integrated) retirementBlock("uncertain", `Worker ${worker.task} already has an integrated commit.`)
  if (!completedGraph && (declaration.owns.length ? !lane || lane.task !== worker.task || lane.source !== worker.source || lane.workspace.path !== worker.workspace || lane.cleanup : Boolean(worker.lane))) retirementBlock("uncertain", "A worker lane assignment changed.")
  if (!worker.dispatch || !completedGraph && !worker.terminal) retirementBlock("uncertain", "A recorded worker has no complete dispatch receipt.")
  let dispatch: any
  try { dispatch = orca(["orchestration", "dispatch-show", "--task", worker.ledgerTask, "--json"])?.result?.dispatch } catch { retirementBlock("uncertain", "A recorded worker dispatch is unavailable.") }
  if (dispatch?.id !== worker.dispatch || dispatch.task_id !== worker.ledgerTask || dispatch.run_id !== state.runId || !completedGraph && dispatch.assignee_handle !== worker.terminal) retirementBlock("uncertain", "A recorded worker dispatch is missing, foreign, duplicated, or changed.")
  if (!["completed", "failed"].includes(dispatch.status)) retirementBlock("running-worker", `Worker ${worker.task} has nonterminal dispatch status ${String(dispatch.status)}.`)
  if (!completedGraph) {
   let wait: any
   try { wait = orca(["terminal", "wait", "--terminal", worker.terminal!, "--for", "exit", "--timeout-ms", "1", "--json"])?.result?.wait } catch { retirementBlock("uncertain", `Worker ${worker.task} terminal exit cannot be verified.`) }
   if (wait?.satisfied !== true) retirementBlock("running-worker", `Worker ${worker.task} terminal has not verifiably exited.`)
  }
 }
 if (!completedGraph && state.lanes.some(lane => lane.previousTasks.length || !lane.task || !state.workers[lane.task] || lane.cleanup)) retirementBlock("uncertain", "A recorded lane does not match an unsettled worker.")
}
function inspectStartedResources(state: GraphRecord, runtime: any, verifyResource?: (record: any, runtime: any, enforceLifetime?: boolean, recordEndpoint?: boolean, rebaselineLegacyStart?: boolean, recordConfiguration?: boolean) => any): void {
 const declarations = state.plan.resources ?? [], resources = state.resources ?? {}, keys = Object.keys(resources)
 if (keys.length !== declarations.length || declarations.some(declaration => !Object.hasOwn(resources, declaration.id) || JSON.stringify(resources[declaration.id]?.declaration) !== JSON.stringify(declaration))) retirementBlock("uncertain", "Each declared resource must have one exact recorded identity.")
 if (declarations.length && !verifyResource) retirementBlock("uncertain", "Resource identity verification is unavailable.")
 let ids: string[], containers: any[]
 try { ids = runtime.list(); containers = ids.map(id => runtime.inspect(id)) } catch { retirementBlock("uncertain", "The local resource inventory is unavailable.") }
 if (!Array.isArray(ids) || new Set(ids).size !== ids.length) retirementBlock("uncertain", "The local resource inventory contains duplicate identities.")
 const recordedIds = new Set(keys.map(key => resources[key]?.id)), scoped = containers.filter(container => container?.Config?.Labels?.["agent-toolkit.scope"] === state.key)
 if (scoped.length !== declarations.length || scoped.some(container => !recordedIds.has(container?.Id))) retirementBlock("uncertain", "The graph scope contains an unrecorded or duplicated resource identity.")
 for (const declaration of declarations) {
  const resource = resources[declaration.id]
  if (!/^[a-f0-9]{64}$/.test(resource?.id ?? "") || !ids.includes(resource.id)) retirementBlock("uncertain", `Resource ${declaration.id} is missing.`)
  if (!Number.isFinite(resource.createdAt)) retirementBlock("uncertain", `Resource ${declaration.id} has no recorded creation time.`)
  const owned = containers.filter(container => container?.Config?.Labels?.["agent-toolkit.scope"] === state.key && container?.Config?.Labels?.["agent-toolkit.token"] === resource.token)
  if (owned.length !== 1 || owned[0]?.Id !== resource.id) retirementBlock("uncertain", `Resource ${declaration.id} has a missing or duplicated identity.`)
  let details: any
  try { details = verifyResource(resource, runtime, false, false, false, false) } catch { retirementBlock("uncertain", `Resource ${declaration.id} identity verification failed.`) }
  if (details?.State?.Running) retirementBlock("live-resource", `Resource ${declaration.id} is live.`)
  if (resource.stopped !== true || resource.ready !== false || details?.State?.Running !== false) retirementBlock("uncertain", `Resource ${declaration.id} is not recorded as stopped.`)
 }
}
function assessGraphRetirement(file: string, runtime: any, orca?: Orca, verifyResource?: (record: any, runtime: any, enforceLifetime?: boolean, recordEndpoint?: boolean, rebaselineLegacyStart?: boolean, recordConfiguration?: boolean) => any) {
 const state = readGraphRecord(file), workers = Object.values(state.workers)
 if (!state.runId || state.completion) retirementBlock("uncertain", "Retire only an incomplete current-v4 graph with a recorded Run.")
 if (Object.keys(state.completed).length) retirementBlock("uncertain", "A graph with a completed task cannot retire.")
 const mutating = workers.find(worker => worker.integration), integrated = workers.find(worker => worker.integrated)
 if (mutating) retirementBlock("uncertain", `Worker ${mutating.task} has an integration mutation in progress.`)
 if (integrated) retirementBlock("uncertain", `Worker ${integrated.task} already has an integrated commit.`)
 const resourceStarted = Object.values(state.resources ?? {}).some((resource: any) => resource?.id || resource?.ready || resource?.stopped)
 const unstarted = !state.lanes.length && !workers.length && !resourceStarted
 if (!orca) retirementBlock("uncertain", "Graph retirement requires complete Run and ledger evidence.")
 inspectOrchestration(state, orca)
 if (!unstarted) inspectStartedResources(state, runtime, verifyResource)
 const worktrees = unstarted ? (() => {
  for (const repo of state.repositories.filter(repo => repo.workspace)) {
   try { if (verifyGraphWorkspace(repo) !== repo.workspace!.captureCommit || graphMergeHead(repo.workspace!.path) || graphDirtyPaths(repo.workspace!.path).length) retirementBlock("uncertain", "Unstarted retirement requires every integration worktree to be clean and unchanged.") }
   catch (error) { if (error instanceof RetirementBlocker) throw error; retirementBlock("uncertain", "An unstarted graph worktree is missing or changed.") }
  }
  const resources = Object.values(state.resources ?? {}) as any[]
  let containers: any[]
  try { containers = runtime.list().map((id: string) => runtime.inspect(id)) } catch { retirementBlock("uncertain", "The local resource inventory is unavailable.") }
  const scoped = containers.filter(container => container?.Config?.Labels?.["agent-toolkit.scope"] === state.key)
  if (scoped.some(container => container.State?.Running)) retirementBlock("live-resource", "A graph-scoped resource is still running.")
  if (scoped.length || resources.some(resource => resource.id || resource.ready || resource.stopped)) retirementBlock("uncertain", "A declared resource exists or has uncertain lifecycle state.")
  return state.repositories.filter(repo => repo.workspace).map(repo => ({ id: repo.workspace!.id, path: repo.workspace!.path, branch: repo.workspace!.branch, role: repo.workspace!.role, status: "verified-existing" }))
 })() : inspectRecordedWorktrees(state, orca!, false)
 return { state, unstarted, worktrees }
}
export interface GraphRetirementInspection { eligible: boolean; runId?: string; state: "eligible" | "active" | "running-worker" | "live-resource" | "uncertain"; blocker?: string; worktrees: any[] }
export function inspectGraphRetirement(file: string, runtime: any, orca?: Orca, verifyResource?: (record: any, runtime: any, enforceLifetime?: boolean, recordEndpoint?: boolean, rebaselineLegacyStart?: boolean, recordConfiguration?: boolean) => any): GraphRetirementInspection {
 try { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return { eligible: false, state: "uncertain", blocker: "The graph record identity is uncertain.", worktrees: [] } }
 catch { return { eligible: false, state: "uncertain", blocker: "The graph record is missing or cannot be inspected.", worktrees: [] } }
 const lease = graphLeaseState(file)
 if (lease === "live") return { eligible: false, state: "active", blocker: "The graph has a live coordinator mutation lease.", worktrees: [] }
 if (lease === "uncertain") return { eligible: false, state: "uncertain", blocker: "The graph mutation lease is uncertain.", worktrees: [] }
 try { const result = assessGraphRetirement(file, runtime, orca, verifyResource); return { eligible: true, runId: result.state.runId, state: "eligible", worktrees: result.worktrees } }
 catch (error) { return { eligible: false, state: error instanceof RetirementBlocker ? error.state : "uncertain", blocker: error instanceof Error ? error.message : "Graph retirement state is uncertain.", worktrees: [] } }
}
export function findUnstartedGraphRetirement(activeDirectory: string, retiredDirectory: string, runId: string): string {
 const candidates = new Set((existsSync(activeDirectory) ? readdirSync(activeDirectory) : []).filter(name => name.endsWith(".json")).map(name => join(activeDirectory, name)).filter(path => JSON.parse(readFileSync(path, "utf8")).runId === runId))
 for (const name of existsSync(retiredDirectory) ? readdirSync(retiredDirectory) : []) {
  const receipt = join(retiredDirectory, name, "retirement.json")
  if (!existsSync(receipt)) continue
  let saved: any
  try { saved = JSON.parse(readFileSync(receipt, "utf8")) } catch { continue }
  if (saved.runId !== runId) continue
  const source = join(activeDirectory, `${name}.json`)
  if (saved.version !== 1 || !["authorized-pending", "retired"].includes(saved.status) || saved.source !== source) throw new Error("Retirement evidence does not match its active graph path; preserve it for inspection.")
  if (saved.status === "retired" && existsSync(source)) throw new Error("An active graph conflicts with completed retirement evidence; preserve both for inspection.")
  candidates.add(source)
 }
 if (candidates.size !== 1) throw new Error(candidates.size ? "Multiple graph records use that Run ID; preserve them for inspection." : "No active or pending graph retirement has that Run ID.")
 return [...candidates][0]
}
export function inspectGraphGarbage(agentDirectory: string, orca: Orca, resources: () => { runtime: any; verifyResource?: (record: any, runtime: any, enforceLifetime?: boolean, recordEndpoint?: boolean, rebaselineLegacyStart?: boolean, recordConfiguration?: boolean) => any } = () => ({ runtime: undefined })) {
 const activeDirectory = join(agentDirectory, "task-graphs"), retiredDirectory = join(agentDirectory, "task-graphs-retired", "v4"), legacyDirectory = join(agentDirectory, "task-graph-locks")
 const files = (existsSync(activeDirectory) ? readdirSync(activeDirectory) : []).filter(name => name.endsWith(".json")).map(name => join(activeDirectory, name)), retiredNames = existsSync(retiredDirectory) ? readdirSync(retiredDirectory) : []
 const headers = new Map<string, any>(), headerErrors = new Map<string, string>(), retiredHeaders = new Map<string, any>(), retiredErrors = new Map<string, string>()
 for (const file of files) try {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) { headerErrors.set(file, "The graph record identity is uncertain."); headers.set(file, undefined) }
  else headers.set(file, JSON.parse(readFileSync(file, "utf8")))
 } catch { headerErrors.set(file, "The graph record is missing or is not valid JSON."); headers.set(file, undefined) }
 for (const name of retiredNames) try {
  const directory = join(retiredDirectory, name), receipt = join(directory, "retirement.json"), directoryStat = lstatSync(directory), receiptStat = lstatSync(receipt)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || realpathSync(directory) !== directory || !receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.nlink !== 1) { retiredErrors.set(name, "The retirement evidence identity is uncertain."); retiredHeaders.set(name, undefined) }
  else retiredHeaders.set(name, JSON.parse(readFileSync(receipt, "utf8")))
 } catch { retiredErrors.set(name, "The retirement receipt is missing or is not valid JSON."); retiredHeaders.set(name, undefined) }
 const runCounts = new Map<string, number>()
 for (const header of headers.values()) if (typeof header?.runId === "string") runCounts.set(header.runId, (runCounts.get(header.runId) ?? 0) + 1)
 for (const [name, header] of retiredHeaders) if (typeof header?.runId === "string") {
  const source = join(activeDirectory, `${name}.json`), pairedPending = header.version === 1 && header.status === "authorized-pending" && header.source === source && headers.get(source)?.runId === header.runId
  if (!pairedPending) runCounts.set(header.runId, (runCounts.get(header.runId) ?? 0) + 1)
 }
 let resourceAccess: ReturnType<typeof resources> | undefined, resourceError = false
 const inspectResources = () => {
  if (!resourceAccess && !resourceError) try { resourceAccess = resources() } catch { resourceError = true }
  return resourceAccess
 }
 const records = files.map(file => {
  const header = headers.get(file), runId = typeof header?.runId === "string" && /^run_[a-zA-Z0-9_-]+$/.test(header.runId) ? header.runId : undefined
  if (!header) return { runId, record: file, location: "active", state: "uncertain", eligible: false, blocker: headerErrors.get(file) }
  if (header.version !== 4) return { runId, record: file, location: "active", state: "legacy", eligible: false, blocker: "Legacy graph records are inspection-only and cannot retire." }
  if (runId && runCounts.get(runId)! > 1) return { runId, record: file, location: "active", state: "uncertain", eligible: false, blocker: "Multiple graph records use this Run ID." }
  const lease = graphLeaseState(file)
  if (header.completion && lease !== "available") return { runId, record: file, location: "active", state: lease === "live" ? "active" : "uncertain", eligible: false, blocker: lease === "live" ? "The completed graph has a live coordinator mutation lease." : "The completed graph mutation lease is uncertain." }
  if (header.completion) {
   const access = inspectResources()
   if (!access) return { runId, record: file, location: "active", state: "uncertain", eligible: false, blocker: "The local resource inventory is unavailable." }
   try { const state = readGraphRecord(file); if (state.plan.tasks.some(task => !state.completed[task.id])) retirementBlock("uncertain", "The completed graph is missing a completed task receipt."); inspectOrchestration(state, orca, true); inspectStartedResources(state, access.runtime, access.verifyResource); return { runId: state.runId, record: file, location: "active", state: "completed", eligible: false, blocker: "The current-v4 graph is completed." } }
   catch (error) { return { runId, record: file, location: "active", state: error instanceof RetirementBlocker ? error.state : "uncertain", eligible: false, blocker: error instanceof Error ? error.message : "The completed graph record is uncertain." } }
  }
  const access = lease === "available" ? inspectResources() : undefined
  if (lease === "available" && !access) return { runId, record: file, location: "active", state: "uncertain", eligible: false, blocker: "The local resource inventory is unavailable." }
  const inspection = inspectGraphRetirement(file, access?.runtime, orca, access?.verifyResource)
  return { runId: inspection.runId ?? runId, record: file, location: "active", ...inspection }
 })
 for (const name of retiredNames) {
  const receipt = join(retiredDirectory, name, "retirement.json"), saved = retiredHeaders.get(name)
  if (!saved) { records.push({ runId: undefined, record: join(retiredDirectory, name), location: "retired", state: "uncertain", eligible: false, blocker: retiredErrors.get(name) }); continue }
  try {
   const record = join(retiredDirectory, name, "record.json"), source = join(activeDirectory, `${name}.json`), runId = /^run_[a-zA-Z0-9_-]+$/.test(saved.runId ?? "") ? saved.runId : undefined
   if (validRetirementReceipt(saved, source) && saved.status === "authorized-pending" && runId) {
    const beforeMove = headers.get(source)?.runId === runId && authoritativeAbsence(record)
    let afterMove = false
    if (!beforeMove && authoritativeAbsence(source)) try { const stat = lstatSync(record); afterMove = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (!saved.recordHash || digest(readFileSync(record)) === saved.recordHash) && readGraphRecord(record).runId === runId } catch {}
    if (beforeMove || afterMove) { records.push({ runId, record, location: "retired", state: "pending-retirement", eligible: false, blocker: "Retirement authorization is pending; resume it with /graph retire." }); continue }
   }
   let retired = Boolean(validRetirementReceipt(saved, source) && saved.status === "retired" && saved.record === record && runId && runCounts.get(runId) === 1 && authoritativeAbsence(source)), inspection: GraphRetirementInspection | undefined
   if (retired) try {
    const stat = lstatSync(record)
    retired = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (!saved.recordHash || digest(readFileSync(record)) === saved.recordHash) && readGraphRecord(record).runId === runId
    if (retired) {
     const access = inspectResources(); inspection = access ? inspectGraphRetirement(record, access.runtime, orca, access.verifyResource) : { eligible: false, state: "uncertain", blocker: "The local resource inventory is unavailable.", worktrees: [] }
     if (inspection.eligible && saved.recordHash && JSON.stringify(inspection.worktrees) !== JSON.stringify(saved.worktrees)) inspection = { ...inspection, eligible: false, state: "uncertain", blocker: "Current worktree evidence does not match the retirement receipt." }
     retired = inspection.eligible
    }
   } catch { retired = false }
   records.push({ runId, record, location: "retired", state: retired ? "retired" : inspection?.state ?? "uncertain", eligible: false, blocker: retired ? "The current-v4 graph is already retired." : inspection?.blocker ?? "The retirement receipt or preserved record is missing or changed." })
  } catch { records.push({ runId: undefined, record: join(retiredDirectory, name), location: "retired", state: "uncertain", eligible: false, blocker: "The retirement receipt or preserved record is missing or changed." }) }
 }
 for (const name of existsSync(legacyDirectory) ? readdirSync(legacyDirectory) : []) records.push({ runId: undefined, record: join(legacyDirectory, name), location: "legacy", state: "legacy", eligible: false, blocker: "Legacy graph evidence is inspection-only and cannot retire." })
 return { version: 1, inspectionOnly: true, records }
}

const RETIREMENT_PRESERVED = ["source-checkouts", "branches", "graph-record", "orchestration-evidence", "commits", "task-receipts", "integration-worktrees", "worker-lanes", "resources", "resource-identities"]
function retirementDirectoryExists(directory: string): boolean {
 const absent = authoritativeAbsence(directory)
 if (absent) return false
 const stat = lstatSync(directory)
 if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) throw new Error("Retirement evidence directory identity changed; preserve it for inspection.")
 return true
}
function validRetirementReceipt(saved: any, file: string): boolean {
 if (saved?.version !== 1 || !["authorized-pending", "retired"].includes(saved.status) || saved.source !== file || !/^run_[a-zA-Z0-9_-]+$/.test(saved.runId ?? "")) return false
 if (!saved.recordHash) return true
 return /^[a-f0-9]{64}$/.test(saved.recordHash) && JSON.stringify(saved.released) === JSON.stringify(["repository-ownership"]) && JSON.stringify(saved.preserved) === JSON.stringify(RETIREMENT_PRESERVED) && Array.isArray(saved.worktrees) && saved.worktrees.every((item: any) => item && ["verified-existing", "verified-absent"].includes(item.status) && typeof item.id === "string" && typeof item.path === "string" && typeof item.branch === "string")
}
export function retireUnstartedGraph(file: string, retiredDirectory: string, runtime: any, orca?: Orca, verifyResource?: (record: any, runtime: any, enforceLifetime?: boolean, recordEndpoint?: boolean, rebaselineLegacyStart?: boolean, recordConfiguration?: boolean) => any): { runId: string; record: string } {
 const directory = join(retiredDirectory, basename(file, ".json")), target = join(directory, "record.json"), receipt = join(directory, "retirement.json")
 const directoryExists = retirementDirectoryExists(directory)
 if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).version !== 4) readGraphRecord(file)
 const release = acquireLease(file)
 try {
  let pending: any
  if (existsSync(receipt)) {
   const stat = lstatSync(receipt)
   if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Retirement evidence identity changed; preserve it for inspection.")
   pending = JSON.parse(readFileSync(receipt, "utf8"))
   if (!validRetirementReceipt(pending, file)) throw new Error("Retirement evidence changed; preserve it for inspection.")
   if (pending.status === "retired") {
    if (existsSync(file) || !existsSync(target) || pending.record !== target) throw new Error("Completed retirement evidence does not match the preserved record.")
    const targetStat = lstatSync(target)
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1 || pending.recordHash && digest(readFileSync(target)) !== pending.recordHash) throw new Error("Completed retirement evidence does not match the preserved record.")
    const state = pending.recordHash ? readGraphRecord(target) : assessGraphRetirement(target, runtime, orca, verifyResource).state
    if (state.runId !== pending.runId) throw new Error("Completed retirement evidence does not match the preserved record.")
    return { runId: pending.runId, record: target }
   }
   if (!existsSync(file) && existsSync(target)) {
    const targetStat = lstatSync(target)
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1 || pending.recordHash && digest(readFileSync(target)) !== pending.recordHash) throw new Error("Pending retirement record changed; preserve it for inspection.")
    const state = pending.recordHash ? readGraphRecord(target) : assessGraphRetirement(target, runtime, orca, verifyResource).state
    if (state.runId !== pending.runId) throw new Error("Pending retirement evidence does not match the preserved record.")
    saveGraphRecord(receipt, { ...pending, status: "retired", record: target })
    return { runId: state.runId!, record: target }
   }
  }
  if (!existsSync(file) || existsSync(target)) throw new Error("Pending retirement record state is uncertain; preserve it for inspection.")
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Graph record identity changed; preserve it for inspection.")
  const assessed = assessGraphRetirement(file, runtime, orca, verifyResource), recordHash = digest(readFileSync(file))
  if (findUnstartedGraphRetirement(dirname(file), retiredDirectory, assessed.state.runId!) !== file) throw new Error("Graph retirement selected a different record; preserve both for inspection.")
  if (pending) {
   if (pending.runId !== assessed.state.runId || pending.recordHash && (pending.recordHash !== recordHash || JSON.stringify(pending.worktrees) !== JSON.stringify(assessed.worktrees))) throw new Error("Retirement evidence changed; preserve it for inspection.")
  } else {
   if (directoryExists) {
    if (readdirSync(directory).length) throw new Error("Retirement evidence directory exists without a receipt; preserve it for inspection.")
   } else { mkdirSync(directory, { recursive: true, mode: 0o700 }); retirementDirectoryExists(directory); if (readdirSync(directory).length) throw new Error("Retirement evidence directory appeared during authorization; preserve it for inspection.") }
   pending = { version: 1, status: "authorized-pending", runId: assessed.state.runId, source: file, recordHash, retiredAt: new Date().toISOString(), reason: assessed.unstarted ? "Human-approved retirement after startup failed before task launch." : "Human-approved retirement after all workers and resources settled.", released: ["repository-ownership"], preserved: RETIREMENT_PRESERVED, worktrees: assessed.worktrees }
   saveGraphRecord(receipt, pending)
  }
  renameSync(file, target)
  saveGraphRecord(receipt, { ...pending, status: "retired", record: target })
  return { runId: assessed.state.runId!, record: target }
 } finally { release() }
}

export function verifyGraphWorkspace(repo: GraphRepository, workspace = repo.workspace!): string {
 if (!workspace?.path || !workspace.branch || !workspace.id || realpathSync(workspace.path) !== workspace.path || repositoryRoot(workspace.path) !== workspace.path || repositoryIdentity(workspace.path) !== repo.identity || graphGit(workspace.path, "rev-parse", "--abbrev-ref", "HEAD") !== workspace.branch || workspace.path === repo.source) throw new Error("Prepared workspace identity changed or preparation is incomplete. Do not recreate it.")
 graphGit(workspace.path, "merge-base", "--is-ancestor", workspace.base, "HEAD")
 return graphGit(workspace.path, "rev-parse", "HEAD")
}
export function removeGraphWorkspace(repo: GraphRepository, workspace: GraphWorkspace, reachableFrom: string, orca: Orca, pending: boolean, markPending: () => void, closeTerminals = true): string {
 if (!workspace.id || !workspace.path) throw new Error("Workspace cleanup requires a complete Orca receipt.")
 const selector = `id:${workspace.id.split("::")[0]}`
 const listed = () => {
  const result = orca(["worktree", "list", "--repo", selector, "--json"])?.result
  if (!Array.isArray(result?.worktrees) || result.truncated || result.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca worktree inventory.")
  return result.worktrees.filter((item: any) => item.id === workspace.id || item.path === workspace.path)
 }
 let matches = listed()
 if (pending && !matches.length && !existsSync(workspace.path)) return workspace.path
 if (matches.length !== 1 || matches[0].id !== workspace.id || matches[0].path !== workspace.path) throw new Error("Workspace cleanup found a missing, duplicate, or changed Orca receipt.")
 const tip = verifyGraphWorkspace(repo, workspace)
 if (graphMergeHead(workspace.path) || graphDirtyPaths(workspace.path).length) throw new Error("Workspace cleanup requires a clean settled worktree.")
 graphGit(repo.source, "merge-base", "--is-ancestor", tip, reachableFrom)
 const terminals = () => {
  const result = orca(["terminal", "list", "--limit", "1000", "--json"])?.result
  if (!Array.isArray(result?.terminals) || result.truncated || result.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca terminal inventory.")
  return result.terminals.filter((item: any) => (item.worktreePath || item.worktreeId?.split("::").at(-1)) === workspace.path)
 }
 const attached = terminals()
 if (attached.length && !closeTerminals) throw new Error("Workspace cleanup preserves a worktree with an attached terminal.")
 for (const terminal of attached) orca(["terminal", "close", "--terminal", terminal.handle, "--json"])
 if (terminals().length) throw new Error("Workspace cleanup could not close an attached terminal.")
 markPending()
 orca(["worktree", "rm", "--worktree", `id:${workspace.id}`, "--json"])
 matches = listed()
 if (matches.length || existsSync(workspace.path)) throw new Error("Orca did not remove the worktree; resume cleanup without recreating it.")
 return workspace.path
}
export function createGraphWorkspace(repo: GraphRepository, workspace: GraphWorkspace, orca: Orca, persist: () => void): void {
 if (workspace.path) { verifyGraphWorkspace(repo, workspace); return }
 const inventory = orca(["repo", "list", "--json"])?.result
 if (!Array.isArray(inventory?.repos) || inventory.truncated || inventory.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca repository inventory.")
 const repos = inventory.repos.filter((item: any) => item.path && existsSync(join(item.path, ".git")) && repositoryIdentity(item.path) === repo.identity)
 if (repos.length !== 1 || !repos[0].id) throw new Error("Select exactly one Orca repository by Git identity.")
 const selector = `id:${repos[0].id}`
 if (workspace.role !== "lane") {
  const configuration = orca(["repo", "show", "--repo", selector, "--json"])?.result
  if (!repo.preparation || digest(JSON.stringify(configuration)) !== repo.preparation.hash) throw new Error("Orca preparation defaults changed after approval.")
 }
 const list = orca(["worktree", "list", "--repo", selector, "--json"])?.result
 if (!Array.isArray(list?.worktrees) || list.truncated || list.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca worktree inventory.")
 const matches = list.worktrees.filter((item: any) => item.displayName === workspace.name || item.branch === `refs/heads/${workspace.name}`)
 if (matches.length > 1) throw new Error("Duplicate workspace receipts. Preserve and inspect them.")
 persist()
 const receipt = matches[0] ?? orca(["worktree", "create", "--repo", selector, "--name", workspace.name, "--base-branch", workspace.base, "--no-parent", "--setup", "skip", "--json"])?.result?.worktree
 if (!receipt?.path || !receipt.id || receipt.isMainWorktree) throw new Error("Workspace receipt missing. Resume the reserved name; do not create another.")
 const path = realpathSync(receipt.path), branch = graphGit(path, "rev-parse", "--abbrev-ref", "HEAD")
 if (path === repo.source || path.startsWith(`${repo.source}${sep}`) || repositoryIdentity(path) !== repo.identity || graphGit(path, "rev-parse", "HEAD") !== workspace.base || graphDirtyPaths(path).length || receipt.branch !== `refs/heads/${branch}`) throw new Error("Workspace does not match its clean approved foundation.")
 Object.assign(workspace, { path, branch, id: receipt.id }); persist()
}
export function importGraphInputs(repo: GraphRepository, persist: () => void): void {
 const workspace = repo.workspace!, head = verifyGraphWorkspace(repo, workspace)
 if (workspace.captureCommit) { graphGit(workspace.path!, "merge-base", "--is-ancestor", workspace.captureCommit, "HEAD"); return }
 const root = workspace.path!, selected = repo.inputs.map(input => input.path)
 if (graphDirtyPaths(root).some(path => !selected.includes(path))) throw new Error("Capture contains unrelated changes; preserve them.")
 if (head !== workspace.base) {
  const changed = graphGit(root, "diff", "--no-renames", "--name-only", `${workspace.base}..HEAD`).split("\n").filter(Boolean)
  if (graphGit(root, "rev-list", "--count", `${workspace.base}..HEAD`) !== "1" || changed.some(path => !selected.includes(path)) || graphDirtyPaths(root).length || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Unexpected capture history. Preserve it for inspection.")
 } else {
  for (const input of repo.inputs) {
   if (JSON.stringify(graphInput(root, input.path)) === JSON.stringify(input)) continue
   if (graphGit(root, "diff", "--name-only", "HEAD", "--", input.path) || graphGit(root, "ls-files", "--others", "--exclude-standard", "--", input.path)) throw new Error(`Capture destination changed: ${input.path}`)
   const path = graphFile(root, input.path)
   if (input.bytes === null) { if (existsSync(path)) unlinkSync(path) }
   else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(input.bytes, "base64")); chmodSync(path, input.executable ? 0o755 : 0o644) }
  }
  if (selected.length) { graphGit(root, "add", "--", ...selected); if (graphGit(root, "diff", "--cached", "--name-only")) graphGit(root, "commit", "-m", "Capture approved graph inputs", "--", ...selected) }
 }
 const captureHead = graphGit(root, "rev-parse", "HEAD"), changed = captureHead === workspace.base ? [] : graphGit(root, "diff", "--no-renames", "--name-only", `${workspace.base}..${captureHead}`).split("\n").filter(Boolean)
 if ((captureHead !== workspace.base && graphGit(root, "rev-list", "--count", `${workspace.base}..${captureHead}`) !== "1") || changed.some(path => !selected.includes(path)) || graphDirtyPaths(root).length || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Capture hooks or filters changed approved history or bytes; preserve the workspace.")
 workspace.captureCommit = captureHead; persist()
}
export function verifyGraphChanges(repo: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: TaskGraphPlan["mode"], base = workspace.captureCommit ?? workspace.base): void {
 verifyGraphWorkspace(repo, workspace)
 const root = workspace.path!
 const check = (path: string) => { graphFile(root, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error(`Outside task ownership: ${path}`) }
 for (const path of graphDirtyPaths(root)) check(path)
 graphGit(root, "merge-base", "--is-ancestor", base, "HEAD")
 for (const commit of graphGit(root, "rev-list", `${base}..HEAD`).split("\n").filter(Boolean)) for (const path of graphGit(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-m", "-z", commit).split("\0").filter(Boolean)) {
  check(path)
  const entry = graphGit(root, "ls-tree", commit, "--", path)
  if (entry && !/^100[0-9]{3} /.test(entry)) throw new Error(`Worker history contains a non-regular file: ${path}`)
 }
}
export function graphMergeHead(path: string): string | undefined { try { return graphGit(path, "rev-parse", "--verify", "--quiet", "MERGE_HEAD") } catch { return undefined } }
export function checkpointGraphChanges(repo: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: TaskGraphPlan["mode"], base: string, paths: string[], message: string): string {
 verifyGraphChanges(repo, workspace, owners, mode, base)
 if (!paths.length || new Set(paths).size !== paths.length || !message.trim()) throw new Error("Checkpoint requires unique explicit paths and a message.")
 for (const path of paths) { graphFile(workspace.path!, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error("Checkpoint outside task ownership.") }
 const root = workspace.path!
 graphGit(root, "add", "--", ...paths)
 if (graphMergeHead(root)) {
  if (graphGit(root, "diff", "--name-only", "--diff-filter=U")) throw new Error("Resolve all integration conflicts before checkpointing.")
  graphGit(root, "commit", "-m", message)
 } else if (graphGit(root, "diff", "--cached", "--name-only", "--", ...paths)) graphGit(root, "commit", "-m", message, "--", ...paths)
 verifyGraphChanges(repo, workspace, owners, mode, base)
 return verifyGraphWorkspace(repo, workspace)
}
export function graphRepositoryMap(record: GraphRecord): Record<string, { path: string; head: string; branch: string }> {
 return Object.fromEntries(record.repositories.map(repo => {
  const head = repo.workspace ? verifyGraphWorkspace(repo) : graphGit(repo.source, "rev-parse", "HEAD")
  if (!repo.workspace && (head !== repo.base || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Read-only source changed from its approved foundation.")
  return [repo.source, { path: repo.workspace?.path ?? repo.source, head, branch: repo.workspace?.branch ?? graphGit(repo.source, "rev-parse", "--abbrev-ref", "HEAD") }]
 }))
}
export function prepareGraphLane(record: GraphRecord, repo: GraphRepository, task: string, orca: Orca, persist: () => void): GraphLane {
 const integration = repo.workspace
 if (!integration || integration.role !== "integration") throw new Error("Writing tasks require an integration workspace.")
 const integrationHead = verifyGraphWorkspace(repo, integration)
 for (const lane of record.lanes.filter(lane => lane.source === repo.source && !lane.task && !lane.blocked && !lane.cleanup)) {
  verifyGraphWorkspace(repo, lane.workspace)
  if (graphDirtyPaths(lane.workspace.path!).length) { lane.blocked = "dirty retained lane"; persist(); continue }
  const laneHead = graphGit(lane.workspace.path!, "rev-parse", "HEAD")
  if (laneHead !== integrationHead) { graphGit(lane.workspace.path!, "merge-base", "--is-ancestor", laneHead, integrationHead); graphGit(lane.workspace.path!, "merge", "--ff-only", integrationHead) }
  lane.task = task; persist(); return lane
 }
 const count = record.repositories.filter(item => item.workspace).length + record.lanes.filter(lane => !lane.cleanup).length
 if (count >= record.plan.worktree_budget) throw new Error(`Graph worktree budget ${record.plan.worktree_budget} is exhausted. Finish and integrate a lane before starting another task.`)
 const id = randomUUID(), lane: GraphLane = { id, source: repo.source, task, previousTasks: [], workspace: { role: "lane", name: `graph-${record.key.slice(0, 8)}-lane-${id.slice(0, 8)}`, base: integrationHead } }
 record.lanes.push(lane); persist(); createGraphWorkspace(repo, lane.workspace, orca, persist); return lane
}
export function integrateGraphWorker(record: GraphRecord, worker: GraphWorker, persist: () => void, releaseLane = true): string {
 const repo = record.repositories.find(repo => repo.source === worker.source)!, lane = record.lanes.find(lane => lane.id === worker.lane)
 if (!lane || lane.task !== worker.task) throw new Error("Worker lane assignment changed.")
 verifyGraphChanges(repo, lane.workspace, record.plan.tasks.find(task => task.id === worker.task)!.owns, record.plan.mode, worker.base)
 const tip = verifyGraphWorkspace(repo, lane.workspace), integration = repo.workspace!, head = verifyGraphWorkspace(repo, integration)
 if (graphDirtyPaths(lane.workspace.path!).length) throw new Error("Commit worker changes before integration.")
 if (worker.integrated) {
  if (worker.integrated !== tip) throw new Error("Worker changed after integration.")
  graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD")
  if (releaseLane) { lane.previousTasks.push(worker.task); lane.task = undefined; persist() }
  return verifyGraphWorkspace(repo, integration)
 }
 const mergeHead = graphMergeHead(integration.path!)
 if (mergeHead) {
  if (mergeHead !== tip || worker.integration?.tip !== tip) throw new Error("The pending merge belongs to another integration attempt.")
  throw new Error("Integration has preserved conflicts. Resolve owned paths with checkpoint_task_graph, then retry completion.")
 }
 if (graphDirtyPaths(integration.path!).length) throw new Error("Integration workspace is dirty; preserve and inspect it.")
 worker.integration ??= { before: head, tip }; persist()
 try { graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD") }
 catch {
  if (verifyGraphWorkspace(repo, integration) !== worker.integration.before) throw new Error("Integration head changed after the recorded attempt.")
  graphGit(integration.path!, "merge", "--no-ff", "-m", `Integrate graph task ${worker.task}`, tip)
 }
 graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD")
 if (graphDirtyPaths(integration.path!).length) throw new Error("Integration left dirty files; preserve them for resolution.")
 worker.integrated = tip
 if (releaseLane) { lane.previousTasks.push(worker.task); lane.task = undefined }
 persist()
 return verifyGraphWorkspace(repo, integration)
}
export function graphWritePath(record: GraphRecord, taskId: string, path: string): void {
 if (path !== resolve(path)) throw new Error("Graph writes require literal absolute paths without traversal.")
 const task = record.plan.tasks.find(task => task.id === taskId), worker = record.workers[taskId]
 const repo = task && worker && record.repositories.find(repo => repo.source === worker.source)
 const lane = worker?.lane && record.lanes.find(item => item.id === worker.lane)
 if (!task || !worker || !repo || !path.startsWith(`${worker.workspace}${sep}`)) throw new Error("Writes must target the task's assigned workspace.")
 const workspace = lane?.workspace
 if (task.owns.length && !workspace) throw new Error("Writing task has no lane.")
 if (workspace) verifyGraphWorkspace(repo, workspace)
 const local = relative(worker.workspace, path).split(sep).join("/")
 graphFile(worker.workspace, local); assertGraphMode(record.plan.mode, local)
 if (!owns(task.owns, local)) throw new Error("Write outside task ownership.")
}
function metadata(markdown: string, key: string): string | undefined { const section = markdown.split(/^##\s+Metadata\s*$/im)[1]?.split(/^##\s+/m)[0]; return section?.match(new RegExp(`^\\s*-\\s*${key}:\\s*([^\\n]+)`, "im"))?.[1].trim() }
function validateSelectedPlan(record: GraphRecord): void {
 if (record.plan.mode !== "execute" || !/(?:^|\/)docs\/(?:future|exec-plans\/(?:active|completed))\/.+\.md$/.test(record.plan.objective)) return
 const documents = record.repositories.flatMap(repo => {
  const paths = new Set(graphGit(repo.source, "ls-tree", "-r", "--name-only", repo.base, "--", "docs/future", "docs/exec-plans/active", "docs/exec-plans/completed").split("\n").filter(path => path.endsWith(".md")))
  for (const input of repo.inputs) if (/^docs\/(?:future|exec-plans\/(?:active|completed))\/.+\.md$/.test(input.path)) input.bytes === null ? paths.delete(input.path) : paths.add(input.path)
  return [...paths].map(path => {
   literalPath(path)
   const input = repo.inputs.find(input => input.path === path)
   const markdown = input ? Buffer.from(input.bytes!, "base64").toString("utf8") : graphGit(repo.source, "show", `${repo.base}:${path}`)
   return { source: repo.source, path, markdown, id: metadata(markdown, "Plan-ID") }
  })
 })
 const target = documents.find(doc => resolve(doc.source, doc.path) === resolve(record.root, record.plan.objective))
 if (!target?.id) throw new Error("Selected execution plan is missing from its approved foundation or has no Plan-ID.")
 const closure = new Map<string, typeof target>()
 const visit = (id: string, stack = new Set<string>()) => {
  const matches = documents.filter(doc => doc.id === id)
  if (matches.length !== 1) throw new Error(`Plan-ID ${id} is missing or ambiguous across selected foundations.`)
  const doc = matches[0], status = metadata(doc.markdown, "Status")?.toLowerCase()
  if (status === "completed" && doc.path.startsWith("docs/exec-plans/completed/")) return
  if (stack.has(id)) throw new Error("Plan dependencies contain a cycle.")
  if (closure.has(id)) return
  if (!["approved", "not-required"].includes(metadata(doc.markdown, "Security-Approval")?.toLowerCase() ?? "") || (doc.path.startsWith("docs/future/") ? status !== "ready-for-promotion" : !["queued", "in-progress", "in-review", "validation", "budget-exhausted", "ready-for-promotion"].includes(status ?? ""))) throw new Error(`Plan ${id} is blocked, draft, completed, or lacks security approval.`)
  for (const field of ["Priority", "Dependencies", "Acceptance-Criteria", "Validation-Lanes", "Risk-Tier"]) if (!metadata(doc.markdown, field)) throw new Error(`Plan ${id} lacks ${field}.`)
  const product = metadata(doc.markdown, "Product-Approval")?.toLowerCase()
  if (product && !["approved", "not-required"].includes(product)) throw new Error(`Plan ${id} lacks required Product approval.`)
  for (const dependency of metadata(doc.markdown, "Dependencies")!.toLowerCase() === "none" ? [] : metadata(doc.markdown, "Dependencies")!.split(",").map(item => item.trim())) visit(dependency, new Set(stack).add(id))
  closure.set(id, doc)
 }
 visit(target.id)
 if (!closure.size || closure.size !== record.plan.tasks.length || record.plan.tasks.some(task => !closure.has(task.id))) throw new Error("Execution tasks must match the complete unfinished plan dependency closure.")
 const scheduled = new Set<string>()
 for (const task of record.plan.tasks) {
  const doc = closure.get(task.id)!, dependencies = metadata(doc.markdown, "Dependencies")!.split(",").map(item => item.trim()).filter(id => closure.has(id))
  if (JSON.stringify([...task.depends_on].sort()) !== JSON.stringify([...dependencies].sort()) || resolve(record.root, task.repository) !== doc.source) throw new Error("Plan task repositories and dependencies must match foundation metadata.")
  const ready = [...closure.values()].filter(item => !scheduled.has(item.id!) && metadata(item.markdown, "Dependencies")!.split(",").map(id => id.trim()).every(id => !closure.has(id) || scheduled.has(id)))
  ready.sort((a, b) => (metadata(a.markdown, "Priority") ?? "").localeCompare(metadata(b.markdown, "Priority") ?? "") || a.id!.localeCompare(b.id!))
  if (ready[0]?.id !== task.id || !/^p[0-3]$/.test(metadata(doc.markdown, "Priority")!)) throw new Error("Order plans by dependencies, Priority, then Plan-ID.")
  const filename = doc.path.replace(/^docs\/(?:future|exec-plans\/(?:active|completed))\//, "")
  const targets = ["Spec-Targets", "Implementation-Targets"].flatMap(field => metadata(doc.markdown, field)?.split(",") ?? []).map(path => path.trim()).filter(path => path && path.toLowerCase() !== "none")
  if (!targets.length || [...targets, `docs/future/${filename}`, `docs/exec-plans/active/${filename}`, `docs/exec-plans/completed/${filename}`].some(path => { literalPath(path); return !owns(task.owns, path) })) throw new Error(`Task ${task.id} must own its declared targets and exact lifecycle paths.`)
  scheduled.add(task.id)
 }
 record.plans = [...closure.values()].map(doc => ({ id: doc.id!, source: doc.source, filename: doc.path.replace(/^docs\/(?:future|exec-plans\/(?:active|completed))\//, "") }))
}
export function graphPlanLocation(record: GraphRecord, id: string) {
 const plan = record.plans?.find(plan => plan.id === id); if (!plan) return undefined
 const repo = record.repositories.find(repo => repo.source === plan.source)!, root = repo.workspace?.path
 if (!root) throw new Error("Prepare the plan integration workspace first.")
 const paths = ["docs/future", "docs/exec-plans/active", "docs/exec-plans/completed"].map(directory => `${directory}/${plan.filename}`)
 const matches = paths.filter(path => existsSync(graphFile(root, path)))
 if (matches.length !== 1) throw new Error(`Plan ${id} has missing or duplicate lifecycle paths.`)
 const local = matches[0], path = graphFile(root, local), markdown = readFileSync(path, "utf8")
 return { repo, path, local, filename: plan.filename, status: metadata(markdown, "Status")?.toLowerCase(), markdown }
}
export function verifyPlanTaskCloseout(record: GraphRecord, id: string, deliveryPending = false): void {
 if (!record.plans?.some(plan => plan.id === id)) return
 const location = graphPlanLocation(record, id)!, closed = location.local.startsWith("docs/exec-plans/completed/") && location.status === "completed", pending = deliveryPending && location.local.startsWith("docs/exec-plans/active/") && location.status === "validation", evidence = metadata(location.markdown, "Done-Evidence"), security = metadata(location.markdown, "Security-Approval")?.toLowerCase(), product = metadata(location.markdown, "Product-Approval")?.toLowerCase()
 if (metadata(location.markdown, "Plan-ID") !== id || !["approved", "not-required"].includes(security ?? "") || product && !["approved", "not-required"].includes(product) || (!closed && !pending) || !evidence || /^(?:pending|none|not-run|todo)$/i.test(evidence)) throw new Error(`Plan ${id} has incomplete closeout.`)
}
export function verifyPlanCloseout(record: GraphRecord, deliveryPending: boolean): void {
 for (const plan of record.plans ?? []) verifyPlanTaskCloseout(record, plan.id, deliveryPending)
}
export const saveGraphRecord = saveRecord
