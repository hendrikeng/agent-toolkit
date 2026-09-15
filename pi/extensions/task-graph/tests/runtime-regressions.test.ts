import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import { registerHooks } from "node:module"
import { digest, graphGit, repositoryIdentity } from "../task-graph-core.ts"
import { captureGraphWorkspaces } from "../workspaces.ts"

const globals = globalThis as any
const hooks = registerHooks({ resolve(specifier, context, next) {
 if (!context.parentURL?.endsWith("/task-graph/index.ts")) return next(specifier, context)
 const modules: Record<string, string> = {
  "@earendil-works/pi-coding-agent": "export const getAgentDir=()=>globalThis.agentDir; export const truncateHead=content=>({content}); export const withFileMutationQueue=(_path,fn)=>fn();",
  "@earendil-works/pi-ai": "export const StringEnum=()=>({});",
  "@earendil-works/pi-tui": "export class Loader { stop(){} }",
  typebox: "export const Type=new Proxy({}, {get:()=>()=>({})});",
  "node:child_process": "export const execFileSync=(_binary,args)=>JSON.stringify(globalThis.orcaRpc(args));",
  "../development-access/index.ts": "export const inspectShell=async(command,cwd)=>({command,cwd,inspection:command.startsWith('git ')||command.startsWith('cross-check '),effects:command.includes('>')||command.startsWith('PATH='),gitMutation:/(?:^|\\/)git (?:add|commit|merge)/.test(command)||command.includes('git hash-object'),commands:command.includes('git hash-object')?(command.startsWith('git hash-object')?[command.split(' ')]:[['git','show'],['git','hash-object','--stdin']]):[command.startsWith('/usr/bin/git ')?command.split(' '):command.startsWith('orca ')?['orca','orchestration','send']:command.startsWith('./orca ')?['./orca','orchestration','send']:command.startsWith('PATH=')?['orca','orchestration','send']:['node','check.cjs']],paths:command.startsWith('cross-')?[command.slice(command.indexOf(' ')+1)]:[],candidates:[],directories:[]}); export const runBash=async(_id,params,_signal,_update,cwd,env)=>{globalThis.graphBashRuns.push({command:params.command,cwd,env}); if(globalThis.graphBashFailure) throw new Error(globalThis.graphBashFailure); return {content:[]}};"
 }
 return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context)
} })
const originalPath = process.env.PATH
let extension: (api: never) => void
try { process.env.PATH = ""; ({ default: extension } = await import("../index.ts")) }
finally { process.env.PATH = originalPath }
test.after(() => hooks.deregister())

