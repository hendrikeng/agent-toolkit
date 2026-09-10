import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { homedir } from "node:os"
import { join, relative } from "node:path"
import test from "node:test"
import { graphGit, readGraphRecord } from "../workspaces.ts"
import type { TaskGraphPlan } from "../task-graph-core.ts"

const globals = globalThis as any
const hook = registerHooks({ resolve(specifier, context, next) {
 if (!context.parentURL?.endsWith("/task-graph/index.ts")) return next(specifier, context)
 const mocks: Record<string, string> = {
  "@earendil-works/pi-coding-agent": "export const createBashTool=(cwd,options)=>({execute:(_id,params)=>globalThis.graphShell(cwd,params,options)}); export const getAgentDir=()=>globalThis.graphAgentDir; export const truncateHead=content=>({content,truncated:false}); export const withFileMutationQueue=(_path,fn)=>fn();",
  "@earendil-works/pi-ai": "export const StringEnum=()=>({});",
  "typebox": "export const Type=new Proxy({}, {get:()=>()=>({})});",
  "node:child_process": "export const execFileSync=(_command,args)=>JSON.stringify(globalThis.graphRpc(args));",
 }
 return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context)
} })
const { default: extension } = await import("../index.ts")
test.after(() => hook.deregister())

function fixture() {
 const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || join(homedir(), "Code/.agent-toolkit-scratch")
 mkdirSync(scratch, { recursive: true, mode: 0o700 })
 const directory = realpathSync(mkdtempSync(join(scratch, "graph-e2e-")))
 const sources = ["api", "web"].map(name => join(directory, name))
 const bin = join(directory, "bin")
 mkdirSync(bin)
 symlinkSync(new URL("../../../../shared/agent-safety/git-yolo-guard", import.meta.url).pathname, join(bin, "git"))
 const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: "Graph Test", GIT_AUTHOR_EMAIL: "graph@example.com", GIT_COMMITTER_NAME: "Graph Test", GIT_COMMITTER_EMAIL: "graph@example.com" }
 const previous = { ...process.env }
 Object.assign(process.env, env, { AGENT_TOOLKIT_PI_AGENT_DIR: join(directory, "agent") })
 delete process.env.AGENT_TOOLKIT_GRAPH_TASK; delete process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES
 for (const source of sources) {
  execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source], { env })
  mkdirSync(join(source, "docs/future"), { recursive: true })
  writeFileSync(join(source, "owned.txt"), "baseline\n")
  writeFileSync(join(source, "unrelated.txt"), "untouched\n")
  writeFileSync(join(source, ".gitignore"), ".setup\n")
  writeFileSync(join(source, "setup.cjs"), "require('node:fs').writeFileSync('.setup','ready')\n")
  writeFileSync(join(source, "check.cjs"), "const assert=require('node:assert/strict');const fs=require('node:fs');assert.equal(fs.readFileSync('.setup','utf8'),'ready');const map=JSON.parse(process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES);assert.equal(Object.keys(map).length,2);console.log('passed');\n")
  graphGit(source, "add", "--", "owned.txt", "unrelated.txt", ".gitignore", "setup.cjs", "check.cjs")
  graphGit(source, "commit", "-m", "foundation")
  // Prove normal capture/checkpoint hooks remain enabled in shared Git metadata.
  writeFileSync(join(source, ".git/hooks/pre-commit"), "#!/bin/sh\nprintf 'hook\\n' >> \"$(git rev-parse --git-common-dir)/hook-evidence\"\n", { mode: 0o755 })
 }
 const heads = sources.map(source => graphGit(source, "rev-parse", "HEAD"))
 writeFileSync(join(sources[0], "docs/future/input.md"), "approved input\n")
 writeFileSync(join(sources[0], "unrelated.txt"), "staged unrelated\n")
 graphGit(sources[0], "add", "--", "unrelated.txt")
 writeFileSync(join(sources[0], "unrelated.txt"), "unstaged unrelated\n")
 const indexes = sources.map(source => readFileSync(join(source, ".git/index")))
 const runs: any[] = [], tasks: any[] = [], worktrees: any[] = [], calls: string[][] = []
 let lost = "", denied = false, confirmations = 0, shellCalls = 0
 globals.graphAgentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR
 globals.graphRpc = (args: string[]) => {
  calls.push(args)
  const value = (key: string) => args[args.indexOf(key) + 1]
  const op = args.slice(0, 2).join(" ")
  let result: any
  switch (op) {
   case "repo list": result = { repos: sources.map((path, index) => ({ id: `repo_${index}`, path })) }; break
   case "worktree list": result = { worktrees: worktrees.filter(item => item.repo === value("--repo")) }; break
   case "worktree create": {
    const source = sources[Number(value("--repo").split("_")[1])]
    assert.ok(source); assert.equal(value("--setup"), "skip"); assert.ok(args.includes("--no-parent"))
    const name = value("--name"), path = join(directory, name)
    graphGit(source, "worktree", "add", "--quiet", "-b", `test/${name}`, path, value("--base-branch"))
    const worktree = { id: `repo::${path}`, repo: value("--repo"), path, displayName: name, branch: `refs/heads/test/${name}` }
    worktrees.push(worktree); result = { worktree }; break
   }
   case "orchestration run-list": result = { runs }; break
   case "orchestration run-show": result = { run: runs.find(run => run.id === value("--id")) }; break
   case "orchestration run-create": { const run = { id: `run_${runs.length}`, objective: value("--objective") }; runs.push(run); result = { run }; break }
   case "orchestration task-list": result = { tasks: tasks.filter(task => task.run_id === value("--run")) }; break
   case "orchestration task-create": {
    const task = { id: `task_${tasks.length}`, run_id: value("--run"), parent_id: null, spec: value("--spec"), deps: value("--deps"), status: "ready" }
    tasks.push(task); result = { task }; break
   }
   case "orchestration task-update": { const task = tasks.find(task => task.id === value("--id")); task.status = value("--status"); result = { task }; break }
   default: throw new Error(`Unexpected RPC (no workers, quota, integration or deletion): ${op}`)
  }
  if (lost === op) { lost = ""; throw new Error(`Lost ${op} receipt`) }
  return { ok: true, result }
 }
 globals.graphShell = (cwd: string, params: any, options: any) => {
  shellCalls++
  const text = execFileSync(params.command.split(" ")[0], params.command.split(" ").slice(1), { cwd, encoding: "utf8", env: options.spawnHook({ env }).env })
  return { content: [{ type: "text", text }], details: {} }
 }
 function runtime(cwd = sources[0]) {
  const tools = new Map<string, any>(), events = new Map<string, any>(), commands = new Map<string, any>()
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => events.set(name, handler), registerCommand: (name: string, command: any) => commands.set(name, command), sendUserMessage: () => {} } as never)
  const ctx = { cwd, hasUI: true, isIdle: () => true, ui: { confirm: async () => { confirmations++; return true }, notify: (message: string) => { throw new Error(message) } } }
  return {
   tools, ctx, stop: () => events.get("agent_settled")(), command: (arg: string) => commands.get("graph").handler(arg, ctx),
   async call(name: string, input: any = {}) {
    const block = await events.get("tool_call")({ toolName: name, input }, ctx)
    if (block?.block) throw new Error(block.reason)
    if (name === "bash" && denied) throw new Error("Native permission denied")
    if (name === "write") { mkdirSync(join(input.path, ".."), { recursive: true }); writeFileSync(input.path, input.content); return }
    return tools.get(name).execute("fixture", input, undefined, undefined, ctx)
   },
  }
 }
 let r = runtime()
 const plan: TaskGraphPlan = { objective: "Fixture", mode: "plan-only", foundations: sources.map((source, index) => ({ repository: relative(sources[0], source) || ".", commit: heads[index] })), inputs: [{ repository: ".", paths: ["docs/future/input.md"] }], tasks: sources.map((source, index) => ({ id: index ? "b" : "a", goal: "bounded work", repository: relative(sources[0], source) || ".", depends_on: index ? ["a"] : [], owns: ["docs/future"], done_when: ["verified"], setup: "node setup.cjs", validation: "node check.cjs" })) }
 return { directory, sources, indexes, heads, plan, worktrees, runs, calls, runtime, get r() { return r }, set r(value) { r = value }, get confirmations() { return confirmations }, get shellCalls() { return shellCalls }, set deny(value: boolean) { denied = value }, set lose(value: string) { lost = value },
  async approve() { await r.command(`${plan.mode === "execute" ? "execute" : "plan"} ${plan.objective}`); return (await r.call("propose_task_graph", plan)).details },
  async resume(cwd = sources[0]) { r.stop(); r = runtime(cwd); await r.command(`${plan.mode === "execute" ? "execute" : "plan"} ${plan.objective}`) },
  close() { r.stop(); for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous) },
 }
}

