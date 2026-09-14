import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
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

export interface GraphArchivePurgeReceipt {
 version: 1
 status: "authorized-pending" | "removing" | "purged"
 runId: string
 archive: string
 staging: string
 archiveHash: string
 recordHash: string
 archivedAt: string
 retentionDays: 90
 entries: Array<{ path: string; type: "directory" | "file"; hash?: string }>
 purgedAt?: string
}

export const GRAPH_ARCHIVE_RETENTION_DAYS = 90
const retentionMs = GRAPH_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000
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

function evidenceManifest(root: string): GraphArchivePurgeReceipt["entries"] {
 assertDirectory(root)
 const entries: GraphArchivePurgeReceipt["entries"] = []
 const walk = (directory: string) => {
  for (const name of readdirSync(directory).sort()) {
   const path = join(directory, name), local = relative(root, path), stat = lstatSync(path)
   if (stat.isSymbolicLink()) throw new Error("Graph archive evidence identity is uncertain. Preserve it for inspection.")
   if (stat.isDirectory()) { if (realpathSync(path) !== resolve(path)) throw new Error("Graph archive evidence identity is uncertain. Preserve it for inspection."); entries.push({ path: local, type: "directory" }); walk(path) }
   else if (stat.isFile() && stat.nlink === 1) entries.push({ path: local, type: "file", hash: digest(readFileSync(path)) })
   else throw new Error("Graph archive evidence identity is uncertain. Preserve it for inspection.")
  }
 }
 walk(root)
 return entries
}

function archiveHash(entries: GraphArchivePurgeReceipt["entries"]): string { return digest(JSON.stringify(entries)) }

function removeEvidence(root: string, expected: GraphArchivePurgeReceipt["entries"]): void {
 const allowed = new Map(expected.map(entry => [`${entry.type}:${entry.path}`, entry.hash]))
 for (const entry of evidenceManifest(root)) if (!allowed.has(`${entry.type}:${entry.path}`) || entry.type === "file" && allowed.get(`file:${entry.path}`) !== entry.hash) throw new Error("Pending graph purge evidence changed. Preserve it for inspection.")
 const remove = (directory: string) => {
  for (const name of readdirSync(directory)) {
   const path = join(directory, name), stat = lstatSync(path)
   if (stat.isSymbolicLink()) throw new Error("Pending graph purge evidence changed. Preserve it for inspection.")
   if (stat.isDirectory()) { if (realpathSync(path) !== resolve(path)) throw new Error("Pending graph purge evidence changed. Preserve it for inspection."); remove(path); rmdirSync(path) }
   else if (stat.isFile() && stat.nlink === 1) unlinkSync(path)
   else throw new Error("Pending graph purge evidence changed. Preserve it for inspection.")
  }
 }
 remove(root); rmdirSync(root)
}

function purgeReceipt(path: string, archive: string, staging: string): GraphArchivePurgeReceipt {
 const stat = lstatSync(path)
 if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Graph purge receipt identity is uncertain. Preserve it for inspection.")
 const receipt = JSON.parse(readFileSync(path, "utf8")) as GraphArchivePurgeReceipt
 const paths = new Set<string>()
 const validEntries = Array.isArray(receipt.entries) && receipt.entries.every(entry => {
  if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.startsWith("/") || entry.path.split(/[\\/]/).includes("..") || paths.has(entry.path)) return false
  paths.add(entry.path); return entry.type === "directory" ? entry.hash === undefined : entry.type === "file" && /^[a-f0-9]{64}$/.test(entry.hash ?? "")
 })
 if (receipt.version !== 1 || !["authorized-pending", "removing", "purged"].includes(receipt.status) || receipt.archive !== archive || receipt.staging !== staging || !/^run_[a-zA-Z0-9_-]+$/.test(receipt.runId ?? "") || !/^[a-f0-9]{64}$/.test(receipt.archiveHash ?? "") || !/^[a-f0-9]{64}$/.test(receipt.recordHash ?? "") || receipt.retentionDays !== GRAPH_ARCHIVE_RETENTION_DAYS || !Number.isFinite(Date.parse(receipt.archivedAt)) || !validEntries || archiveHash(receipt.entries) !== receipt.archiveHash || receipt.status === "purged" && !Number.isFinite(Date.parse(receipt.purgedAt ?? ""))) throw new Error("Graph purge receipt is invalid. Preserve it for inspection.")
 return receipt
}

function archivedEvidence(directory: string): { receipt: GraphArchiveReceipt; entries: GraphArchivePurgeReceipt["entries"]; archiveHash: string } {
 directory = resolve(directory); assertDirectory(directory)
 const receiptPath = join(directory, "archive.json"), stat = lstatSync(receiptPath)
 if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Graph archive receipt identity is uncertain. Preserve it for inspection.")
 const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as GraphArchiveReceipt
 if (receipt.version !== 1 || receipt.status !== "archived" || receipt.record !== join(directory, "record.json") || basename(receipt.source, ".json") !== basename(directory) || !/^run_[a-zA-Z0-9_-]+$/.test(receipt.runId ?? "") || !/^[a-f0-9]{64}$/.test(receipt.recordHash ?? "") || JSON.stringify(receipt.preserved) !== JSON.stringify(preserved) || !Number.isFinite(Date.parse(receipt.archivedAt)) || existsSync(receipt.source) || exactDigest(receipt.record) !== receipt.recordHash) throw new Error("Graph archive is not verified for purge. Preserve it for inspection.")
 const sidecars = join(directory, "sidecars"); assertDirectory(sidecars)
 const entries = evidenceManifest(directory)
 return { receipt, entries, archiveHash: archiveHash(entries) }
}

