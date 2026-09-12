import { execFileSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync } from "node:fs"
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { getAgentDir, truncateHead, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { inspectShell, runBash } from "../development-access/index.ts"
import { StringEnum } from "@earendil-works/pi-ai"
import { Type, type TProperties } from "typebox"
import { acquireLease, assertNoLegacyGraph, digest, graphGit, LEGACY_GRAPH, repositoryIdentity, repositoryRoot, taskGraphPrompt, type Orca, type TaskGraphPlan } from "./task-graph-core.ts"
import { captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphDirtyPaths, graphFile, graphMergeHead, graphPlanLocation, graphRepositoryMap, graphWritePath, importGraphInputs, integrateGraphWorker, prepareGraphLane, readGraphAdmission, readGraphRecord, saveGraphRecord, sourceSeal, verifyGraphChanges, verifyGraphWorkspace, verifyPlanCloseout, verifyPlanTaskCloseout, type GraphRecord } from "./workspaces.ts"

const text = (details: any) => { const output = truncateHead(JSON.stringify(details, null, 2)); return { content: [{ type: "text" as const, text: output.content + (output.truncated ? "\nTruncated; inspect the retained graph record." : "") }], details } }
const string = () => Type.String({ minLength: 1 })
const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false })
const resourceSchema = object({ id: string(), type: StringEnum(["postgres", "storage", "scanner"] as const), image: string(), purpose: string(), memoryMiB: Type.Integer(), storageMiB: Type.Integer(), lifetimeSeconds: Type.Integer(), reset: Type.Optional(string()), targets: Type.Optional(Type.Array(string())), database: Type.Optional(string()), downloads: Type.Optional(Type.Array(string())) })
const resourceHelper = () => createRequire(import.meta.url)(join(process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE!, "local-resources.cjs"))
const foundationSchema = object({ repository: string(), commit: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }) })
const taskDeclarationSchema = object({ id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }), goal: string(), repository: string(), depends_on: Type.Array(string()), owns: Type.Array(string()), done_when: Type.Array(string(), { minItems: 1 }), validation: string(), setup: Type.Optional(string()) })
const inputSchema = object({ repository: string(), paths: Type.Array(string(), { maxItems: 100 }) })
const graphSchema = object({
 objective: string(), mode: StringEnum(["plan-only", "execute"] as const), worktree_budget: Type.Integer({ minimum: 1, maximum: 12 }), resources: Type.Optional(Type.Array(resourceSchema, { maxItems: 4 })),
 foundations: Type.Array(foundationSchema, { minItems: 1, maxItems: 12 }), tasks: Type.Array(taskDeclarationSchema, { minItems: 1, maxItems: 12 }), inputs: Type.Optional(Type.Array(inputSchema, { maxItems: 12 })),
})
const taskSchema = object({ task_id: string() })
const POLICY_VERSION = "development-roots-v1"

