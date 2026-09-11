import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { getAgentDir, truncateHead, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { inspectShell } from "../development-access/index.ts"
import { StringEnum } from "@earendil-works/pi-ai"
import { Type, type TProperties } from "typebox"
import { acquireLease, assertGraphShell, assertNoLegacyGraph, digest, graphGit, validateTaskGraph, LEGACY_GRAPH, repositoryIdentity, repositoryRoot, taskGraphPrompt, type Orca, type TaskGraphPlan } from "./task-graph-core.ts"
import { captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphDirtyPaths, graphFile, graphPlanLocation, graphRepositoryMap, graphWritePath, importGraphInputs, readGraphRecord, saveGraphRecord, sourceSeal, verifyGraphChanges, verifyGraphWorkspace, verifyPlanCloseout, type GraphRecord } from "./workspaces.ts"

const text = (details: any) => {
 const output = truncateHead(JSON.stringify(details, null, 2))
 return { content: [{ type: "text" as const, text: output.content + (output.truncated ? "\nTruncated. Inspect the retained graph record for the full contract." : "") }], details }
}
const string = () => Type.String({ minLength: 1 })
const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false })
const resourceSchema = object({ id: string(), type: StringEnum(["postgres", "storage", "scanner"] as const), image: string(), purpose: string(), memoryMiB: Type.Integer(), storageMiB: Type.Integer(), lifetimeSeconds: Type.Integer(), reset: Type.Optional(string()), targets: Type.Optional(Type.Array(string())), database: Type.Optional(string()), downloads: Type.Optional(Type.Array(string())) })
const resourceHelper = () => createRequire(import.meta.url)(join(process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE!, "local-resources.cjs"))
const foundationSchema = object({ repository: string(), commit: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }) })
const taskDeclarationSchema = object({ id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }), goal: string(), repository: string(), depends_on: Type.Array(string()), owns: Type.Array(string()), done_when: Type.Array(string(), { minItems: 1 }), validation: string(), setup: Type.Optional(string()) })
const inputSchema = object({ repository: string(), paths: Type.Array(string(), { maxItems: 100 }) })
const graphSchema = object({
 objective: string(), mode: StringEnum(["plan-only", "execute"] as const), resources: Type.Optional(Type.Array(resourceSchema, { maxItems: 4 })),
 foundations: Type.Array(foundationSchema, { minItems: 1, maxItems: 12 }),
 tasks: Type.Array(taskDeclarationSchema, { minItems: 1, maxItems: 12 }),
 inputs: Type.Optional(Type.Array(inputSchema, { maxItems: 12 })),
})
const taskSchema = object({ task_id: string() })
const POLICY_VERSION = "development-roots-v1"

