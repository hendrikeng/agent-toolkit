import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { acquireLease, assertGraphMode, assertGraphShell, assertNoLegacyGraph, digest, graphGit, graphLeaseState, LEGACY_GRAPH, literalPath, repositoryIdentity, taskGraphPrompt } from "../task-graph-core.ts"
import { captureGraphWorkspaces, findUnstartedGraphRetirement, graphTaskSpec, inspectGraphGarbage, inspectGraphRetirement, retirementSourceReserved, retireUnstartedGraph } from "../workspaces.ts"

const fixture = () => mkdtempSync(join(tmpdir(), "graph-core-"))
const retirementOrca = (record: any) => (args: string[]) => {
 const operation = args.slice(0, 2).join(" "), run = { id: record.runId, objective: `Pi graph v4: ${record.key}: ${record.plan.objective}` }
 if (operation === "orchestration run-list") return { result: { runs: [run] } }
 if (operation === "orchestration run-show") return { result: { run } }
 if (operation === "orchestration task-list") return { result: { tasks: record.plan.tasks.map((task: any) => ({ id: `task_${task.id}`, run_id: record.runId, parent_id: null, status: "ready", spec: graphTaskSpec(record, task) })) } }
 throw new Error(`Unexpected retirement operation: ${operation}`)
}
test("literal ownership and planning boundary", () => {
 for (const path of ["src/file.ts", "docs/future/plan.md", ".env.example"]) assert.doesNotThrow(() => literalPath(path))
 for (const path of [".", "../secret", "/etc/file", "src/../file", "src//file", "src/*.ts", "src/[file]", ".git/config", "docs/.git/config", ".env", ".env.local", "key.pem", "secret.key", ".netrc", "foo\0bar"]) assert.throws(() => literalPath(path), /literal/)
 assert.doesNotThrow(() => assertGraphMode("plan-only", "docs/future/plan.md"))
 for (const path of ["src/code.ts", "docs/code.ts", "docs/exec-plans/active/plan.md", "docs/EXEC-PLANS/active/plan.md", "docs/exec-plans/completed/plan.md"]) assert.throws(() => assertGraphMode("plan-only", path), error => String(error).includes(`Planning-only ownership "${path}"`) && String(error).includes("not task owns"))
})
test("an authorized unstarted graph retirement preserves its record", () => {
 const root = process.cwd(), directory = fixture(), records = join(directory, "records"), retired = join(directory, "retired")
 const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
 const plan = { objective: "Retirement fixture", mode: "execute" as const, worktree_budget: 1, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "read", goal: "Inspect one file", repository: ".", depends_on: [], owns: [], done_when: ["The file was inspected."], validation: "manual: confirm the file contents are understood" }] }
 const record = captureGraphWorkspaces(root, plan), file = join(records, "fixture.json")
 record.runId = "run_fixture"
 mkdirSync(records)
 const bytes = JSON.stringify(record)
 writeFileSync(file, bytes)
 mkdirSync(join(retired, "fixture"), { recursive: true })
 const result = retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record))
 assert.equal(result.runId, "run_fixture")
 assert.equal(existsSync(file), false)
 assert.equal(readFileSync(result.record, "utf8"), bytes)
 assert.equal(JSON.parse(readFileSync(join(retired, "fixture", "retirement.json"), "utf8")).status, "retired")
})
test("retirement preserves an older run that reused the active record path", () => {
 const root = process.cwd(), directory = fixture(), records = join(directory, "records"), retired = join(directory, "retired"), file = join(records, "fixture.json"), priorDirectory = join(retired, "fixture"), priorTarget = join(priorDirectory, "record.json")
 const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
 const plan = { objective: "Retirement collision fixture", mode: "execute" as const, worktree_budget: 1, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "read", goal: "Inspect one file", repository: ".", depends_on: [], owns: [], done_when: ["The file was inspected."], validation: "manual: confirm the file contents are understood" }] }
 const record = captureGraphWorkspaces(root, plan), prior = structuredClone(record)
 record.runId = "run_current"; prior.runId = "run_prior"
 mkdirSync(records); mkdirSync(priorDirectory, { recursive: true }); writeFileSync(file, JSON.stringify(record)); writeFileSync(priorTarget, JSON.stringify(prior)); writeFileSync(join(priorDirectory, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: prior.runId, source: file, record: priorTarget, retiredAt: new Date().toISOString() }))
 const result = retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record), undefined, record.runId)
 assert.equal(result.record, join(retired, "fixture-run_current", "record.json")); assert.equal(JSON.parse(readFileSync(priorTarget, "utf8")).runId, prior.runId)
 assert.equal(findUnstartedGraphRetirement(records, retired, record.runId), file)
 assert.equal(retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record), undefined, record.runId).record, result.record)
 rmSync(priorDirectory, { recursive: true }); assert.equal(retirementSourceReserved(retired, file), true)
 assert.equal(retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record), undefined, record.runId).record, result.record)
})
test("resource declarations require a writing task before approval", () => {
 const root = process.cwd(), base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
 const plan: any = { objective: "Resource fixture", mode: "execute", worktree_budget: 1, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "read", goal: "Inspect", repository: ".", depends_on: [], owns: [], done_when: ["Inspected."], validation: "manual: inspect" }], resources: [{ id: "database", type: "postgres", image: `postgres:17.6@sha256:${"b".repeat(64)}`, purpose: "fixture", memoryMiB: 256, storageMiB: 128, lifetimeSeconds: 3600 }] }
 assert.throws(() => captureGraphWorkspaces(root, plan), /resources require a writing task/)
 plan.mode = "plan-only"; plan.tasks[0].owns = ["docs/plan.md"]; plan.tasks[0].validation = "node check.cjs"
 assert.throws(() => captureGraphWorkspaces(root, plan), /execution mode/)
})