function fixture() {
 const root = realpathSync(mkdtempSync(join(tmpdir(), "graph-runtime-"))), home = join(root, "home"), source = join(home, "Code/source"), dependency = join(home, "Code/dependency")
 mkdirSync(join(home, "orca/workspaces"), { recursive: true }); process.env.HOME = home
 const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }
 Object.assign(process.env, gitEnv)
 execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source], { env: gitEnv })
 execFileSync("git", ["init", "--quiet", "--initial-branch=dev", dependency], { env: gitEnv }); writeFileSync(join(dependency, "dependency.txt"), "dependency\n"); graphGit(dependency, "add", "--", "dependency.txt"); graphGit(dependency, "commit", "-m", "base")
 for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(source, name), "base\n")
 writeFileSync(join(source, "check.cjs"), "process.exit(0)\n"); writeFileSync(join(source, "setup.cjs"), "process.exit(0)\n")
 graphGit(source, "add", "--", "a.txt", "b.txt", "c.txt", "check.cjs", "setup.cjs"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD")
 const runs: any[] = [], tasks: any[] = [], worktrees: any[] = [], terminals: any[] = [], dispatches: any[] = [], calls: string[][] = [], integrationValidations: any[] = []
 let loseWorktreeReceipt = false
 globals.graphBashRuns = integrationValidations; globals.graphBashFailure = undefined
 globals.orcaRpc = (args: string[]) => {
  calls.push(args); const value = (key: string) => args[args.indexOf(key) + 1], op = args.slice(0, 2).join(" "); let result: any
  if (op === "repo list") result = { repos: [{ id: "repo", path: source }, { id: "dependency", path: dependency }] }
  else if (op === "repo show") result = { repo: { id: "repo", defaultTerminals: [], setup: [] } }
  else if (op === "worktree list") result = { worktrees }
  else if (op === "worktree create") {
   const name = value("--name"), repoId = value("--repo").slice(3), owner = repoId === "repo" ? source : dependency, path = join(home, "orca/workspaces", `${repoId}-${name}`); graphGit(owner, "worktree", "add", "--quiet", "-b", name, path, value("--base-branch"))
   const worktree = { id: `${repoId}::${path}`, path, displayName: name, branch: `refs/heads/${name}`, owner }; worktrees.push(worktree)
   if (loseWorktreeReceipt) { loseWorktreeReceipt = false; throw new Error("lost worktree receipt") }
   result = { worktree }
  } else if (op === "worktree set") {
   const item = worktrees.find(item => item.id === value("--worktree").slice(3)); item.displayName = value("--display-name"); result = { worktree: item }
  } else if (op === "worktree rm") {
   const id = value("--worktree").slice(3), index = worktrees.findIndex(item => item.id === id), item = worktrees[index]
   if (item) { execFileSync("/usr/bin/git", ["--no-replace-objects", "-C", item.owner, "worktree", "remove", item.path], { env: gitEnv }); worktrees.splice(index, 1) }
   result = {}
  } else if (op === "orchestration run-list") result = { runs }
  else if (op === "orchestration run-create") { const run = { id: "run_fixture", objective: value("--objective") }; runs.push(run); result = { run } }
  else if (op === "orchestration run-show") result = { run: runs.find(run => run.id === value("--id")) }
  else if (op === "orchestration run-use") result = { run: runs.find(run => run.id === value("--id")) }
  else if (op === "orchestration task-list") result = { tasks }
  else if (op === "orchestration task-create") { const task = { id: `task_${tasks.length}`, run_id: value("--run"), spec: value("--spec"), deps: value("--deps"), status: "ready", parent_id: null }; tasks.push(task); result = { task } }
  else if (op === "orchestration task-update") { const task = tasks.find(task => task.id === value("--id")); task.status = value("--status"); result = { task } }
  else if (op === "terminal list") result = { terminals }
  else if (op === "terminal create") {
   const selector = value("--worktree"), path = selector.startsWith("id:") ? worktrees.find(item => item.id === selector.slice(3)).path : selector.slice(5)
   const terminal = { handle: `terminal_${calls.filter(call => call.slice(0, 2).join(" ") === "terminal create").length}`, title: value("--title"), worktreePath: path, command: value("--command") }
   terminals.push(terminal); result = { terminal }
  } else if (op === "terminal close") { if (globals.graphTerminalCloseFailure) throw new Error("terminal close failed"); const index = terminals.findIndex(item => item.handle === value("--terminal")); if (index >= 0) terminals.splice(index, 1); result = {} }
  else if (op === "terminal wait") {
   const satisfied = !globals.graphTerminalNotReady; delete globals.graphTerminalNotReady
   result = { wait: { handle: value("--terminal"), condition: "tui-idle", satisfied } }
  }
  else if (op === "orchestration dispatch") {
   if (globals.graphDispatchFailures > 0) { globals.graphDispatchFailures--; throw new Error("dispatch failed") }
   const dispatch = { id: `dispatch_${dispatches.length}`, task_id: value("--task"), run_id: value("--run"), assignee_handle: value("--to"), status: "running" }; dispatches.push(dispatch); tasks.find(task => task.id === dispatch.task_id).status = "dispatched"; result = { dispatch }
  }
  else if (op === "orchestration dispatch-show") result = { dispatch: dispatches.findLast(item => item.task_id === value("--task")) }
  else throw new Error(`Unexpected Orca RPC: ${op}`)
  return { ok: true, result }
 }
 globals.agentDir = join(root, "agent"); mkdirSync(globals.agentDir); process.env.AGENT_TOOLKIT_PI_AGENT_DIR = globals.agentDir
 function runtime(cwd: string) {
  const tools = new Map<string, any>(), events = new Map<string, any>(), commands = new Map<string, any>(), notifications: any[] = [], workingMessages: Array<string | undefined> = [], widgets: any[] = []
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => events.set(name, handler), registerCommand: (name: string, command: any) => commands.set(name, command), sendUserMessage: () => {} } as never)
  let idle = true
  const ctx = { cwd, mode: "tui", model: { provider: "test", id: "model" }, hasUI: true, isIdle: () => idle, ui: { confirm: async () => { globals.graphConfirm?.(); return true }, notify: (message: string, level: string) => { notifications.push({ message, level }); if (level === "error") throw new Error(message) }, setWorkingMessage: (message?: string) => workingMessages.push(message), setWidget: (id: string, content?: any, options?: any) => { widgets.push({ id, value: content ? "loader" : undefined, placement: options?.placement }); if (typeof content === "function") content({}, { fg: (_color: string, value: string) => value }) } } }
  let serial = 0
  return { notifications, workingMessages, widgets, settle: () => events.get("agent_settled")?.({}, ctx), setIdle: (value: boolean) => { idle = value }, commandNames: () => [...commands.keys()], command: (args: string) => commands.get("graph").handler(args, ctx), stop: () => events.get("session_shutdown")?.(), async call(name: string, input: any = {}) {
   const id = String(++serial), event = { toolName: name, input, toolCallId: id }, blocked = await events.get("tool_call")?.(event, ctx)
   if (blocked?.block) throw new Error(blocked.reason)
   let output: any, error: any
   try {
    if (name === "write") writeFileSync(input.path, input.content)
    else if (name === "bash") output = { content: [{ type: "text", text: input.command.startsWith("orca ") ? "reported" : input.command.startsWith("cross-check ") ? "checked" : execFileSync("/bin/bash", ["-c", input.command], { cwd: input.repository || cwd, env: process.env, encoding: "utf8" }) }] }
    else output = await tools.get(name).execute(id, input, undefined, undefined, ctx)
   } catch (failure) { error = failure }
   await events.get("tool_result")?.({ ...event, isError: Boolean(error), content: output?.content ?? [] }, ctx)
   if (error) throw error
   return output
  } }
 }
 const plan: any = { objective: `Concurrent lanes ${root}`, mode: "execute", worktree_budget: 3, foundations: [{ repository: source, commit: base }], tasks: [
  { id: "a", goal: "write a", repository: source, depends_on: [], owns: ["a.txt"], done_when: ["validated"], validation: "node check.cjs" },
  { id: "b", goal: "write b", repository: source, depends_on: [], owns: ["b.txt"], done_when: ["validated"], validation: "node check.cjs" },
  { id: "c", goal: "write c", repository: source, depends_on: ["a", "b"], owns: ["c.txt"], done_when: ["validated"], validation: "node check.cjs" },
 ] }
 return { root, agent: globals.agentDir, source, dependency, base, dependencyBase: graphGit(dependency, "rev-parse", "HEAD"), plan, tasks, worktrees, terminals, dispatches, calls, integrationValidations, loseNextWorktreeReceipt: () => { loseWorktreeReceipt = true }, failNextTerminalWait: () => { globals.graphTerminalNotReady = true }, failNextDispatch: () => { globals.graphDispatchFailures = 1 }, runtime }
}

