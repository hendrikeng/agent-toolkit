import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { deliverGraph, prepareGraphDelivery, readGraphDeliveryReceipt } from "../delivery.ts"
import { digest, graphGit, type Orca, type TaskGraphPlan } from "../task-graph-core.ts"
import { captureGraphWorkspaces, createGraphWorkspace, saveGraphRecord, verifyGraphWorkspace } from "../workspaces.ts"

function fixture() {
 const directory = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "graph-delivery-"))), home = join(directory, "home"), source = join(home, "Code/source"), records = join(directory, "records")
 mkdirSync(join(home, "orca/workspaces"), { recursive: true }); mkdirSync(records); process.env.HOME = home
 Object.assign(process.env, { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" })
 execFileSync("git", ["init", "--quiet", "--initial-branch=main", source])
 writeFileSync(join(source, "file.txt"), "base\n"); graphGit(source, "add", "--", "file.txt"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD"), items: any[] = [], configuration = { repo: { id: "repo", setup: [] } }
 const orca: Orca = args => {
  const value = (key: string) => args[args.indexOf(key) + 1]
  if (args[0] === "repo" && args[1] === "list") return { result: { repos: [{ id: "repo", path: source }] } }
  if (args[0] === "repo" && args[1] === "show") return { result: configuration }
  if (args[0] === "worktree" && args[1] === "list") return { result: { worktrees: items } }
  if (args[0] === "terminal" && args[1] === "list") return { result: { terminals: [] } }
  if (args[0] === "worktree" && args[1] === "rm") {
   const item = items.find(item => item.id === value("--worktree").slice(3)); renameSync(item.path, `${item.path}.removed`); items.splice(items.indexOf(item), 1); return { result: {} }
  }
  assert.deepEqual(args.slice(0, 2), ["worktree", "create"])
  const path = join(home, "orca/workspaces", value("--name")); graphGit(source, "worktree", "add", "--quiet", "-b", value("--name"), path, value("--base-branch"))
  const item = { id: `repo::${path}`, path, displayName: value("--name"), branch: `refs/heads/${value("--name")}` }; items.push(item); return { result: { worktree: item } }
 }
 const plan: TaskGraphPlan = { objective: "Delivery fixture", mode: "execute", worktree_budget: 2, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "write", goal: "write", repository: ".", depends_on: [], owns: ["file.txt"], done_when: ["done"], validation: "node check.cjs" }] }
 const make = (runId: string, name: string, parent?: string) => {
  const record = captureGraphWorkspaces(source, plan), repo = record.repositories[0]; repo.preparation = { configuration, hash: digest(JSON.stringify(configuration)) }; createGraphWorkspace(repo, repo.workspace!, orca, () => {})
  if (parent) graphGit(repo.workspace!.path!, "merge", "--ff-only", parent)
  writeFileSync(join(repo.workspace!.path!, "file.txt"), `${name}\n`); graphGit(repo.workspace!.path!, "add", "--", "file.txt"); graphGit(repo.workspace!.path!, "commit", "-m", name)
  const head = verifyGraphWorkspace(repo); record.runId = runId; record.completed.write = { head, integrationHead: head, evidence: "done" }; record.completion = { evidence: "done", deliveryPending: false }
  const file = join(records, `${name}.json`); saveGraphRecord(file, record); return { record, repo, file, head }
 }
 return { directory, source, records, items, orca, make }
}

test("delivery fast-forwards locally and resumes Orca cleanup after interruption", () => {
 const f = fixture(), predecessor = f.make("run_predecessor", "predecessor")
 const current = f.make("run_current", "current", predecessor.head), final = current.head
 const receiptFile = join(f.directory, "delivery.json"), approved = prepareGraphDelivery(current.file, f.records)
 assert.deepEqual(new Set(approved.cleanup.map(item => item.runId)), new Set(["run_current", "run_predecessor"]))
 let interrupted = false
 const interrupting: Orca = args => {
  const result = f.orca(args)
  if (!interrupted && args[0] === "worktree" && args[1] === "rm") { interrupted = true; throw new Error("interrupted") }
  return result
 }
 assert.throws(() => deliverGraph(receiptFile, approved, interrupting), /interrupted/)
 assert.equal(graphGit(f.source, "rev-parse", "HEAD"), final)
 assert.equal(readGraphDeliveryReceipt(receiptFile).cleanup.some(item => item.status === "removing"), true)
 const delivered = deliverGraph(receiptFile, undefined, f.orca)
 assert.equal(delivered.status, "delivered"); assert.ok(delivered.cleanup.every(item => item.status === "removed")); assert.equal(f.items.length, 0)
 assert.equal(deliverGraph(receiptFile, undefined, f.orca).completedAt, delivered.completedAt)
 assert.equal(JSON.parse(readFileSync(current.file, "utf8")).completion.evidence, "done")
 assert.equal(JSON.parse(readFileSync(predecessor.file, "utf8")).completion.evidence, "done")
})

