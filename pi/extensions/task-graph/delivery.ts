import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { graphGit, repositoryIdentity, repositoryRoot, type Orca } from "./task-graph-core.ts"
import { graphDirtyPaths, graphMergeHead, readGraphRecord, removeGraphWorkspace, saveGraphRecord, verifyGraphWorkspace, type GraphRecord } from "./workspaces.ts"

export interface GraphDeliveryReceipt {
 version: 1
 status: "authorized-pending" | "delivered"
 runId: string
 record: string
 approvedAt: string
 completedAt?: string
 targets: Array<{ source: string; identity: string; branch: string; from: string; head: string; workspace: { id: string; path: string; branch: string }; status: "pending" | "delivered" }>
 cleanup: Array<{ runId: string; record: string; source: string; identity: string; head: string; workspace: { id: string; path: string; branch: string }; status: "pending" | "removing" | "removed" }>
 retained: Array<{ runId: string; record: string; reason: string }>
}

function settled(record: GraphRecord): boolean {
 return Boolean(record.completion && !record.completion.deliveryPending
  && record.plan.tasks.every(task => record.completed[task.id])
  && Object.values(record.workers).every(worker => record.completed[worker.task] && (!record.plan.tasks.find(task => task.id === worker.task)?.owns.length || worker.integrated))
  && record.lanes.every(lane => !lane.task)
  && Object.values(record.resources ?? {}).every((resource: any) => resource.stopped))
}

function recordedIntegrationHead(record: GraphRecord, repo: GraphRecord["repositories"][number]): string {
 const heads = [...new Set(record.plan.tasks.filter(task => task.owns.length && realpathSync(resolve(record.root, task.repository)) === repo.source).map(task => record.completed[task.id]?.integrationHead).filter((head): head is string => Boolean(head)))]
 const final = heads.filter(candidate => heads.every(head => { try { graphGit(repo.source, "merge-base", "--is-ancestor", head, candidate); return true } catch { return false } }))
 if (final.length !== 1 || verifyGraphWorkspace(repo) !== final[0]) throw new Error("The integration workspace advanced beyond the completed Run.")
 return final[0]
}

function target(record: GraphRecord, repo: GraphRecord["repositories"][number]) {
 if (!repo.workspace || repo.workspace.role !== "integration") return undefined
 if (realpathSync(repo.source) !== repo.source || repositoryRoot(repo.source) !== repo.source || repositoryIdentity(repo.source) !== repo.identity) throw new Error("The delivery target repository identity changed.")
 if (graphDirtyPaths(repo.source).length || graphMergeHead(repo.source)) throw new Error("The delivery target checkout is dirty or unsettled.")
 const branch = graphGit(repo.source, "rev-parse", "--abbrev-ref", "HEAD")
 if (branch === "HEAD") throw new Error("The delivery target must have a branch checked out.")
 const head = recordedIntegrationHead(record, repo)
 if (graphDirtyPaths(repo.workspace.path!).length || graphMergeHead(repo.workspace.path!)) throw new Error("The integration workspace is dirty or unsettled.")
 const from = graphGit(repo.source, "rev-parse", "HEAD")
 graphGit(repo.source, "merge-base", "--is-ancestor", from, head)
 return { source: repo.source, identity: repo.identity, branch, from, head, workspace: { id: repo.workspace.id!, path: repo.workspace.path!, branch: repo.workspace.branch! }, status: "pending" as const }
}

export function prepareGraphDelivery(recordFile: string, recordsDirectory: string): GraphDeliveryReceipt {
 const record = readGraphRecord(recordFile)
 if (!record.runId || !settled(record)) throw new Error("Deliver only a completed non-pending settled Run.")
 const targets = record.repositories.map(repo => target(record, repo)).filter(item => item !== undefined)
 if (!targets.length) throw new Error("The Run has no integration commit to deliver.")
 const targetBySource = new Map(targets.map(item => [item.source, item]))
 const cleanup: GraphDeliveryReceipt["cleanup"] = [], retained: GraphDeliveryReceipt["retained"] = []
 for (const name of existsSync(recordsDirectory) ? readdirSync(recordsDirectory).filter(name => name.endsWith(".json")) : []) {
  const path = resolve(recordsDirectory, name)
  let candidate: GraphRecord
  try { candidate = readGraphRecord(path) } catch { continue }
  if (!candidate.runId || !candidate.completion || candidate.completion.deliveryPending) continue
  const related = candidate.repositories.some(repo => targetBySource.get(repo.source)?.identity === repo.identity)
  if (!related) continue
  if (!settled(candidate) || candidate.lanes.some(lane => lane.cleanup !== "removed")) { retained.push({ runId: candidate.runId, record: path, reason: "Run or lanes are not clean and settled." }); continue }
  const workspaces = candidate.repositories.filter(repo => repo.workspace?.role === "integration")
  if (!workspaces.length || workspaces.some(repo => !targetBySource.has(repo.source) || targetBySource.get(repo.source)!.identity !== repo.identity)) { retained.push({ runId: candidate.runId, record: path, reason: "Run contains an unrelated or uncertain repository." }); continue }
  try {
   const eligible = workspaces.map(repo => {
    const head = recordedIntegrationHead(candidate, repo), final = targetBySource.get(repo.source)!.head
    if (graphDirtyPaths(repo.workspace!.path!).length || graphMergeHead(repo.workspace!.path!)) throw new Error("dirty")
    graphGit(repo.source, "merge-base", "--is-ancestor", head, final)
    return { runId: candidate.runId!, record: path, source: repo.source, identity: repo.identity, head, workspace: { id: repo.workspace!.id!, path: repo.workspace!.path!, branch: repo.workspace!.branch! }, status: "pending" as const }
   })
   cleanup.push(...eligible)
  } catch { retained.push({ runId: candidate.runId, record: path, reason: "Integration workspace is dirty, changed, unmerged, or uncertain." }) }
 }
 return { version: 1, status: "authorized-pending", runId: record.runId, record: resolve(recordFile), approvedAt: new Date().toISOString(), targets, cleanup, retained }
}