test("graph commands preserve multiline objectives without a model round trip", async () => {
 const f = fixture(), coordinator = f.runtime(f.source), objective = "first line\nsecond line"
 try {
  assert.deepEqual(coordinator.commandNames(), ["graph"])
  await coordinator.command(`execute ${objective}`)
  assert.deepEqual(coordinator.widgets, [{ id: "task-graph-command", value: "loader", placement: "aboveEditor" }, { id: "task-graph-command", value: undefined, placement: undefined }])
  assert.deepEqual(coordinator.workingMessages, ["Graph: preparing execution…"])
  await coordinator.settle()
  assert.deepEqual(coordinator.workingMessages, ["Graph: preparing execution…", undefined])
  const result = (await coordinator.call("propose_task_graph", { ...f.plan, objective: "first line second line" })).details
  assert.equal(result.plan.objective, objective)
 } finally { coordinator.stop() }
})

test("new graphs do not reuse an orphaned purge staging name", async () => {
 const f = fixture(), objective = f.plan.objective, stem = digest(`${repositoryIdentity(f.source)}:execute:${objective}`), pending = join(f.agent, "task-graph-purges/v1", `${stem}.pending`); mkdirSync(pending, { recursive: true })
 const coordinator = f.runtime(f.source)
 try { await coordinator.command(`execute ${objective}`); const approval = (await coordinator.call("propose_task_graph", f.plan)).details; assert.equal(basename(approval.record), `${stem}-1.json`) }
 finally { coordinator.stop() }
})

test("graph gc reports eligibility without mutating the active graph", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [f.plan.tasks[0]]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const before = readFileSync(approval.record, "utf8"), calls = f.calls.length
  coordinator.setIdle(false); await coordinator.command("gc")
  assert.deepEqual(coordinator.widgets.slice(-2), [{ id: "task-graph-command", value: "loader", placement: "aboveEditor" }, { id: "task-graph-command", value: undefined, placement: undefined }])
  assert.deepEqual(coordinator.workingMessages, ["Graph: preparing execution…"])
  const report = JSON.parse(coordinator.notifications.at(-1).message)
  assert.equal(report.inspectionOnly, true); assert.equal(report.summary.active, 1)
  assert.equal(report.records.find((item: any) => item.runId === "run_fixture").nextAction, "/graph resume run_fixture")
  assert.equal(readFileSync(approval.record, "utf8"), before); assert.equal(f.calls.length, calls)
 } finally { coordinator.stop() }
})

test("graph purge permanently removes only verified archives after 90 days", async () => {
 const f = fixture(), records = join(f.agent, "task-graphs"), directory = join(f.agent, "task-graphs-archived/v1/old"), recordPath = join(directory, "record.json"), sidecars = join(directory, "sidecars")
 const plan: any = { objective: "Old archive", mode: "plan-only", worktree_budget: 1, foundations: [{ repository: f.source, commit: f.base }], tasks: [{ id: "read", goal: "Inspect", repository: f.source, depends_on: [], owns: [], done_when: ["Inspected."], validation: "manual: inspected" }] }, record = captureGraphWorkspaces(f.source, plan)
 record.runId = "run_old_archive"; record.completed.read = { head: f.base, integrationHead: f.base, evidence: "done" }; record.completion = { evidence: "done", deliveryPending: false }
 mkdirSync(records, { recursive: true }); mkdirSync(sidecars, { recursive: true }); writeFileSync(recordPath, JSON.stringify(record)); writeFileSync(join(sidecars, "receipt"), "old evidence")
 writeFileSync(join(directory, "archive.json"), JSON.stringify({ version: 1, status: "archived", runId: record.runId, source: join(records, "old.json"), record: recordPath, recordHash: digest(readFileSync(recordPath)), archivedAt: "2020-01-01T00:00:00.000Z", preserved: ["graph-record", "sidecars", "orchestration-evidence", "commits", "worktrees", "branches", "resources"] }))
 const coordinator = f.runtime(f.source), uncertain = join(records, "uncertain.json"); writeFileSync(uncertain, "not json")
 try {
  await assert.rejects(coordinator.command("purge 90d"), /Uncertain graph evidence can refer/); assert.equal(existsSync(directory), true); unlinkSync(uncertain)
  await coordinator.command("purge 90d")
  assert.equal(existsSync(directory), false)
  const receipt = JSON.parse(readFileSync(join(f.agent, "task-graph-purges/v1/old.json"), "utf8")); assert.equal(receipt.status, "purged"); assert.equal(receipt.runId, record.runId)
 } finally { coordinator.stop() }
})