const ORCA_COMMAND = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca")
function executablePath(command: string, cwd: string, trusted = false): string {
 const candidates = /[\\/]/.test(command) ? [isAbsolute(command) ? command : resolve(cwd, command)] : (process.env.PATH ?? "").split(delimiter).filter(path => path && (!trusted || isAbsolute(path))).map(path => resolve(cwd, path, command))
 for (const candidate of candidates) try { accessSync(candidate, constants.X_OK); return realpathSync(candidate) } catch {}
 throw new Error(`Executable is unavailable: ${command}`)
}
const ORCA_EXECUTABLE = executablePath(ORCA_COMMAND, process.cwd(), true)
export function orcaJson(args: string[]): any {
 const response = JSON.parse(execFileSync(ORCA_EXECUTABLE, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
 if (response?.ok !== true) throw new Error(response?.error?.message ?? "Orca failed; preserve the graph and inspect the error.")
 return response
}
function inventory(orca: Orca, args: string[], field: string): any[] {
 const result = orca([...args, "--json"])?.result
 if (!Array.isArray(result?.[field]) || result.truncated || result.hostScope?.omittedHostIds?.length) throw new Error(`Incomplete Orca ${field} inventory.`)
 return result[field]
}
function marker(record: GraphRecord, id: string): string { return `[graph-v4:${record.key}:${id}]` }
function taskSpec(record: GraphRecord, task: TaskGraphPlan["tasks"][number]): string {
 return `${marker(record, task.id)}\n${task.goal}\nOwn only: ${task.owns.join(", ") || "read-only"}.\nDone when:\n${task.done_when.map(item => `- ${item}`).join("\n")}\n${task.setup ? `Setup: ${task.setup}\n` : ""}Validation: ${task.validation}\nUse checkpoint_task_graph for commits. Do not publish, delete worktrees, or modify unrelated paths.`
}
export function prepareLedger(record: GraphRecord, orca: Orca, persist: () => void): void {
 const objective = `Pi graph v4: ${record.key}: ${record.plan.objective}`
 if (!record.runId) {
  const runs: any[] = []; let cursor: string | undefined; const seen = new Set<string>()
  do {
   const result = orca(["orchestration", "run-list", "--limit", "100", ...(cursor ? ["--cursor", cursor] : []), "--json"])?.result
   if (!Array.isArray(result?.runs) || result.truncated) throw new Error("Incomplete Orca Run inventory.")
   runs.push(...result.runs); cursor = result.nextCursor || undefined
   if (cursor && seen.has(cursor)) throw new Error("Repeated Orca Run cursor."); if (cursor) seen.add(cursor)
  } while (cursor)
  const matches = runs.filter(run => run.objective === objective)
  if (matches.length > 1) throw new Error("Duplicate Run receipts. Preserve them for inspection.")
  persist()
  const run = matches[0] ?? orca(["orchestration", "run-create", "--objective", objective, "--json"])?.result?.run
  if (!/^run_[a-zA-Z0-9_-]+$/.test(run?.id)) throw new Error("Run receipt missing. Resume the reserved objective.")
  record.runId = run.id; persist()
 }
 const run = orca(["orchestration", "run-show", "--id", record.runId!, "--json"])?.result?.run
 if (run?.id !== record.runId || run.objective !== objective) throw new Error("Run identity changed.")
 for (const declaration of record.plan.tasks) {
  const tasks = inventory(orca, ["orchestration", "task-list", "--run", record.runId!], "tasks")
  if (tasks.some(entry => entry.parent_id != null || !record.plan.tasks.some(task => entry.spec === taskSpec(record, task)) || entry.run_id !== record.runId)) throw new Error("Run contains foreign or changed tasks.")
  const matches = tasks.filter(entry => entry.spec === taskSpec(record, declaration))
  if (matches.length > 1) throw new Error("Duplicate task receipts.")
  const dependencies = declaration.depends_on.map(id => tasks.find(entry => entry.spec === taskSpec(record, record.plan.tasks.find(task => task.id === id)!))?.id)
  if (dependencies.some(id => !id)) throw new Error("Missing prerequisite ledger task.")
  if (!matches.length) { persist(); orca(["orchestration", "task-create", "--run", record.runId!, "--spec", taskSpec(record, declaration), "--deps", JSON.stringify(dependencies), "--json"]) }
 }
 for (const [id, evidence] of Object.entries(record.completed)) {
  const task = inventory(orca, ["orchestration", "task-list", "--run", record.runId!], "tasks").find(entry => entry.spec === taskSpec(record, record.plan.tasks.find(task => task.id === id)!))
  if (task?.status !== "completed") orca(["orchestration", "task-update", "--id", task.id, "--status", "completed", "--run", record.runId!, "--result", JSON.stringify({ evidence: evidence.evidence, head: evidence.head }), "--json"])
 }
}
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'` }
function terminalInventory(orca: Orca): any[] { return inventory(orca, ["terminal", "list", "--limit", "1000"], "terminals") }
function terminalPath(terminal: any): string | undefined { return terminal?.worktreePath || terminal?.worktreeId?.split("::").at(-1) }
function receiptFile(file: string, task: string): string { return `${file}.${task}.receipt` }
function readReceipt(file: string, task: string): any { const path = receiptFile(file, task); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {} }
function writeReceipt(file: string, task: string, value: any): void { saveGraphRecord(receiptFile(file, task), value) }

export default function taskGraphExtension(pi: ExtensionAPI): void {
 let request: { objective: string; mode: TaskGraphPlan["mode"]; root: string; model: string; target?: string } | undefined
 let record: GraphRecord | undefined, file: string | undefined, release: (() => void) | undefined
 const workerFile = process.env.AGENT_TOOLKIT_GRAPH_RECORD, workerTask = process.env.AGENT_TOOLKIT_GRAPH_TASK
 const agentDir = () => process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir()
 const persist = () => { if (!file || !record) throw new Error("No approved graph record."); saveGraphRecord(file, record) }
 const bound = () => { if (!record || !release || record.completion) throw new Error("Approve or resume an unfinished graph first."); return record }
 const stop = () => { release?.(); release = undefined; record = undefined; file = undefined; request = undefined }
 const verify = (sources?: Set<string>) => {
  const state = bound(), selected = sources ?? new Set(state.plan.tasks.filter(task => task.owns.length).map(task => realpathSync(resolve(state.root, task.repository))))
  for (const repo of state.repositories.filter(repo => selected.has(repo.source))) {
   if (repo.sourceSeal !== sourceSeal(repo.source)) throw new Error("Source checkout changed. Preserve it and stop.")
   for (const line of repo.sourceBranches?.split("\n").filter(Boolean) ?? []) { const [ref, head] = line.split(" "); if (graphGit(repo.source, "rev-parse", ref) !== head) throw new Error("A source branch changed outside graph authority.") }
   if (repo.workspace) verifyGraphChanges(repo, repo.workspace, state.plan.tasks.filter(task => realpathSync(resolve(state.root, task.repository)) === repo.source).flatMap(task => task.owns), state.plan.mode)
  }
  for (const lane of state.lanes.filter(lane => selected.has(lane.source))) {
   if (lane.cleanup) continue
   const repo = state.repositories.find(repo => repo.source === lane.source)!, worker = lane.task && state.workers[lane.task], task = lane.task && state.plan.tasks.find(task => task.id === lane.task)
   if (worker && task) verifyGraphChanges(repo, lane.workspace, task.owns, state.plan.mode, worker.base)
   else { verifyGraphWorkspace(repo, lane.workspace); if (!lane.blocked && graphDirtyPaths(lane.workspace.path!).length) throw new Error("A reusable lane became dirty. Preserve it.") }
  }
 }
 const taskSources = (state: GraphRecord, task: TaskGraphPlan["tasks"][number]) => new Set([task.id, ...task.depends_on].map(id => state.plan.tasks.find(item => item.id === id)!).map(item => realpathSync(resolve(state.root, item.repository))))
 const graphEnvKeys = new Set<string>()
 const currentRepositoryMap = (state: GraphRecord) => Object.fromEntries(state.repositories.map(repo => [repo.source, { path: repo.workspace?.path ?? repo.source, head: graphGit(repo.workspace?.path ?? repo.source, "rev-parse", "HEAD"), branch: repo.workspace?.branch ?? graphGit(repo.source, "rev-parse", "--abbrev-ref", "HEAD") }]))
 const graphEnvironment = (state: GraphRecord, repositories = currentRepositoryMap(state)) => ({
  AGENT_TOOLKIT_GRAPH_REPOSITORIES: JSON.stringify(repositories),
  ...(state.resources && Object.keys(state.resources).length ? resourceHelper().resourceEnvironment(state.resources, resourceHelper().dockerRuntime()) : {}),
 })
 const exposeGraphEnvironment = (state: GraphRecord, repositories: any) => {
  for (const key of graphEnvKeys) delete process.env[key]
  graphEnvKeys.clear()
  for (const [key, value] of Object.entries(graphEnvironment(state, repositories))) { process.env[key] = value; graphEnvKeys.add(key) }
 }
 const runIntegrationCommand = async (state: GraphRecord, repo: GraphRecord["repositories"][number], worker: GraphRecord["workers"][string], command: string, id: string, signal: AbortSignal | undefined, update: any) => {
  const integration = repo.workspace!, before = verifyGraphWorkspace(repo, integration), approved = state.repositories.map(item => item.workspace?.path ?? item.source), facts = await inspectShell(command, integration.path!)
  const targets = [...facts.paths, ...facts.candidates, ...facts.directories].filter(path => path && path !== "/dev/null")
  if (targets.some(path => !approved.some(root => path === root || path.startsWith(`${root}${sep}`)))) throw new Error("Integration command targets a path outside the approved graph repositories.")
  const relevant = taskSources(state, state.plan.tasks.find(task => task.id === worker.task)!), targetedForeign = state.repositories.filter(item => item.source !== repo.source && targets.some(path => path === (item.workspace?.path ?? item.source) || path.startsWith(`${item.workspace?.path ?? item.source}${sep}`))), usedForeign = state.repositories.filter(item => item.source !== repo.source && (relevant.has(item.source) || targetedForeign.includes(item)))
  if (targetedForeign.length && (!facts.inspection || facts.effects)) throw new Error("Cross-repository prerequisites are read-only during integration validation.")
  for (const foreign of usedForeign) {
   const path = foreign.workspace?.path ?? foreign.source, head = graphGit(path, "rev-parse", "HEAD")
   if (head !== worker.prerequisites[foreign.source] || graphDirtyPaths(path).length) throw new Error("A used cross-repository prerequisite changed before integration validation.")
  }
  const current = currentRepositoryMap(state), repositories = Object.fromEntries(state.repositories.filter(item => relevant.has(item.source)).map(item => [item.source, { ...current[item.source], head: item.source === repo.source ? verifyGraphWorkspace(repo) : worker.prerequisites[item.source] }]))
  try { await runBash(id, { command, repository: integration.path }, signal, update, integration.path!, graphEnvironment(state, repositories)) }
  catch (error) {
   if (graphDirtyPaths(integration.path!).length) graphGit(integration.path!, "stash", "push", "--include-untracked", "--message", `Retain failed graph command ${id}`)
   if (verifyGraphWorkspace(repo, integration) !== before || graphDirtyPaths(integration.path!).length) throw new Error("Failed integration command could not be restored; preserve it and stop.")
   throw error
  }
  for (const foreign of usedForeign) {
   const path = foreign.workspace?.path ?? foreign.source
   if (graphGit(path, "rev-parse", "HEAD") !== worker.prerequisites[foreign.source]) throw new Error("A cross-repository prerequisite changed HEAD during integration validation; preserve it and stop.")
   if (graphDirtyPaths(path).length) { graphGit(path, "stash", "push", "--include-untracked", "--message", `Retain foreign graph changes ${id}`); throw new Error("Integration validation changed a cross-repository prerequisite.") }
  }
  if (verifyGraphWorkspace(repo, integration) !== before) { const lane = state.lanes.find(lane => lane.id === worker.lane); if (lane) { lane.blocked = "Integration command changed HEAD"; persist() }; throw new Error("Integration setup or validation changed the combined HEAD; preserve it and stop.") }
  if (graphDirtyPaths(integration.path!).length) {
   graphGit(integration.path!, "stash", "push", "--include-untracked", "--message", `Retain changed graph command ${id}`)
   if (graphDirtyPaths(integration.path!).length) throw new Error("Integration changes could not be restored; preserve it and stop.")
   throw new Error("Integration setup or validation changed tracked files.")
  }
  return before
 }
 const closeCompletedTerminals = (state: GraphRecord) => {
  let changed = false
  for (const worker of Object.values(state.workers).filter(worker => state.completed[worker.task] && worker.terminal)) {
   if (terminalInventory(orcaJson).some(item => item.handle === worker.terminal)) orcaJson(["terminal", "close", "--terminal", worker.terminal!, "--json"])
   worker.terminal = undefined; worker.launch = undefined; changed = true
  }
  if (changed) persist()
 }
 const cleanupLanes = (state: GraphRecord) => {
  const removed: string[] = []
  for (const lane of state.lanes.filter(lane => lane.cleanup !== "removed")) {
   if (lane.task || lane.blocked) continue
   const repo = state.repositories.find(repo => repo.source === lane.source)!, workspace = lane.workspace
   if (!workspace.id || !workspace.path || !repo.workspace) throw new Error("Lane cleanup requires a complete workspace receipt.")
   const selector = `id:${workspace.id.split("::")[0]}`, listed = () => inventory(orcaJson, ["worktree", "list", "--repo", selector], "worktrees").filter(item => item.id === workspace.id || item.path === workspace.path)
   let matches = listed()
   if (lane.cleanup === "pending" && !matches.length && !existsSync(workspace.path)) { lane.cleanup = "removed"; persist(); removed.push(workspace.path); continue }
   if (matches.length !== 1) throw new Error("Lane cleanup found a missing or duplicate Orca receipt.")
   const tip = verifyGraphWorkspace(repo, workspace)
   if (graphDirtyPaths(workspace.path).length || terminalInventory(orcaJson).some(terminal => terminalPath(terminal) === workspace.path)) throw new Error("Lane cleanup requires a clean integrated lane with no terminal.")
   graphGit(repo.workspace.path!, "merge-base", "--is-ancestor", tip, "HEAD")
   lane.cleanup = "pending"; persist()
   orcaJson(["worktree", "rm", "--worktree", `id:${workspace.id}`, "--json"])
   matches = listed()
   if (matches.length || existsSync(workspace.path)) throw new Error("Orca did not remove the lane; resume cleanup without recreating it.")
   lane.cleanup = "removed"; persist(); removed.push(workspace.path)
  }
  return removed
 }
 const workerContext = (allowStaleReadOnly = false) => {
  if (!workerFile || !workerTask) throw new Error("This tool requires a graph worker.")
  const state = readGraphRecord(workerFile), task = state.plan.tasks.find(task => task.id === workerTask), worker = state.workers[workerTask]
  if (!task || !worker || realpathSync(process.cwd()) !== worker.workspace) throw new Error("Worker workspace binding changed.")
  const repo = state.repositories.find(repo => repo.source === worker.source)!, lane = worker.lane && state.lanes.find(lane => lane.id === worker.lane)
  if (task.owns.length && (!lane || lane.task !== task.id)) throw new Error("Writing lane ownership changed.")
  if (lane) verifyGraphWorkspace(repo, lane.workspace)
  else if (!allowStaleReadOnly) {
   if (graphGit(worker.workspace, "rev-parse", "HEAD") !== worker.base) throw new Error("Read-only checkout advanced; restart this worker against the new head.")
   if (repo.workspace && (graphMergeHead(worker.workspace) || graphDirtyPaths(worker.workspace).length)) throw new Error("Read-only checkout has an unsettled integration; retry after resolution.")
  }
  exposeGraphEnvironment(state, Object.fromEntries(state.repositories.filter(item => taskSources(state, task).has(item.source)).map(item => [item.source, { path: item.source === worker.source ? worker.workspace : item.workspace?.path ?? item.source, head: item.source === worker.source ? lane ? verifyGraphWorkspace(repo, lane.workspace) : worker.base : worker.prerequisites[item.source], branch: item.source === worker.source ? lane?.workspace.branch ?? repo.workspace?.branch : item.workspace?.branch ?? graphGit(item.source, "rev-parse", "--abbrev-ref", "HEAD") }])))
  return { state, task, worker, repo, lane }
 }
 const pendingShell = new Map<string, { task: string; command: string; repository: string }>()

 pi.registerCommand("graph", { description: "Approve and run a bounded multi-worker graph. /graph [plan|execute] <objective>", handler: async (args, ctx) => {
  if (!ctx.isIdle() || release) { ctx.ui.notify("Finish the current response or graph first.", "warning"); return }
  const parsed = /^(?:(plan|execute)\s+)?(.+)$/.exec(args.trim())
  if (!parsed || !ctx.model) { ctx.ui.notify(parsed ? "No model selected." : "Usage: /graph [plan|execute] <objective>", "warning"); return }
  const root = repositoryRoot(ctx.cwd), mode = parsed[1] === "execute" ? "execute" : "plan-only", objective = parsed[2]
  request = { root, mode, objective, model: `${ctx.model.provider}/${ctx.model.id}`.toLowerCase() }
  const directory = join(agentDir(), "task-graphs"), stem = digest(`${repositoryIdentity(root)}:${mode}:${objective}`)
  try {
   if (process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES || process.env.AGENT_TOOLKIT_GRAPH_TASK && !workerFile) throw new Error(LEGACY_GRAPH)
   for (const entry of (existsSync(directory) ? readdirSync(directory) : []).filter(name => name.endsWith(".json"))) {
    const path = join(directory, entry), saved = readGraphAdmission(path, [repositoryIdentity(root)], root)
    if (saved && !saved.completion && saved.root === root && saved.plan.mode === mode && saved.plan.objective === objective) {
     assertNoLegacyGraph(agentDir(), saved.repositories.map(repo => repo.identity)); release = acquireLease(path); file = path; record = saved
     pi.sendUserMessage(`${taskGraphPrompt(objective, mode)}\nResume this record without another approval: ${JSON.stringify({ ...saved, repositories: saved.repositories.map(repo => ({ ...repo, inputs: repo.inputs.map(({ bytes, ...input }) => input) })) })}`); return
    }
   }
   let suffix = 0
   do { request.target = join(directory, `${stem}${suffix ? `-${suffix}` : ""}.json`); suffix++ } while (existsSync(request.target))
   pi.sendUserMessage(taskGraphPrompt(objective, mode))
  } catch (error) { stop(); ctx.ui.notify(error instanceof Error ? error.message : String(error), "error") }
 } })
 pi.registerTool({ name: "propose_task_graph", label: "Approve Graph", description: "Approve one bounded multi-worker graph, including its worktree budget and internal execution.", parameters: graphSchema, executionMode: "sequential", async execute(_id, params, signal, _update, ctx) {
  if (!request || record) throw new Error("Start /graph first or resume its retained record.")
  const plan = params as TaskGraphPlan
  if (plan.mode !== request.mode || plan.objective !== request.objective) throw new Error("Preserve the requested objective and mode.")
  resourceHelper().validateResources(plan.resources)
  const candidate = captureGraphWorkspaces(request.root, plan); candidate.workerModel = request.model
  for (const repo of candidate.repositories) if (repo.workspace) { const configuration = orcaJson(["repo", "show", "--repo", `path:${repo.source}`, "--json"])?.result; if (!configuration) throw new Error("Orca preparation configuration is unavailable."); repo.preparation = { configuration, hash: digest(JSON.stringify(configuration)) } }
  assertNoLegacyGraph(agentDir(), candidate.repositories.map(repo => repo.identity))
  const directory = join(agentDir(), "task-graphs"); mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const entry of readdirSync(directory).filter(name => name.endsWith(".json"))) { const existing = readGraphAdmission(join(directory, entry), candidate.repositories.map(repo => repo.identity)); if (existing && !existing.completion && existing.repositories.some(repo => candidate.repositories.some(other => other.identity === repo.identity))) throw new Error(`Resume the unfinished graph: /graph ${existing.plan.mode} ${existing.plan.objective}`) }
  const summary = { ...candidate, repositories: candidate.repositories.map(repo => ({ ...repo, inputs: repo.inputs.map(({ bytes, ...input }) => input) })) }
  if (!ctx.hasUI || !await ctx.ui.confirm(plan.mode === "plan-only" ? "Approve planning graph?" : "Approve execution graph?", `${JSON.stringify(summary, null, 2)}\nThis single approval covers the declared Run, task records, up to ${plan.worktree_budget} worktrees, pi-yolo worker launches with ${candidate.workerModel} at medium thinking, declared setup and validation on worker and combined integration commits, retries, bounded resources, internal integration, and removal of verified clean integrated lanes at closeout. It excludes secrets, unrelated or dirty worktree cleanup, production administration, publication, and source-branch merge-back.`, { signal })) return text({ status: "not-approved" })
  const target = request.target!, startup = acquireLease(join(directory, "startup"))
  try {
   if (existsSync(target)) throw new Error("Graph record appeared during approval; resume it.")
   for (const entry of readdirSync(directory).filter(name => name.endsWith(".json"))) {
    const existing = readGraphAdmission(join(directory, entry), candidate.repositories.map(repo => repo.identity))
    if (existing && !existing.completion) throw new Error(`Resume the unfinished graph: /graph ${existing.plan.mode} ${existing.plan.objective}`)
   }
   release = acquireLease(target); file = target; record = candidate; persist()
  } finally { startup() }
  return text({ status: "approved", record: file, plan, model: candidate.workerModel })
 } })
 pi.registerTool({ name: "prepare_task_graph_workspace", label: "Prepare Graph", description: "Reconcile the Run and integration workspaces. Writing lanes are created lazily and reused.", parameters: object({}), executionMode: "sequential", async execute() {
  const state = bound(); for (const repo of state.repositories) if (repo.sourceSeal !== sourceSeal(repo.source)) throw new Error("Source checkout changed before preparation.")
  closeCompletedTerminals(state); prepareLedger(state, orcaJson, persist)
  for (const repo of state.repositories) if (repo.workspace) { createGraphWorkspace(repo, repo.workspace, orcaJson, persist); importGraphInputs(repo, persist) }
  for (const lane of state.lanes.filter(lane => !lane.cleanup)) createGraphWorkspace(state.repositories.find(repo => repo.source === lane.source)!, lane.workspace, orcaJson, persist)
  if (state.plan.resources?.length) { const helper = resourceHelper(), workspace = state.repositories.find(repo => repo.workspace?.role === "integration")?.workspace?.path; if (!workspace) throw new Error("Resources require a writing workspace."); state.resources ??= {}; helper.prepareResources(state.key, state.plan.resources, state.resources, persist, workspace, join(realpathSync(tmpdir()), "agent-toolkit-resources", state.key), helper.dockerRuntime()) }
  verify(new Set(state.repositories.map(repo => repo.source))); return text({ run_id: state.runId, repositories: currentRepositoryMap(state), worktree_budget: state.plan.worktree_budget, worktrees_used: state.repositories.filter(repo => repo.workspace).length + state.lanes.filter(lane => !lane.cleanup).length, completed: state.completed, workers: state.workers })
 } })
 pi.registerTool({ name: "start_task_graph_task", label: "Start Graph Worker", description: "Launch or resume one dependency-ready task on an exclusive reusable lane; read-only tasks create no worktree.", parameters: taskSchema, executionMode: "sequential", async execute(_id, params) {
  const state = bound(), task = state.plan.tasks.find(task => task.id === params.task_id)
  if (!task || state.completed[task.id] || task.depends_on.some(id => !state.completed[id])) throw new Error("Start an unfinished task only after all dependencies are integrated.")
  verify(taskSources(state, task)); if (!state.runId || !state.workerModel) throw new Error("Prepare the graph first.")
  const tasks = inventory(orcaJson, ["orchestration", "task-list", "--run", state.runId], "tasks"), ledger = tasks.find(entry => entry.spec === taskSpec(state, task))
  if (!ledger) throw new Error("Approved ledger task is missing.")
  let worker = state.workers[task.id]
  if (worker?.launch && !worker.terminal) {
   const matches = terminalInventory(orcaJson).filter(item => item.title === worker!.launch!.title)
   if (matches.length > 1 || matches[0] && realpathSync(terminalPath(matches[0])!) !== worker.workspace) throw new Error("Uncertain worker launch; preserve it and reconcile Orca.")
   if (matches[0]) { worker.terminal = matches[0].handle; persist() }
  }
  let dispatch: any
  try { dispatch = orcaJson(["orchestration", "dispatch-show", "--task", ledger.id, "--json"])?.result?.dispatch } catch {}
  if (worker && !task.owns.length && dispatch?.status === "completed" && graphGit(worker.workspace, "rev-parse", "HEAD") !== worker.base) {
   if (terminalInventory(orcaJson).some(item => item.handle === worker!.terminal)) orcaJson(["terminal", "close", "--terminal", worker.terminal!, "--json"])
   worker.base = graphGit(worker.workspace, "rev-parse", "HEAD"); worker.attempt++; worker.dispatch = undefined; worker.terminal = undefined; worker.launch = undefined
   orcaJson(["orchestration", "task-update", "--id", ledger.id, "--status", "ready", "--run", state.runId, "--json"]); persist(); dispatch = undefined
  }
  if (worker && dispatch && ["pending", "running", "dispatched", "completed"].includes(dispatch.status) && !(worker.repair && dispatch.status === "completed")) { worker.dispatch ??= dispatch.id; persist(); return text({ status: dispatch.status, worker }) }
  if (worker?.repair && dispatch?.status === "completed") {
   const repo = state.repositories.find(repo => repo.source === worker!.source)!, lane = state.lanes.find(lane => lane.id === worker!.lane)!, integrationHead = verifyGraphWorkspace(repo)
   if (graphDirtyPaths(lane.workspace.path!).length) throw new Error("Repair lane is dirty; preserve and inspect it.")
   graphGit(lane.workspace.path!, "merge", "--ff-only", integrationHead)
   worker.base = verifyGraphWorkspace(repo, lane.workspace); worker.prerequisites = Object.fromEntries(state.repositories.map(item => [item.source, item.workspace ? verifyGraphWorkspace(item) : item.base]))
   worker.attempt++; worker.dispatch = undefined
   if (terminalInventory(orcaJson).some(item => item.handle === worker!.terminal)) orcaJson(["terminal", "close", "--terminal", worker.terminal!, "--json"])
   worker.terminal = undefined; worker.launch = undefined
   orcaJson(["orchestration", "task-update", "--id", ledger.id, "--status", "ready", "--run", state.runId, "--result", JSON.stringify({ repair: worker.repair }), "--json"]); persist(); dispatch = undefined
  }
  if (worker && dispatch?.status === "failed") {
   if (terminalInventory(orcaJson).some(item => item.handle === worker!.terminal)) orcaJson(["terminal", "close", "--terminal", worker.terminal!, "--json"])
   if (!task.owns.length) { const repo = state.repositories.find(repo => repo.source === worker!.source)!; worker.base = graphGit(repo.workspace?.path ?? repo.source, "rev-parse", "HEAD") }
   worker.attempt++; worker.terminal = undefined; worker.dispatch = undefined; worker.launch = undefined; writeReceipt(file!, task.id, { setup: !task.setup }); persist()
   orcaJson(["orchestration", "task-update", "--id", ledger.id, "--status", "ready", "--run", state.runId, "--json"])
  }
  if (!worker) {
   if (Object.values(state.workers).filter(item => !state.completed[item.task] && item.terminal).length >= state.plan.worktree_budget) throw new Error("Worker concurrency budget is full.")
   const repo = state.repositories.find(repo => repo.source === realpathSync(resolve(state.root, task.repository)))!
   const overlaps = (left: string, right: string) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
   if (task.owns.length && Object.values(state.workers).some(active => !state.completed[active.task] && active.source === repo.source && state.plan.tasks.find(item => item.id === active.task)!.owns.some(left => task.owns.some(right => overlaps(left, right))))) throw new Error("A running worker already owns an overlapping path.")
   const lane = task.owns.length ? state.lanes.find(lane => lane.task === task.id && !lane.cleanup) ?? prepareGraphLane(state, repo, task.id, orcaJson, persist) : undefined
   const workspace = lane?.workspace.path ?? repo.workspace?.path ?? repo.source
   if (lane) orcaJson(["worktree", "set", "--worktree", `id:${lane.workspace.id}`, "--display-name", `${state.plan.objective.split("/").at(-1)} · ${task.id}`, "--json"])
   const base = lane ? verifyGraphWorkspace(repo, lane.workspace) : repo.workspace ? verifyGraphWorkspace(repo) : repo.base
   worker = { task: task.id, ledgerTask: ledger.id, source: repo.source, lane: lane?.id, workspace, base, prerequisites: Object.fromEntries(state.repositories.map(item => [item.source, item.workspace ? verifyGraphWorkspace(item) : item.base])), attempt: 0 }
   state.workers[task.id] = worker; writeReceipt(file!, task.id, { setup: !task.setup }); persist()
  }
  for (const dependency of task.depends_on) {
   const completed = state.completed[dependency], declaration = state.plan.tasks.find(item => item.id === dependency)!
   if (completed && realpathSync(resolve(state.root, declaration.repository)) === worker.source) graphGit(worker.workspace, "merge-base", "--is-ancestor", completed.head, "HEAD")
  }
  if (!worker.launch) {
   const title = `pi-graph-${state.key.slice(0, 8)}-${task.id}-${worker.attempt}`
   const assignments: Record<string, string | undefined> = { AGENT_TOOLKIT_GRAPH_RECORD: file, AGENT_TOOLKIT_GRAPH_TASK: task.id, AGENT_TOOLKIT_GRAPH_REPOSITORIES: JSON.stringify(Object.fromEntries(Object.entries(currentRepositoryMap(state)).filter(([source]) => taskSources(state, task).has(source)))), AGENT_TOOLKIT_PI_AGENT_DIR: process.env.AGENT_TOOLKIT_PI_AGENT_DIR, AGENT_TOOLKIT_CODEX_ACCOUNT: process.env.AGENT_TOOLKIT_CODEX_ACCOUNT, AGENT_TOOLKIT_CODEX_PROFILE_HOME: process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME }
   const command = `env ${Object.entries(assignments).filter(([, value]) => value).map(([key, value]) => `${key}=${quote(value!)}`).join(" ")} pi-yolo --model ${quote(state.workerModel)} --thinking medium`
   worker.launch = { title, command }; persist()
  }
  if (!worker.terminal) {
   const receipt = orcaJson(["terminal", "create", "--worktree", worker.lane ? `id:${state.lanes.find(lane => lane.id === worker!.lane)!.workspace.id}` : `path:${worker.workspace}`, "--title", worker.launch.title, "--command", worker.launch.command, "--json"])?.result?.terminal
   if (!receipt?.handle || realpathSync(terminalPath(receipt)!) !== worker.workspace) throw new Error("Worker terminal receipt is missing or points at another workspace.")
   worker.terminal = receipt.handle; persist()
  }
  const created = orcaJson(["orchestration", "dispatch", "--task", ledger.id, "--to", worker.terminal, "--run", state.runId, "--inject", "--json"])?.result?.dispatch
  if (!created?.id) throw new Error("Dispatch receipt missing; resume the task to reconcile it.")
  worker.dispatch = created.id; persist(); return text({ status: "dispatched", worker, worktrees_used: state.repositories.filter(repo => repo.workspace).length + state.lanes.filter(lane => !lane.cleanup).length })
 } })
 pi.registerTool({ name: "checkpoint_task_graph", label: "Checkpoint Graph", description: "Commit explicit worker paths, or an owned integration conflict resolution, with hooks enabled.", parameters: object({ repository: string(), paths: Type.Array(string(), { minItems: 1, maxItems: 100 }), message: string() }), executionMode: "sequential", async execute(_id, params) {
  if (workerFile) {
   const { state, task, worker, repo, lane } = workerContext(); if (!lane || params.repository !== worker.workspace) throw new Error("Only writing workers checkpoint their assigned lane.")
   writeReceipt(workerFile, task.id, { ...readReceipt(workerFile, task.id), validated: undefined })
   const commit = () => checkpointGraphChanges(repo, lane.workspace, task.owns, state.plan.mode, worker.base, params.paths, `[${task.id}] ${params.message}`)
   const queued = [...params.paths].sort().reduceRight<() => Promise<string>>((next, path) => () => withFileMutationQueue(join(worker.workspace, path), next), async () => commit())
   return text({ head: await queued() })
  }
  const state = bound(), repo = state.repositories.find(repo => repo.workspace?.path === params.repository), worker = repo && Object.values(state.workers).find(item => item.source === repo.source && item.integration && !item.integrated)
  if (!repo?.workspace || !worker || !graphMergeHead(repo.workspace.path!)) throw new Error("Coordinator checkpoints are only for a preserved worker integration conflict.")
  const owners = state.plan.tasks.filter(task => realpathSync(resolve(state.root, task.repository)) === repo.source).flatMap(task => task.owns)
  const head = checkpointGraphChanges(repo, repo.workspace, owners, state.plan.mode, worker.integration!.before, params.paths, `[${worker.task}] ${params.message}`)
  persist(); return text({ head })
 } })
 pi.registerTool({ name: "move_task_graph_plan", label: "Move Task Plan", description: "Move only the current worker's approved plan lifecycle file.", parameters: object({ destination: StringEnum(["active", "completed"] as const) }), executionMode: "sequential", async execute(_id, params) {
  const { state, task, worker } = workerContext(), location = graphPlanLocation({ ...state, repositories: state.repositories.map(repo => repo.source === worker.source ? { ...repo, workspace: { ...repo.workspace!, path: worker.workspace } } : repo) }, task.id)
  if (!location) throw new Error("This task has no approved plan lifecycle file.")
  const local = `docs/exec-plans/${params.destination}/${location.filename}`, path = join(worker.workspace, local)
  graphWritePath(state, task.id, location.path); graphWritePath(state, task.id, path)
  if (existsSync(path)) throw new Error("Plan destination already exists.")
  mkdirSync(join(path, ".."), { recursive: true }); renameSync(location.path, path)
  writeReceipt(workerFile!, task.id, { ...readReceipt(workerFile!, task.id), validated: undefined }); return text({ path })
 } })
 pi.registerTool({ name: "complete_task_graph_task", label: "Integrate Graph Task", description: "Verify a settled worker, integrate it, and validate the combined integration commit before releasing its lane.", parameters: object({ task_id: string(), evidence: string(), delivery_pending: Type.Optional(Type.Boolean()) }), executionMode: "sequential", async execute(id, params, signal, update) {
  const state = bound(), task = state.plan.tasks.find(task => task.id === params.task_id), worker = state.workers[params.task_id]
  if (!task || !worker || state.completed[task.id] || !params.evidence.trim()) throw new Error("Complete one dispatched unfinished task with evidence.")
  verify(taskSources(state, task)); const dispatch = orcaJson(["orchestration", "dispatch-show", "--task", worker.ledgerTask, "--json"])?.result?.dispatch
  if (dispatch?.status !== "completed" || dispatch.assignee_handle !== worker.terminal) throw new Error("Worker dispatch is not completed.")
  const repo = state.repositories.find(repo => repo.source === worker.source)!, receipt = readReceipt(file!, task.id)
  let integrationHead = worker.base, head = worker.base
  if (task.owns.length) {
   const lane = state.lanes.find(lane => lane.id === worker.lane)!
   if (lane.blocked) throw new Error(`Task lane is blocked: ${lane.blocked}`)
   head = verifyGraphWorkspace(repo, lane.workspace)
   if (head === worker.base && !worker.repair) throw new Error("A writing task must create a checkpoint commit before completion.")
   if (receipt.validated !== head || receipt.validation !== task.validation) throw new Error("Worker must run declared validation successfully on its clean final checkpoint.")
   integrationHead = integrateGraphWorker(state, worker, persist, false)
   try {
    if (task.setup) await runIntegrationCommand(state, repo, worker, task.setup, id, signal, update)
    await runIntegrationCommand(state, repo, worker, task.validation, id, signal, update)
    verifyPlanTaskCloseout(state, task.id, Boolean(params.delivery_pending))
   }
   catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (reason.includes("preserve it and stop")) throw error
    worker.repair = { reason, integrationHead }; worker.integrated = undefined; worker.integration = undefined
    writeReceipt(file!, task.id, { ...receipt, validated: undefined }); persist()
    orcaJson(["orchestration", "task-update", "--id", worker.ledgerTask, "--status", "ready", "--run", state.runId!, "--result", JSON.stringify({ repair: worker.repair }), "--json"])
    throw new Error(`Combined setup or validation failed. Resume task ${task.id} in its retained lane: ${reason}`)
   }
   integrationHead = verifyGraphWorkspace(repo)
   worker.repair = undefined; lane.previousTasks.push(worker.task); lane.task = undefined
  } else {
   const readPath = repo.workspace?.path ?? repo.source
   if (graphGit(readPath, "rev-parse", "HEAD") !== worker.base) throw new Error("Read-only checkout advanced; restart and reinspect before completion.")
   if (repo.workspace && (graphMergeHead(readPath) || graphDirtyPaths(readPath).length)) throw new Error("Read-only checkout has an unsettled integration; retry after resolution.")
  }
  state.completed[task.id] = { head, integrationHead, evidence: params.evidence, deliveryPending: Boolean(params.delivery_pending) }; persist()
  closeCompletedTerminals(state); prepareLedger(state, orcaJson, persist)
  return text({ status: "completed", task: task.id, head, integrationHead, lane: worker.lane })
 } })
 pi.registerTool({ name: "operate_task_graph_resource", label: "Graph Resource", description: "Operate only an identity-verified graph resource.", parameters: object({ resource_id: string(), operation: StringEnum(["reset", "scan", "stop"] as const) }), executionMode: "sequential", async execute(_id, params) {
  const state = bound(), resource = state.resources?.[params.resource_id]; if (!resource) throw new Error("Resource is outside this graph approval.")
  if (Object.keys(state.completed).length) throw new Error("Graph resources cannot change after task completion.")
  const helper = resourceHelper(), output = helper.operateResource(resource, params.operation, helper.dockerRuntime())
  for (const task of Object.keys(state.workers)) writeReceipt(file!, task, { ...readReceipt(file!, task), validated: undefined })
  persist(); return text({ resource_id: params.resource_id, operation: params.operation, output, retained: true })
 } })
 pi.registerTool({ name: "finish_task_graph", label: "Finish Graph", description: "Finish after every worker is integrated. Remove verified clean lanes, retain the integration worktree, and never publish.", parameters: object({ run_id: string(), evidence: string(), delivery_pending: Type.Optional(Type.Boolean()) }), executionMode: "sequential", async execute(_id, params) {
  const state = bound(); if (params.run_id !== state.runId || !params.evidence.trim() || state.plan.tasks.some(task => !state.completed[task.id])) throw new Error("Finish only after every task completes.")
  if (Object.values(state.completed).some(task => task.deliveryPending) && !params.delivery_pending) throw new Error("A task retained its plan for delivery; retry finish with delivery_pending enabled.")
  verify(); if (Object.values(state.workers).some(worker => !state.completed[worker.task])) throw new Error("An unsettled worker remains.")
  for (const repo of state.repositories.filter(repo => repo.workspace)) {
   const validated = Object.entries(state.completed).filter(([id]) => { const task = state.plan.tasks.find(task => task.id === id)!; return task.owns.length && realpathSync(resolve(state.root, task.repository)) === repo.source }).map(([, result]) => result.integrationHead)
   if (validated.length) {
    const head = verifyGraphWorkspace(repo)
    if (!validated.includes(head) || validated.some(commit => { try { graphGit(repo.workspace!.path!, "merge-base", "--is-ancestor", commit!, head); return false } catch { return true } })) throw new Error("Integration HEAD does not contain every recorded validated task result.")
   }
  }
  closeCompletedTerminals(state); verifyPlanCloseout(state, Boolean(params.delivery_pending)); const removed = cleanupLanes(state)
  state.completion = { evidence: params.evidence, deliveryPending: Boolean(params.delivery_pending) }; persist()
  const retained = state.lanes.filter(lane => lane.cleanup !== "removed").map(lane => lane.workspace.path)
  const result = text({ status: params.delivery_pending ? "local-ready" : "complete", evidence: params.evidence, repositories: graphRepositoryMap(state), removed_lanes: removed, retained_lanes: retained, record: file, publishing: "not-authorized" }); stop(); return { ...result, terminate: true }
 } })
 pi.on("tool_call", async (event, ctx) => {
  try {
   if (workerFile || workerTask) {
    const input = event.input as any, { state, task, worker } = workerContext(event.toolName === "bash")
    if (["read", "fffind", "ffgrep", "grep", "find", "ls", "ask_user_question"].includes(event.toolName)) return
    if (["write", "edit"].includes(event.toolName)) { graphWritePath(state, task.id, resolve(ctx.cwd, String(input.path).replace(/^@/, ""))); writeReceipt(workerFile!, task.id, { ...readReceipt(workerFile!, task.id), validated: undefined }); return }
    if (event.toolName === "bash") {
     const selected = realpathSync(input.repository ? isAbsolute(input.repository) ? input.repository : resolve(ctx.cwd, input.repository) : ctx.cwd)
     const foreign = state.repositories.filter(repo => repo.source !== worker.source).map(repo => ({ repo, path: repo.workspace?.path ?? repo.source }))
     const approved = [worker.workspace, ...foreign.map(item => item.path)], selectedForeign = selected !== worker.workspace
     if (!approved.includes(selected)) throw new Error("Worker commands must use an assigned or approved graph workspace.")
     const facts = await inspectShell(input.command, selected), targets = [...facts.paths, ...facts.candidates, ...facts.directories].filter(path => path && path !== "/dev/null")
     if (targets.some(path => !approved.some(root => path === root || path.startsWith(`${root}${sep}`)))) throw new Error("Worker command targets a path outside the approved graph repositories.")
     const usedForeign = foreign.filter(item => selected === item.path || targets.some(path => path === item.path || path.startsWith(`${item.path}${sep}`)))
     for (const item of usedForeign) {
      const head = item.repo.workspace ? verifyGraphWorkspace(item.repo) : graphGit(item.repo.source, "rev-parse", "HEAD")
      if (head !== worker.prerequisites[item.repo.source]) throw new Error("A used cross-repository prerequisite changed after worker launch.")
     }
     const reporting = !facts.effects && facts.commands.every(args => args[0] === ORCA_COMMAND && executablePath(args[0], selected) === ORCA_EXECUTABLE && args[1] === "orchestration" && ["send", "ask", "check"].includes(args[2]))
     if (!reporting) workerContext()
     if (usedForeign.length && !facts.inspection && !reporting) throw new Error("Cross-repository prerequisites are read-only.")
     if (facts.gitMutation || facts.integration) throw new Error("Graph workers commit through checkpoint_task_graph; shell Git mutations are not allowed.")
     if (selectedForeign && !facts.inspection && !reporting) throw new Error("Commands selected into another graph repository must be read-only.")
     if (!task.owns.length && !reporting && !facts.inspection) throw new Error("Read-only workers use inspection commands, read/search tools, and Orca reporting only.")
     const receipt = readReceipt(workerFile!, task.id)
     if (!reporting && task.setup && !receipt.setup && input.command !== task.setup) throw new Error("Run the declared setup command first.")
     if (!reporting && !facts.inspection) writeReceipt(workerFile!, task.id, { ...receipt, validated: undefined })
     if (!reporting) pendingShell.set(event.toolCallId, { task: task.id, command: input.command, repository: selected })
     return
    }
    if (["checkpoint_task_graph", "move_task_graph_plan"].includes(event.toolName)) return
    throw new Error("Worker tool is outside the approved task scope.")
   }
   if (!request && !record) return
   if (["read", "fffind", "ffgrep", "grep", "find", "ls", "ask_user_question"].includes(event.toolName)) return
   if (["propose_task_graph", "prepare_task_graph_workspace", "start_task_graph_task", "checkpoint_task_graph", "complete_task_graph_task", "finish_task_graph", "operate_task_graph_resource"].includes(event.toolName)) return
   if (["write", "edit"].includes(event.toolName)) {
    const state = bound(), path = resolve(ctx.cwd, String((event.input as any).path).replace(/^@/, ""))
    const repo = state.repositories.find(repo => repo.workspace?.path && path.startsWith(`${repo.workspace.path}${sep}`)), worker = repo && Object.values(state.workers).find(item => item.source === repo.source && item.integration && !item.integrated)
    const task = worker && state.plan.tasks.find(task => task.id === worker.task), local = repo?.workspace?.path ? relative(repo.workspace.path, path).split(sep).join("/") : ""
    if (!repo?.workspace || !worker || !task || !graphMergeHead(repo.workspace.path) || !task.owns.some(owner => local === owner || local.startsWith(`${owner}/`))) throw new Error("Coordinator edits are limited to owned paths in a preserved integration conflict.")
    graphFile(repo.workspace.path, local); return
   }
   if (event.toolName === "bash") {
    if (!record) return
    const state = bound(), input = event.input as any, selected = input.repository ? isAbsolute(input.repository) ? input.repository : resolve(ctx.cwd, input.repository) : ctx.cwd
    const repo = state.repositories.find(repo => repo.workspace?.path === realpathSync(selected))
    if (!repo || Object.values(state.workers).some(worker => !state.completed[worker.task] && worker.workspace === selected)) throw new Error("Coordinator diagnostics require an idle integration workspace.")
    const facts = await inspectShell(input.command, selected), approved = state.repositories.map(item => item.workspace?.path ?? item.source)
    if (!facts.inspection || facts.gitMutation || facts.integration || [...facts.paths, ...facts.candidates, ...facts.directories].some(path => path && path !== "/dev/null" && !approved.some(root => path === root || path.startsWith(`${root}${sep}`)))) throw new Error("Coordinator Bash is limited to read-only graph diagnostics.")
    return
   }
   throw new Error("This mutation is outside graph authority.")
  } catch (error) { return { block: true, reason: `Graph ownership [${POLICY_VERSION}], cwd=${ctx.cwd}: ${error instanceof Error ? error.message : "Rejected operation"}` } }
 })
 pi.on("tool_result", event => {
  const pending = pendingShell.get(event.toolCallId); pendingShell.delete(event.toolCallId)
  if (!pending || event.isError || !workerFile) return
  try {
   const { task, worker, repo, lane } = workerContext(), receipt = readReceipt(workerFile, task.id)
   if (pending.task !== task.id || pending.repository !== worker.workspace) return
   if (pending.command === task.setup) receipt.setup = true
   if (pending.command === task.validation && receipt.setup !== false && lane && !graphDirtyPaths(worker.workspace).length) { receipt.validated = verifyGraphWorkspace(repo, lane.workspace); receipt.validation = task.validation }
   writeReceipt(workerFile, task.id, receipt)
  } catch {}
 })
 pi.on("session_shutdown", () => { for (const key of graphEnvKeys) delete process.env[key]; if (!workerFile) stop() })
}
