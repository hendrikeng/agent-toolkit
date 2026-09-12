import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphFile, graphGit, importGraphInputs, integrateGraphWorker, prepareGraphLane, readGraphAdmission, readGraphRecord, saveGraphRecord, verifyGraphWorkspace, verifyPlanTaskCloseout } from "../workspaces.ts"
import { digest, repositoryIdentity, validateTaskGraph, type TaskGraphPlan } from "../task-graph-core.ts"

function fixture() {
 const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || join(homedir(), "Code/.agent-toolkit-scratch")
 mkdirSync(scratch, { recursive: true, mode: 0o700 })
 const directory = realpathSync(mkdtempSync(join(scratch, "graph-lanes-"))), source = join(directory, "source")
 const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" }
 Object.assign(process.env, env)
 execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source], { env })
 for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(source, name), "base\n")
 graphGit(source, "add", "--", "a.txt", "b.txt", "c.txt"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD")
 const tasks = [
  { id: "a", goal: "a", repository: ".", depends_on: [], owns: ["a.txt"], done_when: ["checked"], validation: "node check.cjs" },
  { id: "b", goal: "b", repository: ".", depends_on: [], owns: ["b.txt"], done_when: ["checked"], validation: "node check.cjs" },
  { id: "c", goal: "c", repository: ".", depends_on: ["a", "b"], owns: ["c.txt"], done_when: ["checked"], validation: "node check.cjs" },
 ]
 const plan: TaskGraphPlan = { objective: "Fixture", mode: "execute", worktree_budget: 3, foundations: [{ repository: ".", commit: base }], tasks }
 const items: any[] = [], configuration = { repo: { id: "repo", defaultTerminals: [], setup: [] } }
 const orca = (args: string[]) => {
  const value = (key: string) => args[args.indexOf(key) + 1]
  if (args[0] === "repo" && args[1] === "list") return { result: { repos: [{ id: "repo", path: source }] } }
  if (args[0] === "repo" && args[1] === "show") return { result: configuration }
  if (args[0] === "worktree" && args[1] === "list") return { result: { worktrees: items } }
  if (args[0] === "worktree" && args[1] === "set") { const item = items.find(item => item.id === value("--worktree").slice(3)); item.displayName = value("--display-name"); return { result: { worktree: item } } }
  assert.deepEqual(args.slice(0, 2), ["worktree", "create"])
  const path = join(directory, value("--name"))
  graphGit(source, "worktree", "add", "--quiet", "-b", value("--name"), path, value("--base-branch"))
  const item = { id: `repo::${path}`, path, displayName: value("--name"), branch: `refs/heads/${value("--name")}` }
  items.push(item); return { result: { worktree: item } }
 }
 const state = captureGraphWorkspaces(source, plan), repo = state.repositories[0]
 repo.preparation = { configuration, hash: digest(JSON.stringify(configuration)) }
 return { directory, source, base, plan, state, repo, orca, items }
}

test("read-only tasks add no worktree and writing plans require an explicit bounded budget", () => {
 const f = fixture()
 assert.equal(f.state.repositories[0].workspace?.role, "integration")
 const readOnly: TaskGraphPlan = { ...f.plan, worktree_budget: 1, tasks: f.plan.tasks.map(task => ({ ...task, owns: [], validation: "manual: inspect files" })) }
 assert.equal(captureGraphWorkspaces(f.source, readOnly).repositories[0].workspace, undefined)
 assert.throws(() => validateTaskGraph({ ...f.plan, worktree_budget: 1 }, f.source), /integration workspace/)
})

test("independent workers use bounded lanes; clean lanes are reused with integrated prerequisites", () => {
 const f = fixture(), persist = () => {}
 createGraphWorkspace(f.repo, f.repo.workspace!, f.orca, persist); importGraphInputs(f.repo, persist)
 const laneA = prepareGraphLane(f.state, f.repo, "a", f.orca, persist), laneB = prepareGraphLane(f.state, f.repo, "b", f.orca, persist)
 assert.equal(f.items.length, 3, "one integration workspace plus two concurrent lanes")
 assert.notEqual(laneA.workspace.path, laneB.workspace.path)
 assert.throws(() => prepareGraphLane(f.state, f.repo, "c", f.orca, persist), /budget/)
 for (const [id, lane, path] of [["a", laneA, "a.txt"], ["b", laneB, "b.txt"]] as const) {
  const base = verifyGraphWorkspace(f.repo, lane.workspace)
  f.state.workers[id] = { task: id, ledgerTask: `task_${id}`, source: f.repo.source, lane: lane.id, workspace: lane.workspace.path!, base, prerequisites: {}, attempt: 0 }
  writeFileSync(join(lane.workspace.path!, path), `${id}\n`)
  checkpointGraphChanges(f.repo, lane.workspace, [path], "execute", base, [path], id)
 }
 const aTip = verifyGraphWorkspace(f.repo, laneA.workspace), bTip = verifyGraphWorkspace(f.repo, laneB.workspace)
 integrateGraphWorker(f.state, f.state.workers.a, persist)
 integrateGraphWorker(f.state, f.state.workers.b, persist)
 const laneC = prepareGraphLane(f.state, f.repo, "c", f.orca, persist)
 assert.equal(f.items.length, 3, "many tasks stay inside the declared worktree budget")
 assert.ok([laneA.id, laneB.id].includes(laneC.id))
 graphGit(laneC.workspace.path!, "merge-base", "--is-ancestor", aTip, "HEAD")
 graphGit(laneC.workspace.path!, "merge-base", "--is-ancestor", bTip, "HEAD")
})