test("an interrupted unstarted graph retirement resumes from its receipt", () => {
 const root = process.cwd(), directory = fixture(), records = join(directory, "records"), retired = join(directory, "retired")
 const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
 const plan = { objective: "Retirement resume fixture", mode: "execute" as const, worktree_budget: 1, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "read", goal: "Inspect one file", repository: ".", depends_on: [], owns: [], done_when: ["The file was inspected."], validation: "manual: confirm the file contents are understood" }] }
 const record = captureGraphWorkspaces(root, plan), file = join(records, "fixture.json"), pending = join(retired, "fixture"), target = join(pending, "record.json")
 record.runId = "run_resume"
 mkdirSync(records); mkdirSync(pending, { recursive: true })
 writeFileSync(file, JSON.stringify(record)); writeFileSync(join(pending, "retirement.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: record.runId, source: file, retiredAt: new Date().toISOString() }))
 renameSync(file, target)
 assert.equal(findUnstartedGraphRetirement(records, retired, record.runId), file)
 assert.equal(retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record)).record, target)
 const receipt = join(pending, "retirement.json"), bytes = readFileSync(receipt, "utf8")
 assert.equal(JSON.parse(bytes).status, "retired")
 assert.equal(retireUnstartedGraph(file, retired, { list: () => [], inspect: () => { throw new Error("unexpected inspect") } }, retirementOrca(record)).record, target)
 assert.equal(readFileSync(receipt, "utf8"), bytes)
})