test("delivery preserves a predecessor workspace referenced by an active Run", () => {
 const f = fixture(), predecessor = f.make("run_predecessor", "predecessor"), current = f.make("run_current", "current", predecessor.head), active = f.make("run_active", "active", current.head)
 active.record.root = predecessor.repo.workspace!.path!; active.record.plan.foundations[0].repository = f.source; active.record.plan.tasks[0].repository = f.source; active.record.completed = {}; delete active.record.completion; saveGraphRecord(active.file, active.record)
 const approved = prepareGraphDelivery(current.file, f.records)
 assert.equal(approved.cleanup.some(item => item.runId === predecessor.record.runId), false)
 assert.match(approved.retained.find(item => item.runId === predecessor.record.runId)!.reason, /Another Run/)
 assert.equal(existsSync(predecessor.repo.workspace!.path!), true)
})

test("delivery rechecks active workspace references after approval", () => {
 const f = fixture(), predecessor = f.make("run_predecessor", "predecessor"), current = f.make("run_current", "current", predecessor.head)
 const receiptFile = join(f.directory, "delivery.json"), approved = prepareGraphDelivery(current.file, f.records), active = f.make("run_active", "active", current.head), sourceHead = graphGit(f.source, "rev-parse", "HEAD")
 active.record.root = predecessor.repo.workspace!.path!; active.record.plan.foundations[0].repository = f.source; active.record.plan.tasks[0].repository = f.source; active.record.completed = {}; delete active.record.completion; saveGraphRecord(active.file, active.record)
 assert.throws(() => deliverGraph(receiptFile, approved, f.orca), /Another Run now requires/)
 assert.equal(graphGit(f.source, "rev-parse", "HEAD"), sourceHead); assert.equal(existsSync(predecessor.repo.workspace!.path!), true)
})

test("delivery rechecks pending-delivery workspace references after approval", () => {
 const f = fixture(), predecessor = f.make("run_predecessor", "predecessor"), current = f.make("run_current", "current", predecessor.head)
 const receiptFile = join(f.directory, "delivery.json"), approved = prepareGraphDelivery(current.file, f.records), pending = f.make("run_pending", "pending", current.head)
 pending.record.root = predecessor.repo.workspace!.path!; pending.record.completion!.deliveryPending = true; saveGraphRecord(pending.file, pending.record)
 assert.throws(() => deliverGraph(receiptFile, approved, f.orca), /Another Run now requires/)
 assert.equal(existsSync(predecessor.repo.workspace!.path!), true)
})

test("delivery preserves cleanup workspaces when graph evidence is unreadable", () => {
 const before = fixture(), predecessor = before.make("run_predecessor", "predecessor"), current = before.make("run_current", "current", predecessor.head)
 writeFileSync(join(before.records, "broken.json"), "{")
 const prepared = prepareGraphDelivery(current.file, before.records)
 assert.equal(prepared.cleanup.some(item => item.runId === predecessor.record.runId), false)
 assert.match(prepared.retained.find(item => item.runId === predecessor.record.runId)!.reason, /unreadable or uncertain/)

 const after = fixture(), earlier = after.make("run_earlier", "earlier"), latest = after.make("run_latest", "latest", earlier.head)
 const receiptFile = join(after.directory, "delivery.json"), approved = prepareGraphDelivery(latest.file, after.records)
 writeFileSync(join(after.records, "broken.json"), "{")
 assert.throws(() => deliverGraph(receiptFile, approved, after.orca))
 assert.equal(existsSync(earlier.repo.workspace!.path!), true)
})

test("delivery preserves a predecessor workspace changed after approval", () => {
 const f = fixture(), predecessor = f.make("run_predecessor", "predecessor"), current = f.make("run_current", "current", predecessor.head)
 const receiptFile = join(f.directory, "delivery.json"), approved = prepareGraphDelivery(current.file, f.records)
 graphGit(predecessor.repo.workspace!.path!, "merge", "--ff-only", current.head)
 assert.throws(() => deliverGraph(receiptFile, approved, f.orca), /advanced after approval/)
 assert.equal(existsSync(predecessor.repo.workspace!.path!), true)
})

test("delivery rejects integration commits added after Run completion", () => {
 const f = fixture(), current = f.make("run_current", "current")
 writeFileSync(join(current.repo.workspace!.path!, "later.txt"), "later\n")
 graphGit(current.repo.workspace!.path!, "add", "--", "later.txt"); graphGit(current.repo.workspace!.path!, "commit", "-m", "later")
 assert.throws(() => prepareGraphDelivery(current.file, f.records), /advanced beyond the completed Run/)
})

test("delivery fails closed for a dirty target checkout", () => {
 const f = fixture(), current = f.make("run_current", "current")
 writeFileSync(join(f.source, "local.txt"), "keep\n")
 assert.throws(() => prepareGraphDelivery(current.file, f.records), /dirty or unsettled/)
 assert.equal(readFileSync(join(f.source, "local.txt"), "utf8"), "keep\n")
})

test("delivery rejects a receipt changed after approval", () => {
 const f = fixture(), current = f.make("run_current", "current")
 const approved = prepareGraphDelivery(current.file, f.records), receiptFile = join(f.directory, "delivery.json")
 saveGraphRecord(receiptFile, { ...approved, retained: [{ runId: "run_other", record: "/changed", reason: "changed" }] })
 assert.throws(() => readGraphDeliveryReceipt(receiptFile, "run_other"), /Invalid graph delivery receipt/)
 assert.throws(() => deliverGraph(receiptFile, approved, f.orca), /changed after approval/)
 assert.notEqual(graphGit(f.source, "rev-parse", "HEAD"), current.head)
})