test("read-only approval rejects script checks and historical foundations; manual checks need no writing workspace", async () => {
 for (const snapshot of [false, true]) {
  const f = fixture()
  try {
   if (!snapshot) delete f.plan.inputs
   f.plan.tasks.forEach(task => { task.owns = []; delete task.setup })
   await assert.rejects(f.approve(), /manual:/)
   assert.equal(f.confirmations, 0); assert.equal(f.runs.length, 0)
   f.plan.tasks.forEach(task => task.validation = "manual: inspect owned.txt and report its contents")
   if (!snapshot) {
    writeFileSync(join(f.sources[0], "owned.txt"), "new foundation\n")
    graphGit(f.sources[0], "commit", "-m", "Later fixture foundation", "--", "owned.txt")
    await assert.rejects(f.approve(), /source HEAD/)
    assert.equal(f.confirmations, 0); assert.equal(f.runs.length, 0)
    f.plan.foundations[0].commit = graphGit(f.sources[0], "rev-parse", "HEAD")
   }
   const indexes = f.sources.map(source => readFileSync(join(source, ".git/index")))
   await f.approve()
   const prepared = (await f.r.call("prepare_task_graph_workspace")).details
   for (const [index, task] of f.plan.tasks.entries()) {
    const started = (await f.r.call("start_task_graph_task", { task_id: task.id })).details
    await assert.rejects(f.r.call("bash", { repository: started.workspace, command: "node check.cjs" }), /approved/)
    const contents = readFileSync(join(started.workspace, "owned.txt"), "utf8")
    await assert.rejects(f.r.call("complete_task_graph_task", { task_id: task.id, evidence: " " }), /evidence/)
    await f.r.call("complete_task_graph_task", { task_id: task.id, evidence: `Inspected owned.txt: ${contents.trim()}` })
    assert.deepEqual(readFileSync(join(f.sources[index], ".git/index")), indexes[index])
   }
   await f.r.call("finish_task_graph", { run_id: prepared.run_id, evidence: "Manual inspection complete; no script checks claimed." })
   assert.equal(f.worktrees.length, snapshot ? 1 : 0); assert.equal(f.shellCalls, 0)
  } finally { f.close() }
 }
})

