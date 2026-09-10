import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

export const LEGACY_GRAPH = "Unsupported legacy graph state. Preserve this record and its Run. Inspect its repositories, workers and retained commits read-only; retirement requires separate, verified authorization. Do not resume, migrate, complete, delete or restart this Run."
export interface TaskGraphTask {
 id: string
 goal: string
 repository: string
 depends_on: string[]
 owns: string[]
 done_when: string[]
 validation: string
 setup?: string
}
export interface TaskGraphPlan {
 objective: string
 mode: "plan-only" | "execute"
 tasks: TaskGraphTask[]
 foundations: Array<{ repository: string; commit: string }>
 inputs?: Array<{ repository: string; paths: string[] }>
}
export type Orca = (args: string[]) => any
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
export function gitEnvironment(): NodeJS.ProcessEnv {
 return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1", ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_(AUTHOR|COMMITTER)_/.test(key))) }
}
export function graphGit(root: string, ...args: string[]): string {
 return execFileSync("git", ["--no-replace-objects", "-C", root, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: gitEnvironment() }).trimEnd()
}
export function repositoryIdentity(root: string): string {
 return realpathSync(resolve(root, graphGit(root, "rev-parse", "--git-common-dir")))
}
export function repositoryRoot(root: string): string {
 return realpathSync(graphGit(root, "rev-parse", "--show-toplevel"))
}
export function saveRecord(file: string, record: unknown): void {
 mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
 const temporary = `${file}.${randomUUID()}.tmp`
 writeFileSync(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 })
 renameSync(temporary, file)
}
export function literalPath(path: string): void {
 if (!path || isAbsolute(path) || /[\\\x00-\x1f\x7f*?\[\]{}:]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /^(?:\.env(?:\.|$)|\.npmrc$|\.netrc$|\.git-credentials$)/i.test(part) && part !== ".env.example" || /\.(?:pem|key)$/i.test(part))) throw new Error(`Use a literal, non-secret repository-relative path: ${path}`)
}
export function owns(owners: string[], path: string): boolean {
 return owners.some(owner => path === owner || path.startsWith(`${owner}/`))
}
export function assertGraphMode(mode: TaskGraphPlan["mode"], path: string): void {
 if (mode === "plan-only" && (!path.startsWith("docs/") || !path.endsWith(".md") || path.toLowerCase().startsWith("docs/exec-plans/"))) throw new Error("Planning-only writes require Markdown under docs/, outside docs/exec-plans/. No implementation or promotion.")
}
// No shell language: these are approved repository checks, not an alternate command channel.
export function assertGraphShell(command: string): void {
 if (!command.trim() || /[\n\r;&|`$<>\\]/.test(command)) throw new Error("Graph checks must be a single command without chaining, substitution, redirection or escapes.")
 let words = command.match(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g)
 if (!words || words.join(" ") !== command.trim().replace(/ +/g, " ") || words.some(word => /^(?:[A-Za-z_][A-Za-z0-9_]*=|\.\.[/\\]|~\/)/.test(word))) throw new Error("Graph checks do not accept environment overrides or parent-relative paths.")
 if (!/^(?:node|npm|pnpm|yarn|bun|uv|pytest|cargo|go|make)$/.test(words[0])) throw new Error("Graph shell permits declared repository checks only. Git, gh, shells, workers, publishing and deletion need separate tools or authorization.")
 const tokens = words
 words = words.map(word => /^["']/.test(word) ? word.slice(1, -1) : word)
 if (words.some(word => /^(?:[A-Za-z_][A-Za-z0-9_]*=|\.\.[/\\]|~\/)/.test(word))) throw new Error("Graph checks do not accept quoted environment overrides or parent-relative paths.")
 if (words[0] === "uv") {
  if (words[1] === "run") {
   let executable = 2
   while (["--locked", "--frozen", "--no-sync"].includes(words[executable])) executable++
   assertGraphShell(tokens.slice(executable).join(" "))
  } else if (words[1] !== "sync") throw new Error("Graph uv checks support sync or run with an approved check executable only.")
 }
 if (words.some(word => /^-(?:e|p|c|C)/.test(word) || ["node", "bun"].includes(words![0]) && /^-r/.test(word)) || words.some(word => /^(?:-e|-p|--eval|--print|--require|--import|--loader|--experimental-loader|--prefix|--dir|--directory|--cwd|-C|--config|--git-dir|--work-tree)(?:=|$)/.test(word)) || words.some(word => /^(?:publish|pub|deploy|release|exec|explore|dlx|x|remove|uninstall)$/.test(word))) throw new Error("Executable/config/path overrides and publishing are not graph checks.")
}
export function validateTaskGraph(plan: TaskGraphPlan, root: string): void {
 if (Object.keys(plan).some(key => !["objective", "mode", "tasks", "foundations", "inputs"].includes(key))) throw new Error("Unsupported graph option. Workers, cleanup and source-checkout execution were removed.")
 if (!plan.objective?.trim() || !["plan-only", "execute"].includes(plan.mode) || !Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 12) throw new Error("A graph needs an objective, mode and one to twelve tasks.")
 const ids = new Set(plan.tasks.map(task => task.id))
 if (ids.size !== plan.tasks.length) throw new Error("Duplicate task IDs.")
 const completed = new Set<string>()
 for (const task of plan.tasks) {
  if (Object.keys(task).some(key => !["id", "goal", "repository", "depends_on", "owns", "done_when", "validation", "setup"].includes(key)) || !/^[a-z0-9][a-z0-9-]*$/.test(task.id) || !task.goal?.trim() || !task.repository || !Array.isArray(task.owns) || !Array.isArray(task.depends_on) || !task.done_when?.length || task.done_when.some(item => !item.trim())) throw new Error("Invalid task contract.")
  if (task.depends_on.some(id => !completed.has(id)) || new Set(task.depends_on).size !== task.depends_on.length) throw new Error("List tasks in dependency order; dependencies must be unique earlier tasks.")
  completed.add(task.id)
  const source = realpathSync(resolve(root, task.repository))
  if (repositoryRoot(source) !== source || source !== resolve(root, task.repository)) throw new Error("Select an exact physical Git repository root, without a symlink alias.")
  for (const path of task.owns) {
   literalPath(path)
   if (plan.mode === "plan-only" && !(path === "docs" || path.startsWith("docs/")) || plan.mode === "plan-only" && path.toLowerCase().startsWith("docs/exec-plans")) throw new Error("Planning-only ownership must stay in documentation outside the execution lifecycle.")
  }
  if (task.owns.length) assertGraphShell(task.validation)
  else if (!/^manual: \S[\s\S]*$/.test(task.validation)) throw new Error("Read-only tasks require explicit validation: manual: <inspection criteria>. Script checks require a writing workspace.")
  if (task.setup) { if (!task.owns.length) throw new Error("Read-only tasks need no setup."); assertGraphShell(task.setup) }
 }
 const sources = [...new Set(plan.tasks.map(task => realpathSync(resolve(root, task.repository))))]
 if (!Array.isArray(plan.foundations) || plan.foundations.length !== sources.length || new Set(plan.foundations.map(item => realpathSync(resolve(root, item.repository)))).size !== sources.length) throw new Error("Select exactly one explicit foundation commit per repository.")
 for (const foundation of plan.foundations) {
  const source = realpathSync(resolve(root, foundation.repository))
  if (!sources.includes(source) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(foundation.commit) || graphGit(source, "rev-parse", `${foundation.commit}^{commit}`) !== foundation.commit) throw new Error("Foundation must be an exact existing commit, not a branch or ambiguous selector.")
 }
 if (new Set(sources.map(repositoryIdentity)).size !== sources.length) throw new Error("Select one source checkout per Git repository.")
}

// Old records are evidence, never a source of executable authority. Unknown scope fails closed.
export function assertNoLegacyGraph(agentDir: string, identities: string[]): void {
 const root = join(agentDir, "task-graph-locks")
 if (!existsSync(root)) return
 for (const entry of readdirSync(root).filter(name => name.endsWith(".lock"))) {
  const directory = join(root, entry)
  const fail = () => { throw new Error(`${LEGACY_GRAPH}\nRecord: ${directory}`) }
  try {
   const file = join(directory, "workspaces.json")
   if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, "utf8"))
    if (!Array.isArray(state.repositories) || !state.repositories.length || state.repositories.some((repo: any) => typeof repo.identity !== "string" || !isAbsolute(repo.identity))) fail()
    if (state.repositories.some((repo: any) => identities.includes(repo.identity))) fail()
   } else {
    const owner = JSON.parse(readFileSync(join(directory, "owner.json"), "utf8"))
    const identity = owner.runKey?.match(/^(.+)::(?:objective|plan|path):/)?.[1]
    const plan = JSON.parse(owner.planContract)
    if (!identity || identities.includes(identity) || !Array.isArray(plan.tasks) || !plan.tasks.length || [...plan.tasks, ...(plan.inputs ?? [])].some(task => task.repository && task.repository !== ".")) fail()
   }
  } catch (error) { if (error instanceof Error && error.message.startsWith(LEGACY_GRAPH)) throw error; fail() }
 }
}

function processStart(pid: number): string {
 return process.platform === "linux" ? readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[21] : execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim()
}
function liveLease(owner: any): boolean {
 if (!Number.isSafeInteger(owner.pid) || owner.pid < 0 || typeof owner.token !== "string") throw new Error("Invalid coordinator lease. Preserve it for inspection.")
 if (!owner.pid) return false
 try { process.kill(owner.pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error }
 return !owner.start || owner.start === processStart(owner.pid)
}
// ponytail: host-local PID lease; cross-host coordinators require an Orca lease service.
export function acquireLease(file: string): () => void {
 const lock = `${file}.lease`
 const token = randomUUID()
 const owner = { pid: process.pid, start: processStart(process.pid), token }
 try { writeFileSync(lock, JSON.stringify(owner), { flag: "wx", mode: 0o600 }) }
 catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  const before = readFileSync(lock, "utf8")
  if (liveLease(JSON.parse(before))) throw new Error("This graph has a live coordinator. Stop it before resuming.")
  // One resumer can replace a dead owner. An interrupted recovery reservation fails closed.
  const reservation = `${lock}.recovery`
  mkdirSync(reservation, { mode: 0o700 })
  try {
   if (readFileSync(lock, "utf8") !== before) throw new Error("Coordinator lease changed during recovery.")
   saveRecord(lock, owner)
  } finally { rmdirSync(reservation) }
 }
 return () => {
  const current = JSON.parse(readFileSync(lock, "utf8"))
  if (current.token !== token) throw new Error("Coordinator lease ownership changed.")
  // Release authority, not evidence. The record and every Git workspace remain intact.
  saveRecord(lock, { ...owner, pid: 0 })
 }
}

export function taskGraphPrompt(objective: string, mode: TaskGraphPlan["mode"]): string {
 return `Graph ${mode}: ${objective}
Read AGENTS.md, repository planning rules, the named plan and actual callers first. Use read/search tools before approval.
The coordinator writes all tasks itself, sequentially in the listed dependency order. Tasks track progress, not agents.
Propose one to twelve tasks with literal owned paths, completion criteria, and exact setup and validation commands. Include every required closeout lane in validation. Resolve the full unfinished plan dependency chain, with priority then Plan-ID ordering. Stop on missing, duplicate, draft, blocked or unapproved execution plans. Never invent external approval.
Read-only tasks require validation written as manual: <inspection criteria>, no setup, and inspection evidence at completion. They never claim a script ran. Without a snapshot or writing workspace, their foundation must equal source HEAD.
Select one explicit source path and full foundation commit per repository. Execution starts from the selected retained planning commits or another explicitly selected foundation, never guessed historical workspaces. Include only exact necessary dirty inputs. Capture is not write ownership.
Planning permits only Markdown under docs/, outside docs/exec-plans/. Planning ends without implementation. Execution requires a separate /graph execute command and approval.
After propose_task_graph approval, call prepare_task_graph_workspace. Start the first unfinished task with start_task_graph_task. Use returned absolute workspace paths for file tools. Run declared setup and validation through bash with repository set to the exact workspace. Cross-repository checks use AGENT_TOOLKIT_GRAPH_REPOSITORIES, not implicit siblings. Use checkpoint_task_graph for explicit-path commits with hooks enabled. Use move_task_graph_plan for the current plan's active/completed move; edit its status and Done-Evidence explicitly. Then complete_task_graph_task with evidence.
Before completing an execution plan, satisfy every must-land item, validation lane, review rule, approval gate, Done-Evidence, evidence index and plan-closeout check. Promote only the current eligible plan. Do not promote later plans early or close dependent future plans. Leave publication-dependent plans active in validation and report local-ready, never shipped.
Finish only after every task and required closeout passes. Retain all source, planning and execution worktrees. No dispatch, worker accounts, quota, integration, cleanup, publishing or merge-back authority. A permission denial is a blocker, never a reason to bypass a guard.
On interruption, repeat this exact /graph command. Resume its record and snapshots, never recapture changed inputs. Legacy Runs are unsupported evidence and require separate retirement authorization.`
}