test("graph archive resumes after the active record was moved", async () => {
 const f = fixture(), records = join(globals.agentDir, "task-graphs"), archive = join(globals.agentDir, "task-graphs-archived/v1"), source = join(records, "interrupted.json"), directory = join(archive, "interrupted"), target = join(directory, "record.json")
 const record = captureGraphWorkspaces(f.source, { ...f.plan, tasks: [{ ...f.plan.tasks[0], owns: [], validation: "manual: inspected" }] }); record.runId = "run_fixture"; record.completed[record.plan.tasks[0].id] = { head: f.base, integrationHead: f.base, evidence: "done" }; record.completion = { evidence: "done", deliveryPending: false }
 mkdirSync(records, { recursive: true }); mkdirSync(directory, { recursive: true }); mkdirSync(join(archive, "empty")); writeFileSync(source, JSON.stringify(record)); writeFileSync(`${source}.receipt`, "sidecar"); const bytes = readFileSync(source); renameSync(source, target)
 writeFileSync(join(directory, "archive.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: record.runId, source, record: target, recordHash: digest(bytes), archivedAt: new Date().toISOString(), preserved: ["graph-record", "sidecars", "orchestration-evidence", "commits", "worktrees", "branches", "resources"] }))
 const retired = join(globals.agentDir, "task-graphs-retired/v4/other"); mkdirSync(retired, { recursive: true }); writeFileSync(join(retired, "retirement.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_other", source: join(records, "other.json") }))
 const coordinator = f.runtime(f.source), duplicate = join(records, "duplicate.json"); writeFileSync(duplicate, JSON.stringify({ version: 4, runId: record.runId }))
 try { await assert.rejects(coordinator.command("archive run_fixture"), /Multiple graph records/); unlinkSync(duplicate); await coordinator.command("archive run_fixture"); assert.equal(JSON.parse(readFileSync(join(directory, "archive.json"), "utf8")).status, "archived"); assert.equal(readFileSync(join(directory, "sidecars/interrupted.json.receipt"), "utf8"), "sidecar") }
 finally { coordinator.stop() }
})

test("an active graph resumes from its repository after its original root disappears", async () => {
 const f = fixture(), coordinator = f.runtime(f.source)
 let record: string
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  record = (await coordinator.call("propose_task_graph", f.plan)).details.record
  await coordinator.call("prepare_task_graph_workspace")
 } finally { coordinator.stop() }
 const state = JSON.parse(readFileSync(record!, "utf8")); state.root = join(f.root, "missing-original-root")
 for (const item of [...state.plan.tasks, ...state.plan.foundations]) item.repository = "."
 writeFileSync(record!, JSON.stringify(state))
 const upgraded = "Checkpoint all final writes first, then run the exact Validation command on the clean checkpoint as your final non-inspection command before reporting completion. Validation before the final checkpoint does not count."
 for (const task of f.tasks) task.spec = task.spec.replace(upgraded, "Use checkpoint_task_graph for commits.")
 const retired = join(f.agent, "task-graphs-retired/v4/other"), retirementReceipt = join(retired, "retirement.json"); mkdirSync(retired, { recursive: true }); writeFileSync(retirementReceipt, JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_fixture", source: record }))
 const retiring = f.runtime(f.source); try { await assert.rejects(retiring.command("resume run_fixture"), /Multiple retained graph records/) } finally { retiring.stop() }; writeFileSync(retirementReceipt, JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_other", source: join(f.agent, "task-graphs/other.json") }))
 const archived = join(f.agent, "task-graphs-archived/v1/conflict"), archivedRoot = join(f.agent, "task-graphs-archived"); mkdirSync(archived, { recursive: true }); writeFileSync(join(archived, "archive.json"), JSON.stringify({ version: 1, status: "archived", runId: "run_fixture", record: join(archived, "record.json") }))
 const conflict = f.runtime(f.source); try { await assert.rejects(conflict.command("resume run_fixture"), /Multiple retained graph records/) } finally { conflict.stop() }; renameSync(archivedRoot, `${archivedRoot}.preserved`)
 const resumed = f.runtime(f.source)
 try {
  await resumed.command("resume run_fixture")
  assert.ok(f.calls.some(call => call.slice(0, 2).join(" ") === "orchestration run-use" && call.includes("run_fixture")))
  await resumed.call("prepare_task_graph_workspace")
  const worker = (await resumed.call("start_task_graph_task", { task_id: "a" })).details.worker
  assert.equal(worker.ledgerTask, f.tasks.find(task => task.spec.includes(":a]"))?.id)
 } finally { resumed.stop() }
})

test("one approval runs concurrent workers, reuses bounded lanes, and delivers prerequisite commits", async () => {
 const f = fixture(), coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  await coordinator.call("bash", { command: "git status --short", repository: f.source })
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  const prepared = (await coordinator.call("prepare_task_graph_workspace")).details
  const a = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  const again = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  assert.equal(again.terminal, a.terminal)
  const b = (await coordinator.call("start_task_graph_task", { task_id: "b" })).details.worker
  assert.notEqual(a.workspace, b.workspace)
  assert.equal(f.worktrees.length, 3, "integration plus two writing lanes")
  assert.match(f.worktrees[0].branch, /graph-.*-integration$/)
  assert.equal(prepared.repositories[f.source].branch, f.worktrees[0].branch.replace("refs/heads/", ""))
  assert.ok(f.worktrees.some(item => item.displayName.endsWith(" · a"))); assert.ok(f.worktrees.some(item => item.displayName.endsWith(" · b")))
  assert.equal(f.calls.filter(call => call.slice(0, 2).join(" ") === "terminal create").length, 2)
  for (const terminal of f.terminals) assert.match(terminal.command, /pi-yolo --model 'test\/model' --thinking medium/)
  for (const dispatch of f.calls.filter(call => call.slice(0, 2).join(" ") === "orchestration dispatch")) {
   const dispatchIndex = f.calls.indexOf(dispatch), terminal = dispatch[dispatch.indexOf("--to") + 1]
   assert.ok(f.calls.slice(0, dispatchIndex).some(call => call.slice(0, 2).join(" ") === "terminal wait" && call.includes(terminal)))
  }
  await assert.rejects(coordinator.call("start_task_graph_task", { task_id: "c" }), /dependencies/)
  for (const [id, worker, path] of [["a", a, "a.txt"], ["b", b, "b.txt"]] as const) {
   process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = id
   const previous = process.cwd(), previousRepositories = process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES, launcherRepositories = `launcher-${id}`
   process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES = launcherRepositories; process.chdir(worker.workspace)
   let child: ReturnType<typeof f.runtime> | undefined
   try {
    child = f.runtime(worker.workspace)
    await assert.rejects(child.call("bash", { repository: worker.workspace, command: "git commit --allow-empty -m bypass" }), /checkpoint_task_graph/)
    await child.call("write", { path: join(worker.workspace, path), content: `${id}\n` })
    await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: [path], message: id })
    await child.call("bash", { repository: worker.workspace, command: "node check.cjs" })
    await child.call("bash", { repository: worker.workspace, command: "orca orchestration send --message done" })
   } finally {
    child?.stop(); assert.equal(process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES, launcherRepositories)
    process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK
    if (previousRepositories === undefined) delete process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES; else process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES = previousRepositories
   }
   const dispatch = f.dispatches.find(item => item.id === worker.dispatch); dispatch.status = "completed"
   f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
  }
  await coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "a validated" })
  let durable = JSON.parse(readFileSync(approval.record, "utf8")); assert.ok(durable.completed.a); assert.equal(durable.lanes.find((lane: any) => lane.previousTasks.includes("a")).task, undefined)
  await coordinator.call("complete_task_graph_task", { task_id: "b", evidence: "b validated" })
  assert.equal(f.integrationValidations.length, 2, "each merged task is validated again on the combined integration checkout")
  const integration = prepared.repositories[f.source].path, messages = graphGit(integration, "log", "--format=%s", "-6")
  assert.match(messages, /Integrate graph task a/); assert.match(messages, /\[a\] a/)
  const c = (await coordinator.call("start_task_graph_task", { task_id: "c" })).details.worker
  assert.equal(f.worktrees.length, 3, "the dependent task reuses a clean lane")
  f.dispatches.find(item => item.id === c.dispatch).status = "failed"
  f.tasks.find(task => task.id === c.ledgerTask).status = "failed"
  const retried = (await coordinator.call("start_task_graph_task", { task_id: "c" })).details.worker
  assert.equal(retried.workspace, c.workspace, "a retry preserves and reuses its lane")
  assert.equal(f.worktrees.length, 3)
  const state = JSON.parse(readFileSync(approval.record, "utf8"))
  for (const id of ["a", "b"]) graphGit(c.workspace, "merge-base", "--is-ancestor", state.completed[id].head, "HEAD")
  assert.equal(prepared.worktree_budget, 3)
  for (const name of readdirSync(join(f.root, "agent/task-graphs")).filter(name => name.endsWith(".json"))) assert.equal(JSON.parse(readFileSync(join(f.root, "agent/task-graphs", name), "utf8")).version, 4, "task receipts are not graph records")
 } finally { coordinator.stop() }
})