export function orcaJson(args: string[]): any {
 const binary = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca")
 const response = JSON.parse(execFileSync(binary, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
 if (response?.ok !== true) throw new Error(response?.error?.message ?? "Orca failed; preserve the graph and inspect the error.")
 return response
}
function inventory(orca: Orca, args: string[], field: string): any[] {
 const result = orca([...args, "--json"])?.result
 if (!Array.isArray(result?.[field]) || result.truncated || result.hostScope?.omittedHostIds?.length) throw new Error(`Incomplete Orca ${field} inventory.`)
 return result[field]
}
function marker(record: GraphRecord, id: string): string { return `[graph-v3:${record.key}:${id}]` }
export function prepareLedger(record: GraphRecord, orca: Orca, persist: () => void): void {
 const objective = `Pi graph v3: ${record.key}: ${record.plan.objective}`
 if (!record.runId) {
  const runs: any[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
   const result = orca(["orchestration", "run-list", "--limit", "100", ...(cursor ? ["--cursor", cursor] : []), "--json"])?.result
   if (!Array.isArray(result?.runs) || result.truncated) throw new Error("Incomplete Orca Run inventory.")
   runs.push(...result.runs)
   cursor = result.nextCursor || undefined
   if (cursor && seen.has(cursor)) throw new Error("Repeated Orca Run cursor.")
   if (cursor) seen.add(cursor)
  } while (cursor)
  const matches = runs.filter(run => run.objective === objective)
  if (matches.length > 1) throw new Error("Duplicate Run receipts. Preserve them for inspection.")
  persist()
  const run = matches[0] ?? orca(["orchestration", "run-create", "--objective", objective, "--json"])?.result?.run
  if (!/^run_[a-zA-Z0-9_-]+$/.test(run?.id)) throw new Error("Run receipt missing. Resume the reserved objective.")
  record.runId = run.id
  persist()
 }
 const run = orca(["orchestration", "run-show", "--id", record.runId!, "--json"])?.result?.run
 if (run?.id !== record.runId || run.objective !== objective) throw new Error("Run identity changed. No legacy binding or objective migration is supported.")
 for (const task of record.plan.tasks) {
  const tasks = inventory(orca, ["orchestration", "task-list", "--run", record.runId!], "tasks")
  if (tasks.some(entry => entry.parent_id != null || !record.plan.tasks.some(task => entry.spec === marker(record, task.id)) || entry.run_id !== record.runId || !["pending", "ready", "completed"].includes(entry.status))) throw new Error("Run contains foreign, dispatched or changed tasks. Preserve it; do not dispatch or retire workers.")
  const matches = tasks.filter(entry => entry.spec === marker(record, task.id))
  if (matches.length > 1) throw new Error("Duplicate task receipts.")
  const dependencies = task.depends_on.map(id => tasks.find(entry => entry.spec === marker(record, id))?.id)
  if (dependencies.some(id => !id)) throw new Error("Missing prerequisite ledger task.")
  if (!matches.length) {
   persist()
   orca(["orchestration", "task-create", "--run", record.runId!, "--spec", marker(record, task.id), "--deps", JSON.stringify(dependencies), "--json"])
  } else if (JSON.stringify(JSON.parse(matches[0].deps)) !== JSON.stringify(dependencies) || matches[0].status === "completed" && !record.completed[task.id]) throw new Error("Task dependencies or completion changed outside this graph.")
 }
 // Replay only locally verified completion after an interrupted RPC. Never infer completion from Orca alone.
 for (const [id, evidence] of Object.entries(record.completed)) {
  const tasks = inventory(orca, ["orchestration", "task-list", "--run", record.runId!], "tasks")
  const task = tasks.find(entry => entry.spec === marker(record, id))
  if (task.status !== "completed") orca(["orchestration", "task-update", "--id", task.id, "--status", "completed", "--run", record.runId!, "--result", JSON.stringify({ evidence: evidence.evidence, head: evidence.head }), "--json"])
 }
}

export default function taskGraphExtension(pi: ExtensionAPI): void {
 let request: { objective: string; mode: TaskGraphPlan["mode"]; root: string } | undefined
 let record: GraphRecord | undefined
 let file: string | undefined
 let release: (() => void) | undefined
 const agentDir = () => process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir()
 const persist = () => { if (!file || !record) throw new Error("No approved graph record."); saveGraphRecord(file, record) }
 const bound = () => {
  if (!record || !release || record.completion) throw new Error("Approve or resume an unfinished graph first.")
  return record
 }
 const active = () => {
  const state = bound()
  const task = state.plan.tasks.find(task => task.id === state.active?.task)
  const repo = task && state.repositories.find(repo => repo.source === realpathSync(resolve(state.root, task.repository)))
  if (!task || !repo || !state.runId) throw new Error("Prepare the graph and start its first unfinished task.")
  return { state, task, repo }
 }
 const verify = () => {
  const state = bound()
  graphRepositoryMap(state)
  for (const repo of state.repositories) {
   if (repo.sourceSeal !== sourceSeal(repo.source)) throw new Error("Source checkout, source index or source branch changed. Preserve the change and stop.")
   for (const line of repo.sourceBranches?.split("\n").filter(Boolean) ?? []) {
    const [ref, head] = line.split(" ")
    if (graphGit(repo.source, "rev-parse", ref) !== head) throw new Error("An existing source branch tip changed outside graph authority.")
   }
  }
  for (const repo of state.repositories) if (repo.workspace) {
   const owners = state.plan.tasks.filter(task => realpathSync(resolve(state.root, task.repository)) === repo.source).flatMap(task => task.owns)
   verifyGraphChanges(repo, owners, state.plan.mode)
   const current = state.plan.tasks.find(task => task.id === state.active?.task && resolve(state.root, task.repository) === repo.source)
   if (current) verifyGraphChanges(repo, current.owns, state.plan.mode, state.active!.before)
   else {
    const last = state.plan.tasks.findLast(task => resolve(state.root, task.repository) === repo.source && state.completed[task.id])
    if (verifyGraphWorkspace(repo) !== (last ? state.completed[last.id].head : repo.workspace.captureCommit) || graphDirtyPaths(repo.workspace.path!).length) throw new Error("Inactive workspace changed after its verified checkpoint. Preserve and inspect it.")
   }
  }
 }
 const pendingShell = new Map<string, { task: string; command: string }>()
 const previousInspection = process.env.AGENT_TOOLKIT_GIT_INSPECTION_ONLY
 const previousMap = process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES
 const resourceEnv = new Map<string, string | undefined>()
 const stop = () => {
  release?.(); release = undefined; record = undefined; file = undefined; request = undefined; pendingShell.clear()
  for (const [key, value] of resourceEnv) value === undefined ? delete process.env[key] : process.env[key] = value
  resourceEnv.clear()
  for (const [key, value] of [["AGENT_TOOLKIT_GIT_INSPECTION_ONLY", previousInspection], ["AGENT_TOOLKIT_GRAPH_REPOSITORIES", previousMap]]) value === undefined ? delete process.env[key!] : process.env[key!] = value
 }

 pi.registerCommand("graph", {
  description: "Plan in isolation; execute only with separate approval. /graph [plan|execute] <objective>",
  handler: async (args, ctx) => {
   if (!ctx.isIdle()) { ctx.ui.notify("Wait for the current response to finish.", "warning"); return }
   if (release) { ctx.ui.notify("This graph is active. Finish it or stop the session before starting another.", "warning"); return }
   const parsed = /^(?:(plan|execute)\s+)?(.+)$/.exec(args.trim())
   if (!parsed) { ctx.ui.notify("Usage: /graph [plan|execute] <objective-or-plan-path>. Repeat the exact command to resume.", "warning"); return }
   const root = repositoryRoot(ctx.cwd)
   const mode = parsed[1] === "execute" ? "execute" : "plan-only"
   const objective = parsed[2]
   request = { root, mode, objective }
   process.env.AGENT_TOOLKIT_GIT_INSPECTION_ONLY = "true"
   const directory = join(agentDir(), "task-graphs")
   const target = join(directory, `${digest(`${repositoryIdentity(root)}:${mode}:${objective}`)}.json`)
   try {
    if (process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES || process.env.AGENT_TOOLKIT_GRAPH_TASK) throw new Error(LEGACY_GRAPH)
    if (existsSync(target)) {
     const saved = readGraphRecord(target)
     if (saved.completion) throw new Error(`This graph is already ${saved.completion.deliveryPending ? "local-ready" : "complete"}. Retained record: ${target}. Use a separately scoped objective for new work.`)
     assertNoLegacyGraph(agentDir(), saved.repositories.map(repo => repo.identity))
     release = acquireLease(target)
     file = target; record = saved
     pi.sendUserMessage(`${taskGraphPrompt(objective, mode)}\nResume exactly this approved record (do not propose or capture again): ${JSON.stringify({ ...saved, repositories: saved.repositories.map(repo => ({ ...repo, inputs: repo.inputs.map(({ bytes, ...input }) => input) })) })}\nCall prepare_task_graph_workspace to reconcile existing resources.`)
    } else pi.sendUserMessage(taskGraphPrompt(objective, mode))
   } catch (error) { stop(); ctx.ui.notify(error instanceof Error ? error.message : String(error), "error") }
  },
 })
 pi.registerTool({
  name: "propose_task_graph", label: "Approve Graph", description: "Approve coordinator-owned planning or separately requested execution, with exact foundation commits and input snapshots.", parameters: graphSchema, executionMode: "sequential",
  async execute(_id, params, signal, _update, ctx) {
   if (!request || record) throw new Error("Start /graph first. Resume existing approval instead of proposing it again.")
   const plan = params as TaskGraphPlan
   if (plan.mode !== request.mode || plan.objective !== request.objective) throw new Error("Preserve the requested objective and mode. Execution needs a separate /graph execute command.")
   resourceHelper().validateResources(plan.resources)
   const candidate = captureGraphWorkspaces(request.root, plan)
   for (const repo of candidate.repositories) if (repo.workspace) {
    const configuration = orcaJson(["repo", "show", "--repo", `path:${repo.source}`, "--json"])?.result
    if (!configuration) throw new Error("Orca preparation configuration is unavailable.")
    repo.preparation = { configuration, hash: digest(JSON.stringify(configuration)) }
   }
   assertNoLegacyGraph(agentDir(), candidate.repositories.map(repo => repo.identity))
   const directory = join(agentDir(), "task-graphs")
   mkdirSync(directory, { recursive: true, mode: 0o700 })
   for (const entry of readdirSync(directory).filter(name => name.endsWith(".json"))) {
    const existing = readGraphRecord(join(directory, entry))
    if (!existing.completion && existing.repositories.some(repo => candidate.repositories.some(other => other.identity === repo.identity))) throw new Error(`An unfinished graph owns a selected repository. Resume its exact command: /graph ${existing.plan.mode === "execute" ? "execute" : "plan"} ${existing.plan.objective}`)
   }
   const summary = { ...candidate, resourceRuntime: resourceHelper().RESOURCE_RUNTIME, repositories: candidate.repositories.map(repo => ({ ...repo, inputs: repo.inputs.map(({ bytes, ...input }) => input) })) }
   if (!ctx.hasUI || !await ctx.ui.confirm(plan.mode === "plan-only" ? "Approve planning only?" : "Approve separate execution?", `${JSON.stringify(summary, null, 2)}\nOne coordinator workspace per writing repository. Input captures and scoped commits run Git hooks. The displayed Orca preparation configuration includes default terminals and commands. Approval covers that exact configuration; changes block creation. Creation skips repository setup hooks. No source writes, workers, publishing, merge-back or worktree deletion. Approved repository scripts remain trusted code, not an OS sandbox.`, { signal })) return text({ status: "not-approved" })
   // Inputs were captured before confirmation. Never re-read them after approval or on resume.
   const target = join(directory, `${digest(`${repositoryIdentity(request.root)}:${plan.mode}:${plan.objective}`)}.json`)
   if (existsSync(target)) throw new Error("Graph record appeared during approval. Resume it; do not overwrite it.")
   const releaseStartup = acquireLease(join(directory, "startup"))
   try {
    for (const entry of readdirSync(directory).filter(name => name.endsWith(".json"))) {
     const existing = readGraphRecord(join(directory, entry))
     if (!existing.completion && existing.repositories.some(repo => candidate.repositories.some(other => other.identity === repo.identity))) throw new Error("A selected repository acquired an unfinished graph during approval. Resume it instead.")
    }
    if (existsSync(target)) throw new Error("Graph record appeared during approval; do not overwrite it.")
    release = acquireLease(target)
    file = target; record = candidate
    persist()
   } finally { releaseStartup() }
   return text({ status: "approved", record: file, plan, repositories: summary.repositories })
  },
 })
 pi.registerTool({
  name: "prepare_task_graph_workspace", label: "Prepare Graph", description: "Reconcile the Run and create or reuse one workspace per writing repository. No workers or input recapture.", parameters: object({}), executionMode: "sequential",
  async execute() {
   const state = bound()
   for (const repo of state.repositories) if (repo.sourceSeal !== sourceSeal(repo.source)) throw new Error('Source checkout changed before preparation. Preserve it and stop.')
   prepareLedger(state, orcaJson, persist)
   for (const repo of state.repositories) if (repo.workspace) { createGraphWorkspace(repo, orcaJson, persist); importGraphInputs(repo, persist) }
   verify()
   if (state.plan.resources?.length) {
    if (state.active) { state.active.validated = undefined; state.active.validation = undefined; persist() }
    const helper = resourceHelper()
    const workspace = state.repositories.find(repo => repo.workspace?.role !== "snapshot" && repo.workspace?.path)?.workspace?.path
    if (!workspace) throw new Error("Local resources require a writing workspace.")
    state.resources ??= {}
    helper.prepareResources(state.key, state.plan.resources, state.resources, persist, workspace, join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT!, "graph-resources", state.key), helper.dockerRuntime())
   }
   return text({ run_id: state.runId, repositories: graphRepositoryMap(state), completed: state.completed, active: state.active, resources: Object.entries(state.resources ?? {}).map(([id, resource]) => ({ id, identity: resource.id, ready: resource.ready })) })
  },
 })
 pi.registerTool({
  name: "operate_task_graph_resource", label: "Graph Resource", description: "Operate only an identity-verified scope-owned local resource. No enclosing-resource deletion.", parameters: object({ resource_id: string(), operation: StringEnum(["reset", "scan", "stop"] as const) }), executionMode: "sequential",
  async execute(_id, params) {
   const state = bound(), resource = state.resources?.[params.resource_id]
   if (!resource) throw new Error("Resource is outside this graph approval.")
   if (params.operation !== 'stop') active()
   if (state.active) { state.active.validated = undefined; state.active.validation = undefined; persist() }
   const helper = resourceHelper()
   const output = helper.operateResource(resource, params.operation, helper.dockerRuntime())
   persist()
   if (params.operation === 'stop') {
    for (const [key, value] of resourceEnv) value === undefined ? delete process.env[key] : process.env[key] = value
    resourceEnv.clear()
   }
   return text({ resource_id: params.resource_id, operation: params.operation, output, retained: true })
  },
 })
 pi.registerTool({
  name: "expand_task_graph_scope", label: "Expand Graph Scope", description: "Approve only scope additions: ownership, tasks, new repositories or local resources. Existing foundations and snapshots remain unchanged.", parameters: object({ owns: Type.Array(object({ task_id: string(), paths: Type.Array(string()) })), resources: Type.Array(resourceSchema), tasks: Type.Optional(Type.Array(taskDeclarationSchema)), foundations: Type.Optional(Type.Array(foundationSchema)), inputs: Type.Optional(Type.Array(inputSchema)) }), executionMode: "sequential",
  async execute(_id, params, signal, _update, ctx) {
   const state = bound()
   if (pendingShell.size) throw new Error("Wait for active commands before scope expansion.")
   verify()
   const plan = structuredClone(state.plan)
   plan.tasks.push(...(params.tasks ?? []))
   plan.foundations.push(...(params.foundations ?? []))
   for (const selection of params.inputs ?? []) if (state.repositories.some(repo => repo.source === realpathSync(resolve(state.root, selection.repository)))) throw new Error('Scope additions cannot recapture existing repository inputs.')
   plan.inputs = [...(plan.inputs ?? []), ...(params.inputs ?? [])]
   for (const entry of params.owns) {
    const task = plan.tasks.find(task => task.id === entry.task_id)
    if (!task || state.completed[task.id]) throw new Error("Only unfinished task ownership can expand.")
    task.owns = [...new Set([...task.owns, ...entry.paths])]
   }
   plan.resources ??= []
   for (const addition of params.resources) {
    const index = plan.resources.findIndex(resource => resource.id === addition.id)
    if (index < 0) plan.resources.push(addition)
    else {
     if (state.resources?.[addition.id]) throw new Error('Created or uncertain resources cannot change limits. Declare a new bounded resource ID; retain the old one.')
     plan.resources[index] = addition
    }
   }
   resourceHelper().validateResources(plan.resources)
   const candidate = captureGraphWorkspaces(state.root, plan, state)
   const additions = candidate.repositories.filter(repo => !state.repositories.some(old => old.source === repo.source && Boolean(old.workspace) === Boolean(repo.workspace)))
   for (const repo of additions) if (repo.workspace) {
    const configuration = orcaJson(['repo', 'show', '--repo', `path:${repo.source}`, '--json'])?.result
    if (!configuration) throw new Error('Orca preparation configuration is unavailable.')
    repo.preparation = { configuration, hash: digest(JSON.stringify(configuration)) }
   }
   assertNoLegacyGraph(agentDir(), additions.map(repo => repo.identity))
   const summary = { ...params, resourceRuntime: resourceHelper().RESOURCE_RUNTIME, repositories: additions.map(repo => ({ ...repo, inputs: repo.inputs.map(({ bytes, ...input }) => input) })) }
   if (!ctx.hasUI || !await ctx.ui.confirm("Approve graph scope additions?", JSON.stringify(summary, null, 2), { signal })) return text({ status: "not-approved" })
   const releaseAdmission = acquireLease(join(agentDir(), 'task-graphs/startup'))
   try {
    for (const entry of readdirSync(join(agentDir(), 'task-graphs')).filter(name => name.endsWith('.json'))) {
     const otherFile = join(agentDir(), 'task-graphs', entry)
     if (otherFile === file) continue
     const other = readGraphRecord(otherFile)
     if (!other.completion && other.repositories.some(repo => additions.some(addition => addition.identity === repo.identity))) throw new Error('An added repository belongs to another unfinished graph.')
    }
    state.plan = plan; state.repositories = candidate.repositories
    state.scopeChanges ??= []; state.scopeChanges.push({ at: new Date().toISOString(), additions: summary })
    persist()
   } finally { releaseAdmission() }
   if (state.active) { state.active.validated = undefined; state.active.validation = undefined }
   persist()
   return text({ status: "expanded", additions: params })
  },
 })
 pi.registerTool({
  name: "start_task_graph_task", label: "Start Graph Task", description: "Start or resume only the first unfinished task. One task may write at a time.", parameters: taskSchema, executionMode: "sequential",
  async execute(_id, params) {
   const state = bound()
   verify()
   if (!state.runId) throw new Error("Prepare the Run first.")
   const task = state.plan.tasks.find(task => !state.completed[task.id])
   if (!task || task.id !== params.task_id || task.depends_on.some(id => !state.completed[id])) throw new Error("Start the first unfinished task in dependency order.")
   if (state.active && state.active.task !== task.id) throw new Error("Another task is active.")
   const repo = state.repositories.find(repo => repo.source === realpathSync(resolve(state.root, task.repository)))!
   if (!state.active) {
    const location = graphPlanLocation(state, task.id)
    if (location && (location.local.startsWith("docs/future/") ? location.status !== "ready-for-promotion" : !["queued", "in-progress", "in-review", "validation", "budget-exhausted", "ready-for-promotion"].includes(location.status ?? ""))) throw new Error("Current plan is not executable. Preserve its blocker.")
    if (state.repositories.some(repo => repo.workspace && graphDirtyPaths(repo.workspace.path!).length)) throw new Error("Checkpoint previous task changes before starting another.")
    state.active = { task: task.id, before: repo.workspace ? verifyGraphWorkspace(repo) : repo.base, setup: !task.setup }
    persist()
   }
   return text({ task, workspace: repo.workspace?.path ?? repo.source, progress: state.active })
  },
 })
 pi.on("tool_result", event => {
  const pending = pendingShell.get(event.toolCallId)
  pendingShell.delete(event.toolCallId)
  if (!pending) return
  try {
   const { state, task, repo } = active()
   if (task.id !== pending.task) throw new Error("Task changed while a shell command was running.")
   verify()
   if (event.isError) return
   if (pending.command === task.setup) state.active!.setup = true
   if (pending.command === task.validation && state.active!.setup && !graphDirtyPaths(repo.workspace!.path!).length) {
    state.active!.validated = verifyGraphWorkspace(repo)
    state.active!.validation = { command: task.validation, head: state.active!.validated, result: "success" }
   }
   persist()
  } catch (error) {
   if (record?.active) { record.active.validated = undefined; record.active.validation = undefined; persist() }
   return { isError: true, content: [{ type: "text" as const, text: `Graph ownership [${POLICY_VERSION}]: ${error instanceof Error ? error.message : "Post-command verification failed"}` }] }
  }
 })
 pi.registerTool({
  name: "checkpoint_task_graph", label: "Checkpoint Graph", description: "Commit explicit active-task paths with Git hooks enabled. No amend, publishing, branch changes or integration.", parameters: object({ repository: string(), paths: Type.Array(string(), { minItems: 1, maxItems: 100 }), message: string() }), executionMode: "sequential",
  async execute(_id, params) {
   const { state, task, repo } = active()
   if (params.repository !== repo.workspace?.path || !state.active!.setup) throw new Error("Checkpoint only the active task's prepared workspace after setup.")
   if (new Set(params.paths).size !== params.paths.length) throw new Error("Checkpoint paths must be unique.")
   for (const path of params.paths) graphFile(repo.workspace!.path!, path)
   const commit = () => checkpointGraphChanges(repo, task.owns, state.plan.mode, state.active!.before, params.paths, params.message)
   const queued = [...params.paths].sort().reduceRight<() => Promise<string>>((next, path) => () => withFileMutationQueue(join(repo.workspace!.path!, path), next), async () => commit())
   state.active!.validated = undefined; state.active!.validation = undefined; persist()
   const head = await queued()
   return text({ head })
  },
 })
 pi.registerTool({
  name: "move_task_graph_plan", label: "Move Current Plan", description: "Move only the active approved plan to active or completed. Status and evidence must already be truthful. No source or unrelated plan moves.", parameters: object({ destination: StringEnum(["active", "completed"] as const) }), executionMode: "sequential",
  async execute(_id, params) {
   const { state, task } = active()
   const location = graphPlanLocation(state, task.id)
   if (!location || state.plan.mode !== "execute") throw new Error("Only the active approved execution plan can move.")
   const local = `docs/exec-plans/${params.destination}/${location.filename}`
   const path = join(location.repo.workspace!.path!, local)
   if (path === location.path) return text({ path })
   if (params.destination === "active" && !location.local.startsWith("docs/future/") || params.destination === "completed" && (!location.local.startsWith("docs/exec-plans/active/") || location.status !== "completed")) throw new Error("Invalid plan lifecycle transition. Complete the current active plan before its final move.")
   graphWritePath(state, location.path); graphWritePath(state, path)
   const [first, second] = [location.path, path].sort()
   return withFileMutationQueue(first, () => withFileMutationQueue(second, async () => {
    const current = graphPlanLocation(state, task.id)!
    if (current.path !== location.path || current.status !== location.status) throw new Error("Plan changed before its move; inspect it again.")
    graphWritePath(state, location.path); graphWritePath(state, path)
    if (existsSync(path)) throw new Error("Plan destination already exists; preserve both records.")
    mkdirSync(join(path, ".."), { recursive: true })
    renameSync(location.path, path)
    state.active!.validated = undefined; state.active!.validation = undefined; persist()
    return text({ path })
   }))
  },
 })
 pi.registerTool({
  name: "complete_task_graph_task", label: "Complete Graph Task", description: "Complete the active task after successful validation of its clean checkpoint, with truthful evidence.", parameters: object({ task_id: string(), evidence: string() }), executionMode: "sequential",
  async execute(_id, params) {
   const { state, task, repo } = active()
   if (task.id !== params.task_id || !params.evidence.trim()) throw new Error("Complete only the active task with evidence.")
   verify()
   const head = repo.workspace ? verifyGraphWorkspace(repo) : repo.base
   if (repo.workspace && graphDirtyPaths(repo.workspace.path!).length || task.owns.length && (state.active!.validated !== head || state.active!.validation?.command !== task.validation || state.active!.validation?.head !== head || state.active!.validation?.result !== "success")) throw new Error("Run the declared validation successfully on the clean final checkpoint before completion.")
   verifyPlanCloseout({ ...state, plans: state.plans?.filter(plan => plan.id === task.id) }, true)
   state.completed[task.id] = { head, evidence: params.evidence }
   state.active = undefined
   persist() // Durable verified result before the remote task update, replayed on resume.
   prepareLedger(state, orcaJson, persist)
   return text({ status: "completed", task: task.id, head })
  },
 })
 pi.registerTool({
  name: "finish_task_graph", label: "Finish Graph", description: "Finish locally after every task and closeout check. Retain all workspaces; no publishing, deletion or automatic execution.", parameters: object({ run_id: string(), evidence: string(), delivery_pending: Type.Optional(Type.Boolean()) }), executionMode: "sequential",
  async execute(_id, params) {
   const state = bound()
   if (params.run_id !== state.runId || !params.evidence.trim() || state.active || state.plan.tasks.some(task => !state.completed[task.id])) throw new Error("Finish only this Run after every task completes with evidence.")
   verify()
   if (state.repositories.some(repo => repo.workspace && graphDirtyPaths(repo.workspace.path!).length)) throw new Error("Final workspaces must be clean.")
   verifyPlanCloseout(state, Boolean(params.delivery_pending))
   prepareLedger(state, orcaJson, persist)
   state.completion = { evidence: params.evidence, deliveryPending: Boolean(params.delivery_pending) }
   persist()
   const result = text({ status: params.delivery_pending ? "local-ready" : "complete", evidence: params.evidence, repositories: graphRepositoryMap(state), record: file, publishing: "not-authorized", worktrees: "retained" })
   stop()
   return { ...result, terminate: true }
  },
 })
 pi.on("tool_call", async (event, ctx) => {
  if (process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES || process.env.AGENT_TOOLKIT_GRAPH_TASK) return { block: true, reason: LEGACY_GRAPH }
  if (!request && !record) return
  try {
   const probe = `${process.env.AGENT_TOOLKIT_REVIEW_ROOT}/.native-probe-${process.pid}.txt`
   if (event.toolName === "write" && (event.input as any).path === probe && (event.input as any).content === "native report probe") return
   if (["read", "fffind", "ffgrep", "grep", "find", "ls", "ask_user_question"].includes(event.toolName)) return
   if (event.toolName === "bash") {
    const input = event.input as any
    const selected = input.repository ? isAbsolute(input.repository) ? input.repository : `${ctx.cwd}/${input.repository}` : ctx.cwd
    const facts = await inspectShell(input.command, selected)
    if (facts.inspection) {
     if (!record?.active) return
     const { task, repo } = active()
     if (facts.cwd !== repo.workspace?.path || ![task.setup, task.validation].includes(input.command)) return
    }
    const { state, task, repo } = active()
    if (!repo.workspace?.path || facts.cwd !== repo.workspace.path) throw new Error("Commands with possible side effects require the active writing workspace.")
    if ((facts.directories ?? []).some(path => path !== repo.workspace!.path && !path.startsWith(`${repo.workspace!.path}/`))) throw new Error('Working-directory change escapes the active writing workspace.')
    if (!state.active!.setup && input.command !== task.setup) throw new Error("Run the declared setup before diagnostics or validation.")
    verify()
    state.active!.validated = undefined; state.active!.validation = undefined
    if (input.command === task.setup) state.active!.setup = false
    persist()
    process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES = JSON.stringify(graphRepositoryMap(state))
    if (state.resources && Object.keys(state.resources).length) {
     for (const [key, value] of resourceEnv) value === undefined ? delete process.env[key] : process.env[key] = value
     resourceEnv.clear()
     const helper = resourceHelper()
     for (const [key, value] of Object.entries(helper.resourceEnvironment(state.resources, helper.dockerRuntime()))) {
      if (!resourceEnv.has(key)) resourceEnv.set(key, process.env[key])
      process.env[key] = String(value)
     }
    }
    pendingShell.set(event.toolCallId, { task: task.id, command: input.command })
    return
   }
   if (["write", "edit"].includes(event.toolName)) {
    const state = bound()
    graphWritePath(state, String((event.input as any).path).replace(/^@/, ""))
    state.active!.validated = undefined; state.active!.validation = undefined; persist()
    return
   }
   if (["propose_task_graph", "prepare_task_graph_workspace", "start_task_graph_task", "checkpoint_task_graph", "move_task_graph_plan", "complete_task_graph_task", "finish_task_graph", "operate_task_graph_resource", "expand_task_graph_scope"].includes(event.toolName)) return
   throw new Error("This tool is outside graph authority. Workers, publishing, deletion and other mutation tools are not permitted.")
  } catch (error) { return { block: true, reason: `Graph ownership [${POLICY_VERSION}], cwd=${ctx.cwd}: ${error instanceof Error ? error.message : "Rejected operation"}. Resume the recorded scope or obtain approval for the changed scope.` } }
 })
 // Keep graph ownership between turns and interrupted commands. Only explicit
 // local closeout or session shutdown releases the coordinator lease.
 pi.on("session_shutdown", stop)
}
