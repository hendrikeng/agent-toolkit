import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { assertGraphMode, digest, graphGit, literalPath, owns, repositoryIdentity, repositoryRoot, saveRecord, validateTaskGraph, type Orca, type TaskGraphPlan } from "./task-graph-core.ts"
export { graphGit } from "./task-graph-core.ts"

export interface GraphInput { path: string; hash: string | null; executable: boolean; bytes: string | null }
export interface GraphWorkspace { role: "integration" | "snapshot" | "lane"; name: string; base: string; path?: string; branch?: string; id?: string; captureCommit?: string }
export interface GraphRepository { source: string; identity: string; base: string; inputs: GraphInput[]; workspace?: GraphWorkspace; sourceSeal?: string; sourceBranches?: string; preparation?: { configuration: unknown; hash: string } }
export interface GraphLane { id: string; source: string; workspace: GraphWorkspace; task?: string; previousTasks: string[]; blocked?: string; cleanup?: "pending" | "removed" }
export interface GraphWorker { task: string; ledgerTask: string; source: string; lane?: string; workspace: string; base: string; prerequisites: Record<string, string>; attempt: number; launch?: { title: string; command: string }; terminal?: string; dispatch?: string; integration?: { before: string; tip: string }; integrated?: string; repair?: { reason: string; integrationHead: string } }
export interface GraphRecord {
 version: 4
 key: string
 root: string
 plan: TaskGraphPlan
 workerModel?: string
 repositories: GraphRepository[]
 lanes: GraphLane[]
 workers: Record<string, GraphWorker>
 runId?: string
 resources?: Record<string, any>
 completed: Record<string, { head: string; integrationHead: string; evidence: string; deliveryPending?: boolean }>
 plans?: Array<{ id: string; source: string; filename: string }>
 completion?: { evidence: string; deliveryPending: boolean }
}
export function graphFile(root: string, path: string): string {
 literalPath(path)
 let target = realpathSync(root)
 const parts = path.split("/")
 for (const [index, part] of parts.entries()) {
  target = join(target, part)
  if (!existsSync(target)) {
   try { if (lstatSync(target).isSymbolicLink()) throw new Error("Broken symlink in graph path.") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
   continue
  }
  const stat = lstatSync(target)
  if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() || existsSync(join(target, ".git")) : !stat.isFile())) throw new Error(`Graph path must be a regular file without symlinks or nested repositories: ${path}`)
 }
 return target
}
export function graphInput(root: string, path: string): GraphInput {
 const file = graphFile(root, path)
 const bytes = existsSync(file) ? readFileSync(file) : null
 if (bytes && bytes.length > 8 * 1024 * 1024) throw new Error("Graph inputs are limited to 8 MiB per file.")
 return { path, hash: bytes === null ? null : digest(bytes), executable: bytes !== null && Boolean(lstatSync(file).mode & 0o111), bytes: bytes?.toString("base64") ?? null }
}
export function graphDirtyPaths(root: string): string[] {
 return [...new Set([graphGit(root, "diff", "--name-only", "--no-renames", "-z", "HEAD", "--"), graphGit(root, "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"), graphGit(root, "ls-files", "--others", "--exclude-standard", "-z")].flatMap(value => value.split("\0")).filter(Boolean))]
}
export function sourceSeal(root: string): string {
 const index = resolve(root, graphGit(root, "rev-parse", "--git-path", "index"))
 return digest(JSON.stringify([graphGit(root, "rev-parse", "HEAD"), existsSync(index) ? digest(readFileSync(index)) : null, graphGit(root, "diff", "--binary", "HEAD", "--"), graphGit(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).map(path => { const stat = lstatSync(join(root, path), { bigint: true }); return [path, String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)] })]))
}
export function captureGraphWorkspaces(root: string, plan: TaskGraphPlan): GraphRecord {
 validateTaskGraph(plan, root)
 const key = randomUUID(), label = (plan.objective.split("/").at(-1) ?? plan.objective).replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "task"
 const sources = [...new Set(plan.tasks.map(task => realpathSync(resolve(root, task.repository))))]
 const inputs = new Map<string, string[]>()
 for (const selection of plan.inputs ?? []) {
  const source = realpathSync(resolve(root, selection.repository))
  if (!sources.includes(source) || inputs.has(source) || new Set(selection.paths).size !== selection.paths.length || selection.paths.length > 100) throw new Error("Input selections need unique task repositories and exact unique files.")
  inputs.set(source, selection.paths)
 }
 const repositories = sources.map(source => {
  const base = plan.foundations.find(item => realpathSync(resolve(root, item.repository)) === source)!.commit
  const selected = inputs.get(source) ?? []
  if (selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Dirty inputs require the selected source HEAD as foundation.")
  if (selected.some(path => !graphDirtyPaths(source).includes(path))) throw new Error("Capture only explicitly selected dirty inputs.")
  const writing = plan.tasks.some(task => realpathSync(resolve(root, task.repository)) === source && task.owns.length)
  if (!writing && !selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Read-only inspection without a workspace requires source HEAD as its foundation.")
  const role = writing ? "integration" : "snapshot"
  const workspace = writing || selected.length ? { role, name: `graph-${label}-${key.slice(0, 8)}-${role}`, base } as GraphWorkspace : undefined
  return { source, sourceSeal: sourceSeal(source), sourceBranches: graphGit(source, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), identity: repositoryIdentity(source), base, inputs: selected.map(path => graphInput(source, path)), ...(workspace ? { workspace } : {}) }
 })
 const record: GraphRecord = { version: 4, key, root: realpathSync(root), plan: structuredClone(plan), repositories, lanes: [], workers: {}, completed: {} }
 validateSelectedPlan(record)
 return record
}
export function readGraphAdmission(file: string, identities: string[], root?: string): GraphRecord | undefined {
 const saved = JSON.parse(readFileSync(file, "utf8"))
 if (saved.completion) return undefined
 if (saved.version === 4 && root && saved.root === root) return readGraphRecord(file)
 const historical = Array.isArray(saved.repositories) ? saved.repositories.map((repo: any) => repo?.identity).filter((identity: unknown): identity is string => typeof identity === "string") : []
 if (!historical.some((identity: string) => identities.includes(identity))) return undefined
 if (saved.version === 4) return readGraphRecord(file)
 if (!saved.completion) throw new Error(`An unfinished historical graph still owns a selected repository. Preserve it for inspection: ${file}`)
 return undefined
}
export function readGraphRecord(file: string): GraphRecord {
 const record = JSON.parse(readFileSync(file, "utf8"))
 if (record.version !== 4) throw new Error(`Graph ownership [development-roots-v1]: this approval uses an older contract. Preserve it and its Run; do not migrate or restart it. Record: ${file}`)
 if (!/^[a-f0-9-]{36}$/.test(record.key) || !record.root || !Array.isArray(record.repositories) || !Array.isArray(record.lanes) || !record.workers || !record.completed) throw new Error("Invalid graph record. Preserve it for inspection.")
 validateTaskGraph(record.plan, record.root)
 const selected = record.plan.foundations.map((item: any) => ({ source: realpathSync(resolve(record.root, item.repository)), base: item.commit }))
 if (record.repositories.length !== selected.length || record.repositories.some((repo: GraphRepository) => !selected.some((item: any) => item.source === repo.source && item.base === repo.base) || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Workspace foundations no longer match approval.")
 for (const repo of record.repositories as GraphRepository[]) for (const input of repo.inputs) {
  literalPath(input.path)
  if (input.hash !== (input.bytes === null ? null : digest(Buffer.from(input.bytes, "base64")))) throw new Error("Input snapshot hash changed.")
 }
 if (record.lanes.some((lane: GraphLane) => !record.repositories.some((repo: GraphRepository) => repo.source === lane.source) || lane.workspace.role !== "lane") || Object.entries(record.workers as Record<string, GraphWorker>).some(([id, worker]) => worker.task !== id || !record.plan.tasks.some((task: any) => task.id === id))) throw new Error("Invalid lane or worker record.")
 return record
}
export function verifyGraphWorkspace(repo: GraphRepository, workspace = repo.workspace!): string {
 if (!workspace?.path || !workspace.branch || !workspace.id || realpathSync(workspace.path) !== workspace.path || repositoryRoot(workspace.path) !== workspace.path || repositoryIdentity(workspace.path) !== repo.identity || graphGit(workspace.path, "rev-parse", "--abbrev-ref", "HEAD") !== workspace.branch || workspace.path === repo.source) throw new Error("Prepared workspace identity changed or preparation is incomplete. Do not recreate it.")
 graphGit(workspace.path, "merge-base", "--is-ancestor", workspace.base, "HEAD")
 return graphGit(workspace.path, "rev-parse", "HEAD")
}
export function createGraphWorkspace(repo: GraphRepository, workspace: GraphWorkspace, orca: Orca, persist: () => void): void {
 if (workspace.path) { verifyGraphWorkspace(repo, workspace); return }
 const inventory = orca(["repo", "list", "--json"])?.result
 if (!Array.isArray(inventory?.repos) || inventory.truncated || inventory.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca repository inventory.")
 const repos = inventory.repos.filter((item: any) => item.path && existsSync(join(item.path, ".git")) && repositoryIdentity(item.path) === repo.identity)
 if (repos.length !== 1 || !repos[0].id) throw new Error("Select exactly one Orca repository by Git identity.")
 const selector = `id:${repos[0].id}`
 if (workspace.role !== "lane") {
  const configuration = orca(["repo", "show", "--repo", selector, "--json"])?.result
  if (!repo.preparation || digest(JSON.stringify(configuration)) !== repo.preparation.hash) throw new Error("Orca preparation defaults changed after approval.")
 }
 const list = orca(["worktree", "list", "--repo", selector, "--json"])?.result
 if (!Array.isArray(list?.worktrees) || list.truncated || list.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca worktree inventory.")
 const matches = list.worktrees.filter((item: any) => item.displayName === workspace.name || item.branch === `refs/heads/${workspace.name}`)
 if (matches.length > 1) throw new Error("Duplicate workspace receipts. Preserve and inspect them.")
 persist()
 const receipt = matches[0] ?? orca(["worktree", "create", "--repo", selector, "--name", workspace.name, "--base-branch", workspace.base, "--no-parent", "--setup", "skip", "--json"])?.result?.worktree
 if (!receipt?.path || !receipt.id || receipt.isMainWorktree) throw new Error("Workspace receipt missing. Resume the reserved name; do not create another.")
 const path = realpathSync(receipt.path), branch = graphGit(path, "rev-parse", "--abbrev-ref", "HEAD")
 if (path === repo.source || path.startsWith(`${repo.source}${sep}`) || repositoryIdentity(path) !== repo.identity || graphGit(path, "rev-parse", "HEAD") !== workspace.base || graphDirtyPaths(path).length || receipt.branch !== `refs/heads/${branch}`) throw new Error("Workspace does not match its clean approved foundation.")
 Object.assign(workspace, { path, branch, id: receipt.id }); persist()
}
export function importGraphInputs(repo: GraphRepository, persist: () => void): void {
 const workspace = repo.workspace!, head = verifyGraphWorkspace(repo, workspace)
 if (workspace.captureCommit) { graphGit(workspace.path!, "merge-base", "--is-ancestor", workspace.captureCommit, "HEAD"); return }
 const root = workspace.path!, selected = repo.inputs.map(input => input.path)
 if (graphDirtyPaths(root).some(path => !selected.includes(path))) throw new Error("Capture contains unrelated changes; preserve them.")
 if (head !== workspace.base) {
  const changed = graphGit(root, "diff", "--no-renames", "--name-only", `${workspace.base}..HEAD`).split("\n").filter(Boolean)
  if (graphGit(root, "rev-list", "--count", `${workspace.base}..HEAD`) !== "1" || changed.some(path => !selected.includes(path)) || graphDirtyPaths(root).length || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Unexpected capture history. Preserve it for inspection.")
 } else {
  for (const input of repo.inputs) {
   if (JSON.stringify(graphInput(root, input.path)) === JSON.stringify(input)) continue
   if (graphGit(root, "diff", "--name-only", "HEAD", "--", input.path) || graphGit(root, "ls-files", "--others", "--exclude-standard", "--", input.path)) throw new Error(`Capture destination changed: ${input.path}`)
   const path = graphFile(root, input.path)
   if (input.bytes === null) { if (existsSync(path)) unlinkSync(path) }
   else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(input.bytes, "base64")); chmodSync(path, input.executable ? 0o755 : 0o644) }
  }
  if (selected.length) { graphGit(root, "add", "--", ...selected); if (graphGit(root, "diff", "--cached", "--name-only")) graphGit(root, "commit", "-m", "Capture approved graph inputs", "--", ...selected) }
 }
 const captureHead = graphGit(root, "rev-parse", "HEAD"), changed = captureHead === workspace.base ? [] : graphGit(root, "diff", "--no-renames", "--name-only", `${workspace.base}..${captureHead}`).split("\n").filter(Boolean)
 if ((captureHead !== workspace.base && graphGit(root, "rev-list", "--count", `${workspace.base}..${captureHead}`) !== "1") || changed.some(path => !selected.includes(path)) || graphDirtyPaths(root).length || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Capture hooks or filters changed approved history or bytes; preserve the workspace.")
 workspace.captureCommit = captureHead; persist()
}
export function verifyGraphChanges(repo: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: TaskGraphPlan["mode"], base = workspace.captureCommit ?? workspace.base): void {
 verifyGraphWorkspace(repo, workspace)
 const root = workspace.path!
 const check = (path: string) => { graphFile(root, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error(`Outside task ownership: ${path}`) }
 for (const path of graphDirtyPaths(root)) check(path)
 graphGit(root, "merge-base", "--is-ancestor", base, "HEAD")
 for (const commit of graphGit(root, "rev-list", `${base}..HEAD`).split("\n").filter(Boolean)) for (const path of graphGit(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-m", "-z", commit).split("\0").filter(Boolean)) {
  check(path)
  const entry = graphGit(root, "ls-tree", commit, "--", path)
  if (entry && !/^100[0-9]{3} /.test(entry)) throw new Error(`Worker history contains a non-regular file: ${path}`)
 }
}
export function graphMergeHead(path: string): string | undefined { try { return graphGit(path, "rev-parse", "--verify", "--quiet", "MERGE_HEAD") } catch { return undefined } }
export function checkpointGraphChanges(repo: GraphRepository, workspace: GraphWorkspace, owners: string[], mode: TaskGraphPlan["mode"], base: string, paths: string[], message: string): string {
 verifyGraphChanges(repo, workspace, owners, mode, base)
 if (!paths.length || new Set(paths).size !== paths.length || !message.trim()) throw new Error("Checkpoint requires unique explicit paths and a message.")
 for (const path of paths) { graphFile(workspace.path!, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error("Checkpoint outside task ownership.") }
 const root = workspace.path!
 graphGit(root, "add", "--", ...paths)
 if (graphMergeHead(root)) {
  if (graphGit(root, "diff", "--name-only", "--diff-filter=U")) throw new Error("Resolve all integration conflicts before checkpointing.")
  graphGit(root, "commit", "-m", message)
 } else if (graphGit(root, "diff", "--cached", "--name-only", "--", ...paths)) graphGit(root, "commit", "-m", message, "--", ...paths)
 verifyGraphChanges(repo, workspace, owners, mode, base)
 return verifyGraphWorkspace(repo, workspace)
}
export function graphRepositoryMap(record: GraphRecord): Record<string, { path: string; head: string; branch: string }> {
 return Object.fromEntries(record.repositories.map(repo => {
  const head = repo.workspace ? verifyGraphWorkspace(repo) : graphGit(repo.source, "rev-parse", "HEAD")
  if (!repo.workspace && (head !== repo.base || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Read-only source changed from its approved foundation.")
  return [repo.source, { path: repo.workspace?.path ?? repo.source, head, branch: repo.workspace?.branch ?? graphGit(repo.source, "rev-parse", "--abbrev-ref", "HEAD") }]
 }))
}
export function prepareGraphLane(record: GraphRecord, repo: GraphRepository, task: string, orca: Orca, persist: () => void): GraphLane {
 const integration = repo.workspace
 if (!integration || integration.role !== "integration") throw new Error("Writing tasks require an integration workspace.")
 const integrationHead = verifyGraphWorkspace(repo, integration)
 for (const lane of record.lanes.filter(lane => lane.source === repo.source && !lane.task && !lane.blocked && !lane.cleanup)) {
  verifyGraphWorkspace(repo, lane.workspace)
  if (graphDirtyPaths(lane.workspace.path!).length) { lane.blocked = "dirty retained lane"; persist(); continue }
  const laneHead = graphGit(lane.workspace.path!, "rev-parse", "HEAD")
  if (laneHead !== integrationHead) { graphGit(lane.workspace.path!, "merge-base", "--is-ancestor", laneHead, integrationHead); graphGit(lane.workspace.path!, "merge", "--ff-only", integrationHead) }
  lane.task = task; persist(); return lane
 }
 const count = record.repositories.filter(item => item.workspace).length + record.lanes.filter(lane => !lane.cleanup).length
 if (count >= record.plan.worktree_budget) throw new Error(`Graph worktree budget ${record.plan.worktree_budget} is exhausted. Finish and integrate a lane before starting another task.`)
 const id = randomUUID(), lane: GraphLane = { id, source: repo.source, task, previousTasks: [], workspace: { role: "lane", name: `graph-${record.key.slice(0, 8)}-lane-${id.slice(0, 8)}`, base: integrationHead } }
 record.lanes.push(lane); persist(); createGraphWorkspace(repo, lane.workspace, orca, persist); return lane
}
export function integrateGraphWorker(record: GraphRecord, worker: GraphWorker, persist: () => void, releaseLane = true): string {
 const repo = record.repositories.find(repo => repo.source === worker.source)!, lane = record.lanes.find(lane => lane.id === worker.lane)
 if (!lane || lane.task !== worker.task) throw new Error("Worker lane assignment changed.")
 verifyGraphChanges(repo, lane.workspace, record.plan.tasks.find(task => task.id === worker.task)!.owns, record.plan.mode, worker.base)
 const tip = verifyGraphWorkspace(repo, lane.workspace), integration = repo.workspace!, head = verifyGraphWorkspace(repo, integration)
 if (graphDirtyPaths(lane.workspace.path!).length) throw new Error("Commit worker changes before integration.")
 if (worker.integrated) {
  if (worker.integrated !== tip) throw new Error("Worker changed after integration.")
  graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD")
  if (releaseLane) { lane.previousTasks.push(worker.task); lane.task = undefined; persist() }
  return verifyGraphWorkspace(repo, integration)
 }
 const mergeHead = graphMergeHead(integration.path!)
 if (mergeHead) {
  if (mergeHead !== tip || worker.integration?.tip !== tip) throw new Error("The pending merge belongs to another integration attempt.")
  throw new Error("Integration has preserved conflicts. Resolve owned paths with checkpoint_task_graph, then retry completion.")
 }
 if (graphDirtyPaths(integration.path!).length) throw new Error("Integration workspace is dirty; preserve and inspect it.")
 worker.integration ??= { before: head, tip }; persist()
 try { graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD") }
 catch {
  if (verifyGraphWorkspace(repo, integration) !== worker.integration.before) throw new Error("Integration head changed after the recorded attempt.")
  graphGit(integration.path!, "merge", "--no-ff", "-m", `Integrate graph task ${worker.task}`, tip)
 }
 graphGit(integration.path!, "merge-base", "--is-ancestor", tip, "HEAD")
 if (graphDirtyPaths(integration.path!).length) throw new Error("Integration left dirty files; preserve them for resolution.")
 worker.integrated = tip
 if (releaseLane) { lane.previousTasks.push(worker.task); lane.task = undefined }
 persist()
 return verifyGraphWorkspace(repo, integration)
}
export function graphWritePath(record: GraphRecord, taskId: string, path: string): void {
 if (path !== resolve(path)) throw new Error("Graph writes require literal absolute paths without traversal.")
 const task = record.plan.tasks.find(task => task.id === taskId), worker = record.workers[taskId]
 const repo = task && worker && record.repositories.find(repo => repo.source === worker.source)
 const lane = worker?.lane && record.lanes.find(item => item.id === worker.lane)
 if (!task || !worker || !repo || !path.startsWith(`${worker.workspace}${sep}`)) throw new Error("Writes must target the task's assigned workspace.")
 const workspace = lane?.workspace
 if (task.owns.length && !workspace) throw new Error("Writing task has no lane.")
 if (workspace) verifyGraphWorkspace(repo, workspace)
 const local = relative(worker.workspace, path).split(sep).join("/")
 graphFile(worker.workspace, local); assertGraphMode(record.plan.mode, local)
 if (!owns(task.owns, local)) throw new Error("Write outside task ownership.")
}
function metadata(markdown: string, key: string): string | undefined { const section = markdown.split(/^##\s+Metadata\s*$/im)[1]?.split(/^##\s+/m)[0]; return section?.match(new RegExp(`^\\s*-\\s*${key}:\\s*([^\\n]+)`, "im"))?.[1].trim() }
function validateSelectedPlan(record: GraphRecord): void {
 if (record.plan.mode !== "execute" || !/(?:^|\/)docs\/(?:future|exec-plans\/(?:active|completed))\/.+\.md$/.test(record.plan.objective)) return
 const documents = record.repositories.flatMap(repo => {
  const paths = new Set(graphGit(repo.source, "ls-tree", "-r", "--name-only", repo.base, "--", "docs/future", "docs/exec-plans/active", "docs/exec-plans/completed").split("\n").filter(path => path.endsWith(".md")))
  for (const input of repo.inputs) if (/^docs\/(?:future|exec-plans\/(?:active|completed))\/.+\.md$/.test(input.path)) input.bytes === null ? paths.delete(input.path) : paths.add(input.path)
  return [...paths].map(path => {
   literalPath(path)
   const input = repo.inputs.find(input => input.path === path)
   const markdown = input ? Buffer.from(input.bytes!, "base64").toString("utf8") : graphGit(repo.source, "show", `${repo.base}:${path}`)
   return { source: repo.source, path, markdown, id: metadata(markdown, "Plan-ID") }
  })
 })
 const target = documents.find(doc => resolve(doc.source, doc.path) === resolve(record.root, record.plan.objective))
 if (!target?.id) throw new Error("Selected execution plan is missing from its approved foundation or has no Plan-ID.")
 const closure = new Map<string, typeof target>()
 const visit = (id: string, stack = new Set<string>()) => {
  const matches = documents.filter(doc => doc.id === id)
  if (matches.length !== 1) throw new Error(`Plan-ID ${id} is missing or ambiguous across selected foundations.`)
  const doc = matches[0], status = metadata(doc.markdown, "Status")?.toLowerCase()
  if (status === "completed" && doc.path.startsWith("docs/exec-plans/completed/")) return
  if (stack.has(id)) throw new Error("Plan dependencies contain a cycle.")
  if (closure.has(id)) return
  if (!["approved", "not-required"].includes(metadata(doc.markdown, "Security-Approval")?.toLowerCase() ?? "") || (doc.path.startsWith("docs/future/") ? status !== "ready-for-promotion" : !["queued", "in-progress", "in-review", "validation", "budget-exhausted", "ready-for-promotion"].includes(status ?? ""))) throw new Error(`Plan ${id} is blocked, draft, completed, or lacks security approval.`)
  for (const field of ["Priority", "Dependencies", "Acceptance-Criteria", "Validation-Lanes", "Risk-Tier"]) if (!metadata(doc.markdown, field)) throw new Error(`Plan ${id} lacks ${field}.`)
  const product = metadata(doc.markdown, "Product-Approval")?.toLowerCase()
  if (product && !["approved", "not-required"].includes(product)) throw new Error(`Plan ${id} lacks required Product approval.`)
  for (const dependency of metadata(doc.markdown, "Dependencies")!.toLowerCase() === "none" ? [] : metadata(doc.markdown, "Dependencies")!.split(",").map(item => item.trim())) visit(dependency, new Set(stack).add(id))
  closure.set(id, doc)
 }
 visit(target.id)
 if (!closure.size || closure.size !== record.plan.tasks.length || record.plan.tasks.some(task => !closure.has(task.id))) throw new Error("Execution tasks must match the complete unfinished plan dependency closure.")
 const scheduled = new Set<string>()
 for (const task of record.plan.tasks) {
  const doc = closure.get(task.id)!, dependencies = metadata(doc.markdown, "Dependencies")!.split(",").map(item => item.trim()).filter(id => closure.has(id))
  if (JSON.stringify([...task.depends_on].sort()) !== JSON.stringify([...dependencies].sort()) || resolve(record.root, task.repository) !== doc.source) throw new Error("Plan task repositories and dependencies must match foundation metadata.")
  const ready = [...closure.values()].filter(item => !scheduled.has(item.id!) && metadata(item.markdown, "Dependencies")!.split(",").map(id => id.trim()).every(id => !closure.has(id) || scheduled.has(id)))
  ready.sort((a, b) => (metadata(a.markdown, "Priority") ?? "").localeCompare(metadata(b.markdown, "Priority") ?? "") || a.id!.localeCompare(b.id!))
  if (ready[0]?.id !== task.id || !/^p[0-3]$/.test(metadata(doc.markdown, "Priority")!)) throw new Error("Order plans by dependencies, Priority, then Plan-ID.")
  const filename = doc.path.replace(/^docs\/(?:future|exec-plans\/(?:active|completed))\//, "")
  const targets = ["Spec-Targets", "Implementation-Targets"].flatMap(field => metadata(doc.markdown, field)?.split(",") ?? []).map(path => path.trim()).filter(path => path && path.toLowerCase() !== "none")
  if (!targets.length || [...targets, `docs/future/${filename}`, `docs/exec-plans/active/${filename}`, `docs/exec-plans/completed/${filename}`].some(path => { literalPath(path); return !owns(task.owns, path) })) throw new Error(`Task ${task.id} must own its declared targets and exact lifecycle paths.`)
  scheduled.add(task.id)
 }
 record.plans = [...closure.values()].map(doc => ({ id: doc.id!, source: doc.source, filename: doc.path.replace(/^docs\/(?:future|exec-plans\/(?:active|completed))\//, "") }))
}
export function graphPlanLocation(record: GraphRecord, id: string) {
 const plan = record.plans?.find(plan => plan.id === id); if (!plan) return undefined
 const repo = record.repositories.find(repo => repo.source === plan.source)!, root = repo.workspace?.path
 if (!root) throw new Error("Prepare the plan integration workspace first.")
 const paths = ["docs/future", "docs/exec-plans/active", "docs/exec-plans/completed"].map(directory => `${directory}/${plan.filename}`)
 const matches = paths.filter(path => existsSync(graphFile(root, path)))
 if (matches.length !== 1) throw new Error(`Plan ${id} has missing or duplicate lifecycle paths.`)
 const local = matches[0], path = graphFile(root, local), markdown = readFileSync(path, "utf8")
 return { repo, path, local, filename: plan.filename, status: metadata(markdown, "Status")?.toLowerCase(), markdown }
}
export function verifyPlanTaskCloseout(record: GraphRecord, id: string, deliveryPending = false): void {
 if (!record.plans?.some(plan => plan.id === id)) return
 const location = graphPlanLocation(record, id)!, closed = location.local.startsWith("docs/exec-plans/completed/") && location.status === "completed", pending = deliveryPending && location.local.startsWith("docs/exec-plans/active/") && location.status === "validation", evidence = metadata(location.markdown, "Done-Evidence"), security = metadata(location.markdown, "Security-Approval")?.toLowerCase(), product = metadata(location.markdown, "Product-Approval")?.toLowerCase()
 if (metadata(location.markdown, "Plan-ID") !== id || !["approved", "not-required"].includes(security ?? "") || product && !["approved", "not-required"].includes(product) || (!closed && !pending) || !evidence || /^(?:pending|none|not-run|todo)$/i.test(evidence)) throw new Error(`Plan ${id} has incomplete closeout.`)
}
export function verifyPlanCloseout(record: GraphRecord, deliveryPending: boolean): void {
 for (const plan of record.plans ?? []) verifyPlanTaskCloseout(record, plan.id, deliveryPending)
}
export const saveGraphRecord = saveRecord
