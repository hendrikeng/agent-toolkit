import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { assertGraphMode, digest, graphGit, LEGACY_GRAPH, literalPath, owns, repositoryIdentity, repositoryRoot, saveRecord, validateTaskGraph, type Orca, type TaskGraphPlan } from "./task-graph-core.ts"
export { graphGit } from "./task-graph-core.ts"

export interface GraphInput { path: string; hash: string | null; executable: boolean; bytes: string | null }
export interface GraphWorkspace { role: "planning" | "execution" | "snapshot"; name: string; path?: string; branch?: string; id?: string; captureCommit?: string }
export interface GraphRepository { source: string; identity: string; base: string; inputs: GraphInput[]; workspace?: GraphWorkspace; sourceSeal?: string; sourceBranches?: string; preparation?: { configuration: unknown; hash: string } }
export interface GraphRecord {
 version: 3
 key: string
 root: string
 plan: TaskGraphPlan
 repositories: GraphRepository[]
 runId?: string
 resources?: Record<string, any>
 scopeChanges?: Array<{ at: string; additions: unknown }>
 active?: { task: string; before: string; setup: boolean; validated?: string; validation?: { command: string; head: string; result: "success" } }
 completed: Record<string, { head: string; evidence: string }>
 plans?: Array<{ id: string; source: string; filename: string }>
 completion?: { evidence: string; deliveryPending: boolean }
}
export function graphFile(root: string, path: string): string {
 literalPath(path)
 let target = realpathSync(root)
 for (const [index, part] of path.split("/").entries()) {
  target = join(target, part)
  if (!existsSync(target)) {
   try { if (lstatSync(target).isSymbolicLink()) throw new Error("Broken symlink in graph path.") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
   continue
  }
  const stat = lstatSync(target)
  if (stat.isSymbolicLink() || (index < path.split("/").length - 1 ? !stat.isDirectory() || existsSync(join(target, ".git")) : !stat.isFile())) throw new Error(`Graph path must be a regular file without symlinks or nested repositories: ${path}`)
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
export function captureGraphWorkspaces(root: string, plan: TaskGraphPlan, existing?: GraphRecord): GraphRecord {
 validateTaskGraph(plan, root)
 const sources = [...new Set(plan.tasks.map(task => realpathSync(resolve(root, task.repository))))]
 const inputs = new Map<string, string[]>()
 for (const selection of plan.inputs ?? []) {
  const source = realpathSync(resolve(root, selection.repository))
  if (!sources.includes(source) || inputs.has(source) || new Set(selection.paths).size !== selection.paths.length || selection.paths.length > 100) throw new Error("Input selections need unique task repositories and exact unique files.")
  inputs.set(source, selection.paths)
 }
 const repositories = sources.map(source => {
  const retained = existing?.repositories.find(repo => repo.source === source)
  if (retained) {
   const copy = structuredClone(retained) // Scope additions never recapture existing inputs.
   if (plan.tasks.some(task => realpathSync(resolve(root, task.repository)) === source && task.owns.length)) {
    if (copy.workspace?.role === 'snapshot') throw new Error('Snapshot workspaces remain read-only. Use a separate approved writing graph.')
    copy.workspace ??= { role: plan.mode === 'plan-only' ? 'planning' : 'execution', name: `graph-${plan.mode}-${randomUUID()}` }
   }
   return copy
  }
  const base = plan.foundations.find(item => realpathSync(resolve(root, item.repository)) === source)!.commit
  const selected = inputs.get(source) ?? []
  if (selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Dirty inputs require the selected source HEAD as foundation.")
  if (selected.some(path => !graphDirtyPaths(source).includes(path))) throw new Error("Capture only explicitly selected dirty inputs.")
  const writing = plan.tasks.some(task => realpathSync(resolve(root, task.repository)) === source && task.owns.length)
  if (!writing && !selected.length && graphGit(source, "rev-parse", "HEAD") !== base) throw new Error("Read-only inspection without a workspace requires source HEAD as its foundation. Select the matching source checkout before approval.")
  const role = writing ? plan.mode === "plan-only" ? "planning" : "execution" : "snapshot"
  return { source, sourceSeal: sourceSeal(source), sourceBranches: graphGit(source, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"), identity: repositoryIdentity(source), base, inputs: selected.map(path => graphInput(source, path)), ...(writing || selected.length ? { workspace: { role, name: `graph-${role}-${randomUUID()}` } as GraphWorkspace } : {}) }
 })
 const record: GraphRecord = { version: 3, key: randomUUID(), root: realpathSync(root), plan: structuredClone(plan), repositories, completed: {} }
 validateSelectedPlan(record)
 return record
}
export function readGraphRecord(file: string): GraphRecord {
 const record = JSON.parse(readFileSync(file, "utf8"))
 if (record.version !== 3) throw new Error(`Graph ownership [development-roots-v1]: this approval uses an older contract. No automatic expansion, migration or retirement is permitted. Preserve it and request a separately reviewed transition. Record: ${file}`)
 if (!/^[a-f0-9-]{36}$/.test(record.key) || !record.root || !Array.isArray(record.repositories) || !record.completed || record.workers || record.coordination || record.currentCheckout) throw new Error("Invalid graph record. Preserve it for inspection.")
 validateTaskGraph(record.plan, record.root)
 const selected = record.plan.foundations.map((item: any) => ({ source: realpathSync(resolve(record.root, item.repository)), base: item.commit }))
 if (record.repositories.length !== selected.length || record.repositories.some((repo: GraphRepository) => !selected.some((item: any) => item.source === repo.source && item.base === repo.base) || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Workspace foundations no longer match approval.")
 if (Object.keys(record.completed).some(id => !record.plan.tasks.some((task: any) => task.id === id)) || record.active && !record.plan.tasks.some((task: any) => task.id === record.active.task && !record.completed[task.id])) throw new Error("Invalid task progress record.")
 // Validate authority without consulting changed source files or recapturing them.
 for (const repo of record.repositories as GraphRepository[]) {
  if (!repo.source.startsWith("/") || !repo.identity.startsWith("/") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(repo.base) || !Array.isArray(repo.inputs)) throw new Error("Invalid repository record.")
  for (const input of repo.inputs) {
   literalPath(input.path)
   if (input.hash !== (input.bytes === null ? null : digest(Buffer.from(input.bytes, "base64")))) throw new Error("Input snapshot hash changed.")
  }
 }
 return record
}
export function verifyGraphWorkspace(repo: GraphRepository): string {
 const workspace = repo.workspace
 if (!workspace?.path || !workspace.branch || !workspace.id || realpathSync(workspace.path) !== workspace.path || repositoryRoot(workspace.path) !== workspace.path || repositoryIdentity(workspace.path) !== repo.identity || graphGit(workspace.path, "rev-parse", "--abbrev-ref", "HEAD") !== workspace.branch || workspace.path === repo.source) throw new Error("Prepared workspace identity changed or preparation is incomplete. Do not recreate it.")
 graphGit(workspace.path, "merge-base", "--is-ancestor", repo.base, "HEAD")
 return graphGit(workspace.path, "rev-parse", "HEAD")
}
export function createGraphWorkspace(repo: GraphRepository, orca: Orca, persist: () => void): void {
 const workspace = repo.workspace!
 if (workspace.path) { verifyGraphWorkspace(repo); return }
 const inventory = orca(["repo", "list", "--json"])?.result
 if (!Array.isArray(inventory?.repos) || inventory.truncated || inventory.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca repository inventory.")
 const repos = inventory.repos.filter((item: any) => item.path && existsSync(join(item.path, ".git")) && repositoryIdentity(item.path) === repo.identity)
 if (repos.length !== 1 || !repos[0].id) throw new Error("Select exactly one registered Orca repository by Git identity.")
 const selector = `id:${repos[0].id}`
 const configuration = orca(["repo", "show", "--repo", selector, "--json"])?.result
 if (!repo.preparation || digest(JSON.stringify(configuration)) !== repo.preparation.hash) throw new Error("Orca preparation defaults changed or were not disclosed in approval. Approve the changed setup scope before creation.")
 const list = orca(["worktree", "list", "--repo", selector, "--json"])?.result
 if (!Array.isArray(list?.worktrees) || list.truncated || list.hostScope?.omittedHostIds?.length) throw new Error("Incomplete Orca worktree inventory.")
 const matches = list.worktrees.filter((item: any) => item.displayName === workspace.name || item.branch === `refs/heads/${workspace.name}`)
 if (matches.length > 1) throw new Error("Duplicate workspace receipts. Preserve and inspect them.")
 persist() // Reserve the exact name before RPC; a lost receipt is found by that name on resume.
 const receipt = matches[0] ?? orca(["worktree", "create", "--repo", selector, "--name", workspace.name, "--base-branch", repo.base, "--no-parent", "--setup", "skip", "--json"])?.result?.worktree
 if (!receipt?.path || !receipt.id || receipt.isMainWorktree) throw new Error("Workspace receipt missing. Resume the reserved name; do not create another.")
 const path = realpathSync(receipt.path)
 const branch = graphGit(path, "rev-parse", "--abbrev-ref", "HEAD")
 if (path === repo.source || path.startsWith(`${repo.source}${sep}`) || repositoryIdentity(path) !== repo.identity || graphGit(path, "rev-parse", "HEAD") !== repo.base || graphDirtyPaths(path).length || receipt.branch !== `refs/heads/${branch}`) throw new Error("Workspace does not match the clean approved foundation.")
 Object.assign(workspace, { path, branch, id: receipt.id })
 persist()
}
export function importGraphInputs(repo: GraphRepository, persist: () => void): void {
 const head = verifyGraphWorkspace(repo)
 const workspace = repo.workspace!
 if (workspace.captureCommit) { graphGit(workspace.path!, "merge-base", "--is-ancestor", workspace.captureCommit, "HEAD"); return }
 const root = workspace.path!
 const selected = repo.inputs.map(input => input.path)
 if (graphDirtyPaths(root).some(path => !selected.includes(path))) throw new Error("Capture contains unrelated changes; preserve them.")
 // A successful commit with a lost save is recoverable only as one exact capture commit.
 if (head !== repo.base) {
  if (graphGit(root, "rev-list", "--count", `${repo.base}..HEAD`) !== "1" || graphDirtyPaths(root).length || graphGit(root, "diff", "--name-only", "--no-renames", "-z", repo.base, head).split("\0").filter(Boolean).some(path => !selected.includes(path)) || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Unexpected capture history. Preserve it for inspection.")
 } else {
  for (const input of repo.inputs) {
   if (graphGit(root, "diff", "--cached", "--name-only", "HEAD", "--", input.path) && graphGit(root, "diff", "--name-only", "--", input.path)) throw new Error(`Capture index contains a third version: ${input.path}. Preserve it.`)
   const actual = graphInput(root, input.path)
   if (JSON.stringify(actual) === JSON.stringify(input)) continue
   // Only unchanged base files may be replaced. An interrupted third version is never overwritten.
   if (graphGit(root, "diff", "--name-only", "HEAD", "--", input.path) || graphGit(root, "ls-files", "--others", "--exclude-standard", "--", input.path)) throw new Error(`Capture destination changed: ${input.path}`)
   const path = graphFile(root, input.path)
   if (input.bytes === null) { if (existsSync(path)) unlinkSync(path) }
   else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(input.bytes, "base64")); chmodSync(path, input.executable ? 0o755 : 0o644) }
  }
  if (selected.length) {
   graphGit(root, "add", "--", ...selected)
   if (graphGit(root, "diff", "--cached", "--name-only")) graphGit(root, "commit", "-m", "Capture approved graph inputs", "--", ...selected)
  }
  if (graphDirtyPaths(root).length || repo.inputs.some(input => JSON.stringify(graphInput(root, input.path)) !== JSON.stringify(input))) throw new Error("Capture hooks or filters changed approved bytes; preserve and inspect the workspace.")
 }
 const captured = graphGit(root, "rev-parse", "HEAD")
 if (captured !== repo.base && (graphGit(root, "rev-list", "--count", `${repo.base}..HEAD`) !== "1" || graphGit(root, "diff", "--name-only", "--no-renames", "-z", repo.base, captured).split("\0").filter(Boolean).some(path => !selected.includes(path)))) throw new Error("Capture hook changed unapproved history. Preserve the workspace.")
 workspace.captureCommit = captured
 persist()
}
export function verifyGraphChanges(repo: GraphRepository, owners: string[], mode: TaskGraphPlan["mode"], base = repo.workspace?.captureCommit): void {
 verifyGraphWorkspace(repo)
 if (!base) throw new Error("Finish input capture before writes.")
 const root = repo.workspace!.path!
 const check = (path: string) => { graphFile(root, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error(`Outside task ownership: ${path}`) }
 for (const path of graphDirtyPaths(root)) check(path)
 graphGit(root, "merge-base", "--is-ancestor", base, "HEAD")
 for (const commit of graphGit(root, "rev-list", `${base}..HEAD`).split("\n").filter(Boolean)) {
  const paths = graphGit(root, "diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-m", "-z", commit).split("\0").filter(Boolean)
  for (const path of paths) check(path)
  if (paths.length && graphGit(root, "ls-tree", "-r", "-z", commit, "--", ...paths).split("\0").some(entry => entry && !/^100(?:644|755) blob /.test(entry))) throw new Error("History contains a non-regular file.")
 }
}
export function checkpointGraphChanges(repo: GraphRepository, owners: string[], mode: TaskGraphPlan["mode"], base: string, paths: string[], message: string): string {
 verifyGraphChanges(repo, owners, mode, base)
 if (!paths.length || new Set(paths).size !== paths.length || !message.trim()) throw new Error("Checkpoint requires unique explicit paths and a message.")
 for (const path of paths) { graphFile(repo.workspace!.path!, path); assertGraphMode(mode, path); if (!owns(owners, path)) throw new Error("Checkpoint outside task ownership.") }
 const root = repo.workspace!.path!
 try {
  graphGit(root, "add", "--", ...paths)
  if (graphGit(root, "diff", "--cached", "--name-only", "--", ...paths)) graphGit(root, "commit", "-m", message, "--", ...paths)
 } finally { verifyGraphChanges(repo, owners, mode, base) }
 return verifyGraphWorkspace(repo)
}
export function graphWritePath(record: GraphRecord, path: string): void {
 if (path !== resolve(path)) throw new Error('Graph writes require literal absolute paths without traversal.')
 const task = record.plan.tasks.find(task => task.id === record.active?.task)
 const repo = task && record.repositories.find(repo => repo.source === resolve(record.root, task.repository))
 if (!task || !repo?.workspace?.path || !record.active?.setup) throw new Error("Start the current task and finish setup before writing.")
 if (!path.startsWith(`${repo.workspace.path}${sep}`)) throw new Error("Writes must target the active task's isolated workspace, never its source or another task.")
 verifyGraphWorkspace(repo)
 const local = relative(repo.workspace.path, path).split(sep).join("/")
 graphFile(repo.workspace.path, local)
 assertGraphMode(record.plan.mode, local)
 if (!owns(task.owns, local)) throw new Error("Write outside task ownership.")
}
export function graphRepositoryMap(record: GraphRecord): Record<string, { path: string; head: string }> {
 return Object.fromEntries(record.repositories.map(repo => {
  const head = repo.workspace ? verifyGraphWorkspace(repo) : graphGit(repo.source, "rev-parse", "HEAD")
  if (!repo.workspace && (head !== repo.base || repositoryIdentity(repo.source) !== repo.identity)) throw new Error("Read-only source changed; inspect the selected commit, not a later checkout.")
  return [repo.source, { path: repo.workspace?.path ?? repo.source, head }]
 }))
}
function metadata(markdown: string, key: string): string | undefined {
 const section = markdown.split(/^##\s+Metadata\s*$/im)[1]?.split(/^##\s+/m)[0]
 return section?.match(new RegExp(`^\\s*-\\s*${key}:\\s*([^\\n]+)`, "im"))?.[1].trim()
}
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
  const doc = matches[0]
  const status = metadata(doc.markdown, "Status")?.toLowerCase()
  if (status === "completed" && doc.path.startsWith("docs/exec-plans/completed/")) return
  if (stack.has(id)) throw new Error("Plan dependencies contain a cycle.")
  if (closure.has(id)) return
  if (!["approved", "not-required"].includes(metadata(doc.markdown, "Security-Approval")?.toLowerCase() ?? "") || (doc.path.startsWith("docs/future/") ? status !== "ready-for-promotion" : !["queued", "in-progress", "in-review", "validation", "budget-exhausted", "ready-for-promotion"].includes(status ?? ""))) throw new Error(`Plan ${id} is blocked, draft, completed, or lacks security approval.`)
  for (const field of ["Priority", "Dependencies", "Acceptance-Criteria", "Validation-Lanes", "Risk-Tier"]) if (!metadata(doc.markdown, field)) throw new Error(`Plan ${id} lacks ${field}.`)
  const product = metadata(doc.markdown, 'Product-Approval')?.toLowerCase()
  if (product && !['approved', 'not-required'].includes(product)) throw new Error(`Plan ${id} lacks required Product approval.`)
  const dependencies = metadata(doc.markdown, "Dependencies")!
  for (const dependency of dependencies.toLowerCase() === "none" ? [] : dependencies.split(",").map(item => item.trim())) visit(dependency, new Set(stack).add(id))
  closure.set(id, doc)
 }
 visit(target.id)
 if (!closure.size || closure.size !== record.plan.tasks.length || record.plan.tasks.some(task => !closure.has(task.id))) throw new Error("Execution tasks must match the complete unfinished plan dependency closure, without extra plans.")
 const scheduled = new Set<string>()
 for (const task of record.plan.tasks) {
  const doc = closure.get(task.id)!
  const dependencies = (metadata(doc.markdown, "Dependencies")!.split(",").map(item => item.trim())).filter(id => closure.has(id))
  if (JSON.stringify([...task.depends_on].sort()) !== JSON.stringify([...dependencies].sort()) || resolve(record.root, task.repository) !== doc.source) throw new Error("Plan task repositories and dependencies must match the foundation metadata.")
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
 const plan = record.plans?.find(plan => plan.id === id)
 if (!plan) return undefined
 const repo = record.repositories.find(repo => repo.source === plan.source)!
 if (!repo.workspace?.path) throw new Error("Prepare the plan workspace first.")
 const paths = ["docs/future", "docs/exec-plans/active", "docs/exec-plans/completed"].map(directory => `${directory}/${plan.filename}`)
 const matches = paths.filter(path => existsSync(graphFile(repo.workspace!.path!, path)))
 if (matches.length !== 1) throw new Error(`Plan ${id} has missing or duplicate lifecycle paths. Preserve and inspect them.`)
 const local = matches[0], path = graphFile(repo.workspace.path, local), markdown = readFileSync(path, "utf8")
 if (metadata(markdown, "Plan-ID") !== id || !["approved", "not-required"].includes(metadata(markdown, "Security-Approval")?.toLowerCase() ?? "")) throw new Error("Plan identity or approval changed.")
 const product = metadata(markdown, 'Product-Approval')?.toLowerCase()
 if (product && !['approved', 'not-required'].includes(product)) throw new Error('Required Product approval changed or remains pending.')
 return { repo, path, local, filename: plan.filename, status: metadata(markdown, "Status")?.toLowerCase(), markdown }
}
export function verifyPlanCloseout(record: GraphRecord, deliveryPending: boolean): void {
 for (const plan of record.plans ?? []) {
  const location = graphPlanLocation(record, plan.id)!
  const closed = location.local.startsWith("docs/exec-plans/completed/") && location.status === "completed"
  const pending = deliveryPending && location.local.startsWith("docs/exec-plans/active/") && location.status === "validation"
  const evidence = metadata(location.markdown, "Done-Evidence")
  if ((!closed && !pending) || !evidence || /^(?:pending|none|not-run|todo)$/i.test(evidence)) throw new Error(`Plan ${plan.id} has incomplete closeout. Require Done-Evidence and completed status/path, or explicit delivery-pending validation.`)
 }
}
export const saveGraphRecord = saveRecord