test("a completed worker missing final-checkpoint validation is redispatched", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [f.plan.tasks[0]]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"
  const previous = process.cwd(); process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("write", { path: join(worker.workspace, "a.txt"), content: "a\n" })
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["a.txt"], message: "a" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  const firstDispatch = worker.dispatch
  f.dispatches.find(item => item.id === firstDispatch).status = "completed"
  f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
  await assert.rejects(coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "missing final validation" }), /final checkpoint/)
  f.failNextTerminalWait()
  await assert.rejects(coordinator.call("start_task_graph_task", { task_id: "a" }), /not ready/)
  const retainedTerminal = JSON.parse(readFileSync(approval.record, "utf8")).workers.a.terminal
  f.failNextDispatch()
  await assert.rejects(coordinator.call("start_task_graph_task", { task_id: "a" }), /dispatch failed/)
  const retried = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  assert.equal(retried.terminal, retainedTerminal)
  assert.equal(f.calls.filter(call => call.slice(0, 2).join(" ") === "terminal create").length, 2)
  assert.notEqual(retried.dispatch, firstDispatch)
  assert.equal(retried.workspace, worker.workspace)
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(retried.workspace)
  try { await f.runtime(retried.workspace).call("bash", { repository: retried.workspace, command: "node check.cjs" }) }
  finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === retried.dispatch).status = "completed"
  f.tasks.find(task => task.id === retried.ledgerTask).status = "completed"
  await coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "validated after checkpoint" })
 } finally { coordinator.stop() }
})

test("lost lane creation receipts reconcile without another worktree", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [f.plan.tasks[0]]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  await coordinator.call("propose_task_graph", f.plan); await coordinator.call("prepare_task_graph_workspace")
  f.loseNextWorktreeReceipt()
  await assert.rejects(coordinator.call("start_task_graph_task", { task_id: "a" }), /lost worktree receipt/)
  assert.equal(f.worktrees.length, 2)
  await coordinator.call("prepare_task_graph_workspace")
  await coordinator.call("start_task_graph_task", { task_id: "a" })
  assert.equal(f.worktrees.length, 2, "resume adopts the reserved lane")
 } finally { coordinator.stop() }
})