test("owned setup outputs can checkpoint; failed checks and later inactive commits cannot claim completion", async () => {
 const f = fixture()
 try {
  writeFileSync(join(f.sources[0], "setup.cjs"), "const fs=require('node:fs');fs.writeFileSync('.setup','ready');fs.mkdirSync('docs/future',{recursive:true});fs.writeFileSync('docs/future/setup.md','setup output');\n")
  f.plan.inputs![0].paths.push("setup.cjs")
  await f.approve()
  const prepared = (await f.r.call("prepare_task_graph_workspace")).details
  const root = prepared.repositories[f.sources[0]].path
  await f.r.call("start_task_graph_task", { task_id: "a" })
  await assert.rejects(f.r.call("bash", { repository: root, command: "node setup.cjs" }), /Checkpoint owned/)
  await f.r.call("checkpoint_task_graph", { repository: root, paths: ["docs/future/setup.md"], message: "Owned setup output" })
  const shell = globals.graphShell
  try {
   globals.graphShell = () => { throw new Error("Fixture check failed") }
   await assert.rejects(f.r.call("bash", { repository: root, command: "node check.cjs" }), /check failed/)
   await assert.rejects(f.r.call("complete_task_graph_task", { task_id: "a", evidence: "false success" }), /validation/)
  } finally { globals.graphShell = shell }
  await f.r.call("bash", { repository: root, command: "node check.cjs" })
  await f.r.call("complete_task_graph_task", { task_id: "a", evidence: "Focused check passed" })
  writeFileSync(join(root, "docs/future/setup.md"), "later external modification")
  graphGit(root, "add", "--", "docs/future/setup.md"); graphGit(root, "commit", "-m", "External fixture change")
  await assert.rejects(f.r.call("start_task_graph_task", { task_id: "b" }), /Inactive workspace changed/)
 } finally { f.close() }
})

