import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { archiveCompletedGraph, inspectGraphArchive, inspectGraphArchivePurge, purgeGraphArchive } from "../archive.ts"
import { acquireLease, digest, graphGit } from "../task-graph-core.ts"
import { captureGraphWorkspaces } from "../workspaces.ts"

function fixture() {
 const root = mkdtempSync(join(tmpdir(), "graph-archive-")), agent = join(root, "agent"), records = join(agent, "task-graphs"), archive = join(agent, "task-graphs-archived/v1"), source = join(root, "source"); mkdirSync(records, { recursive: true })
 const env = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }; Object.assign(process.env, env); execFileSync("git", ["init", "--quiet", "--initial-branch=main", source], { env }); writeFileSync(join(source, "file.txt"), "fixture\n"); graphGit(source, "add", "--", "file.txt"); graphGit(source, "commit", "-m", "base")
 const base = graphGit(source, "rev-parse", "HEAD"), record: any = captureGraphWorkspaces(source, { objective: "Archive fixture", mode: "plan-only", worktree_budget: 1, foundations: [{ repository: ".", commit: base }], tasks: [{ id: "done", goal: "inspect", repository: ".", depends_on: [], owns: [], done_when: ["done"], validation: "manual: inspected" }] }); record.runId = "run_archive"; record.completed.done = { head: base, integrationHead: base, evidence: "done" }; record.completion = { evidence: "done", deliveryPending: false }
 const file = join(records, "record.json")
 writeFileSync(file, JSON.stringify(record)); writeFileSync(`${file}.receipt`, "sidecar")
 return { root, records, archive, file, record }
}

test("completed graph archive preserves exact record and sidecars and resumes idempotently", () => {
 const f = fixture(), bytes = readFileSync(f.file)
 assert.equal(inspectGraphArchive(f.file).eligible, true)
 const result = archiveCompletedGraph(f.file, f.archive)
 assert.equal(result.status, "archived"); assert.equal(result.recordHash, digest(bytes)); assert.equal(existsSync(f.file), false)
 assert.deepEqual(readFileSync(result.record), bytes); assert.equal(readFileSync(join(f.archive, "record/sidecars/record.json.receipt"), "utf8"), "sidecar")
 assert.deepEqual(archiveCompletedGraph(f.file, f.archive), result)
})

test("archive validates a completed record whose historical source worktree is absent", () => {
 const f = fixture(), missing = join(f.root, "missing-worktree"); f.record.root = missing; f.record.repositories[0].source = missing; f.record.plan.tasks[0].repository = missing; f.record.plan.foundations[0].repository = missing; writeFileSync(f.file, JSON.stringify(f.record))
 assert.equal(archiveCompletedGraph(f.file, f.archive).status, "archived")
})

test("archive resumes after authorization was saved before the record move", () => {
 const f = fixture(), directory = join(f.archive, "record"), target = join(directory, "record.json"), bytes = readFileSync(f.file); mkdirSync(directory, { recursive: true })
 writeFileSync(join(directory, "archive.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_archive", source: f.file, record: target, recordHash: digest(bytes), archivedAt: new Date().toISOString(), preserved: ["graph-record", "sidecars", "orchestration-evidence", "commits", "worktrees", "branches", "resources"] }))
 const result = archiveCompletedGraph(f.file, f.archive); assert.equal(result.status, "archived"); assert.deepEqual(readFileSync(target), bytes)
})

test("a verified 90-day archive purge is explicit, idempotent, and interruption-safe", () => {
 const f = fixture(), archived = archiveCompletedGraph(f.file, f.archive), directory = join(f.archive, "record"), purges = join(f.root, "agent/task-graph-purges/v1"), now = Date.parse("2026-06-01T00:00:00.000Z"), archivedAt = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
 writeFileSync(join(directory, "archive.json"), JSON.stringify({ ...archived, archivedAt }))
 assert.equal(inspectGraphArchivePurge(directory, purges, now - 1).eligible, false)
 const inspection = inspectGraphArchivePurge(directory, purges, now); assert.equal(inspection.eligible, true)
 const backup = join(f.root, "backup"); cpSync(directory, backup, { recursive: true })
 const result = purgeGraphArchive(directory, purges, inspection.archiveHash, now)
 assert.equal(result.status, "purged"); assert.equal(existsSync(directory), false); assert.equal(existsSync(result.staging), false); assert.deepEqual(purgeGraphArchive(directory, purges, result.archiveHash, now), result)
 writeFileSync(join(purges, "record.json"), JSON.stringify({ ...result, status: "authorized-pending", purgedAt: undefined })); cpSync(backup, result.staging, { recursive: true }); unlinkSync(join(result.staging, "sidecars/record.json.receipt"))
 assert.throws(() => purgeGraphArchive(directory, purges, result.archiveHash, now), /evidence changed/)
 writeFileSync(join(purges, "record.json"), JSON.stringify({ ...result, status: "removing", purgedAt: undefined }))
 assert.equal(purgeGraphArchive(directory, purges, result.archiveHash, now).status, "purged")
 writeFileSync(join(purges, "record.json"), JSON.stringify({ ...result, status: "removing", purgedAt: undefined }))
 assert.equal(purgeGraphArchive(directory, purges, result.archiveHash, now).status, "purged")
 cpSync(backup, directory, { recursive: true }); assert.match(inspectGraphArchivePurge(directory, purges, now).blocker!, /reappeared/)
})