test("the coordinator can resolve a preserved integration conflict", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [{ ...f.plan.tasks[1], setup: "node setup.cjs" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  const prepared = (await coordinator.call("prepare_task_graph_workspace")).details
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "b" })).details.worker
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "b"
  const previous = process.cwd(); process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("bash", { repository: worker.workspace, command: "node setup.cjs" })
   await child.call("write", { path: join(worker.workspace, "b.txt"), content: "worker\n" })
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["b.txt"], message: "worker" })
   await child.call("bash", { repository: worker.workspace, command: "node check.cjs" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  const integration = prepared.repositories[f.source].path
  writeFileSync(join(integration, "b.txt"), "integration\n"); graphGit(integration, "add", "--", "b.txt"); graphGit(integration, "commit", "-m", "integration change")
  f.dispatches.find(item => item.id === worker.dispatch).status = "completed"; f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
  await assert.rejects(coordinator.call("complete_task_graph_task", { task_id: "b", evidence: "validated" }))
  await coordinator.call("write", { path: join(integration, "b.txt"), content: "resolved\n" })
  await coordinator.call("checkpoint_task_graph", { repository: integration, paths: ["b.txt"], message: "Resolve worker integration" })
  globals.graphBashFailure = "combined validation failed"
  await assert.rejects(coordinator.call("complete_task_graph_task", { task_id: "b", evidence: "validated and resolved" }), /Combined setup or validation failed/)
  assert.equal(f.integrationValidations.at(-1).command, "node setup.cjs", "integration setup failures enter repair")
  let state = JSON.parse(readFileSync(approval.record, "utf8"))
  assert.equal(state.completed.b, undefined); assert.equal(state.lanes[0].task, "b", "failed integration validation keeps the lane assigned")
  globals.graphBashFailure = undefined
  const failedDispatch = worker.dispatch, repair = (await coordinator.call("start_task_graph_task", { task_id: "b" })).details.worker
  assert.equal(repair.workspace, worker.workspace); assert.notEqual(repair.dispatch, failedDispatch)
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "b"
  process.chdir(repair.workspace)
  try {
   const child = f.runtime(repair.workspace)
   await child.call("bash", { repository: repair.workspace, command: "node check.cjs" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === repair.dispatch).status = "completed"; f.tasks.find(task => task.id === repair.ledgerTask).status = "completed"
  await coordinator.call("complete_task_graph_task", { task_id: "b", evidence: "validated and repaired" })
  state = JSON.parse(readFileSync(approval.record, "utf8")); assert.ok(state.completed.b); assert.equal(state.workers.b.repair, undefined)
 } finally { coordinator.stop() }
})

test("completed and unrelated historical graphs do not block admission", async () => {
 const f = fixture(), directory = join(f.agent, "task-graphs"); mkdirSync(directory, { recursive: true })
 writeFileSync(join(directory, "unrelated.json"), JSON.stringify({ version: 3, repositories: [{ identity: "unrelated" }], completed: {} }))
 writeFileSync(join(directory, "completed.json"), JSON.stringify({ version: 3, repositories: [{ identity: repositoryIdentity(f.source) }], completed: {}, completion: { evidence: "done" } }))
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  assert.equal((await coordinator.call("propose_task_graph", f.plan)).details.status, "approved")
 } finally { coordinator.stop() }
})

test("repository ownership is rechecked under the startup lock", async () => {
 const f = fixture(), directory = join(globals.agentDir, "task-graphs"); mkdirSync(directory, { recursive: true })
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  globals.graphConfirm = () => writeFileSync(join(directory, "racing.json"), JSON.stringify(captureGraphWorkspaces(f.source, f.plan)))
  await assert.rejects(coordinator.call("propose_task_graph", f.plan), /Resume the unfinished graph/)
 } finally { delete globals.graphConfirm; coordinator.stop() }
})

