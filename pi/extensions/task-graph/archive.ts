import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { acquireLease, digest, graphLeaseState, saveRecord } from "./task-graph-core.ts"
import { graphDeliveryInventory, validateRetainedGraphRecord } from "./workspaces.ts"

export interface GraphArchiveReceipt {
 version: 1
 status: "authorized-pending" | "archived"
 runId: string
 source: string
 record: string
 recordHash: string
 archivedAt: string
 preserved: string[]
 deliveryPendingAbandoned?: true
}

const preserved = ["graph-record", "sidecars", "orchestration-evidence", "commits", "worktrees", "branches", "resources"]

function exactDigest(path: string): string {
 const stat = lstatSync(path)
 if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Graph archive evidence identity is uncertain. Preserve it for inspection.")
 return digest(readFileSync(path))
}

function assertDirectory(path: string): void {
 const stat = lstatSync(path)
 if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) throw new Error("Graph archive identity is uncertain. Preserve it for inspection.")
}

function ensureArchiveRoot(path: string): void {
 const parent = dirname(path); mkdirSync(parent, { recursive: true, mode: 0o700 }); assertDirectory(parent)
 mkdirSync(path, { recursive: true, mode: 0o700 }); assertDirectory(path)
}

function assertNoPendingDelivery(file: string, runId: string): void {
 const inventory = graphDeliveryInventory(dirname(dirname(file))), related = inventory.receipts.filter(item => item.receipt.runId === runId || item.receipt.cleanup.some((cleanup: any) => cleanup.runId === runId || resolve(cleanup.record) === file))
 if (inventory.uncertain || related.some(item => item.receipt.status === "authorized-pending" || item.receipt.runId === runId && resolve(item.receipt.record) !== file)) throw new Error(`Run ${runId} has an unfinished or uncertain delivery.`)
}

function moveSidecars(file: string, directory: string): void {
 const evidence = join(directory, "sidecars"); ensureArchiveRoot(evidence)
 for (const entry of readdirSync(dirname(file)).filter(entry => entry.startsWith(`${basename(file)}.`))) {
  const source = join(dirname(file), entry), target = join(evidence, entry), stat = lstatSync(source)
  if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1) throw new Error("Graph sidecar identity is uncertain. Preserve it for inspection.")
  if (existsSync(target)) throw new Error("Archived graph sidecar already exists. Preserve both for inspection.")
  renameSync(source, target)
 }
}

function header(file: string): { saved: any; bytes: Buffer } {
 const stat = lstatSync(file)
 if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Graph record identity is uncertain. Preserve it for inspection.")
 const bytes = readFileSync(file), parsed = JSON.parse(bytes.toString("utf8"))
 if (parsed.version !== 4) throw new Error("Archive only a completed current-v4 graph.")
 const saved = validateRetainedGraphRecord(parsed, file)
 if (!/^run_[a-zA-Z0-9_-]+$/.test(saved.runId ?? "") || !saved.completion || saved.plan.tasks.some(task => !saved.completed[task.id])) throw new Error("Archive only a completed current-v4 graph.")
 return { saved, bytes }
}

export function inspectGraphArchive(file: string): { eligible: boolean; runId?: string; objective?: string; recordHash?: string; deliveryPending?: boolean; blocker?: string } {
 try {
  const { saved, bytes } = header(file), lease = graphLeaseState(file)
  if (lease !== "available") return { eligible: false, runId: saved.runId, objective: saved.plan.objective, blocker: lease === "live" ? "The graph has a live coordinator." : "The graph lease is uncertain." }
  return { eligible: true, runId: saved.runId, objective: saved.plan.objective, recordHash: digest(bytes), deliveryPending: saved.completion.deliveryPending === true }
 } catch (error) { return { eligible: false, blocker: error instanceof Error ? error.message : String(error) } }
}