export function inspectGraphArchivePurge(directory: string, purgeDirectory: string, now = Date.now()): { eligible: boolean; pending?: boolean; runId?: string; archiveHash?: string; archivedAt?: string; blocker?: string } {
 try {
  directory = resolve(directory); purgeDirectory = resolve(purgeDirectory)
  const name = basename(directory), receiptFile = join(purgeDirectory, `${name}.json`), staging = join(purgeDirectory, `${name}.pending`)
  if (existsSync(receiptFile)) {
   const receipt = purgeReceipt(receiptFile, directory, staging)
   const archivePresent = existsSync(directory), stagingPresent = existsSync(staging)
   if (receipt.status === "purged") {
    if (archivePresent || stagingPresent) throw new Error("Purged graph evidence reappeared. Preserve it for inspection.")
    return { eligible: false, runId: receipt.runId, archivedAt: receipt.archivedAt, blocker: "The graph archive is already purged." }
   }
   if (receipt.status === "removing" && !archivePresent && !stagingPresent) return { eligible: true, pending: true, runId: receipt.runId, archiveHash: receipt.archiveHash, archivedAt: receipt.archivedAt }
   if (archivePresent === stagingPresent) throw new Error("Pending graph purge location is uncertain. Preserve it for inspection.")
   return { eligible: true, pending: true, runId: receipt.runId, archiveHash: receipt.archiveHash, archivedAt: receipt.archivedAt }
  }
  const evidence = archivedEvidence(directory), archivedAt = Date.parse(evidence.receipt.archivedAt)
  if (archivedAt > now || now - archivedAt < retentionMs) return { eligible: false, runId: evidence.receipt.runId, archivedAt: evidence.receipt.archivedAt, blocker: `The graph archive is less than ${GRAPH_ARCHIVE_RETENTION_DAYS} days old.` }
  return { eligible: true, runId: evidence.receipt.runId, archiveHash: evidence.archiveHash, archivedAt: evidence.receipt.archivedAt }
 } catch (error) { return { eligible: false, blocker: error instanceof Error ? error.message : String(error) } }
}

export function purgeGraphArchive(directory: string, purgeDirectory: string, expectedArchiveHash?: string, now = Date.now()): GraphArchivePurgeReceipt {
 directory = resolve(directory); purgeDirectory = resolve(purgeDirectory); ensureArchiveRoot(purgeDirectory)
 const name = basename(directory), receiptFile = join(purgeDirectory, `${name}.json`), staging = join(purgeDirectory, `${name}.pending`)
 let receipt: GraphArchivePurgeReceipt
 if (existsSync(receiptFile)) receipt = purgeReceipt(receiptFile, directory, staging)
 else {
  if (existsSync(staging)) throw new Error("Graph purge staging evidence has no receipt. Preserve it for inspection.")
  const evidence = archivedEvidence(directory), archivedAt = Date.parse(evidence.receipt.archivedAt)
  if (archivedAt > now || now - archivedAt < retentionMs) throw new Error(`Keep graph archives for at least ${GRAPH_ARCHIVE_RETENTION_DAYS} days.`)
  if (expectedArchiveHash && expectedArchiveHash !== evidence.archiveHash) throw new Error("Graph archive changed after purge approval. Preserve it for inspection.")
  receipt = { version: 1, status: "authorized-pending", runId: evidence.receipt.runId, archive: directory, staging, archiveHash: evidence.archiveHash, recordHash: evidence.receipt.recordHash, archivedAt: evidence.receipt.archivedAt, retentionDays: GRAPH_ARCHIVE_RETENTION_DAYS, entries: evidence.entries }
  saveRecord(receiptFile, receipt)
 }
 if (expectedArchiveHash && expectedArchiveHash !== receipt.archiveHash) throw new Error("Graph archive changed after purge approval. Preserve it for inspection.")
 if (receipt.status === "purged") {
  if (existsSync(directory) || existsSync(staging)) throw new Error("Purged graph evidence reappeared. Preserve it for inspection.")
  return receipt
 }
 if (receipt.status === "removing" && !existsSync(directory) && !existsSync(staging)) {
  receipt = { ...receipt, status: "purged", purgedAt: new Date(now).toISOString() }; saveRecord(receiptFile, receipt); return receipt
 }
 if (existsSync(directory) && !existsSync(staging)) {
  if (receipt.status !== "authorized-pending" || archiveHash(evidenceManifest(directory)) !== receipt.archiveHash) throw new Error("Graph archive changed after purge approval. Preserve it for inspection.")
  renameSync(directory, staging)
 } else if (existsSync(directory) || !existsSync(staging)) throw new Error("Pending graph purge location is uncertain. Preserve it for inspection.")
 if (receipt.status === "authorized-pending") {
  if (archiveHash(evidenceManifest(staging)) !== receipt.archiveHash) throw new Error("Pending graph purge evidence changed. Preserve it for inspection.")
  receipt = { ...receipt, status: "removing" }; saveRecord(receiptFile, receipt)
 }
 removeEvidence(staging, receipt.entries)
 receipt = { ...receipt, status: "purged", purgedAt: new Date(now).toISOString() }
 saveRecord(receiptFile, receipt)
 return receipt
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