test("input capture survives source edits and uncertain workspace creation without duplicates", () => {
 const f = fixture(), file = join(f.directory, "record.json")
 writeFileSync(join(f.source, "a.txt"), "approved\n")
 f.plan.inputs = [{ repository: ".", paths: ["a.txt"] }]
 const state = captureGraphWorkspaces(f.source, f.plan), repo = state.repositories[0]
 repo.preparation = f.repo.preparation
 saveGraphRecord(file, state); writeFileSync(join(f.source, "a.txt"), "later\n")
 const resumed = readGraphRecord(file), selected = resumed.repositories[0], persist = () => saveGraphRecord(file, resumed)
 createGraphWorkspace(selected, selected.workspace!, f.orca, persist); importGraphInputs(selected, persist)
 createGraphWorkspace(selected, selected.workspace!, f.orca, persist); importGraphInputs(selected, persist)
 assert.equal(f.items.length, 1)
 assert.equal(readFileSync(join(selected.workspace!.path!, "a.txt"), "utf8"), "approved\n")
 assert.equal(readFileSync(join(f.source, "a.txt"), "utf8"), "later\n")
})

test("capture recovery rejects unrelated committed paths", () => {
 const f = fixture(); writeFileSync(join(f.source, "a.txt"), "approved\n"); f.plan.inputs = [{ repository: ".", paths: ["a.txt"] }]
 const state = captureGraphWorkspaces(f.source, f.plan), repo = state.repositories[0]; repo.preparation = f.repo.preparation
 createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
 writeFileSync(join(repo.workspace!.path!, "a.txt"), "approved\n"); writeFileSync(join(repo.workspace!.path!, "b.txt"), "unrelated\n")
 graphGit(repo.workspace!.path!, "add", "--", "a.txt", "b.txt"); graphGit(repo.workspace!.path!, "commit", "-m", "interrupted capture")
 assert.throws(() => importGraphInputs(repo, () => {}), /Unexpected capture history/)
})

test("task completion requires its named plan closeout", () => {
 const f = fixture(), repo = f.state.repositories[0]; createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
 f.state.plans = [{ id: "a", source: f.source, filename: "plan.md" }]
 const directory = join(repo.workspace!.path!, "docs/exec-plans/active"); mkdirSync(directory, { recursive: true })
 const file = join(directory, "plan.md"); writeFileSync(file, "## Metadata\n- Plan-ID: a\n- Security-Approval: approved\n- Status: validation\n- Done-Evidence: focused tests passed\n")
 assert.throws(() => verifyPlanTaskCloseout(f.state, "a"), /incomplete closeout/)
 assert.doesNotThrow(() => verifyPlanTaskCloseout(f.state, "a", true))
 const completed = join(repo.workspace!.path!, "docs/exec-plans/completed/plan.md"); mkdirSync(join(completed, ".."), { recursive: true }); renameSync(file, completed)
 writeFileSync(completed, "## Metadata\n- Plan-ID: a\n- Security-Approval: approved\n- Status: completed\n- Done-Evidence: focused tests passed\n")
 assert.doesNotThrow(() => verifyPlanTaskCloseout(f.state, "a"))
})

test("unsafe paths and old records are rejected without changing retained evidence", () => {
 const f = fixture(); symlinkSync(join(f.source, "a.txt"), join(f.source, "link")); assert.throws(() => graphFile(f.source, "link"), /symlink/)
 const file = join(f.directory, "legacy.json")
 saveGraphRecord(file, f.state); assert.equal(readGraphAdmission(file, ["unrelated"], f.state.root)?.key, f.state.key, "launch root resumes a cross-repository graph")
 writeFileSync(file, JSON.stringify({ version: 4, root: f.state.root, completion: { evidence: "done" }, repositories: [{ source: "/missing" }] })); assert.equal(readGraphAdmission(file, [repositoryIdentity(f.source)], f.state.root), undefined)
 const bytes = JSON.stringify({ version: 3, workers: [{ terminal: "live" }] })
 writeFileSync(file, bytes); assert.throws(() => readGraphRecord(file), /older contract/); assert.equal(readFileSync(file, "utf8"), bytes)
 assert.equal(readGraphAdmission(file, [repositoryIdentity(f.source)]), undefined, "an unrelated historical record does not block admission")
 const relevant = JSON.stringify({ version: 3, repositories: [{ identity: repositoryIdentity(f.source) }], completed: {} })
 writeFileSync(file, relevant); assert.throws(() => readGraphAdmission(file, [repositoryIdentity(f.source)]), /unfinished historical graph/)
 writeFileSync(file, JSON.stringify({ ...JSON.parse(relevant), completion: { evidence: "done" } })); assert.equal(readGraphAdmission(file, [repositoryIdentity(f.source)]), undefined)
})