export function archiveCompletedGraph(file: string, archiveDirectory: string, verify?: (record: any) => void, expectedHash?: string, abandonPendingDelivery = false): GraphArchiveReceipt {
 file = resolve(file); assertDirectory(dirname(file)); archiveDirectory = resolve(archiveDirectory); ensureArchiveRoot(archiveDirectory)
 const name = basename(file, ".json"), directory = join(archiveDirectory, name), target = join(directory, "record.json"), receiptFile = join(directory, "archive.json")
 if (existsSync(directory)) assertDirectory(directory)
 if (existsSync(receiptFile)) {
  const receiptStat = lstatSync(receiptFile)
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.nlink !== 1) throw new Error("Graph archive receipt identity is uncertain. Preserve it for inspection.")
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as GraphArchiveReceipt
  if (receipt.version !== 1 || !["authorized-pending", "archived"].includes(receipt.status) || receipt.source !== file || receipt.record !== target || !/^run_[a-zA-Z0-9_-]+$/.test(receipt.runId) || !/^[a-f0-9]{64}$/.test(receipt.recordHash) || expectedHash && receipt.recordHash !== expectedHash || JSON.stringify(receipt.preserved) !== JSON.stringify(preserved) || receipt.deliveryPendingAbandoned && receipt.deliveryPendingAbandoned !== true) throw new Error("Graph archive receipt is invalid. Preserve it for inspection.")
  if (receipt.status === "archived") {
   if (existsSync(file) || !existsSync(target) || exactDigest(target) !== receipt.recordHash) throw new Error("Archived graph evidence changed. Preserve it for inspection.")
   moveSidecars(file, directory); return receipt
  }
  if (existsSync(file) && exactDigest(file) !== receipt.recordHash) throw new Error("Pending graph archive source changed. Preserve it for inspection.")
  if (existsSync(file) && !existsSync(target)) {
   const release = acquireLease(file)
   try {
    const { saved, bytes } = header(file); assertNoPendingDelivery(file, saved.runId); verify?.(saved)
    if (saved.runId !== receipt.runId || digest(bytes) !== receipt.recordHash || (saved.completion.deliveryPending === true) !== (receipt.deliveryPendingAbandoned === true)) throw new Error("Pending graph archive no longer matches its record.")
    renameSync(file, target)
   } finally { release() }
   moveSidecars(file, directory); const completed = { ...receipt, status: "archived" as const }; saveRecord(receiptFile, completed); return completed
  }
  if (!existsSync(file) && existsSync(target) && exactDigest(target) === receipt.recordHash) {
   const { saved, bytes } = header(target); assertNoPendingDelivery(file, saved.runId); verify?.(saved)
   if (saved.runId !== receipt.runId || digest(bytes) !== receipt.recordHash || (saved.completion.deliveryPending === true) !== (receipt.deliveryPendingAbandoned === true)) throw new Error("Pending graph archive no longer matches its record.")
   moveSidecars(file, directory); const completed = { ...receipt, status: "archived" as const }; saveRecord(receiptFile, completed); return completed
  }
 }
 if (!existsSync(file) || existsSync(target)) throw new Error("Graph archive state is uncertain. Preserve it for inspection.")
 const release = acquireLease(file)
 let result: GraphArchiveReceipt
 try {
  const { saved, bytes } = header(file); assertNoPendingDelivery(file, saved.runId)
  if (saved.completion.deliveryPending === true && !abandonPendingDelivery) throw new Error(`Run ${saved.runId} still has pending delivery work.`)
  verify?.(saved)
  const recordHash = digest(bytes); if (expectedHash && recordHash !== expectedHash) throw new Error("Graph record changed after archive approval. Preserve it for inspection.")
  if (existsSync(directory) && readdirSync(directory).length) throw new Error("Graph archive destination is not empty. Preserve it for inspection.")
  ensureArchiveRoot(directory)
  const pending: GraphArchiveReceipt = { version: 1, status: "authorized-pending", runId: saved.runId, source: file, record: target, recordHash, archivedAt: new Date().toISOString(), preserved, ...(saved.completion.deliveryPending === true ? { deliveryPendingAbandoned: true as const } : {}) }
  saveRecord(receiptFile, pending); renameSync(file, target); result = pending
 } finally { release() }
 moveSidecars(file, directory); result = { ...result!, status: "archived" }; saveRecord(receiptFile, result)
 return result
}