test("worktree budget includes read-only input snapshots", async () => {
 const f = fixture(); writeFileSync(join(f.dependency, "dependency.txt"), "captured\n")
 f.plan.worktree_budget = 2; f.plan.foundations.push({ repository: f.dependency, commit: f.dependencyBase }); f.plan.inputs = [{ repository: f.dependency, paths: ["dependency.txt"] }]
 f.plan.tasks = [f.plan.tasks[0], { id: "dependency", goal: "provide captured input", repository: f.dependency, depends_on: [], owns: [], done_when: ["available"], validation: "manual: available" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  await assert.rejects(coordinator.call("propose_task_graph", f.plan), /read-only input snapshot/)
 } finally { coordinator.stop() }
})

test("workers can inspect and reference pinned repositories in the approved graph", async () => {
 const f = fixture(); f.plan.worktree_budget = 2
 f.plan.foundations.push({ repository: f.dependency, commit: f.dependencyBase })
 f.plan.tasks = [f.plan.tasks[0], { id: "local-read", goal: "inspect local repository", repository: f.source, depends_on: [], owns: [], done_when: ["available"], validation: "manual: available" }, { id: "dependency", goal: "provide dependency", repository: f.dependency, depends_on: [], owns: [], done_when: ["available"], validation: "manual: available" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"
  const previous = process.cwd(); process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("bash", { repository: f.dependency, command: "git status --short" })
   await child.call("bash", { repository: worker.workspace, command: `cross-check ${f.dependency}` })
   await assert.rejects(child.call("bash", { repository: worker.workspace, command: `cross-write ${f.dependency}` }), /prerequisites are read-only/)
   writeFileSync(join(f.dependency, "later.txt"), "later\n"); graphGit(f.dependency, "add", "--", "later.txt"); graphGit(f.dependency, "commit", "-m", "independent progress")
   await child.call("bash", { repository: worker.workspace, command: "node check.cjs" })
   await coordinator.call("start_task_graph_task", { task_id: "local-read" })
   await assert.rejects(child.call("bash", { repository: worker.workspace, command: `cross-check ${f.dependency}` }), /used cross-repository prerequisite changed/)
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
 } finally { coordinator.stop() }
})

test("exact validation permits only read-only Git clauses", async () => {
 const f = fixture(); f.plan.tasks = [{ ...f.plan.tasks[0], validation: "git show HEAD:a.txt >/dev/null && git hash-object a.txt" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  const previous = process.cwd(); process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("write", { path: join(worker.workspace, "a.txt"), content: "done\n" })
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["a.txt"], message: "done" })
   await child.call("bash", { repository: worker.workspace, command: f.plan.tasks[0].validation })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
 } finally { coordinator.stop() }
 for (const validation of ["git hash-object -w a.txt", "git hash-object -wt blob a.txt", "/usr/bin/git commit --allow-empty -m bad"]) {
  const rejected = fixture(); rejected.plan.tasks = [{ ...rejected.plan.tasks[0], validation }]
  const guard = rejected.runtime(rejected.source)
  try {
   await guard.command(`execute ${rejected.plan.objective}`)
   const approval = (await guard.call("propose_task_graph", rejected.plan)).details
   await guard.call("prepare_task_graph_workspace")
   const worker = (await guard.call("start_task_graph_task", { task_id: "a" })).details.worker
   const previous = process.cwd(); process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(worker.workspace)
   try { await assert.rejects(rejected.runtime(worker.workspace).call("bash", { repository: worker.workspace, command: validation }), /shell Git mutations/) }
   finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  } finally { guard.stop() }
 }
})

test("validation only credits the worker checkout", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.foundations.push({ repository: f.dependency, commit: f.dependencyBase }); f.plan.tasks = [
  { id: "dependency", goal: "inspect dependency", repository: f.dependency, depends_on: [], owns: [], done_when: ["inspected"], validation: "manual: inspected" },
  { ...f.plan.tasks[0], depends_on: ["dependency"], validation: "git diff --check" },
 ]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const dependency = (await coordinator.call("start_task_graph_task", { task_id: "dependency" })).details.worker
  f.dispatches.find(item => item.id === dependency.dispatch).status = "completed"; f.tasks.find(task => task.id === dependency.ledgerTask).status = "completed"
  await coordinator.call("complete_task_graph_task", { task_id: "dependency", evidence: "inspected" })
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  const previous = process.cwd(); process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("write", { path: join(worker.workspace, "a.txt"), content: "done\n" })
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["a.txt"], message: "done" })
   await child.call("bash", { repository: f.dependency, command: "git diff --check" })
   f.dispatches.find(item => item.id === worker.dispatch).status = "completed"; f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
   await assert.rejects(coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "validated elsewhere" }), /clean final checkpoint/)
   await child.call("bash", { repository: worker.workspace, command: "git diff --check" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  await coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "validated in worker checkout" })
 } finally { coordinator.stop() }
})

test("delivery-pending closeout records a failed combined validation without claiming completion", async () => {
 const f = fixture(); f.plan.tasks = [f.plan.tasks[0]]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  const prepared = (await coordinator.call("prepare_task_graph_workspace")).details
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  const previous = process.cwd(); process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("write", { path: join(worker.workspace, "a.txt"), content: "pending\n" })
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["a.txt"], message: "pending delivery" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === worker.dispatch).status = "completed"; f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
  globals.graphBashFailure = "external validation gate"
  const taskResult = (await coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "focused checks passed; external gate pending", delivery_pending: true })).details
  globals.graphBashFailure = undefined
  assert.equal(taskResult.status, "local-ready")
  assert.match(taskResult.validation_pending, /external validation gate/)
  const saved = JSON.parse(readFileSync(approval.record, "utf8"))
  assert.equal(saved.completed.a.deliveryPending, true)
  assert.match(saved.completed.a.validationPending, /external validation gate/)
  const result = (await coordinator.call("finish_task_graph", { run_id: prepared.run_id, evidence: "local only", delivery_pending: true })).details
  assert.equal(result.status, "local-ready")
 } finally { globals.graphBashFailure = undefined; coordinator.stop() }
})

test("integration setup precedes validation and closeout removes only clean integrated lanes", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [{ ...f.plan.tasks[0], setup: "node setup.cjs" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  const prepared = (await coordinator.call("prepare_task_graph_workspace")).details
  const worker = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  await coordinator.call("bash", { repository: f.source, command: "orca orchestration send --message 'coordinator reply while worker runs'" })
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"
  const previous = process.cwd(); process.chdir(worker.workspace)
  try {
   const child = f.runtime(worker.workspace)
   await child.call("bash", { repository: worker.workspace, command: "orca orchestration send --message 'starting setup'" })
   await child.call("bash", { repository: worker.workspace, command: "node setup.cjs" })
   await child.call("write", { path: join(worker.workspace, "a.txt"), content: "done\n" })
   symlinkSync(join(worker.workspace, "a.txt"), join(worker.workspace, "dist"))
   await child.call("checkpoint_task_graph", { repository: worker.workspace, paths: ["a.txt"], message: "done" })
   assert.equal(existsSync(join(worker.workspace, "dist")), false)
   await child.call("bash", { repository: worker.workspace, command: "node check.cjs" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === worker.dispatch).status = "completed"; f.tasks.find(task => task.id === worker.ledgerTask).status = "completed"
  globals.graphTerminalCloseFailure = true
  await assert.rejects(coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "validated" }), /terminal close failed/)
  assert.ok(JSON.parse(readFileSync(approval.record, "utf8")).completed.a, "completion is durable before terminal closure")
  delete globals.graphTerminalCloseFailure
  await coordinator.call("prepare_task_graph_workspace")
  assert.deepEqual(f.integrationValidations.map(item => item.command), ["node setup.cjs", "node check.cjs"])
  for (const item of f.integrationValidations) assert.equal(JSON.parse(item.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES)[f.source].path, prepared.repositories[f.source].path)
  f.terminals.push({ handle: "stale_completed_worker", worktreePath: worker.workspace })
  const result = (await coordinator.call("finish_task_graph", { run_id: prepared.run_id, evidence: "done" })).details
  assert.equal(f.worktrees.length, 1); assert.equal(f.worktrees[0].path, prepared.repositories[f.source].path)
  assert.ok(f.calls.some(call => call.slice(0, 2).join(" ") === "terminal close" && call.includes("stale_completed_worker")))
  assert.deepEqual(result.removed_lanes, [worker.workspace]); assert.equal(graphGit(f.source, "show", "HEAD:a.txt"), "base")
 } finally { coordinator.stop() }
})