export function readGraphDeliveryReceipt(file: string, expectedRunId?: string): GraphDeliveryReceipt {
 const receipt = JSON.parse(readFileSync(file, "utf8")) as GraphDeliveryReceipt
 if (receipt.version !== 1 || !["authorized-pending", "delivered"].includes(receipt.status) || !/^run_[a-zA-Z0-9_-]+$/.test(receipt.runId) || expectedRunId && receipt.runId !== expectedRunId || !Array.isArray(receipt.targets) || !receipt.targets.length || !Array.isArray(receipt.cleanup) || !Array.isArray(receipt.retained)) throw new Error("Invalid graph delivery receipt. Preserve it for inspection.")
 return receipt
}

export function deliverGraph(receiptFile: string, approved: GraphDeliveryReceipt | undefined, orca: Orca): GraphDeliveryReceipt {
 const saved = existsSync(receiptFile) ? readGraphDeliveryReceipt(receiptFile) : undefined
 if (approved && saved && JSON.stringify(saved) !== JSON.stringify(approved)) throw new Error("The delivery receipt changed after approval. Preserve it for inspection.")
 let receipt = approved ?? saved
 if (!receipt) throw new Error("Graph delivery needs interactive approval.")
 const persist = () => saveGraphRecord(receiptFile, receipt)
 if (!existsSync(receiptFile)) persist()
 const record = readGraphRecord(receipt.record)
 if (record.runId !== receipt.runId || !settled(record)) throw new Error("The approved Run record changed or is no longer deliverable.")
 for (const item of receipt.targets) {
  const repo = record.repositories.find(repo => repo.source === item.source && repo.identity === item.identity)
  const cleanup = receipt.cleanup.find(cleanup => cleanup.workspace.id === item.workspace.id && cleanup.workspace.path === item.workspace.path)
  const removalRecorded = item.status === "delivered" && cleanup && cleanup.status !== "pending" && !existsSync(item.workspace.path)
  if (!repo?.workspace || repo.workspace.id !== item.workspace.id || repo.workspace.path !== item.workspace.path || repo.workspace.branch !== item.workspace.branch || !removalRecorded && verifyGraphWorkspace(repo) !== item.head) throw new Error("The approved repository, workspace, or integration commit changed.")
  if (repositoryRoot(item.source) !== item.source || repositoryIdentity(item.source) !== item.identity || graphGit(item.source, "rev-parse", "--abbrev-ref", "HEAD") !== item.branch || graphDirtyPaths(item.source).length || graphMergeHead(item.source)) throw new Error("The delivery target checkout changed, is dirty, or is unsettled.")
  const current = graphGit(item.source, "rev-parse", "HEAD")
  if (current !== item.from && current !== item.head) throw new Error("The delivery target commit changed after approval.")
  if (current !== item.head) graphGit(item.source, "merge", "--ff-only", item.head)
  if (graphGit(item.source, "rev-parse", "HEAD") !== item.head || graphDirtyPaths(item.source).length) throw new Error("The local fast-forward did not reach the approved integration commit.")
  item.status = "delivered"; persist()
 }
 for (const item of receipt.targets) graphGit(item.source, "merge-base", "--is-ancestor", item.head, "HEAD")
 for (const item of receipt.cleanup.filter(item => item.status !== "removed")) {
  const candidate = readGraphRecord(item.record), repo = candidate.repositories.find(repo => repo.source === item.source && repo.identity === item.identity)
  if (candidate.runId !== item.runId || !settled(candidate) || candidate.lanes.some(lane => lane.cleanup !== "removed") || !repo?.workspace || repo.workspace.id !== item.workspace.id || repo.workspace.path !== item.workspace.path || repo.workspace.branch !== item.workspace.branch) throw new Error("A cleanup Run or workspace no longer matches its durable receipt.")
  const final = receipt.targets.find(target => target.source === item.source && target.identity === item.identity)
  if (!final) throw new Error("A cleanup target is no longer related to this delivery.")
  if (repositoryIdentity(final.source) !== final.identity || graphGit(final.source, "rev-parse", "--abbrev-ref", "HEAD") !== final.branch || graphGit(final.source, "rev-parse", "HEAD") !== final.head || graphDirtyPaths(final.source).length || graphMergeHead(final.source)) throw new Error("The delivered target changed before cleanup.")
  if (existsSync(item.workspace.path) && verifyGraphWorkspace(repo) !== item.head) throw new Error("A cleanup workspace advanced after approval.")
  removeGraphWorkspace(repo, repo.workspace, final.head, orca, item.status === "removing", () => { item.status = "removing"; persist() }, false)
  item.status = "removed"; persist()
 }
 receipt.status = "delivered"; receipt.completedAt ??= new Date().toISOString(); persist()
 return receipt
}
