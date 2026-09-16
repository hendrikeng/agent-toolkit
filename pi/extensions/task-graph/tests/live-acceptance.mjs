#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const option = name => {
 const index = argv.indexOf(name)
 return index < 0 ? undefined : argv[index + 1]
}
if (argv.includes("--help")) {
 console.log("Usage: node pi/extensions/task-graph/tests/live-acceptance.mjs --approve [--model provider/model] [--timeout-ms 1800000]")
 process.exit(0)
}
assert(argv.includes("--approve"), "Live acceptance requires --approve because it starts real model workers and changes a disposable local repository.")
const model = option("--model") ?? (process.env.PI_PROVIDER && process.env.PI_MODEL ? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}` : undefined)
assert(model?.includes("/"), "Pass --model provider/model or run from a Pi shell that exports PI_PROVIDER and PI_MODEL.")
const timeoutMs = Number(option("--timeout-ms") ?? 1_800_000)
assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60_000, "--timeout-ms must be an integer of at least 60000.")
const orca = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca")

const run = (command, args, cwd, env = process.env) => {
 const result = spawnSync(command, args, { cwd, env, encoding: "utf8" })
 assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`)
 return result.stdout.trim()
}
const git = (cwd, ...args) => run("git", args, cwd, { ...process.env, GIT_AUTHOR_NAME: "Graph Acceptance", GIT_AUTHOR_EMAIL: "graph-acceptance@example.invalid", GIT_COMMITTER_NAME: "Graph Acceptance", GIT_COMMITTER_EMAIL: "graph-acceptance@example.invalid" })
const parseFirstJson = text => {
 let depth = 0, start = -1, quoted = false, escaped = false
 for (let index = 0; index < text.length; index++) {
  const character = text[index]
  if (quoted) {
   if (escaped) escaped = false
   else if (character === "\\") escaped = true
   else if (character === '"') quoted = false
   continue
  }
  if (character === '"') quoted = true
  else if (character === "{") { if (start < 0) start = index; depth++ }
  else if (character === "}" && --depth === 0 && start >= 0) return JSON.parse(text.slice(start, index + 1))
 }
 throw new Error("Confirmation did not contain a complete JSON object.")
}

