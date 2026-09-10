import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphFile, graphGit, importGraphInputs, readGraphRecord, saveGraphRecord, verifyGraphChanges } from "../workspaces.ts"
import { validateTaskGraph, type TaskGraphPlan } from "../task-graph-core.ts"

function fixture() {
 const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || join(homedir(), "Code/.agent-toolkit-scratch")
 mkdirSync(scratch, { recursive: true, mode: 0o700 })
 const directory = realpathSync(mkdtempSync(join(scratch, "graph-workspaces-"))), source = join(directory, "source")
 const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" }
 Object.assign(process.env, env)
 execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source], { env })
 mkdirSync(join(source, "docs/future"), { recursive: true })
 writeFileSync(join(source, "file.txt"), "base\n")
 writeFileSync(join(source, "other.txt"), "preserved\n")
 graphGit(source, "add", "--", "file.txt", "other.txt"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD")
 const plan: TaskGraphPlan = { objective: "Fixture", mode: "execute", foundations: [{ repository: ".", commit: base }], tasks: [{ id: "a", goal: "a", repository: ".", depends_on: [], owns: ["file.txt"], done_when: ["checked"], validation: "node check.cjs" }] }
 const items: any[] = []
 const orca = (args: string[]) => {
  const value = (key: string) => args[args.indexOf(key) + 1]
  if (args[0] === "repo") return { result: { repos: [{ id: "repo", path: source }] } }
  if (args[1] === "list") return { result: { worktrees: items } }
  assert.equal(args[1], "create")
  const path = join(directory, value("--name"))
  graphGit(source, "worktree", "add", "--quiet", "-b", value("--name"), path, value("--base-branch"))
  const item = { id: `repo::${path}`, path, displayName: value("--name"), branch: `refs/heads/${value("--name")}` }
  items.push(item); return { result: { worktree: item } }
 }
 return { directory, source, base, plan, orca, items }
}
test("one workspace per writing repository; read-only inspection creates none; dirty inspection needs only one snapshot", () => {
 const f = fixture()
 const state = captureGraphWorkspaces(f.source, f.plan)
 assert.equal(state.repositories.length, 1); assert.equal(state.repositories[0].workspace?.role, "execution")
 f.plan.tasks.push({ ...f.plan.tasks[0], id: "b", depends_on: ["a"] })
 assert.equal(captureGraphWorkspaces(f.source, f.plan).repositories.length, 1)
 f.plan.mode = "plan-only"; f.plan.tasks.forEach(task => { task.owns = []; task.validation = "manual: inspect the selected files" })
 assert.equal(captureGraphWorkspaces(f.source, f.plan).repositories[0].workspace, undefined)
 writeFileSync(join(f.source, "file.txt"), "approved snapshot\n")
 f.plan.inputs = [{ repository: ".", paths: ["file.txt"] }]
 assert.equal(captureGraphWorkspaces(f.source, f.plan).repositories[0].workspace?.role, "snapshot")
})
test("capture retains immutable approved bytes before any RPC, across later source edits and interrupted commits", () => {
 const f = fixture()
 writeFileSync(join(f.source, "file.txt"), "approved\n")
 f.plan.inputs = [{ repository: ".", paths: ["file.txt"] }]
 const index = readFileSync(join(f.source, ".git/index"))
 const state = captureGraphWorkspaces(f.source, f.plan), file = join(f.directory, "record.json")
 saveGraphRecord(file, state)
 writeFileSync(join(f.source, "file.txt"), "later\n")
 const resumed = readGraphRecord(file), repo = resumed.repositories[0]
 const persist = () => saveGraphRecord(file, resumed)
 createGraphWorkspace(repo, f.orca, persist)
 const hook = join(f.source, ".git/hooks/pre-commit")
 writeFileSync(hook, "#!/bin/sh\nexit 7\n", { mode: 0o755 })
 assert.throws(() => importGraphInputs(repo, persist))
 assert.equal(repo.workspace?.captureCommit, undefined)
 writeFileSync(hook, "#!/bin/sh\nexit 0\n"); chmodSync(hook, 0o755)
 importGraphInputs(repo, persist)
 createGraphWorkspace(repo, f.orca, persist); importGraphInputs(repo, persist)
 assert.equal(f.items.length, 1)
 assert.equal(readFileSync(join(repo.workspace!.path!, "file.txt"), "utf8"), "approved\n")
 assert.equal(readFileSync(join(f.source, "file.txt"), "utf8"), "later\n")
 assert.equal(graphGit(f.source, "rev-parse", "HEAD"), f.base)
 assert.deepEqual(readFileSync(join(f.source, ".git/index")), index)
})
test("source/index preservation and scoped checkpoints reject unauthorized history even after a revert", () => {
 const f = fixture(), state = captureGraphWorkspaces(f.source, f.plan), repo = state.repositories[0]
 createGraphWorkspace(repo, f.orca, () => {}); importGraphInputs(repo, () => {})
 const root = repo.workspace!.path!, index = readFileSync(join(f.source, ".git/index"))
 writeFileSync(join(root, "file.txt"), "implemented\n")
 assert.throws(() => checkpointGraphChanges(repo, ["file.txt"], "execute", f.base, ["other.txt"], "bad"), /ownership/)
 checkpointGraphChanges(repo, ["file.txt"], "execute", f.base, ["file.txt"], "good")
 assert.deepEqual(readFileSync(join(f.source, ".git/index")), index)
 writeFileSync(join(root, "other.txt"), "outside\n")
 graphGit(root, "add", "--", "other.txt"); graphGit(root, "commit", "-m", "unapproved fixture commit")
 writeFileSync(join(root, "other.txt"), "preserved\n")
 graphGit(root, "add", "--", "other.txt"); graphGit(root, "commit", "-m", "undo fixture change")
 assert.throws(() => verifyGraphChanges(repo, ["file.txt"], "execute"), /ownership/)
})
test("symlink/nested repository paths and unsupported legacy records fail without modification", () => {
 const f = fixture()
 symlinkSync(join(f.source, "other.txt"), join(f.source, "link"))
 assert.throws(() => graphFile(f.source, "link"), /symlink/)
 mkdirSync(join(f.source, "nested/.git"), { recursive: true })
 assert.throws(() => graphFile(f.source, "nested/file"), /nested/)
 const file = join(f.directory, "legacy.json"), bytes = JSON.stringify({ version: 1, workers: [{ terminal: "live" }] })
 writeFileSync(file, bytes)
 assert.throws(() => readGraphRecord(file), /Unsupported legacy/)
 assert.equal(readFileSync(file, "utf8"), bytes)
})
test("explicit full foundations, ordered dependencies and removed options are enforced", () => {
 const f = fixture()
 for (const commit of ["dev", "HEAD", f.base.slice(0, 8), "--all"]) assert.throws(() => validateTaskGraph({ ...f.plan, foundations: [{ repository: ".", commit }] }, f.source), /Foundation/)
 for (const option of ["parallel_workers", "cleanup_workers", "current_checkout"]) assert.throws(() => validateTaskGraph({ ...f.plan, [option]: true }, f.source), /removed/)
 assert.throws(() => validateTaskGraph({ ...f.plan, tasks: [{ ...f.plan.tasks[0], depends_on: ["unknown"] }] }, f.source), /dependency order/)
 const state = captureGraphWorkspaces(f.source, f.plan)
 writeFileSync(join(f.source, "file.txt"), "new source\n"); graphGit(f.source, "add", "--", "file.txt"); graphGit(f.source, "commit", "-m", "later source")
 createGraphWorkspace(state.repositories[0], f.orca, () => {})
 assert.equal(graphGit(state.repositories[0].workspace!.path!, "rev-parse", "HEAD"), f.base)
})