// Twenty complete fresh multi-repository runs, not twenty assertions in one scenario.
for (let repetition = 1; repetition <= 20; repetition++) test(`final planning → separate execution → interruption/resume → closeout ${repetition}/20`, async () => {
 const f = fixture()
 try {
  await f.r.command("plan Fixture")
  await f.r.call("bash", { command: "git status --short" })
  assert.deepEqual(readFileSync(join(f.sources[0], ".git/index")), f.indexes[0])
  await assert.rejects(f.r.call("write", { path: join(f.sources[0], "owned.txt"), content: "bad" }))
  const approval = await f.approve()
  if (repetition % 3 === 0) { f.lose = "worktree create"; await assert.rejects(f.r.call("prepare_task_graph_workspace"), /Lost/); await f.resume() }
  if (repetition % 3 === 1) { f.lose = "orchestration run-create"; await assert.rejects(f.r.call("prepare_task_graph_workspace"), /Lost/); await f.resume() }
  const prep = (await f.r.call("prepare_task_graph_workspace")).details
  const planning = Object.values(prep.repositories).map((value: any) => value.path) as string[]
  assert.equal(f.worktrees.length, 2)
  const markdown = (index: number, status = "ready-for-promotion") => `# Executable plan\n\n## Metadata\n\n- Plan-ID: ${index ? "b" : "a"}\n- Status: ${status}\n- Priority: p1\n- Dependencies: ${index ? "a" : "none"}\n- Security-Approval: not-required\n- Acceptance-Criteria: owned change verified\n- Validation-Lanes: always\n- Risk-Tier: low\n- Implementation-Targets: owned.txt\n- Done-Evidence: ${status === "completed" ? "node check.cjs passed" : "pending"}\n`
  const runTask = async (index: number, root: string, mode: string) => {
   const task_id = index ? "b" : "a"
   await f.r.call("start_task_graph_task", { task_id })
   const path = join(root, mode === "plan-only" ? "docs/future/result.md" : "owned.txt")
   await assert.rejects(f.r.call("write", { path, content: "before setup" }), /setup/)
   f.deny = true
   const before = f.shellCalls
   await assert.rejects(f.r.call("bash", { repository: root, command: "node setup.cjs" }), /Native permission/)
   assert.equal(f.shellCalls, before); f.deny = false
   await f.r.call("bash", { repository: root, command: "node setup.cjs" })
   if (mode === "plan-only") for (const local of ["owned.txt", "docs/script.ts", "docs/exec-plans/active/plan.md"]) await assert.rejects(f.r.call("write", { path: join(root, local), content: "bad" }), /Planning-only/)
   await assert.rejects(f.r.call("write", { path: join(f.sources[index], "owned.txt"), content: "bad" }), /isolated workspace/)
   if (mode === "execute") {
    await f.r.call("move_task_graph_plan", { destination: "active" })
    await f.r.call("write", { path: join(root, "docs/exec-plans/active/result.md"), content: markdown(index, "in-progress") })
   }
   await f.r.call("write", { path, content: mode === "plan-only" ? markdown(index) : "implemented\n" })
   if (mode === "execute" && index === 1) {
    await f.resume(planning[0])
    await f.r.call("prepare_task_graph_workspace")
    const resumed = await f.r.call("start_task_graph_task", { task_id })
    assert.equal(resumed.details.progress.setup, true)
    assert.equal(f.worktrees.length, 4)
    assert.equal(readFileSync(path, "utf8"), "implemented\n")
   }
   await assert.rejects(f.r.call("complete_task_graph_task", { task_id, evidence: "not checked" }), /validation/)
   if (mode === "execute") {
    await f.r.call("write", { path: join(root, "docs/exec-plans/active/result.md"), content: markdown(index, "completed") })
    await f.r.call("move_task_graph_plan", { destination: "completed" })
   }
   const checkpointPath = mode === "plan-only" ? "docs/future/result.md" : "owned.txt"
   await assert.rejects(f.r.call("checkpoint_task_graph", { repository: root, paths: [checkpointPath, checkpointPath], message: "duplicate" }), /unique/)
   await assert.rejects(f.r.call("checkpoint_task_graph", { repository: root, paths: [checkpointPath, `./${checkpointPath}`], message: "alias" }), /literal/)
   await f.r.call("checkpoint_task_graph", { repository: root, paths: mode === "plan-only" ? ["docs/future/result.md"] : ["owned.txt", "docs/future/result.md", "docs/exec-plans/completed/result.md"], message: "Scoped checkpoint" })
   await f.r.call("bash", { repository: root, command: "node check.cjs" })
   await f.r.call("complete_task_graph_task", { task_id, evidence: "Exact focused validation passed" })
  }
  await assert.rejects(f.r.call("start_task_graph_task", { task_id: "b" }), /first unfinished/)
  for (const [index, root] of planning.entries()) await runTask(index, root, "plan-only")
  await f.r.call("finish_task_graph", { run_id: prep.run_id, evidence: "Planning documents checked. No implementation." })
  assert.equal(f.worktrees.length, 2); assert.equal(f.runs.length, 1)
  const planningHeads = planning.map(root => graphGit(root, "rev-parse", "HEAD"))
  assert.ok(readGraphRecord(approval.record).completion)
  writeFileSync(join(f.sources[0], "docs/future/input.md"), "later source edit\n")
  f.plan.mode = "execute"; delete f.plan.inputs
  f.plan.objective = relative(planning[0], join(planning[1], "docs/future/result.md"))
  f.plan.tasks.forEach((task, index) => { task.repository = relative(planning[0], planning[index]) || "."; task.owns = ["owned.txt", "docs/future/result.md", "docs/exec-plans/active/result.md", "docs/exec-plans/completed/result.md"] })
  f.plan.foundations = planning.map((root, index) => ({ repository: relative(planning[0], root) || ".", commit: planningHeads[index] }))
  f.r = f.runtime(planning[0])
  await f.approve()
  assert.equal(f.confirmations, 2, "Separate execution approval")
  const execution = (await f.r.call("prepare_task_graph_workspace")).details
  const executionRoots = Object.values(execution.repositories).map((value: any) => value.path) as string[]
  assert.equal(f.worktrees.length, 4)
  executionRoots.forEach((root, index) => { assert.notEqual(root, planning[index]); assert.equal(graphGit(root, "rev-parse", "HEAD"), planningHeads[index]) })
  await runTask(0, executionRoots[0], "execute")
  await f.resume(planning[0])
  await f.r.call("prepare_task_graph_workspace")
  assert.equal(f.worktrees.length, 4); assert.equal(f.runs.length, 2); assert.equal(f.confirmations, 2)
  await runTask(1, executionRoots[1], "execute")
  const final = await f.r.call("finish_task_graph", { run_id: execution.run_id, evidence: "Both tasks and required local checks passed" })
  assert.equal(final.details.status, "complete")
  assert.equal(readFileSync(join(executionRoots[0], "docs/future/input.md"), "utf8"), "approved input\n")
  assert.equal(readFileSync(join(f.sources[0], "unrelated.txt"), "utf8"), "unstaged unrelated\n")
  for (const [index, source] of f.sources.entries()) {
   assert.equal(graphGit(source, "rev-parse", "HEAD"), f.heads[index]); assert.deepEqual(readFileSync(join(source, ".git/index")), f.indexes[index])
   assert.equal(graphGit(planning[index], "rev-parse", "HEAD"), planningHeads[index])
   assert.ok(readFileSync(join(source, ".git/hook-evidence"), "utf8").split("hook").length >= 3)
  }
  assert.ok(!f.calls.some(args => /worker|dispatch|terminal|quota|integrat|\brm\b/.test(args.join(" "))))
  writeFileSync(join(f.directory, "result.json"), JSON.stringify({ repetition, status: "passed", planningHeads, planning, executionRoots }))
 } finally { f.close() }
})