const toolkit = realpathSync(fileURLToPath(new URL("../../../../", import.meta.url))), toolkitHead = git(toolkit, "rev-parse", "HEAD")
assert.equal(git(toolkit, "status", "--porcelain=v1", "--untracked-files=all"), "", "Commit the acceptance test and install that exact clean Toolkit commit before running it.")
const root = realpathSync(mkdtempSync(join(realpathSync(join(homedir(), "Code")), "graph-live-acceptance-")))
const source = join(root, "source"), evidence = join(root, "evidence")
const agentDir = realpathSync(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"))
mkdirSync(source); mkdirSync(evidence, { recursive: true })
writeFileSync(join(source, "a.txt"), "base\n")
writeFileSync(join(source, "b.txt"), "base\n")
writeFileSync(join(source, "check-first.cjs"), "const assert=require('node:assert/strict'),fs=require('node:fs');assert.equal(fs.readFileSync('a.txt','utf8'),'alpha\\n')\n")
writeFileSync(join(source, "check-second.cjs"), "const assert=require('node:assert/strict'),fs=require('node:fs');assert.equal(fs.readFileSync('a.txt','utf8'),'alpha\\n');assert.equal(fs.readFileSync('b.txt','utf8'),'beta\\n')\n")
git(source, "init", "--quiet", "--initial-branch=main")
git(source, "add", "--", "a.txt", "b.txt", "check-first.cjs", "check-second.cjs")
git(source, "commit", "--quiet", "-m", "graph acceptance base")
const base = git(source, "rev-parse", "HEAD")
const repo = JSON.parse(run(orca, ["repo", "add", "--path", source, "--json"], source))
assert.equal(repo.ok, true, "Orca did not register the disposable repository.")

const objective = [
 `Live installed graph acceptance ${root}.`,
 `Before approval call inspect_task_graph_runtime with repository ${toolkit} and commit ${toolkitHead}; stop unless it reports verified.`,
 `Use only repository ${source} at foundation ${base}.`,
 "Propose exactly two execute tasks and no resources or inputs.",
 `Task first: repository ${source}; dependencies []; owns [a.txt]; replace a.txt with exactly alpha plus a newline; validation node check-first.cjs.`,
 `Task second: repository ${source}; dependencies [first]; owns [b.txt]; replace b.txt with exactly beta plus a newline; validation node check-second.cjs.`,
 "Use worktree budget 2, no setup commands, and the exact task IDs first and second.",
 "After approval, prepare the workspace, complete first, complete second, and finish the graph. Do not deliver or archive it.",
].join(" ")

const recordDirectory = join(agentDir, "task-graphs")
const originalRecords = new Set(existsSync(recordDirectory) ? readdirSync(recordDirectory) : [])
const eventFiles = [], stderrFiles = []
let child
function graphRecord() {
 const files = existsSync(recordDirectory) ? readdirSync(recordDirectory).filter(name => name.endsWith(".json") && !originalRecords.has(name)) : []
 assert.equal(files.length, 1, `Expected one active graph record, found ${files.length}.`)
 return { path: join(recordDirectory, files[0]), value: JSON.parse(readFileSync(join(recordDirectory, files[0]), "utf8")) }
}
function validateApproval(message) {
 const candidate = parseFirstJson(message), plan = candidate.plan
 assert.equal(plan.mode, "execute")
 assert.equal(plan.objective, objective)
 assert.equal(plan.worktree_budget, 2)
 assert.equal(plan.resources, undefined)
 assert.equal(plan.inputs, undefined)
 assert.deepEqual(plan.foundations, [{ repository: source, commit: base }])
 assert.equal(plan.tasks.length, 2)
 const first = plan.tasks.find(task => task.id === "first"), second = plan.tasks.find(task => task.id === "second")
 assert(first && second, "The graph must contain the exact task IDs first and second.")
 assert.equal(realpathSync(first.repository), source); assert.deepEqual(first.depends_on, []); assert.deepEqual(first.owns, ["a.txt"]); assert.equal(first.validation, "node check-first.cjs"); assert.equal(first.setup, undefined); assert.match(`${first.goal} ${first.done_when.join(" ")}`, /alpha/i)
 assert.equal(realpathSync(second.repository), source); assert.deepEqual(second.depends_on, ["first"]); assert.deepEqual(second.owns, ["b.txt"]); assert.equal(second.validation, "node check-second.cjs"); assert.equal(second.setup, undefined); assert.match(`${second.goal} ${second.done_when.join(" ")}`, /beta/i)
}

function startRpc(phase, interruptAfterFirst = false) {
 const eventsPath = join(evidence, `${phase}-events.jsonl`), stderrPath = join(evidence, `${phase}-stderr.log`)
 eventFiles.push(eventsPath); stderrFiles.push(stderrPath)
 const events = [], waiters = []
 let stdoutBuffer = "", stderr = "", interrupted = false, runtimeVerified = false, fatal
 child = spawn("pi-yolo", ["--mode", "rpc", "--no-session", "--approve", "--model", model, "--thinking", "medium"], { cwd: source, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" }, stdio: ["pipe", "pipe", "pipe"] })
 const send = value => child.stdin.write(`${JSON.stringify(value)}\n`)
 const fail = error => {
  fatal ??= error instanceof Error ? error : new Error(String(error))
  for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(fatal) }
  if (!child.killed) child.kill("SIGTERM")
 }
 const settleWaiters = event => {
  for (let index = waiters.length - 1; index >= 0; index--) if (waiters[index].predicate(event)) { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(event) }
 }
 const receive = event => {
  events.push(event); appendFileSync(eventsPath, `${JSON.stringify(event)}\n`)
  if (event.type === "tool_execution_end" && event.toolName === "inspect_task_graph_runtime" && !event.isError && event.result?.details?.status === "verified") runtimeVerified = true
  if (event.type === "extension_ui_request" && event.method === "confirm") {
   if (event.title === "Approve execution graph?") {
    assert.equal(phase, "initial", "A resumed graph requested a second execution approval.")
    assert.equal(runtimeVerified, true, "The coordinator did not verify the installed task-graph runtime before approval.")
    validateApproval(event.message)
    send({ type: "extension_ui_response", id: event.id, confirmed: true })
   } else if (event.title === "Deliver completed graph?" || event.title === "Archive completed graph?") send({ type: "extension_ui_response", id: event.id, confirmed: true })
   else throw new Error(`Unexpected confirmation: ${event.title}`)
  }
  if (interruptAfterFirst && !interrupted && event.type === "tool_execution_end" && event.toolName === "complete_task_graph_task" && event.args?.task_id === "first" && !event.isError) {
   interrupted = true
   child.kill("SIGKILL")
  }
  settleWaiters(event)
 }
 const decoder = new StringDecoder("utf8")
 child.stdout.on("data", chunk => {
  try {
   stdoutBuffer += decoder.write(chunk)
   for (;;) {
    const newline = stdoutBuffer.indexOf("\n")
    if (newline < 0) break
    const line = stdoutBuffer.slice(0, newline).replace(/\r$/, ""); stdoutBuffer = stdoutBuffer.slice(newline + 1)
    if (line) receive(JSON.parse(line))
   }
  } catch (error) { fail(error) }
 })
 child.stderr.on("data", chunk => { stderr += chunk.toString(); writeFileSync(stderrPath, stderr) })
 child.on("error", fail)
 child.on("exit", (code, signal) => { if (!interrupted && signal !== "SIGTERM") fail(new Error(`pi-yolo exited with code ${code} and signal ${signal}. Evidence: ${root}`)) })
 const waitFor = (predicate, label) => new Promise((resolve, reject) => {
  if (fatal) return reject(fatal)
  const match = events.find(predicate)
  if (match) return resolve(match)
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}. Evidence: ${root}`)), timeoutMs)
  waiters.push({ predicate, resolve, reject, timer })
 })
 const request = async (id, message) => {
  send({ id, type: "prompt", message })
  const response = await waitFor(event => event.type === "response" && event.id === id, `${id} response`)
  assert.equal(response.success, true, response.error)
  return response
 }
 const exit = () => child.exitCode !== null || child.signalCode ? Promise.resolve({ code: child.exitCode, signal: child.signalCode }) : new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })))
 return { request, waitFor, exit, send, events, get interrupted() { return interrupted } }
}

let initial, resumed
try {
 initial = startRpc("initial", true)
 await initial.request("execute", `/graph execute ${objective}`)
 const firstExit = await initial.exit()
 assert.equal(initial.interrupted, true, `The first coordinator exited before the first task completed: ${JSON.stringify(firstExit)}`)
 const interrupted = graphRecord().value
 assert(interrupted.completed.first, "The interrupted record did not retain the completed first task.")
 assert.equal(interrupted.completed.second, undefined)
 assert.equal(git(source, "rev-parse", "HEAD"), base, "Graph execution changed the source branch before delivery.")
 assert.equal(git(source, "status", "--porcelain=v1", "--untracked-files=all"), "")

 resumed = startRpc("resumed")
 await resumed.request("resume", `/graph execute ${objective}`)
 await resumed.waitFor(event => event.type === "agent_settled", "resumed graph completion")
 const completed = graphRecord(), state = completed.value
 assert(state.completion, "The resumed graph did not finish.")
 assert(state.completed.first && state.completed.second, "The resumed graph did not complete both tasks.")
 assert.equal(Object.keys(state.workers).length, 2)
 assert.equal(state.workers.first.attempt, 0, "Resume duplicated the completed first worker.")
 assert.equal(state.workers.second.attempt, 0, "Resume duplicated the second worker.")
 assert.equal(state.lanes.length, 1, "The dependent tasks did not reuse the bounded writing lane.")
 assert.equal(state.lanes[0].cleanup, "removed", "Graph closeout did not remove the clean writing lane.")
 assert.deepEqual(state.lanes[0].previousTasks, ["first", "second"])
 assert.equal(existsSync(state.lanes[0].workspace.path), false, "Graph closeout left the clean writing lane on disk.")
 assert.equal(git(source, "rev-parse", "HEAD"), base, "Graph execution changed the source branch before delivery.")
 assert.equal(git(source, "status", "--porcelain=v1", "--untracked-files=all"), "")
 const integrationHead = state.repositories[0].workspace && git(state.repositories[0].workspace.path, "rev-parse", "HEAD")
 assert(integrationHead, "The completed graph has no integration commit.")
 assert.equal(readFileSync(join(state.repositories[0].workspace.path, "a.txt"), "utf8"), "alpha\n")
 assert.equal(readFileSync(join(state.repositories[0].workspace.path, "b.txt"), "utf8"), "beta\n")

 await resumed.request("deliver", `/graph deliver ${state.runId}`)
 assert.equal(git(source, "rev-parse", "HEAD"), integrationHead)
 assert.equal(git(source, "status", "--porcelain=v1", "--untracked-files=all"), "")
 assert.equal(readFileSync(join(source, "a.txt"), "utf8"), "alpha\n")
 assert.equal(readFileSync(join(source, "b.txt"), "utf8"), "beta\n")
 assert.equal(existsSync(state.repositories[0].workspace.path), false, "Delivery left the clean integration worktree behind.")

 await resumed.request("archive", `/graph archive ${state.runId}`)
 assert.equal(existsSync(completed.path), false, "Archive left the completed record active.")
 const archived = join(agentDir, "task-graphs-archived", "v1", basename(completed.path, ".json"))
 assert(existsSync(archived), "Archive evidence is missing.")
 const taskList = JSON.parse(run(orca, ["orchestration", "task-list", "--run", state.runId, "--json"], source))
 assert.equal(taskList.ok, true)
 assert.equal(taskList.result.tasks.length, 2)
 assert(taskList.result.tasks.every(task => task.status === "completed"), "The Orca task ledger is not complete.")

 const report = { status: "passed", fixture: root, source, evidence, model, base, runId: state.runId, integrationHead, finalHead: git(source, "rev-parse", "HEAD"), restart: "SIGKILL after first integration, then exact-command resume", events: eventFiles, stderr: stderrFiles }
 writeFileSync(join(evidence, "result.json"), `${JSON.stringify(report, null, 2)}\n`)
 console.log(JSON.stringify(report, null, 2))
 resumed.send({ type: "abort" }); child.kill("SIGTERM")
} catch (error) {
 const failure = { status: "failed", fixture: root, source, evidence, model, error: error instanceof Error ? error.stack : String(error), events: eventFiles, stderr: stderrFiles }
 writeFileSync(join(evidence, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`)
 if (child && !child.killed) child.kill("SIGTERM")
 console.error(JSON.stringify(failure, null, 2))
 process.exitCode = 1
}