test("an unrelated read-only worker does not block integration", async () => {
 const f = fixture(); f.plan.worktree_budget = 2; f.plan.tasks = [f.plan.tasks[0], { id: "read", goal: "inspect old head", repository: f.source, depends_on: [], owns: [], done_when: ["reported"], validation: "manual: inspect files" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`)
  const approval = (await coordinator.call("propose_task_graph", f.plan)).details
  await coordinator.call("prepare_task_graph_workspace")
  const writer = (await coordinator.call("start_task_graph_task", { task_id: "a" })).details.worker
  const reader = (await coordinator.call("start_task_graph_task", { task_id: "read" })).details.worker
  const previous = process.cwd(); process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "read"; process.chdir(reader.workspace)
  try {
   const child = f.runtime(reader.workspace); await child.call("bash", { repository: reader.workspace, command: "git status --short" })
   await assert.rejects(child.call("bash", { repository: reader.workspace, command: `orca orchestration send > ${join(f.source, "a.txt")}` }), /Read-only workers/)
  }
  finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "a"; process.chdir(writer.workspace)
  try {
   const child = f.runtime(writer.workspace)
   await child.call("write", { path: join(writer.workspace, "a.txt"), content: "written\n" })
   await child.call("checkpoint_task_graph", { repository: writer.workspace, paths: ["a.txt"], message: "write while reader runs" })
   await child.call("bash", { repository: writer.workspace, command: "node check.cjs" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === writer.dispatch).status = "completed"; f.tasks.find(task => task.id === writer.ledgerTask).status = "completed"
  await coordinator.call("complete_task_graph_task", { task_id: "a", evidence: "validated" })
  process.env.AGENT_TOOLKIT_GRAPH_RECORD = approval.record; process.env.AGENT_TOOLKIT_GRAPH_TASK = "read"; process.chdir(reader.workspace)
  try {
   const child = f.runtime(reader.workspace)
   await assert.rejects(child.call("bash", { repository: reader.workspace, command: "git status --short" }), /checkout advanced/)
   const fake = join(reader.workspace, "orca"), path = process.env.PATH; writeFileSync(fake, "#!/bin/sh\nexit 0\n"); chmodSync(fake, 0o755); process.env.PATH = `${reader.workspace}:${path}`
   try {
    await assert.rejects(child.call("bash", { repository: reader.workspace, command: "./orca orchestration send --message bypass" }), /checkout advanced/)
    await assert.rejects(child.call("bash", { repository: reader.workspace, command: "orca orchestration send --message bypass" }), /checkout advanced/)
    await assert.rejects(child.call("bash", { repository: reader.workspace, command: `PATH=${reader.workspace}:$PATH orca orchestration send --message bypass` }), /checkout advanced/)
   } finally { process.env.PATH = path; unlinkSync(fake) }
   await child.call("bash", { repository: reader.workspace, command: "orca orchestration send --message 'restart needed'" })
  } finally { process.chdir(previous); delete process.env.AGENT_TOOLKIT_GRAPH_RECORD; delete process.env.AGENT_TOOLKIT_GRAPH_TASK }
  f.dispatches.find(item => item.id === reader.dispatch).status = "completed"
  const restartedReader = (await coordinator.call("start_task_graph_task", { task_id: "read" })).details.worker
  f.dispatches.find(item => item.id === restartedReader.dispatch).status = "completed"; f.tasks.find(task => task.id === restartedReader.ledgerTask).status = "completed"
  await coordinator.call("complete_task_graph_task", { task_id: "read", evidence: "inspection completed against pinned ancestor after restart" })
 } finally { coordinator.stop() }
})

test("read-only workers create no additional worktree", async () => {
 const f = fixture(); f.plan.worktree_budget = 1; f.plan.tasks = [{ id: "read", goal: "inspect", repository: f.source, depends_on: [], owns: [], done_when: ["reported"], validation: "manual: inspect files" }]
 const coordinator = f.runtime(f.source)
 try {
  await coordinator.command(`execute ${f.plan.objective}`); await coordinator.call("propose_task_graph", f.plan); await coordinator.call("prepare_task_graph_workspace"); await coordinator.call("start_task_graph_task", { task_id: "read" })
  assert.equal(f.worktrees.length, 0)
 } finally { coordinator.stop() }
})