test("graph declaration shape does not introduce another shell language", () => {
 for (const command of [
  "node check.cjs", "node 'check file.cjs'", "npm run verify:full", "cargo test", "make check",
  "sh scripts/check.sh", "bash -n scripts/check.sh", "./scripts/check.sh --fast",
  "node --import tsx scripts/check.ts", "node --require local-module check.cjs",
  "python -m pytest", "python3 -B -S tools/offline_pytest.py feeds -q",
  "uv run --locked sh scripts/check.sh", "pnpm exec local-checker --config test.config.ts",
  "pnpm exec node check.cjs", "pnpm exec bash scripts/check.sh", "tsc -p tsconfig.json",
  "pnpm --filter @booking-os/api exec vitest run test/integration/kysely-schema.integration.test.ts",
 ]) assert.doesNotThrow(() => assertGraphShell(command), command)
 for (const command of [
  "node check.cjs; git push", "node check.cjs && node other.cjs", "node check.cjs\ngit push",
  "node $(git push)", "node `git push`", "node check.cjs > ../file", "node check.cjs | tee file",
  "NODE_OPTIONS=evil node check.cjs", "bash -c 'node check.cjs'", "node -e 'process.exit()'",
  "uv run python -c 'print(1)'", "node '--eval' 'process.exit(0)'", "node '-e0'",
  "node '../source/check.cjs'", "npm '--prefix=/elsewhere' test", "pnpm --dir=/outside test",
  "npm publish", "npm 'pub'", "pnpm run deploy:staging", "pnpm exec gh pr create",
  "git status", "git -C repo status", "gh repo view", "/usr/bin/git push", "GH pr create", "ENV GH pr create",
  "orca orchestration dispatch --task x", "rm file", "psql database", "docker compose up",
  "node \"unterminated",
 ]) assert.doesNotThrow(() => assertGraphShell(command), 'Only native parsed-shell policy classifies operations: ' + command)
 for (const command of ['', '  ', 'node\0check']) assert.throws(() => assertGraphShell(command))
})
test("legacy evidence remains unchanged; unrelated known scope is neither resumed nor presumed settled", () => {
 const root = fixture(), locks = join(root, "task-graph-locks")
 const directory = join(locks, `${digest("legacy")}.lock`)
 mkdirSync(directory, { recursive: true })
 const file = join(directory, "workspaces.json")
 const bytes = JSON.stringify({ version: 1, repositories: [{ identity: "/other/repo/.git" }], workers: [{ terminal: "live-worker" }] })
 writeFileSync(file, bytes)
 assert.doesNotThrow(() => assertNoLegacyGraph(root, ["/selected/repo/.git"]))
 assert.throws(() => assertNoLegacyGraph(root, ["/other/repo/.git"]), error => String(error).includes(LEGACY_GRAPH))
 assert.equal(readFileSync(file, "utf8"), bytes)
 writeFileSync(file, "{}")
 assert.throws(() => assertNoLegacyGraph(root, ["/selected/repo/.git"]), /Unsupported legacy/)
 assert.equal(readFileSync(file, "utf8"), "{}")
})
test("coordinator lease excludes live writers and resumes an exited process without deleting records", () => {
 const root = fixture(), file = join(root, "record.json")
 writeFileSync(file, "preserved approval")
 const release = acquireLease(file)
 assert.throws(() => acquireLease(file), /live coordinator/)
 release()
 const module = new URL("../task-graph-core.ts", import.meta.url).href
 const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import { acquireLease } from ${JSON.stringify(module)}; acquireLease(${JSON.stringify(file)});`], { encoding: "utf8" })
 assert.equal(child.status, 0, child.stderr)
 acquireLease(file)()
 assert.equal(readFileSync(file, "utf8"), "preserved approval")
})
test("dangling graph lease symlinks are uncertain", () => {
 const directory = fixture(), file = join(directory, "current-v4.json"); writeFileSync(file, "{}")
 symlinkSync(join(directory, "missing"), `${file}.lease`); assert.equal(graphLeaseState(file), "uncertain")
 const other = join(directory, "other.json"); writeFileSync(other, "{}"); symlinkSync(join(directory, "missing-recovery"), `${other}.lease.recovery`); assert.equal(graphLeaseState(other), "uncertain")
})

test("one prompt states the bounded lane and approval contract", () => {
 const prompt = taskGraphPrompt("Build search", "plan-only")
 for (const rule of [/separate \/graph execute/, /pi-yolo workers/, /worktree budget/, /reusable lanes/, /future implementation paths and serial ownership/, /Read-only repositories use owns: \[\]/, /one exact copy-ready \/graph execute <objective> command/, /user must not reconstruct it from task details/, /install required dependencies/, /only a directly runnable shell command/, /leave tracked files unchanged/, /native shell syntax instead of opaque wrappers/, /do not probe helper or binary availability/, /Legacy Runs are unsupported/, /never recapture/, /hooks enabled/, /internal integration/]) assert.match(prompt, rule)
 assert.doesNotMatch(prompt, /per-task worktree|current_checkout|worker-start/)
})

function settledRetirementFixture(runId = "run_settled", missingIntegration = false, withResource = false) {
 const directory = fixture(), home = join(directory, "home"), source = join(home, "Code/source"), worktreeRoot = join(home, "orca/workspaces"), records = join(home, "agent/task-graphs"), retired = join(home, "agent/task-graphs-retired/v4")
 mkdirSync(worktreeRoot, { recursive: true }); mkdirSync(records, { recursive: true }); process.env.HOME = home
 const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" }
 Object.assign(process.env, env); execFileSync("git", ["init", "--quiet", "--initial-branch=main", source], { env }); writeFileSync(join(source, "file.txt"), "base\n")
 graphGit(source, "add", "--", "file.txt"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD"), declaration = { id: "write", goal: "Write one file", repository: ".", depends_on: [], owns: ["file.txt"], done_when: ["The file is written."], validation: "node check.cjs" }
 const plan: any = { objective: `Settled retirement ${runId}`, mode: "execute", worktree_budget: 2, foundations: [{ repository: ".", commit: base }], tasks: [declaration] }
 const record = captureGraphWorkspaces(source, plan), repo = record.repositories[0], integration = join(worktreeRoot, "integration"), lane = join(worktreeRoot, "lane"), worktrees: any[] = []
 if (!missingIntegration) {
  graphGit(source, "worktree", "add", "--quiet", "-b", `integration-${record.key}`, integration, base)
  Object.assign(repo.workspace!, { path: integration, branch: `integration-${record.key}`, id: `repo::${integration}`, captureCommit: base })
  worktrees.push({ id: repo.workspace!.id, path: integration, branch: `refs/heads/${repo.workspace!.branch}`, owner: "repo" })
 } else Object.assign(repo.workspace!, { path: integration, branch: `integration-${record.key}`, id: `repo::${integration}`, captureCommit: base })
 graphGit(source, "worktree", "add", "--quiet", "-b", `lane-${record.key}`, lane, base)
 const laneRecord: any = { id: "lane", source, task: "write", previousTasks: [], workspace: { role: "lane", name: "lane", base, path: lane, branch: `lane-${record.key}`, id: `repo::${lane}` } }
 record.lanes.push(laneRecord); record.workers.write = { task: "write", ledgerTask: "task_write", source, lane: "lane", workspace: lane, base, prerequisites: { [source]: base }, attempt: 0, terminal: "terminal_write", dispatch: "dispatch_write" }; record.runId = runId
 worktrees.push({ id: laneRecord.workspace.id, path: lane, branch: `refs/heads/${laneRecord.workspace.branch}`, owner: "repo" }); writeFileSync(join(lane, "stranded.txt"), "keep\n")
 const tasks: any[] = [{ id: "task_write", run_id: runId, parent_id: null, status: "failed", spec: graphTaskSpec(record, declaration) }], dispatches: any[] = [{ id: "dispatch_write", task_id: "task_write", run_id: runId, assignee_handle: "terminal_write", status: "completed" }]
 const resourceId = "a".repeat(64), token = "00000000-0000-4000-8000-000000000000", containers: any[] = []
 if (withResource) {
  const resourceDeclaration = { id: "database", type: "postgres", image: `postgres:17.6@sha256:${"b".repeat(64)}`, purpose: "retirement fixture", memoryMiB: 256, storageMiB: 128, lifetimeSeconds: 3600, profile: "maintenance-owner" }
  record.plan.resources = [resourceDeclaration as any]; record.resources = { database: { scope: record.key, declaration: resourceDeclaration, engine: "engine", token, createdAt: Date.now(), id: resourceId, ready: false, stopped: true } }
  containers.push({ Id: resourceId, Config: { Labels: { "agent-toolkit.scope": record.key, "agent-toolkit.token": token } }, State: { Running: false } })
 }
 const run = { id: runId, objective: `Pi graph v4: ${record.key}: ${record.plan.objective}` }, runs = [run]
 const orca = (args: string[]) => {
  const operation = args.slice(0, 2).join(" "), value = (key: string) => args[args.indexOf(key) + 1]
  if (operation === "orchestration run-list") return { result: { runs } }
  if (operation === "orchestration run-show") return { result: { run: runs.find(item => item.id === value("--id")) } }
  if (operation === "orchestration task-list") return { result: { tasks: tasks.filter(item => item.run_id === value("--run")) } }
  if (operation === "orchestration dispatch-show") return { result: { dispatch: dispatches.find(item => item.task_id === value("--task")) } }
  if (operation === "terminal wait") return { result: { wait: { satisfied: true } } }
  if (operation === "repo list") return { result: { repos: [{ id: "repo", path: source }, { id: "foreign", path: source }] } }
  if (operation === "worktree list") return { result: { worktrees: worktrees.filter(item => item.owner === value("--repo").slice(3)) } }
  throw new Error(`Unexpected retirement operation: ${operation}`)
 }
 const runtime = { list: () => containers.map(item => item.Id), inspect: (id: string) => containers.find(item => item.Id === id) }
 const verifyResource = (resource: any) => { if (resource.identityError) throw new Error("postgresql://user:private-password@127.0.0.1/private"); return runtime.inspect(resource.id) }
 const file = join(records, "current-v4.json"); writeFileSync(file, JSON.stringify(record)); writeFileSync(`${file}.write.receipt`, "preserved task receipt")
 return { directory, home, source, records, retired, file, record, repo, lane, integration, worktrees, tasks, dispatches, run, runs, orca, runtime, verifyResource, containers }
}

function saveSettled(f: ReturnType<typeof settledRetirementFixture>) { writeFileSync(f.file, JSON.stringify(f.record)) }

test("run_4786ff0ea472-shaped retirement needs no repair marker and preserves a stopped maintenance resource", () => {
 const f = settledRetirementFixture("run_4786ff0ea472", false, true), before = readFileSync(f.file, "utf8")
 assert.equal(f.record.workers.write.repair, undefined)
 const result = retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource), receipt = JSON.parse(readFileSync(join(f.retired, "current-v4/retirement.json"), "utf8"))
 assert.equal(readFileSync(result.record, "utf8"), before); assert.equal(readFileSync(join(f.lane, "stranded.txt"), "utf8"), "keep\n"); assert.equal(readFileSync(`${f.file}.write.receipt`, "utf8"), "preserved task receipt")
 assert.equal(receipt.status, "retired"); assert.deepEqual(receipt.released, ["repository-ownership"]); assert.ok(receipt.preserved.includes("resources"))
})

test("workerless resource startup can retire after its exact resource is stopped", () => {
 const f = settledRetirementFixture("run_workerless_resource", false, true); f.record.lanes = []; f.record.workers = {}; f.record.resources!.database.stopped = false; f.record.resources!.database.ready = true; f.tasks[0].status = "ready"; saveSettled(f)
 const result = inspectGraphRetirement(f.file, f.runtime, f.orca, f.verifyResource)
 assert.equal(result.eligible, true); assert.equal(result.state, "eligible")
})

test("run_072fca697cae-shaped retirement accepts a completed worker report and records absent worktrees", () => {
 const f = settledRetirementFixture("run_072fca697cae", true); f.tasks[0].status = "completed"
 renameSync(f.lane, `${f.lane}.removed`); f.worktrees.splice(f.worktrees.findIndex(item => item.path === f.lane), 1)
 const result = retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource)
 const receipt = JSON.parse(readFileSync(join(f.retired, "current-v4/retirement.json"), "utf8"))
 assert.equal(receipt.worktrees.find((item: any) => item.role === "integration").status, "verified-absent")
 assert.equal(receipt.worktrees.find((item: any) => item.role === "lane").status, "verified-absent")
 assert.equal(existsSync(f.integration), false); assert.equal(existsSync(f.lane), false)
 const bytes = readFileSync(join(f.retired, "current-v4/retirement.json"), "utf8")
 assert.equal(retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource).record, result.record); assert.equal(readFileSync(join(f.retired, "current-v4/retirement.json"), "utf8"), bytes)
})

test("settled retirement rejects nonterminal, changed, missing, duplicate, or foreign orchestration evidence", () => {
 const cases: Array<[string, (f: ReturnType<typeof settledRetirementFixture>) => void, RegExp]> = [
  ["running dispatch", f => { f.dispatches[0].status = "running" }, /nonterminal/],
  ["missing task", f => { f.tasks.length = 0 }, /ledger/i],
  ["changed task", f => { f.tasks[0].spec += " changed" }, /ledger/i],
  ["duplicate task", f => { f.tasks.push({ ...f.tasks[0], id: "task_duplicate" }) }, /ledger/i],
  ["foreign task", f => { f.tasks[0].run_id = "run_foreign" }, /ledger/i],
  ["missing dispatch", f => { f.dispatches.length = 0 }, /dispatch/],
  ["changed dispatch", f => { f.dispatches[0].id = "dispatch_changed" }, /dispatch/],
  ["foreign dispatch", f => { f.dispatches[0].run_id = "run_foreign" }, /dispatch/],
  ["missing Run", f => { f.runs.length = 0 }, /Run/],
  ["duplicate Run", f => { f.runs.push({ ...f.run }) }, /Run/],
  ["foreign Run", f => { f.run.id = "run_foreign" }, /Run/],
  ["changed Run", f => { f.run.objective += " changed" }, /Run/],
 ]
 for (const [name, change, blocker] of cases) {
  const f = settledRetirementFixture(`run_${name.replaceAll(" ", "_")}`); change(f)
  const result = inspectGraphRetirement(f.file, f.runtime, f.orca, f.verifyResource)
  assert.equal(result.eligible, false, name); assert.match(result.blocker!, blocker, name); assert.equal(existsSync(f.file), true, name)
 }
 const missingWorker = settledRetirementFixture("run_missing_worker"); delete missingWorker.record.workers.write; saveSettled(missingWorker)
 assert.match(inspectGraphRetirement(missingWorker.file, missingWorker.runtime, missingWorker.orca, missingWorker.verifyResource).blocker!, /worker/i)
 const missingDispatch = settledRetirementFixture("run_missing_recorded_dispatch"); delete missingDispatch.record.workers.write.dispatch; saveSettled(missingDispatch)
 assert.match(inspectGraphRetirement(missingDispatch.file, missingDispatch.runtime, missingDispatch.orca, missingDispatch.verifyResource).blocker!, /dispatch/i)
 const runningTerminal = settledRetirementFixture("run_running_terminal"), runningOrca = (args: string[]) => args.slice(0, 2).join(" ") === "terminal wait" ? { result: { wait: { satisfied: false } } } : runningTerminal.orca(args)
 assert.equal(inspectGraphRetirement(runningTerminal.file, runningTerminal.runtime, runningOrca, runningTerminal.verifyResource).state, "running-worker")
 const timedOutTerminal = settledRetirementFixture("run_timed_out_terminal"), timedOutOrca = (args: string[]) => { if (args.slice(0, 2).join(" ") === "terminal wait") throw new Error("timeout"); return timedOutTerminal.orca(args) }
 assert.equal(inspectGraphRetirement(timedOutTerminal.file, timedOutTerminal.runtime, timedOutOrca, timedOutTerminal.verifyResource).state, "running-worker")
 const activeWithoutWorker = settledRetirementFixture("run_active_without_worker"), activeTask = { id: "active", goal: "Active", repository: ".", depends_on: [], owns: ["active.txt"], done_when: ["Done."], validation: "node check.cjs" }
 activeWithoutWorker.record.plan.tasks.push(activeTask); activeWithoutWorker.tasks.push({ id: "task_active", run_id: activeWithoutWorker.record.runId, parent_id: null, status: "dispatched", spec: graphTaskSpec(activeWithoutWorker.record, activeTask) }); saveSettled(activeWithoutWorker)
 assert.equal(inspectGraphRetirement(activeWithoutWorker.file, activeWithoutWorker.runtime, activeWithoutWorker.orca, activeWithoutWorker.verifyResource).state, "running-worker")
 const duplicate = settledRetirementFixture("run_duplicate_dispatch")
 const other = { id: "other", goal: "Other", repository: ".", depends_on: [], owns: ["other.txt"], done_when: ["Done."], validation: "node check.cjs" }
 duplicate.record.plan.tasks.push(other); duplicate.record.lanes.push({ ...duplicate.record.lanes[0], id: "other-lane", task: "other" }); duplicate.record.workers.other = { ...duplicate.record.workers.write, task: "other", ledgerTask: "task_other", lane: "other-lane" }; duplicate.tasks.push({ id: "task_other", run_id: duplicate.record.runId, parent_id: null, status: "failed", spec: graphTaskSpec(duplicate.record, other) }); saveSettled(duplicate)
 assert.match(inspectGraphRetirement(duplicate.file, duplicate.runtime, duplicate.orca, duplicate.verifyResource).blocker!, /duplicated.*dispatch/)
})

test("settled retirement rejects completed, integrated, or actively mutated graphs", () => {
 for (const change of [
  (f: ReturnType<typeof settledRetirementFixture>) => { f.record.completed.write = { head: f.record.workers.write.base, integrationHead: f.record.workers.write.base, evidence: "done" } },
  (f: ReturnType<typeof settledRetirementFixture>) => { f.record.workers.write.integrated = f.record.workers.write.base },
  (f: ReturnType<typeof settledRetirementFixture>) => { f.record.workers.write.integration = { before: f.record.workers.write.base, tip: f.record.workers.write.base } },
 ]) {
  const f = settledRetirementFixture(); change(f); saveSettled(f); assert.equal(inspectGraphRetirement(f.file, f.runtime, f.orca, f.verifyResource).eligible, false)
 }
 const active = settledRetirementFixture("run_active"), release = acquireLease(active.file)
 try { assert.equal(inspectGraphRetirement(active.file, active.runtime, active.orca, active.verifyResource).state, "active"); assert.throws(() => retireUnstartedGraph(active.file, active.retired, active.runtime, active.orca, active.verifyResource), /live coordinator/) } finally { release() }
})

test("settled retirement rejects live, missing, duplicated, or identity-uncertain resources", () => {
 const cases: Array<[string, (f: ReturnType<typeof settledRetirementFixture>) => void, string]> = [
  ["live", f => { f.containers[0].State.Running = true }, "live-resource"],
  ["missing", f => { f.containers.length = 0 }, "uncertain"],
  ["duplicated", f => { f.containers.push({ ...f.containers[0], Id: "c".repeat(64) }) }, "uncertain"],
  ["orphaned", f => { f.containers.push({ Id: "d".repeat(64), Config: { Labels: { "agent-toolkit.scope": f.record.key, "agent-toolkit.token": "foreign" } }, State: { Running: true } }) }, "uncertain"],
  ["identity-uncertain", f => { f.record.resources.database.identityError = true; saveSettled(f) }, "uncertain"],
 ]
 for (const [name, change, state] of cases) {
  const f = settledRetirementFixture(`run_resource_${name}`, false, true); change(f)
  const result = inspectGraphRetirement(f.file, f.runtime, f.orca, f.verifyResource)
  assert.equal(result.eligible, false, name); assert.equal(result.state, state, name)
 }
 const expired = settledRetirementFixture("run_resource_expired", false, true); expired.record.resources.database.createdAt = 0; saveSettled(expired); assert.equal(inspectGraphRetirement(expired.file, expired.runtime, expired.orca, expired.verifyResource).eligible, true)
})

test("settled retirement rejects changed, duplicated, foreign, or incompletely inventoried worktrees", () => {
 const cases: Array<[string, (f: ReturnType<typeof settledRetirementFixture>) => any]> = [
  ["changed branch", f => { f.worktrees[0].branch = "refs/heads/changed" }],
  ["path disagreement", f => { f.worktrees[0].id = "repo::/other" }],
  ["duplicate match", f => { f.worktrees.push({ ...f.worktrees[0] }) }],
  ["foreign repository", f => { f.worktrees[0].owner = "foreign" }],
  ["advanced integration", f => { writeFileSync(join(f.integration, "advanced.txt"), "advanced\n"); graphGit(f.integration, "add", "--", "advanced.txt"); graphGit(f.integration, "commit", "-m", "advanced integration") }],
 ]
 for (const [name, change] of cases) {
  const f = settledRetirementFixture(`run_worktree_${name.replaceAll(" ", "_")}`); change(f)
  const result = inspectGraphRetirement(f.file, f.runtime, f.orca, f.verifyResource); assert.equal(result.eligible, false, name); assert.match(result.blocker!, /worktree|Orca/i, name)
 }
 const incomplete = settledRetirementFixture("run_incomplete_inventory", true)
 const orca = (args: string[]) => args[0] === "worktree" ? { result: { worktrees: [], truncated: true } } : incomplete.orca(args)
 assert.match(inspectGraphRetirement(incomplete.file, incomplete.runtime, orca, incomplete.verifyResource).blocker!, /Incomplete Orca worktree inventory/)
 const ambiguous = settledRetirementFixture("run_ambiguous_missing", true), real = join(ambiguous.directory, "real")
 mkdirSync(real); symlinkSync(real, join(ambiguous.directory, "alias")); ambiguous.record.repositories[0].workspace!.path = join(ambiguous.directory, "alias/missing"); ambiguous.record.repositories[0].workspace!.id = `repo::${ambiguous.record.repositories[0].workspace!.path}`; saveSettled(ambiguous)
 assert.match(inspectGraphRetirement(ambiguous.file, ambiguous.runtime, ambiguous.orca, ambiguous.verifyResource).blocker!, /symlink|ambiguous/)
})

test("duplicate graph records and legacy records remain ineligible and byte-identical", () => {
 const f = settledRetirementFixture("run_duplicate_graph"), duplicate = join(f.records, "duplicate.json"); writeFileSync(duplicate, readFileSync(f.file))
 assert.throws(() => findUnstartedGraphRetirement(f.records, f.retired, f.record.runId!), /Multiple graph records/)
 const foreignReceipt = join(f.retired, "foreign"); mkdirSync(foreignReceipt, { recursive: true }); writeFileSync(join(foreignReceipt, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: "run_foreign_source", source: join(f.directory, "outside.json") }))
 assert.throws(() => findUnstartedGraphRetirement(f.records, f.retired, "run_foreign_source"), /does not match its active graph path/)
 const legacy = join(f.records, "legacy.json"), bytes = JSON.stringify({ version: 3, runId: "run_legacy", repositories: [] }); writeFileSync(legacy, bytes)
 assert.equal(inspectGraphGarbage(join(f.home, "agent"), f.orca).records.find((item: any) => item.runId === "run_legacy").state, "legacy")
 assert.equal(readFileSync(legacy, "utf8"), bytes); assert.throws(() => retireUnstartedGraph(legacy, f.retired, f.runtime, f.orca, f.verifyResource), /older contract/); assert.equal(readFileSync(legacy, "utf8"), bytes)
})

test("garbage inspection and retirement reject a symlinked active records directory", () => {
 const f = settledRetirementFixture("run_symlinked_active"), external = join(f.directory, "external-records"), record = join(external, "current-v4.json")
 renameSync(f.records, external); symlinkSync(external, f.records)
 assert.throws(() => inspectGraphGarbage(join(f.home, "agent"), f.orca), /Active graph evidence identity is uncertain/)
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource), /Active graph evidence identity is uncertain/)
 assert.equal(existsSync(`${record}.lease`), false); assert.equal(existsSync(record), true); assert.equal(existsSync(join(f.retired, "current-v4/record.json")), false)
})

test("retirement rejects a symlinked active record before reading its target", () => {
 const f = settledRetirementFixture("run_symlinked_record_source"), outside = join(f.directory, "outside-active-record.json")
 renameSync(f.file, outside); symlinkSync(outside, f.file)
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource), /Graph record identity changed/)
 assert.equal(graphLeaseState(f.file), "available"); assert.equal(existsSync(outside), true)
})

test("retirement rejects an active record replaced during assessment", () => {
 const f = settledRetirementFixture("run_replaced_record_source"), original = join(f.directory, "original-active-record.json")
 let replaced = false
 const orca = (args: string[]) => {
  const result = f.orca(args)
  if (!replaced) { replaced = true; renameSync(f.file, original); writeFileSync(f.file, JSON.stringify(f.record)) }
  return result
 }
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, orca, f.verifyResource), /Graph record identity changed/)
 assert.equal(graphLeaseState(f.file), "available"); assert.equal(existsSync(original), true); assert.equal(existsSync(join(f.retired, "current-v4/record.json")), false)
})

test("retirement rejects an active record changed in place during assessment", () => {
 const f = settledRetirementFixture("run_changed_record_source")
 let changed = false
 const orca = (args: string[]) => {
  const result = f.orca(args)
  if (!changed) { changed = true; f.record.key = `${f.record.key}-changed`; writeFileSync(f.file, JSON.stringify(f.record)) }
  return result
 }
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, orca, f.verifyResource), /Graph record identity changed/)
 assert.equal(graphLeaseState(f.file), "available"); assert.equal(existsSync(f.file), true); assert.equal(existsSync(join(f.retired, "current-v4/record.json")), false)
})

test("retirement rejects a symlinked evidence directory", () => {
 const f = settledRetirementFixture("run_symlinked_retirement"), outside = join(f.directory, "outside-retirement")
 mkdirSync(f.retired, { recursive: true }); mkdirSync(outside); symlinkSync(outside, join(f.retired, "current-v4"))
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource), /symlink/)
 assert.equal(existsSync(f.file), true)
})

test("pending retirement rejects a symlinked moved record", () => {
 const f = settledRetirementFixture("run_symlinked_record"), directory = join(f.retired, "current-v4"), target = join(directory, "record.json"), outside = join(f.directory, "outside-record.json")
 mkdirSync(directory, { recursive: true }); renameSync(f.file, outside); symlinkSync(outside, target); writeFileSync(join(directory, "retirement.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: f.record.runId, source: f.file, retiredAt: new Date().toISOString() }))
 assert.throws(() => retireUnstartedGraph(f.file, f.retired, f.runtime, f.orca, f.verifyResource), /Graph record identity changed/)
})

test("graph garbage inspection is mutation-free, state-specific, and credential-redacted", () => {
 const f = settledRetirementFixture("run_gc", false, true), agent = join(f.home, "agent"), legacy = join(agent, "task-graph-locks/legacy.lock")
 mkdirSync(legacy, { recursive: true }); writeFileSync(join(legacy, "owner.json"), "private legacy evidence")
 const completedPlan: any = { objective: "GC completed", mode: "execute", worktree_budget: 1, foundations: [{ repository: ".", commit: f.repo.base }], tasks: [{ id: "read", goal: "Inspect", repository: ".", depends_on: [], owns: [], done_when: ["Inspected."], validation: "manual: inspect" }] }, completed = captureGraphWorkspaces(f.source, completedPlan); completed.runId = "run_completed"; completed.workers.read = { task: "read", ledgerTask: "task_completed", source: f.source, workspace: f.source, base: f.repo.base, prerequisites: {}, attempt: 0, dispatch: "dispatch_completed" }; completed.completed.read = { head: f.repo.base, integrationHead: f.repo.base, evidence: "done" }; completed.completion = { evidence: "done", deliveryPending: false }; writeFileSync(join(f.records, "completed.json"), JSON.stringify(completed)); f.runs.push({ id: completed.runId, objective: `Pi graph v4: ${completed.key}: ${completed.plan.objective}` }); f.tasks.push({ id: "task_completed", run_id: completed.runId, parent_id: null, status: "completed", spec: graphTaskSpec(completed, completed.plan.tasks[0]) }); f.dispatches.push({ id: "dispatch_completed", task_id: "task_completed", run_id: completed.runId, assignee_handle: "terminal_write", status: "completed" }); writeFileSync(join(f.records, "malformed-completed.json"), JSON.stringify({ version: 4, runId: "run_malformed_completed", completion: { evidence: "done" } }))
 const deliveries = join(agent, "task-graph-deliveries/v1"); mkdirSync(deliveries, { recursive: true }); writeFileSync(join(deliveries, "run_completed.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_completed", record: join(f.records, "completed.json"), approvedAt: new Date().toISOString(), targets: [{ source: f.source, identity: repositoryIdentity(f.source), branch: "main", from: f.repo.base, head: f.repo.base, workspace: { id: "workspace", path: f.source, branch: "main" }, status: "pending" }], cleanup: [], retained: [] }))
 const archivedState = structuredClone(completed); archivedState.runId = "run_archived"; const archivedDirectory = join(agent, "task-graphs-archived/v1/archived"), archivedRecord = join(archivedDirectory, "record.json"), archivedBytes = JSON.stringify(archivedState); mkdirSync(join(archivedDirectory, "sidecars"), { recursive: true }); writeFileSync(archivedRecord, archivedBytes); writeFileSync(join(archivedDirectory, "archive.json"), JSON.stringify({ version: 1, status: "archived", runId: archivedState.runId, source: join(f.records, "archived.json"), record: archivedRecord, recordHash: digest(archivedBytes) })); const malformedArchive = join(agent, "task-graphs-archived/v1/malformed"); mkdirSync(malformedArchive); writeFileSync(join(malformedArchive, "archive.json"), "{")
 const eligiblePlan: any = { objective: "GC eligible", mode: "execute", worktree_budget: 1, foundations: [{ repository: ".", commit: f.repo.base }], tasks: [{ id: "read", goal: "Inspect", repository: ".", depends_on: [], owns: [], done_when: ["Inspected."], validation: "manual: inspect" }] }
 const eligible = captureGraphWorkspaces(f.source, eligiblePlan); eligible.runId = "run_eligible"; const eligibleFile = join(f.records, "eligible.json"), eligibleBytes = JSON.stringify(eligible); writeFileSync(eligibleFile, eligibleBytes); f.runs.push({ id: eligible.runId, objective: `Pi graph v4: ${eligible.key}: ${eligible.plan.objective}` }); f.tasks.push({ id: "task_read", run_id: eligible.runId, parent_id: null, status: "ready", spec: graphTaskSpec(eligible, eligible.plan.tasks[0]) }); const pending = join(f.retired, "eligible"); mkdirSync(pending, { recursive: true }); writeFileSync(join(pending, "retirement.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: eligible.runId, source: eligibleFile, recordHash: digest(eligibleBytes), released: ["repository-ownership"], preserved: ["source-checkouts", "branches", "graph-record", "orchestration-evidence", "commits", "task-receipts", "integration-worktrees", "worker-lanes", "resources", "resource-identities"], worktrees: [] }))
 const movedPlan: any = { ...eligiblePlan, objective: "GC pending after move" }, movedState = captureGraphWorkspaces(f.source, movedPlan); movedState.runId = "run_pending_moved"; f.runs.push({ id: movedState.runId, objective: `Pi graph v4: ${movedState.key}: ${movedState.plan.objective}` }); f.tasks.push({ id: "task_pending_moved", run_id: movedState.runId, parent_id: null, status: "ready", spec: graphTaskSpec(movedState, movedState.plan.tasks[0]) }); const moved = join(f.retired, "moved"), movedRecord = join(moved, "record.json"), movedBytes = JSON.stringify(movedState); mkdirSync(moved); writeFileSync(movedRecord, movedBytes); writeFileSync(join(moved, "retirement.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: movedState.runId, source: join(f.records, "moved.json"), recordHash: digest(movedBytes), released: ["repository-ownership"], preserved: ["source-checkouts", "branches", "graph-record", "orchestration-evidence", "commits", "task-receipts", "integration-worktrees", "worker-lanes", "resources", "resource-identities"], worktrees: [] }))
 const retiredPlan: any = { ...eligiblePlan, objective: "GC retired" }, retiredState = captureGraphWorkspaces(f.source, retiredPlan); retiredState.runId = "run_retired"; f.runs.push({ id: retiredState.runId, objective: `Pi graph v4: ${retiredState.key}: ${retiredState.plan.objective}` }); f.tasks.push({ id: "task_retired", run_id: retiredState.runId, parent_id: null, status: "ready", spec: graphTaskSpec(retiredState, retiredState.plan.tasks[0]) }); const retired = join(f.retired, "old"), retiredRecord = join(retired, "record.json"); mkdirSync(retired, { recursive: true }); writeFileSync(retiredRecord, JSON.stringify(retiredState)); writeFileSync(join(retired, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: "run_retired", source: join(f.records, "old.json"), record: retiredRecord }))
 const conflictActive = { ...eligible, runId: "run_conflict" }; writeFileSync(join(f.records, "conflict.json"), JSON.stringify(conflictActive)); const conflict = join(f.retired, "conflict"); mkdirSync(conflict); writeFileSync(join(conflict, "record.json"), JSON.stringify(conflictActive)); writeFileSync(join(conflict, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: "run_conflict", source: join(f.records, "conflict.json"), record: join(conflict, "record.json") })); assert.throws(() => findUnstartedGraphRetirement(f.records, f.retired, "run_conflict"), /conflicts/)
 const external = join(f.directory, "external-graph.json"); writeFileSync(external, JSON.stringify(eligible)); symlinkSync(external, join(f.records, "symlink.json"))
 const hashedPlan: any = { ...eligiblePlan, objective: "GC hashed retired" }, hashedState = captureGraphWorkspaces(f.source, hashedPlan); hashedState.runId = "run_hashed_retired"; f.runs.push({ id: hashedState.runId, objective: `Pi graph v4: ${hashedState.key}: ${hashedState.plan.objective}` }); f.tasks.push({ id: "task_hashed_retired", run_id: hashedState.runId, parent_id: null, status: "ready", spec: graphTaskSpec(hashedState, hashedState.plan.tasks[0]) }); const hashed = join(f.retired, "hashed"), hashedRecord = join(hashed, "record.json"), hashedBytes = JSON.stringify(hashedState); mkdirSync(hashed); writeFileSync(hashedRecord, hashedBytes); writeFileSync(join(hashed, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: hashedState.runId, source: join(f.records, "hashed.json"), record: hashedRecord, recordHash: digest(hashedBytes), released: ["repository-ownership"], preserved: ["source-checkouts", "branches", "graph-record", "orchestration-evidence", "commits", "task-receipts", "integration-worktrees", "worker-lanes", "resources", "resource-identities"], worktrees: [] })); f.containers.push({ Id: "c".repeat(64), Config: { Labels: { "agent-toolkit.scope": hashedState.key } }, State: { Running: true } })
 const lost = join(f.retired, "lost"); mkdirSync(lost); writeFileSync(join(lost, "retirement.json"), JSON.stringify({ version: 1, status: "retired", runId: "run_lost", source: join(f.records, "lost.json"), record: join(lost, "record.json") }))
 const symlinkTarget = join(f.directory, "retired-symlink-target"); mkdirSync(symlinkTarget); writeFileSync(join(symlinkTarget, "retirement.json"), "{}"); symlinkSync(symlinkTarget, join(f.retired, "symlink-directory")); const symlinkReceipt = join(f.retired, "symlink-receipt"); mkdirSync(symlinkReceipt); symlinkSync(join(symlinkTarget, "retirement.json"), join(symlinkReceipt, "retirement.json"))
 f.record.resources.database.identityError = true; saveSettled(f)
 const before = [readFileSync(f.file, "utf8"), readFileSync(join(legacy, "owner.json"), "utf8"), readFileSync(join(retired, "retirement.json"), "utf8"), readFileSync(join(lost, "retirement.json"), "utf8")]
 const report = inspectGraphGarbage(agent, f.orca, () => ({ runtime: f.runtime, verifyResource: f.verifyResource })), output = JSON.stringify(report)
 assert.equal(report.inspectionOnly, true); assert.ok(report.summary.active > 0); assert.ok(report.summary.completed > 0); assert.equal(report.summary.archived, 1); assert.equal(report.records.find((item: any) => item.runId === "run_archived").state, "archived"); assert.equal(report.records.find((item: any) => item.record.includes("/malformed")).state, "uncertain")
 assert.equal(report.records.find((item: any) => item.runId === "run_completed" && item.location === "active").nextAction, undefined); assert.equal(report.records.find((item: any) => item.runId === "run_completed" && item.location === "delivery").nextAction, "/graph deliver run_completed"); assert.equal(report.records.find((item: any) => item.runId === "run_eligible").nextAction, "/graph retire run_eligible"); assert.ok(report.records.some((item: any) => item.state === "eligible")); assert.equal(report.records.filter((item: any) => item.state === "pending-retirement").length, 2); assert.ok(report.records.filter((item: any) => item.state === "pending-retirement").every((item: any) => item.nextAction === `/graph retire ${item.runId}`)); assert.equal(report.records.find((item: any) => item.record.endsWith("symlink.json")).state, "uncertain"); assert.equal(report.records.find((item: any) => item.runId === "run_conflict" && item.location === "active").state, "uncertain"); assert.equal(report.records.find((item: any) => item.runId === "run_malformed_completed").state, "uncertain"); assert.equal(report.records.find((item: any) => item.runId === "run_malformed_completed").nextAction, undefined); assert.ok(report.records.some((item: any) => item.state === "completed"), JSON.stringify(report)); assert.ok(report.records.some((item: any) => item.state === "retired")); assert.equal(report.records.find((item: any) => item.runId === "run_hashed_retired").state, "live-resource", JSON.stringify(report)); assert.ok(report.records.filter((item: any) => item.record.includes("symlink-")).every((item: any) => item.state === "uncertain")); assert.equal(report.records.find((item: any) => item.runId === "run_lost").state, "uncertain"); assert.ok(report.records.some((item: any) => item.state === "legacy")); assert.ok(report.records.some((item: any) => item.state === "uncertain"))
 assert.doesNotMatch(output, /private-password|postgresql:\/\//); assert.deepEqual([readFileSync(f.file, "utf8"), readFileSync(join(legacy, "owner.json"), "utf8"), readFileSync(join(retired, "retirement.json"), "utf8"), readFileSync(join(lost, "retirement.json"), "utf8")], before)
})

test("graph garbage inspection reports an uncertain delivery directory", () => {
 const root = fixture(), agent = join(root, "agent"), deliveries = join(agent, "task-graph-deliveries"); mkdirSync(deliveries, { recursive: true }); writeFileSync(join(deliveries, "v1"), "not a directory")
 const report = inspectGraphGarbage(agent, () => ({})); assert.equal(report.records.find((item: any) => item.record.endsWith("task-graph-deliveries/v1")).state, "uncertain")
})