test("archive purge rejects changed or linked evidence", () => {
 const changed = fixture(), archived = archiveCompletedGraph(changed.file, changed.archive), directory = join(changed.archive, "record"), now = Date.parse("2026-06-01T00:00:00.000Z"); writeFileSync(join(directory, "archive.json"), JSON.stringify({ ...archived, archivedAt: "2026-01-01T00:00:00.000Z" }))
 const purges = join(changed.root, "agent/task-graph-purges/v1"), inspection = inspectGraphArchivePurge(directory, purges, now); writeFileSync(join(directory, "extra"), "changed")
 assert.throws(() => purgeGraphArchive(directory, purges, inspection.archiveHash, now), /changed after purge approval/)
 const linked = fixture(), linkedArchive = archiveCompletedGraph(linked.file, linked.archive), linkedDirectory = join(linked.archive, "record"), outside = join(linked.root, "outside-purges"); writeFileSync(join(linkedDirectory, "archive.json"), JSON.stringify({ ...linkedArchive, archivedAt: "2026-01-01T00:00:00.000Z" })); mkdirSync(outside); symlinkSync(outside, join(linked.root, "agent/task-graph-purges"))
 assert.throws(() => purgeGraphArchive(linkedDirectory, join(linked.root, "agent/task-graph-purges/v1"), undefined, now), /archive identity is uncertain/)
})

test("archive rejects incomplete, legacy, and live graph records", () => {
 const incomplete = fixture(); delete (incomplete.record as any).completion; writeFileSync(incomplete.file, JSON.stringify(incomplete.record)); assert.equal(inspectGraphArchive(incomplete.file).eligible, false)
 const legacy = fixture(); legacy.record.version = 2; legacy.record.repositories[0].source = join(legacy.root, "missing-legacy-source"); writeFileSync(legacy.file, JSON.stringify(legacy.record)); assert.equal(inspectGraphArchive(legacy.file).eligible, false)
 const malformed = fixture(); writeFileSync(malformed.file, JSON.stringify({ version: 4, key: malformed.record.key, runId: "run_archive", plan: malformed.record.plan, completed: malformed.record.completed, completion: malformed.record.completion })); assert.equal(inspectGraphArchive(malformed.file).eligible, false)
 const ambiguousRoot = fixture(); ambiguousRoot.record.root = join(ambiguousRoot.root, "missing-root"); ambiguousRoot.record.plan.tasks[0].repository = "."; ambiguousRoot.record.plan.foundations[0].repository = "."; writeFileSync(ambiguousRoot.file, JSON.stringify(ambiguousRoot.record)); assert.equal(inspectGraphArchive(ambiguousRoot.file).eligible, false)
 const changed = fixture(); assert.throws(() => archiveCompletedGraph(changed.file, changed.archive, undefined, "0".repeat(64)), /changed after archive approval/); assert.equal(existsSync(join(changed.archive, "record")), false)
 const pending = fixture(), deliveries = join(pending.root, "agent/task-graph-deliveries/v1"); mkdirSync(deliveries, { recursive: true }); writeFileSync(join(deliveries, "run_archive.json"), JSON.stringify({ version: 1, status: "authorized-pending", runId: "run_archive" })); assert.throws(() => archiveCompletedGraph(pending.file, pending.archive), /unfinished or uncertain delivery/)
 const malformedDelivery = fixture(), malformedDeliveries = join(malformedDelivery.root, "agent/task-graph-deliveries/v1"); mkdirSync(malformedDeliveries, { recursive: true }); writeFileSync(join(malformedDeliveries, "run_archive.json"), JSON.stringify({ version: 1, status: "delivered", runId: "run_archive" })); assert.throws(() => archiveCompletedGraph(malformedDelivery.file, malformedDelivery.archive), /unfinished or uncertain delivery/)
 const blockedDeliveries = fixture(); writeFileSync(join(blockedDeliveries.root, "agent/task-graph-deliveries"), "not a directory"); assert.throws(() => archiveCompletedGraph(blockedDeliveries.file, blockedDeliveries.archive), /unfinished or uncertain delivery/)
 const abandoned = fixture(); abandoned.record.completion.deliveryPending = true; writeFileSync(abandoned.file, JSON.stringify(abandoned.record)); assert.throws(() => archiveCompletedGraph(abandoned.file, abandoned.archive), /still has pending delivery work/); assert.equal(archiveCompletedGraph(abandoned.file, abandoned.archive, undefined, undefined, true).deliveryPendingAbandoned, true)
 const linked = fixture(), external = join(linked.root, "external"); mkdirSync(external); symlinkSync(external, join(linked.root, "agent/task-graphs-archived")); assert.throws(() => archiveCompletedGraph(linked.file, linked.archive), /archive identity is uncertain/)
 const linkedSource = fixture(), alias = join(linkedSource.root, "linked-records"); symlinkSync(linkedSource.records, alias); assert.throws(() => archiveCompletedGraph(join(alias, "record.json"), linkedSource.archive), /archive identity is uncertain/)
 const live = fixture(), release = acquireLease(live.file)
 try { assert.equal(inspectGraphArchive(live.file).eligible, false) } finally { release() }
})
