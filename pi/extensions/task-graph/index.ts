import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { createBashTool, getAgentDir, isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { defaultPiAccount, fetchCodexUsage, piAccountEmail, piProfileAccountId } from "../codex-account/index.ts"
import {
	abandonTaskGraphLock,
	acquireTaskGraphLock,
	acquireTaskGraphMutationLock,
	bindTaskGraphLockToOrcaRun,
	bindTaskGraphLockToPlanContract,
	formatTaskGraph,
	isTaskGraphRecoveryCommand,
	isTaskGraphWorkerLaunch,
	normalizeTaskGraphOwnership,
	planDependencies,
	planId,
	planMetadata,
	planPriority,
	planSecurityApproved,
	planStatus,
	planningDocumentIsExecutable,
	planningDocumentNeedsRecovery,
	planningDocumentRequiresPlanOnly,
	releaseTaskGraphLock,
	repositoryIdentity,
	replacePlanStatus,
	resolvePlanLifecyclePath,
	reviewTaskGraph,
	shellSegments,
	taskGraphLockKeysForRun,
	taskGraphOrcaRunIdsForLockRun,
	taskGraphPlanContractsForLockRun,
	taskGraphOrcaArgv,
	taskGraphOrcaInvocations,
	taskGraphOrcaOperations,
	taskGraphStandaloneOrca,
	taskGraphQuotaPauseReason,
	taskGraphPrompt,
	taskGraphTerminalTitle,
	taskGraphWorkerAccount,
	taskGraphWorkerEnvironment,
	taskGraphWorkerThinking,
	taskGraphWorkerModel,
	TASK_GRAPH_SHORT_QUOTA_RESERVE,
	TASK_GRAPH_USAGE,
	TASK_GRAPH_WEEKLY_QUOTA_RESERVE,
	type TaskGraphLock,
	type TaskGraphPlan,
	validateTaskGraph,
	validateTaskGraphRepositories,
} from "./task-graph-core.ts"

import { cleanupGraphWorkers } from "./cleanup.ts"
import { validateRunRecovery, type RunRecoverySnapshot } from "./run-recovery.ts"
import { assertGraphInputs, captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphDirtyPaths, graphGit, graphMergeHead, graphRepositoryMap, graphOwns, graphWritePath, importGraphInputs, integrateGraphWorker, readGraphWorkspaces, reconcileGraphLaunch, saveGraphWorkspaces, verifyGraphChanges, verifyGraphWorkspace, type GraphWorkspaces, type GraphWorkerWorkspace, type GraphRepository } from "./workspaces.ts"

const taskSchema = Type.Object({
	id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$", description: "Stable lowercase task ID" }),
	goal: Type.String({ minLength: 1, description: "One bounded outcome" }),
	depends_on: Type.Array(Type.String({ minLength: 1 }), { maxItems: 11, description: "Hard prerequisite task IDs" }),
	repository: Type.Optional(Type.String({ minLength: 1, description: "Local Git repository root relative to the current repository; defaults to the current repository" })),
	owns: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20, description: "Exclusive write paths relative to this task's repository; empty for read-only work" }),
	specialty: Type.String({ minLength: 1, description: "Worker expertise needed for this task" }),
	thinking: Type.Union([Type.Literal("medium"), Type.Literal("high")], { description: "Worker thinking level: medium by default; high only when the user explicitly requests it" }),
	done_when: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10, description: "Observable completion criteria" }),
	validation: Type.String({ minLength: 1, description: "Smallest focused validation command or manual check" }),
	setup: Type.Optional(Type.String({ minLength: 1, description: "Required setup command from repository rules. Run this exact command with bash in each prepared worker workspace before launch; omit only if no setup is needed." })),
}, { additionalProperties: false })

const graphSchema = Type.Object({
	objective: Type.String({ minLength: 1 }),
	mode: Type.Union([Type.Literal("plan-only"), Type.Literal("execute")], {
		description: "plan-only for blocked work or execute for approved work",
	}),
	tasks: Type.Array(taskSchema, { minItems: 1, maxItems: 12 }),
	inputs: Type.Optional(Type.Array(Type.Object({ repository: Type.Optional(Type.String()), paths: Type.Array(Type.String(), { maxItems: 100 }) }, { additionalProperties: false }), { maxItems: 12, description: "Exact dirty input files to capture in isolation; never import the whole dirty checkout implicitly." })),
	current_checkout: Type.Optional(Type.Boolean({ description: "Explicit exception: use clean source checkouts for coordinator writes. Writing workers remain isolated. Requires separate human confirmation." })),
	cleanup_workers: Type.Optional(Type.Boolean({ description: "Explicit approval to remove this Run's clean, integrated worker worktrees after local closeout, including ignored setup artifacts. Keep source and delivery worktrees, and label delivery worktrees clearly. Never force removal or close live terminals." })),
}, { additionalProperties: false })

function repositoryRoot(cwd: string): string {
	let current = realpathSync(cwd)
	while (!existsSync(join(current, ".git"))) {
		const parent = dirname(current)
		if (parent === current) return realpathSync(cwd)
		current = parent
	}
	return current
}

interface WorkerAccount {
	profile: string
	profileHash: string
	email: string
	accountId: string
	agentDir: string
}

export interface LocalPlan {
	target: string
	root: string
	local: string
	markdown: string
}

export function resolveLocalPlan(cwd: string, objective: string): LocalPlan | undefined {
	const target = resolvePlanLifecyclePath(cwd, objective)
	if (!target) return undefined
	const root = repositoryRoot(dirname(target))
	if (!existsSync(join(root, ".git"))) return undefined
	return {
		target,
		root,
		local: relative(root, target).split(sep).join("/"),
		markdown: readFileSync(target, "utf8"),
	}
}

function orcaExecutable(): string {
	return process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca")
}

function orcaJson(args: string[]): any {
	const response = JSON.parse(execFileSync(orcaExecutable(), args, { encoding: "utf8", timeout: 10_000 }))
	if (response?.ok !== true) throw new Error(response?.error?.message ?? response?.error ?? "Orca command failed.")
	return response
}

function optionValues(argv: string[], name: string): string[] {
	return argv.flatMap((argument, index) => argument === name && argv[index + 1] ? [argv[index + 1]] : argument.startsWith(`${name}=`) ? [argument.slice(name.length + 1)] : [])
}

function hasOption(argv: string[], name: string): boolean {
	return argv.some((argument) => argument === name || argument.startsWith(`${name}=`))
}

function terminalReceiptFromOutput(output: string): { handle: string; repository: string } | undefined {
	for (let start = output.indexOf("{"); start >= 0; start = output.indexOf("{", start + 1)) {
		for (let end = output.lastIndexOf("}"); end > start; end = output.lastIndexOf("}", end - 1)) {
			try {
				const response = JSON.parse(output.slice(start, end + 1))
				const terminal = response?.result?.terminal ?? response?.result?.split
				const repository = String(terminal?.worktreePath || terminal?.worktreeId || "").split("::").at(-1)
				if (typeof terminal?.handle === "string" && repository && existsSync(repository)) return { handle: terminal.handle, repository: realpathSync(repository) }
			} catch {}
		}
	}
	return undefined
}

function orcaTerminalHandles(): Set<string> {
	const inventory = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result
	const terminals = inventory?.terminals
	if (!Array.isArray(terminals) || inventory.truncated || inventory.hostScope?.omittedHostIds?.length) throw new Error("Orca terminal listing is incomplete.")
	return new Set(terminals.flatMap((terminal: { handle?: unknown }) => typeof terminal.handle === "string" ? [terminal.handle] : []))
}

function orcaRuns(): any[] {
	const runs: any[] = []
	let cursor: string | undefined
	do {
		const response = orcaJson(["orchestration", "run-list", "--limit", "100", ...(cursor ? ["--cursor", cursor] : []), "--json"])
		if (!Array.isArray(response?.result?.runs)) throw new Error("Orca Run listing is incomplete.")
		runs.push(...response.result.runs)
		cursor = response.result.nextCursor || undefined
	} while (cursor)
	return runs
}

function orcaRepositoryRoots(): string[] {
	const response = orcaJson(["repo", "list", "--json"])
	const repos = response?.result?.repos
	if (!Array.isArray(repos)) throw new Error("Orca did not return its repository inventory.")
	return [...new Set(repos.flatMap((repo: { path?: unknown }) => typeof repo.path === "string" && existsSync(join(repo.path, ".git")) ? [realpathSync(repo.path)] : []))]
}

function taskGraphRunKey(cwd: string, objective: string, plan?: LocalPlan): string {
	if (!plan) return `${repositoryIdentity(repositoryRoot(cwd))}::objective:${objective}`
	const id = planId(plan.markdown)
	if (!id && localPlanChain(plan)) throw new Error(`Execution plan has no Plan-ID: ${plan.local}`)
	return `${repositoryIdentity(plan.root)}::${id ? `plan:${id}` : `path:${plan.target}`}`
}

function localPlanChain(plan?: LocalPlan): boolean {
	return Boolean(plan && /^(?:docs\/future|docs\/exec-plans\/(?:active|completed))\/.+\.md$/.test(plan.local))
}

function planPathsById(root: string, id: string): string[] {
	const matches: string[] = []
	const pending = ["docs/future", "docs/exec-plans/active", "docs/exec-plans/completed"].map((directory) => join(root, directory))
	while (pending.length > 0) {
		const path = pending.pop()!
		if (!existsSync(path)) continue
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const candidate = join(path, entry.name)
			if (entry.isDirectory() && entry.name !== "evidence") pending.push(candidate)
			else if (entry.isFile() && entry.name !== "README.md" && entry.name.endsWith(".md") && planId(readFileSync(candidate, "utf8")) === id) matches.push(realpathSync(candidate))
		}
	}
	return matches
}

function validatePlanChainPlans(plan: TaskGraphPlan, root: string, targetKey: string, repositoryRoots: string[], recovery = false, state?: GraphWorkspaces): string[] {
	const executionRoot = (source: string) => state?.repositories.find((repo) => repo.source === source)?.workspace?.path ?? source
	const taskRoots = new Set(plan.tasks.map((task) => executionRoot(realpathSync(resolve(root, task.repository ?? ".")))))
	const registered = new Map<string, string[]>()
	for (const repository of repositoryRoots) {
		const identity = repositoryIdentity(repository)
		registered.set(identity, [...(registered.get(identity) ?? []), repository])
	}
	for (const taskRoot of taskRoots) {
		const identity = repositoryIdentity(taskRoot)
		if (!registered.has(identity)) throw new Error(`Plan repository is not registered in Orca: ${taskRoot}`)
		registered.set(identity, [taskRoot])
	}
	const repositories = new Set([...registered.values()].flat())
	const find = (id: string) => [...new Set([...repositories].flatMap((repository) => planPathsById(repository, id)))]
	const keys = plan.tasks.map((task) => `${repositoryIdentity(realpathSync(resolve(root, task.repository ?? ".")))}::plan:${task.id}`)
	const priorities = new Map<string, number>()
	const target = plan.tasks[keys.indexOf(targetKey)]
	if (!target) throw new Error("A plan chain must include the selected target and use each Plan-ID as its task ID.")

	for (const task of plan.tasks) {
		const taskRoot = executionRoot(realpathSync(resolve(root, task.repository ?? ".")))
		if (planPathsById(taskRoot, task.id).length !== 1) throw new Error(`Plan-chain task ${task.id} must match exactly one Plan-ID in ${task.repository ?? "."}.`)
		const matches = find(task.id)
		if (matches.length !== 1) throw new Error(`Plan-ID ${task.id} must match exactly one local plan.`)
		const markdown = readFileSync(matches[0], "utf8")
		const priority = planPriority(markdown)
		if (priority === undefined) throw new Error(`Plan-chain task ${task.id} must declare Priority p0, p1, p2, or p3.`)
		priorities.set(task.id, priority)
		const local = relative(taskRoot, matches[0]).split(sep).join("/")
		const acceptance = planMetadata(markdown, "Acceptance-Criteria")
		const validation = planMetadata(markdown, "Validation-Lanes")
		const risk = planMetadata(markdown, "Risk-Tier")?.toLowerCase()
		if (!acceptance || !validation || !risk || !["low", "medium", "high"].includes(risk)) throw new Error(`Plan-chain task ${task.id} has incomplete execution metadata.`)
		const targets = ["Spec-Targets", "Implementation-Targets"]
			.flatMap((field) => planMetadata(markdown, field)?.split(",") ?? [])
			.map((target) => target.trim())
			.filter((target) => target && target.toLowerCase() !== "none")
		if (targets.length === 0) throw new Error(`Plan-chain task ${task.id} has no Spec-Targets or Implementation-Targets.`)
		const filename = local.replace(/^docs\/(?:future|exec-plans\/(?:active|completed))\//, "")
		const lifecycleTargets = [`docs/future/${filename}`, `docs/exec-plans/active/${filename}`, `docs/exec-plans/completed/${filename}`]
		task.owns = [...new Set([...lifecycleTargets, ...targets, `docs/exec-plans/evidence-index/${task.id}.md`, `docs/exec-plans/active/evidence/${task.id}`])]
		if (task.owns.length > 20) throw new Error(`Plan-chain task ${task.id} exceeds 20 ownership targets.`)
		task.done_when = [acceptance, `Validation lanes: ${validation}`]
		const recoveryTask = planningDocumentNeedsRecovery(local, markdown)
		if (recoveryTask && !planSecurityApproved(markdown)) throw new Error(`Plan-chain recovery task ${task.id} has no approved security gate.`)
		if (!recoveryTask && !planningDocumentIsExecutable(local, markdown)) throw new Error(`Plan-chain task ${task.id} is not executable.`)
		const declared = planDependencies(markdown)
		const expected = declared.filter((dependency) => {
			const dependencies = find(dependency)
			if (dependencies.length !== 1) throw new Error(`Dependency ${dependency} must match exactly one local plan.`)
			const dependencyRoot = [...repositories]
				.filter((repository) => dependencies[0].startsWith(`${repository}${sep}`))
				.sort((a, b) => b.length - a.length)[0]
			const localDependency = dependencyRoot ? relative(dependencyRoot, dependencies[0]).split(sep).join("/") : ""
			return planStatus(readFileSync(dependencies[0], "utf8")) !== "completed" || !localDependency.startsWith("docs/exec-plans/completed/")
		})
		if (expected.some((dependency) => !task.depends_on.includes(dependency)) || task.depends_on.some((dependency) => !declared.includes(dependency)) || !recovery && expected.length !== task.depends_on.length) {
			throw new Error(`Plan-chain task ${task.id} must preserve its unfinished Dependencies exactly.`)
		}
	}

	const byId = new Map(plan.tasks.map((task) => [task.id, task]))
	const reachable = new Set<string>()
	const visit = (task: (typeof plan.tasks)[number]) => {
		if (reachable.has(task.id)) return
		reachable.add(task.id)
		for (const dependency of task.depends_on) visit(byId.get(dependency)!)
	}
	visit(target)
	if (reachable.size !== plan.tasks.length) throw new Error("A plan chain cannot include plans outside the selected target's dependency closure.")

	const remaining = new Set(plan.tasks.map((task) => task.id))
	const scheduled = new Set<string>()
	const order: string[] = []
	while (remaining.size > 0) {
		const next = plan.tasks
			.filter((task) => remaining.has(task.id) && task.depends_on.every((dependency) => scheduled.has(dependency)))
			.sort((a, b) => priorities.get(a.id)! - priorities.get(b.id)! || a.id.localeCompare(b.id))[0]
		if (!next) break
		order.push(next.id)
		scheduled.add(next.id)
		remaining.delete(next.id)
	}
	if (order.some((id, index) => plan.tasks[index]?.id !== id)) throw new Error("Plan-chain tasks must use dependency, Priority, then Plan-ID order.")
	return [...new Set(keys)].sort()
}

export function assertGraphShell(command: string, state: GraphWorkspaces, cwd: string): void {
	if (/\$\(|`|[<>]/.test(command)) throw new Error("Use file tools for writes and repository scripts for complex shell commands; graph shell redirection and substitution are not authorized.")
	const segments = shellSegments(command)
	if (!segments) throw new Error("Cannot parse the graph shell command.")
	for (const words of segments) {
		const git = words.findIndex((word) => basename(word) === "git")
		if (git >= 0) {
			const args = words.slice(git + 1).filter((word) => word !== "--no-pager")
			if (!args.length || args[0].startsWith("-") || !["status", "diff", "log", "show", "grep", "ls-files", "ls-tree", "rev-parse", "rev-list", "merge-base", "blame", "describe", "cat-file"].includes(args[0])) throw new Error("Use checkpoint_task_graph for scoped local commits and the integration tool for merges. Shell Git is read-only, without -C or config overrides.")
		}
		if (words.some((word) => ["gh", "glab", "orca", "orca-dev", "orca-ide", basename(orcaExecutable())].includes(basename(word)))) throw new Error("Use standalone Orca inspection through bash. Hosting and delivery commands require a separate trusted action.")
		if (words.some((word) => /^(?:\.\.[/\\]|~[/\\])/.test(word))) throw new Error("Use approved absolute workspace paths, not parent-relative shell paths.")
		if (["cd", "rm", "rmdir"].includes(words[0])) for (const argument of words.slice(1).filter((word) => !word.startsWith("-"))) {
			const path = resolve(cwd, argument)
			if (/[`$]/.test(argument) || path !== cwd && !path.startsWith(`${cwd}${sep}`) || words[0] !== "cd" && path === cwd || argument.split(/[\\/]/).includes(".git")) throw new Error("Shell navigation and removal must remain inside the graph workspace; worktree cleanup is not authorized.")
		}
	}
	if (!state.currentCheckout && state.repositories.some((repo) => command.includes(repo.source))) throw new Error("Do not reference source checkout paths in graph shell commands; use the isolated workspace paths.")
}

function graphReportingCommand(command: string): boolean {
	const argv = taskGraphOrcaArgv(command)
	return taskGraphStandaloneOrca(command) && argv?.[0] === "orchestration" && ["send", "ask", "check"].includes(argv[1]) && !hasOption(argv, "--from")
}

export default function taskGraphExtension(pi: ExtensionAPI): void {
	let pending: { prompt: string; planChain: boolean; planExecutable: boolean; planOnlyRequired: boolean; recoveryOnly: boolean; recoveryPlan?: LocalPlan; workerModel: string; workerAccount?: WorkerAccount; repositoryRoots: string[]; runObjective: string } | null = null
	let planning = false
	let approved = false
	let finished = false
	let reviewClosed = false
	let planChain = false
	let planExecutable = true
	let planOnlyRequired = false
	let recoveryOnly = false
	let recoveryPlan: LocalPlan | undefined
	let workerModel = ""
	let workerAccount: WorkerAccount | undefined
	let repositoryRoots: string[] = []
	let activeRunKey: string | undefined
	let activeRunObjective: string | undefined
	let activeOrcaRunId: string | undefined
	let boundRunObjective: string | undefined
	let resumingRun = false
	let runCreationAttempted = false
	let recoveredOrcaRunId: string | undefined
	let recoveredPlanContract: string | undefined
	let workerTerminalTitle = ""
	let workspaces: GraphWorkspaces | undefined
	let workspaceFile: string | undefined
	const workerWorkspaceFile = process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES
	const workerTask = process.env.AGENT_TOOLKIT_GRAPH_TASK
	const persistWorkspaces = () => {
		if (!workspaces || !workspaceFile) throw new Error("No graph workspace contract is bound.")
		saveGraphWorkspaces(workspaceFile, workspaces)
	}
	let approvedTaskMarkers: string[] = []
	let approvedPlans: Array<{ root: string; id: string }> = []
	let activeLocks: TaskGraphLock[] = []
	const launchTitle = (worker: GraphWorkerWorkspace) => worker.launch?.title ?? `${workerTerminalTitle}-${worker.task}-${worker.previousTerminals?.length ?? 0}`
	const preparedWorker = (worker: GraphWorkerWorkspace) => ({ workspace: worker, launchTitle: launchTitle(worker), repositories: graphRepositoryMap(workspaces!, worker), environment: { AGENT_TOOLKIT_GRAPH_WORKSPACES: workspaceFile, AGENT_TOOLKIT_GRAPH_TASK: worker.task } })
	const approvedWorkerTerminals = new Set<string>()
	const graphWorkerTerminals = new Set<string>()
	const terminalRepositories = new Map<string, string>()
	const approvedTaskRepositories = new Map<string, string>()
	const approvedTaskDependencies = new Map<string, string[]>()
	const pendingTaskCreates = new Map<string, string>()
	const pendingTerminalLaunches = new Set<string>()
	const coordinatorOwners = (repository: GraphRepository) => {
		const contract = JSON.parse(recoveredPlanContract!) as TaskGraphPlan
		return contract.tasks.filter((task) => approvedTaskRepositories.get(task.id) === repository.source).flatMap((task) => task.owns)
	}
	const verifyCoordinator = (repository: GraphRepository) => verifyGraphChanges(repository, repository.workspace!, coordinatorOwners(repository), workspaces!.mode)
	const workerContext = (cwd: string) => {
		if (!workerWorkspaceFile || !workerTask) throw new Error("Incomplete graph worker workspace binding.")
		const state = readGraphWorkspaces(workerWorkspaceFile)
		const worker = state.workers.find((item) => item.task === workerTask)
		const repository = state.repositories.find((repo) => repo.source === worker?.source)
		if (!worker || !repository || realpathSync(cwd) !== worker.path) throw new Error("Worker cwd does not match its recorded graph workspace.")
		verifyGraphWorkspace(repository, worker)
		return { state, worker, repository }
	}
	const pendingDispatches = new Map<string, string>()
	const approvedLedgerIsComplete = (tasks: unknown): boolean => {
		if (!Array.isArray(tasks) || tasks.length === 0 || tasks.some((task: { status?: unknown }) => task.status !== "completed")) return false
		const specs = tasks.filter((task: { parent_id?: unknown }) => task.parent_id == null).map((task: { spec?: unknown }) => String(task.spec ?? ""))
		return approvedTaskMarkers.every((marker) => specs.filter((spec) => spec.startsWith(marker)).length === 1) && (planChain || resumingRun || specs.length === approvedTaskMarkers.length)
	}
	const approvedDependenciesMatch = (marker: string, tasks: Array<{ id?: unknown; parent_id?: unknown; spec?: unknown }>, argv: string[]): boolean => {
		const id = marker.match(/^\[(?:plan|graph-task):([^\]]+)\]/)?.[1]
		const expected = (approvedTaskDependencies.get(id ?? "") ?? []).map((dependency) => {
			const prefix = approvedTaskMarkers.find((candidate) => candidate.startsWith(`[${planChain ? "plan" : "graph-task"}:${dependency}]`))
			const task = prefix && tasks.find((candidate) => candidate.parent_id == null && String(candidate.spec ?? "").startsWith(prefix))
			return typeof task?.id === "string" ? task.id : ""
		})
		const values = optionValues(argv, "--deps")
		if (values.length > 1) return false
		try {
			const supplied: unknown = values.length ? JSON.parse(values[0]) : []
			return Array.isArray(supplied) && supplied.every((dependency) => typeof dependency === "string") && supplied.length === expected.length && expected.every((dependency) => supplied.includes(dependency))
		} catch {
			return false
		}
	}

	pi.registerTool({
		name: "prepare_task_graph_workspace",
		label: "Prepare Graph Workspace",
		description: "Create or verify the approved isolated coordinator workspaces, or prepare one bound Orca task's worker worktree. Never copies inputs again on resume.",
		parameters: Type.Object({
			task_id: Type.Optional(Type.String({ pattern: "^task_[a-zA-Z0-9_-]+$" })),
			owns: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: "Required exclusive ownership subset for an internal plan task." })),
			retry: Type.Optional(Type.Boolean({ description: "One replacement terminal after a verified failed, closed dispatch; reuse its clean task worktree." })),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_id, params) {
			if (!approved || !activeOrcaRunId || !workspaces || !workspaceFile) throw new Error("Approve and bind the graph before workspace preparation.")
			if (recoveryOnly && !workspaces.currentCheckout && !workspaces.repositories.every((repo) => !repo.workspace || repo.workspace.path)) throw new Error("Lifecycle recovery must reuse its recorded workspaces.")
			for (const repository of workspaces.repositories) {
				if (!repository.workspace) continue
				const workspace = repository.workspace
				if (workspace.path) {
					verifyGraphWorkspace(repository, workspace, false, true)
					if (!repository.captureComplete && !workspaces.currentCheckout) importGraphInputs(repository, persistWorkspaces)
					continue
				}
				if (workspaces.currentCheckout) {
					assertGraphInputs(repository)
					if (graphDirtyPaths(repository.source).length) throw new Error("The current-checkout exception requires a clean source immediately before preparation.")
					Object.assign(workspace, { path: repository.source, branch: repository.sourceBranch, id: `path:${repository.source}`, phase: "ready" })
					persistWorkspaces()
				} else {
					createGraphWorkspace(repository, workspace, orcaJson, persistWorkspaces)
					importGraphInputs(repository, persistWorkspaces)
				}
			}
			approvedPlans = approvedPlans.map((plan) => ({ ...plan, root: workspaces!.repositories.find((repo) => repo.source === plan.root)?.workspace?.path ?? plan.root }))
			if (recoveryPlan) {
				const root = workspaces.repositories.find((repo) => repo.source === recoveryPlan!.root)?.workspace?.path
				if (root) recoveryPlan = { ...recoveryPlan, root, target: join(root, recoveryPlan.local) }
			}
			if (!params.task_id) return { content: [{ type: "text", text: JSON.stringify(workspaces.repositories, null, 2) }], details: { workspaces } }
			if (recoveryOnly) throw new Error("Lifecycle recovery cannot prepare workers.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId, "--json"])?.result?.tasks
			if (!Array.isArray(tasks)) throw new Error("Task inventory is incomplete.")
			const task = tasks.find((item: any) => item.id === params.task_id)
			let parent = task
			const seen = new Set<string>()
			while (parent?.parent_id && !seen.has(parent.id)) { seen.add(parent.id); parent = tasks.find((item: any) => item.id === parent.parent_id) }
			const marker = approvedTaskMarkers.find((prefix) => String(parent?.spec ?? "").startsWith(prefix))
			const approvedId = marker?.match(/^\[(?:plan|graph-task):([^\]]+)\]/)?.[1]
			const contract = JSON.parse(recoveredPlanContract!) as TaskGraphPlan
			const approvedTask = contract.tasks.find((item) => item.id === approvedId)
			const repository = workspaces.repositories.find((repo) => repo.source === approvedTaskRepositories.get(approvedId ?? ""))
			if (!task || !approvedTask || !repository || parent.parent_id != null || planChain && task.id === parent.id) throw new Error("Prepare only an approved graph task or its internal plan task.")
			const existing = workspaces.workers.find((worker) => worker.task === task.id)
			if (existing) {
				if (!existing.path) createGraphWorkspace(repository, existing, orcaJson, persistWorkspaces)
				verifyGraphWorkspace(repository, existing)
				reconcileGraphLaunch(existing, orcaJson, persistWorkspaces)
				if (params.owns && !isDeepStrictEqual(params.owns, existing.owns)) throw new Error("Resume must preserve worker ownership.")
				if (params.retry) {
					const dispatch = orcaJson(["orchestration", "dispatch-show", "--task", task.id, "--json"])?.result?.dispatch
					if (dispatch?.status !== "failed" || dispatch?.assignee_handle !== existing.terminal || !existing.terminal || existing.previousTerminals?.length || graphDirtyPaths(existing.path!).length || orcaTerminalHandles().has(existing.terminal)) throw new Error("Retry requires one failed, closed dispatch and a clean retained worktree; no second replacement is allowed.")
					existing.previousTerminals = [existing.terminal]
					existing.terminal = undefined
					existing.launch = undefined
					existing.setupComplete = false
					existing.launchBase = verifyGraphWorkspace(repository, existing)
					persistWorkspaces()
				}
				return { content: [{ type: "text", text: JSON.stringify(preparedWorker(existing)) }], details: { workspace: existing } }
			}
			if (!["ready", "pending"].includes(task.status)) throw new Error("New worker preparation requires a ready, undispatched task.")
			for (const entry of [task, ...(parent !== task ? [parent] : [])]) {
				const dependencies: unknown = JSON.parse(entry.deps)
				if (!Array.isArray(dependencies)) throw new Error("Task dependencies are invalid.")
				for (const dependency of dependencies) {
					const predecessor = tasks.find((item: any) => item.id === dependency)
					if (predecessor?.status !== "completed") throw new Error("Complete prerequisite tasks before worker preparation.")
					const predecessorId = String(predecessor.spec).match(/^\[(?:plan|graph-task):([^\]]+)\]/)?.[1]
					if (workspaces.workers.some((worker) => (worker.task === dependency || predecessorId && worker.approvedTask === predecessorId) && worker.owns.length && !worker.integrated)) throw new Error("Integrate prerequisite worker commits before preparing dependent worktrees.")
				}
			}
			const owns = parent === task ? approvedTask.owns : params.owns
			if (!owns || owns.some((path) => !graphOwns(approvedTask.owns, path))) throw new Error("Internal worker ownership must be an explicit subset of the approved plan targets.")
			if (workspaces.workers.some((worker) => worker.source === repository.source && !worker.integrated && worker.owns.some((path) => graphOwns(owns, path) || owns.some((owner) => graphOwns(worker.owns, owner))))) throw new Error("Worker ownership overlaps another unintegrated task.")
			const base = repository.workspace ? verifyGraphWorkspace(repository, repository.workspace) : repository.base
			if (repository.workspace && graphDirtyPaths(repository.workspace.path!).length) throw new Error("Checkpoint coordinator changes before creating a dependent worker.")
			const prerequisiteIds = new Set(approvedTask.depends_on)
			for (const id of prerequisiteIds) for (const dependency of contract.tasks.find((task) => task.id === id)?.depends_on ?? []) prerequisiteIds.add(dependency)
			const prerequisiteSources = new Set([...prerequisiteIds].map((id) => approvedTaskRepositories.get(id)))
			const prerequisites = Object.fromEntries(workspaces.repositories.filter((repo) => repo.source !== repository.source && prerequisiteSources.has(repo.source)).map((repo) => {
				if (graphDirtyPaths(repo.workspace?.path ?? repo.source).length) throw new Error("Checkpoint prerequisite workspaces before preparing dependent workers.")
				return [repo.source, repo.workspace ? verifyGraphWorkspace(repo, repo.workspace) : repo.base]
			}))
			const worker: GraphWorkerWorkspace = { task: task.id, approvedTask: approvedTask.id, source: repository.source, owns, name: `pi-task-${createHash("sha256").update(`${workspaces.key}:${task.id}`).digest("hex").slice(0, 24)}`, base, prerequisites, phase: "creating" }
			workspaces.workers.push(worker)
			persistWorkspaces()
			if (!owns.length) {
				Object.assign(worker, { path: repository.workspace?.path ?? repository.source, branch: repository.workspace?.branch ?? repository.sourceBranch, id: repository.workspace?.id ?? `path:${repository.source}`, phase: "ready" })
				persistWorkspaces()
			} else createGraphWorkspace(repository, worker, orcaJson, persistWorkspaces)
			return { content: [{ type: "text", text: JSON.stringify(preparedWorker(worker)) }], details: { workspace: worker } }
		},
	})

	pi.registerTool({
		name: "integrate_task_graph_worker",
		label: "Integrate Graph Worker",
		description: "Verify a completed worker's scoped committed changes and merge them into this Run's isolated integration branch. Does not merge back to a source or delivery branch.",
		parameters: Type.Object({ task_id: Type.String({ pattern: "^task_[a-zA-Z0-9_-]+$" }) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_id, params) {
			if (!approved || !activeOrcaRunId || !workspaces) throw new Error("No approved bound graph.")
			const worker = workspaces.workers.find((item) => item.task === params.task_id)
			const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId, "--json"])?.result?.tasks
			const dispatch = orcaJson(["orchestration", "dispatch-show", "--task", params.task_id, "--json"])?.result?.dispatch
			if (!worker?.terminal || !Array.isArray(tasks) || !tasks.some((task: any) => task.id === worker.task && task.run_id === activeOrcaRunId && task.status === "completed") || dispatch?.task_id !== worker.task || dispatch?.run_id !== activeOrcaRunId || dispatch?.status !== "completed" || dispatch?.assignee_handle !== worker.terminal) throw new Error("Integrate only a completed task with its verified settled dispatch.")
			if (orcaTerminalHandles().has(worker.terminal)) throw new Error("Close the settled worker terminal before integration.")
			if (!worker.owns.length) {
				const repository = workspaces.repositories.find((repo) => repo.source === worker.source)!
				worker.integrated = verifyGraphWorkspace(repository, worker)
			}
			else integrateGraphWorker(workspaces, worker, persistWorkspaces)
			const repository = workspaces.repositories.find((repo) => repo.source === worker.source)!
			if (repository.workspace) verifyCoordinator(repository)
			persistWorkspaces()
			return { content: [{ type: "text", text: `Integrated ${worker.task}: ${worker.integrated}` }], details: { worker } }
		},
	})

	const shellWorkspace = (selector: string) => {
		if (!approved || !activeOrcaRunId || !workspaces || recoveryOnly) throw new Error("No approved writing graph workspace.")
		const worker = workspaces.workers.find((item) => item.path === selector && item.owns.length)
		if (worker?.terminal || worker?.launch) {
			const dispatch = orcaJson(["orchestration", "dispatch-show", "--task", worker.task, "--json"])?.result?.dispatch
			if (!worker.terminal || dispatch?.status !== "failed" || dispatch?.assignee_handle !== worker.terminal || orcaTerminalHandles().has(worker.terminal)) throw new Error("Worker changes belong to its live worker; coordinator repair requires a failed, closed dispatch.")
		}
		const repository = workspaces.repositories.find((repo) => worker ? repo.source === worker.source : selector === repo.source || selector === repo.workspace?.path)
		const workspace = worker ?? repository?.workspace
		if (!worker && repository && workspaces.workers.some((reader) => !reader.integrated && reader.prerequisites?.[repository.source])) throw new Error("Finish dependent workers before changing their pinned prerequisite workspace.")
		if (!repository || !workspace || !repository.captureComplete && !workspaces.currentCheckout) throw new Error("Prepare this repository's writing workspace and input checkpoint first.")
		verifyGraphWorkspace(repository, workspace)
		const owners = worker?.owns ?? coordinatorOwners(repository)
		if (!owners.length) throw new Error("Read-only graph snapshots use read/search tools only.")
		return { repository, workspace, worker, owners }
	}

	// Keep the native tool name: every command still traverses Pi's normal bash permission hooks.
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: "Execute a shell command with standard output limits. During a graph, set repository to an exact prepared workspace for setup and checks. Use checkpoint_task_graph for commits.",
		parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number()), repository: Type.Optional(Type.String({ description: "Exact prepared graph workspace; omit for standalone Orca commands or ordinary non-graph shell use." })) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(id, params, signal, onUpdate, ctx) {
			if (workerWorkspaceFile || workerTask) {
				const { state, worker, repository } = workerContext(ctx.cwd)
				if (params.repository && params.repository !== worker.path) throw new Error("Workers cannot change shell workspaces.")
				if (!graphReportingCommand(params.command)) {
					if (!worker.owns.length) throw new Error("Read-only workers may run standalone reporting commands only.")
					assertGraphShell(params.command, state, worker.path!)
				}
				try {
					return await createBashTool(worker.path!, { spawnHook: (context) => ({ ...context, env: { ...context.env, AGENT_TOOLKIT_GRAPH_REPOSITORIES: graphReportingCommand(params.command) ? "{}" : JSON.stringify(graphRepositoryMap(state, worker)) } }) }).execute(id, params, signal, onUpdate)
				} finally { if (worker.owns.length) verifyGraphChanges(repository, worker, worker.owns, state.mode) }
			}
			if (planning && params.repository) {
				const { repository, workspace, worker, owners } = shellWorkspace(params.repository)
				assertGraphShell(params.command, workspaces!, workspace.path!)
				let result
				try {
					result = await createBashTool(workspace.path!, { spawnHook: (context) => ({ ...context, env: { ...context.env, AGENT_TOOLKIT_GRAPH_REPOSITORIES: JSON.stringify(graphRepositoryMap(workspaces!, worker)) } }) }).execute(id, params, signal, onUpdate)
				} finally { verifyGraphChanges(repository, workspace, owners, workspaces!.mode) }
				if (worker && (JSON.parse(recoveredPlanContract!) as TaskGraphPlan).tasks.find((task) => task.id === worker.approvedTask)?.setup === params.command) {
					if (graphDirtyPaths(worker.path!).length) throw new Error("Setup changed tracked or untracked inputs; checkpoint owned changes before confirming setup again.")
					worker.setupComplete = true
					persistWorkspaces()
				}
				return result
			}
			if (params.repository) throw new Error("The repository selector is available only inside an approved graph.")
			if (planning && approved && isTaskGraphWorkerLaunch(params.command)) {
				const environment = taskGraphWorkerEnvironment(params.command)
				const worker = workspaces?.workers.find((item) => item.task === environment?.AGENT_TOOLKIT_GRAPH_TASK)
				if (!worker || worker.launch || worker.terminal) throw new Error("The worker launch is already attempted; reconcile it before continuing.")
				verifyGraphWorkspace(workspaces!.repositories.find((repo) => repo.source === worker.source)!, worker, true)
				worker.launch = { title: launchTitle(worker), command: params.command }
				persistWorkspaces() // After permission approval, before the terminal-create RPC.
			}
			return createBashTool(ctx.cwd).execute(id, params, signal, onUpdate)
		},
	})

	pi.registerTool({
		name: "checkpoint_task_graph",
		label: "Checkpoint Graph Changes",
		description: "Commit explicit owned paths after required checks and reviews. Hooks remain enabled. No amend, publishing, or branch changes.",
		parameters: Type.Object({ repository: Type.Optional(Type.String()), paths: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }), message: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let head: string
			if (workerWorkspaceFile || workerTask) {
				const { state, worker, repository } = workerContext(ctx.cwd)
				if (params.repository && params.repository !== worker.path) throw new Error("Checkpoint only this worker's workspace.")
				head = checkpointGraphChanges(repository, worker, worker.owns, state.mode, params.paths, params.message)
			} else {
				if (!params.repository) throw new Error("Choose an exact prepared workspace for the checkpoint.")
				const { repository, workspace, worker, owners } = shellWorkspace(params.repository)
				head = checkpointGraphChanges(repository, workspace, owners, workspaces!.mode, params.paths, params.message)
				if (worker && !worker.launch && !worker.terminal) { worker.launchBase = head; persistWorkspaces() }
			}
			const path = workerWorkspaceFile ? ctx.cwd : shellWorkspace(params.repository!).workspace.path!
			const pendingIntegration = Boolean(graphMergeHead(path))
			return { content: [{ type: "text", text: pendingIntegration ? "Staged explicit resolution paths; retry integrate_task_graph_worker to finish the recorded merge." : `Local checkpoint: ${head}` }], details: { head, pendingIntegration } }
		},
	})

	pi.registerTool({
		name: "bind_task_graph_run",
		label: "Bind Task Graph Run",
		description: "Bind the one unfinished Orca Run selected or created for this approved graph.",
		parameters: Type.Object({
			run_id: Type.String({ pattern: "^run_[a-zA-Z0-9_-]+$", description: "Selected Orca Run ID" }),
			recover: Type.Optional(Type.Boolean({ description: "Explicitly recover this Run across an objective change; requires preserved contracts, identity/dispatch validation and interactive confirmation." })),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!planning || !approved || !activeRunObjective) throw new Error("bind_task_graph_run requires an approved active /graph run.")
			if (recoveredOrcaRunId && params.run_id !== recoveredOrcaRunId) throw new Error(`Resume the Orca Run persisted by this graph: ${recoveredOrcaRunId}`)
			const matchingRuns = orcaRuns().filter((run: { id?: unknown; objective?: unknown }) => run.objective === activeRunObjective || params.recover && run.id === params.run_id)
			if (!Array.isArray(matchingRuns) || !matchingRuns.some((run: { id?: unknown }) => run.id === params.run_id)) throw new Error("The supplied Orca Run does not match this approved graph.")
			const unfinishedRuns = matchingRuns.filter((candidate: { id?: unknown }) => {
				const candidateTasks = orcaJson(["orchestration", "task-list", "--run", String(candidate.id), "--json"])?.result?.tasks
				return !Array.isArray(candidateTasks) || candidateTasks.length === 0 || candidateTasks.some((task: { status?: unknown }) => task.status !== "completed")
			})
			if (unfinishedRuns.length > 1 || unfinishedRuns.length === 1 && unfinishedRuns[0].id !== params.run_id) throw new Error("The approved objective has an ambiguous or different unfinished Orca Run.")
			const run = orcaJson(["orchestration", "run-show", "--id", params.run_id, "--json"])?.result?.run
			if (!params.recover && run?.objective !== activeRunObjective) throw new Error("The supplied Orca Run does not match this approved graph. Use recover: true for explicitly confirmed Run-ID recovery.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", params.run_id, "--json"])?.result?.tasks
			if (!recoveryPlan && recoveredOrcaRunId !== params.run_id && Array.isArray(tasks) && tasks.length > 0 && tasks.every((task: { status?: unknown }) => task.status === "completed")) throw new Error("The supplied Orca Run is already complete.")
			if (workspaces?.runId && workspaces.runId !== params.run_id) throw new Error("Workspace contract belongs to a different Run.")
			for (const repository of workspaces?.repositories ?? []) if (repository.workspace?.path) verifyGraphWorkspace(repository, repository.workspace, false, true)
			for (const worker of workspaces?.workers ?? []) if (worker.path) verifyGraphWorkspace(workspaces!.repositories.find((repo) => repo.source === worker.source)!, worker)
			let recoveredMarkers: string[] | undefined
			const recoveryLocks: TaskGraphLock[] = []
			if (params.recover) {
				if (planChain || !recoveredPlanContract || !ctx.hasUI) throw new Error("Explicit Run recovery requires an approved task graph and interactive confirmation.")
				const root = repositoryRoot(ctx.cwd)
				const lockRoot = join(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir(), "task-graph-locks")
				const oldKey = String(run?.objective ?? "").replace(/^Pi task graph: /, "")
				const readRecovery = () => {
					const ids = taskGraphOrcaRunIdsForLockRun(lockRoot, oldKey)
					const contracts = taskGraphPlanContractsForLockRun(lockRoot, oldKey)
					if (ids.length !== 1 || ids[0] !== params.run_id || contracts.length !== 1) throw new Error("Recovery requires one preserved original Run binding and graph contract.")
					const previous = JSON.parse(contracts[0]) as TaskGraphPlan
					const snapshot: RunRecoverySnapshot = {
						run: orcaJson(["orchestration", "run-show", "--id", params.run_id, "--json"])?.result?.run,
						tasks: orcaJson(["orchestration", "task-list", "--run", params.run_id, "--json"])?.result?.tasks,
						workers: orcaJson(["orchestration", "worker-list", "--run", params.run_id, "--json"])?.result?.workers,
						dispatches: {},
						terminalInventory: orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result,
					}
					if (!Array.isArray(snapshot.tasks)) throw new Error("Recovery task inventory is incomplete.")
					for (const task of snapshot.tasks) snapshot.dispatches[task.id] = orcaJson(["orchestration", "dispatch-show", "--task", task.id, "--json"])?.result?.dispatch
					const previousWorkspaceFile = join(lockRoot, `${createHash("sha256").update(oldKey).digest("hex")}.lock`, "workspaces.json")
					const previousWorkspaces = existsSync(previousWorkspaceFile) ? readGraphWorkspaces(previousWorkspaceFile) : undefined
					if (!previousWorkspaces && !workspaces?.currentCheckout) throw new Error("Legacy Run recovery requires an explicitly approved current_checkout override.")
					return validateRunRecovery(root, params.run_id, previous, JSON.parse(recoveredPlanContract!), snapshot, previousWorkspaces)
				}
				const checked = readRecovery()
				if (checked.objective !== run.objective) throw new Error("Recovery Run changed during inspection.")
				if (!await ctx.ui.confirm(`Recover ${params.run_id} without replacing it?`, `The objective differs or explicit reconciliation was requested. Repositories, ownership, task identities, dependencies and dispatches match. Preserve the existing task specs and contract markers below; new workers still use the newly approved model, account and thinking levels.\n\n${JSON.stringify(checked, null, 2)}`, { signal })) throw new Error("Run recovery cancelled; no Run or task was changed.")
				try {
					if (oldKey !== activeRunKey) {
						for (const key of taskGraphLockKeysForRun(lockRoot, oldKey)) {
							const path = join(lockRoot, `${createHash("sha256").update(key).digest("hex")}.lock`)
							if (!activeLocks.some((lock) => lock.path === path)) recoveryLocks.push(acquireTaskGraphLock(lockRoot, key, process.pid, oldKey))
						}
					}
					if (!isDeepStrictEqual(checked, readRecovery())) throw new Error("Recovery state changed during confirmation; inspect it again before binding.")
					recoveredMarkers = checked.markers
					if (checked.workspaces) {
						workspaces = checked.workspaces
						workspaces.contractHash = createHash("sha256").update(recoveredPlanContract!).digest("hex")
					}
				} catch (error) {
					for (const lock of recoveryLocks.reverse()) abandonTaskGraphLock(lock)
					throw error
				}
			}
			try {
				orcaJson(["orchestration", "run-use", "--id", params.run_id, "--json"])
				for (const lock of activeLocks) bindTaskGraphLockToOrcaRun(lock, params.run_id)
			} catch (error) {
				for (const lock of recoveryLocks.reverse()) abandonTaskGraphLock(lock)
				throw error
			}
			activeLocks.push(...recoveryLocks)
			if (recoveredMarkers) approvedTaskMarkers = recoveredMarkers
			boundRunObjective = run.objective
			recoveredOrcaRunId = params.run_id
			const workers = orcaJson(["orchestration", "worker-list", "--run", params.run_id, "--json"])?.result?.workers
			if (!Array.isArray(workers)) throw new Error("Cannot reconcile worker terminals for the selected Orca Run.")
			const dispatchedTerminals = new Set<string>()
			for (const worker of workspaces?.workers ?? []) reconcileGraphLaunch(worker, orcaJson, persistWorkspaces)
			if (workspaces && !workspaces.currentCheckout) for (const worker of workers) {
				const recorded = workspaces.workers.find((item) => item.task === worker.taskId)
				if (!recorded || recorded.terminal !== worker.agentTerminalHandle && !recorded.previousTerminals?.includes(worker.agentTerminalHandle)) throw new Error("Recovery worker does not match the recorded workspace/terminal binding.")
			}
			for (const worker of workers) if (typeof worker?.agentTerminalHandle === "string") {
				graphWorkerTerminals.add(worker.agentTerminalHandle)
				dispatchedTerminals.add(worker.agentTerminalHandle)
			}
			const terminals = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result?.terminals
			if (!Array.isArray(terminals)) throw new Error("Cannot reconcile worker terminals for the selected Orca Run.")
			for (const terminal of terminals.filter((candidate: { title?: unknown; handle?: string }) => candidate.title === workerTerminalTitle || workspaces?.workers.some((worker) => worker.terminal === candidate.handle || worker.launch?.title === candidate.title))) {
				const repository = String(terminal.worktreePath || terminal.worktreeId || "").split("::").at(-1)
				if (typeof terminal.handle === "string" && repository && existsSync(repository)) {
					graphWorkerTerminals.add(terminal.handle)
					if (!dispatchedTerminals.has(terminal.handle)) approvedWorkerTerminals.add(terminal.handle)
					terminalRepositories.set(terminal.handle, realpathSync(repository))
				}
			}
			if (workspaces) {
				if (workspaces.runId && workspaces.runId !== params.run_id) throw new Error("Workspace contract belongs to a different Run.")
				workspaces.runId = params.run_id
				persistWorkspaces()
			}
			activeOrcaRunId = params.run_id
			return { content: [{ type: "text", text: `Bound task graph to Orca Run ${params.run_id}` }], details: { status: "bound", runId: params.run_id } }
		},
	})

	pi.registerTool({
		name: "recover_plan_lifecycle",
		label: "Recover Plan Lifecycle",
		description: "Finish one approved interrupted plan status or lifecycle move after its Orca Run is reconciled.",
		parameters: Type.Object({}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute() {
			if (!planning || !approved || !recoveryPlan || !activeOrcaRunId || !workspaces) throw new Error("No approved and bound interrupted plan lifecycle is ready for recovery.")
			graphWritePath(workspaces, recoveryPlan.target)
			const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId, "--json"])?.result?.tasks
			if (!approvedLedgerIsComplete(tasks)) throw new Error("Reconcile the complete approved Orca ledger before plan lifecycle recovery.")
			const workers = orcaJson(["orchestration", "worker-list", "--run", activeOrcaRunId, "--json"])?.result?.workers
			if (!Array.isArray(workers) || workers.some((worker: { dispatchStatus?: unknown }) => !["completed", "failed"].includes(String(worker.dispatchStatus)))) throw new Error("Settle every Orca dispatch before plan lifecycle recovery.")
			if (recoveryPlan.local.startsWith("docs/exec-plans/active/")) {
				if (planStatus(readFileSync(recoveryPlan.target, "utf8")) !== "completed") throw new Error("Active plan recovery requires the current Status to remain completed.")
				const destination = join(recoveryPlan.root, recoveryPlan.local.replace("docs/exec-plans/active/", "docs/exec-plans/completed/"))
				graphWritePath(workspaces, destination)
				if (existsSync(destination)) throw new Error(`Recovery destination already exists: ${destination}`)
				mkdirSync(dirname(destination), { recursive: true })
				renameSync(recoveryPlan.target, destination)
				const repository = workspaces.repositories.find((repo) => repo.workspace?.path === recoveryPlan!.root)!
				const paths = [recoveryPlan.local, relative(recoveryPlan.root, destination).split(sep).join("/")]
				// Keep the moved target in memory too, so a failed commit can be retried in this turn.
				recoveryPlan = { ...recoveryPlan, target: destination, local: paths[1] }
				checkpointGraphChanges(repository, repository.workspace!, coordinatorOwners(repository), workspaces.mode, paths, "Complete approved plan lifecycle recovery")
				recoveryPlan = undefined
				return { content: [{ type: "text", text: `Recovered completed plan move to ${destination}` }], details: { status: "recovered", destination } }
			}
			if (recoveryPlan.local.startsWith("docs/exec-plans/completed/")) {
				const target = recoveryPlan.target
				const content = readFileSync(target, "utf8")
				if (planStatus(content) !== "completed") writeFileSync(target, replacePlanStatus(content, "completed"))
				const repository = workspaces.repositories.find((repo) => repo.workspace?.path === recoveryPlan!.root)!
				const filename = recoveryPlan.local.slice("docs/exec-plans/completed/".length)
				const paths = graphDirtyPaths(recoveryPlan.root).filter((path) => [recoveryPlan!.local, `docs/exec-plans/active/${filename}`, `docs/future/${filename}`].includes(path))
				if (paths.length) checkpointGraphChanges(repository, repository.workspace!, coordinatorOwners(repository), workspaces.mode, paths, "Complete approved plan lifecycle recovery")
				recoveryPlan = undefined
				return { content: [{ type: "text", text: `Recovered completed plan state in ${target}` }], details: { status: "recovered", target } }
			}
			throw new Error("The selected plan has no supported interrupted lifecycle transition.")
		},
	})

	const cleanupArchivedRun = async (runId: string, ctx: ExtensionContext, signal?: AbortSignal) => {
		const lockRoot = join(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir(), "task-graph-locks")
		const archiveRoot = join(lockRoot, "completed")
		const matches = existsSync(archiveRoot) ? readdirSync(archiveRoot).filter((name) => name.endsWith(".json")).map((name) => ({ file: join(archiveRoot, name), state: readGraphWorkspaces(join(archiveRoot, name)) })).filter(({ state }) => state.runId === runId) : []
		if (matches.length !== 1 || !matches[0].state.completion) throw new Error("Cleanup requires exactly one archived, locally completed graph record.")
		const { file } = matches[0]
		const lock = acquireTaskGraphLock(join(lockRoot, "cleanup-locks"), runId)
		try {
			const state = readGraphWorkspaces(file)
			if (!state.completion || state.runId !== runId || !state.repositories.some((repo) => repo.identity === repositoryIdentity(repositoryRoot(ctx.cwd)))) throw new Error("Run cleanup from a repository belonging to this completed graph.")
			if (!state.cleanupWorkers) {
				if (!ctx.hasUI || !await ctx.ui.confirm("Remove verified worker worktrees?", `Only clean, integrated workers with completed, released dispatches and no terminals can be removed. Removal includes ignored setup artifacts. Sources, delivery worktrees and blocked workers stay. Delivery worktrees receive readable display labels without branch renames. No force, hooks, publishing or merge-back.\n\n${state.workers.filter((worker) => worker.owns.length && worker.cleanup !== "removed").map((worker) => worker.path ?? worker.name).join("\n")}`, { signal })) throw new Error("Worker cleanup was not approved; nothing removed.")
				state.cleanupWorkers = true
				saveGraphWorkspaces(file, state)
			}
			return cleanupGraphWorkers(state, lockRoot, orcaJson, () => saveGraphWorkspaces(file, state))
		} finally { releaseTaskGraphLock(lock) }
	}

	pi.registerTool({
		name: "cleanup_completed_task_graph",
		label: "Clean Completed Graph Workers",
		description: "Remove only verified clean, integrated worker worktrees of one archived completed Run. Requires explicit cleanup approval, preserves sources and delivery worktrees, never forces removal or bypasses permission failures.",
		parameters: Type.Object({ run_id: Type.String({ pattern: "^run_[a-zA-Z0-9_-]+$" }) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (planning || workerWorkspaceFile || workerTask) throw new Error("Finish the active graph before cleanup; workers cannot clean worktrees.")
			const result = await cleanupArchivedRun(params.run_id, ctx, signal)
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result }
		},
	})

	pi.registerTool({
		name: "finish_task_graph",
		label: "Finish Task Graph",
		description: "Release graph locks after every worker is settled and released and all required validation and closeout passed.",
		parameters: Type.Object({
			run_id: Type.String({ pattern: "^run_[a-zA-Z0-9_-]+$", description: "Bound Orca Run ID" }),
			evidence: Type.String({ minLength: 1, description: "Concise completion and closeout evidence" }),
			delivery_pending: Type.Optional(Type.Boolean({ description: "All local work passed, but repository rules require publishing before plan completion. Leave these plans active with Status: validation; do not claim shipped completion." })),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			if (!planning || !approved || !activeRunObjective) throw new Error("finish_task_graph requires an approved active /graph run.")
			if (params.run_id !== activeOrcaRunId) throw new Error("Finish the Orca Run bound for this graph invocation.")
			if (recoveryPlan) throw new Error("Finish the approved plan lifecycle recovery before releasing graph locks.")
			const run = orcaJson(["orchestration", "run-show", "--id", params.run_id, "--json"])?.result?.run
			if (!boundRunObjective || run?.objective !== boundRunObjective) throw new Error("The bound Orca Run objective changed after binding.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", params.run_id, "--json"])?.result?.tasks
			if (!approvedLedgerIsComplete(tasks)) {
				throw new Error("Every approved Orca task must exist exactly once and be completed before graph locks are released.")
			}
			for (const approvedPlan of approvedPlans) {
				const matches = planPathsById(approvedPlan.root, approvedPlan.id)
				const local = matches.length === 1 ? relative(approvedPlan.root, matches[0]).split(sep).join("/") : ""
				const status = matches.length === 1 ? planStatus(readFileSync(matches[0], "utf8")) : undefined
				if (!(local.startsWith("docs/exec-plans/completed/") && status === "completed") && !(params.delivery_pending && local.startsWith("docs/exec-plans/active/") && status === "validation")) throw new Error(`Plan ${approvedPlan.id} has not completed local closeout. Delivery-pending plans must remain active in validation.`)
			}
			const workers = orcaJson(["orchestration", "worker-list", "--run", params.run_id, "--json"])?.result?.workers
			const terminalInventory = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result
			const terminals = terminalInventory?.terminals
			const liveTerminals = new Set(Array.isArray(terminals) ? terminals.map((terminal: { handle?: unknown }) => terminal.handle) : [])
			if (terminalInventory?.truncated || terminalInventory?.hostScope?.omittedHostIds?.length) throw new Error("The live terminal inventory is incomplete; graph locks cannot be released safely.")
			if (Array.isArray(terminals) && terminals.some((terminal: { title?: unknown; handle?: string }) => terminal.title === workerTerminalTitle || workspaces?.workers.some((worker) => worker.terminal === terminal.handle || worker.launch?.title === terminal.title))) throw new Error("Close every graph-owned worker terminal before finishing.")
			if (!Array.isArray(workers) || !Array.isArray(terminals) || workers.some((worker: { dispatchStatus?: unknown; workerState?: unknown; terminalState?: unknown; resource?: unknown; agentTerminalHandle?: unknown }) =>
				!["completed", "failed"].includes(String(worker.dispatchStatus)) || (!["released", "closed"].includes(String(worker.workerState)) && !["released", "closed"].includes(String(worker.terminalState)) && !(worker.workerState === "unsupervised" && worker.resource == null && typeof worker.agentTerminalHandle === "string" && !liveTerminals.has(worker.agentTerminalHandle))))) {
				throw new Error("Every Orca worker must be settled and released before graph locks are released.")
			}
			if (workspaces) {
				if (workspaces.repositories.some((repo) => repo.workspace && (!repo.workspace.path || !repo.captureComplete && !workspaces!.currentCheckout))) throw new Error("Prepare or recover every approved workspace before finishing.")
				if (workspaces.workers.some((worker) => !worker.integrated)) throw new Error("Verify and integrate every completed worker before finishing.")
				for (const worker of workspaces.workers) if (worker.owns.length) integrateGraphWorker(workspaces, worker, persistWorkspaces)
				for (const repository of workspaces.repositories) if (repository.workspace) {
					verifyCoordinator(repository)
					if (graphDirtyPaths(repository.workspace.path!).length) throw new Error("Checkpoint all approved coordinator changes before finishing.")
				}
				workspaces.completion = { evidence: params.evidence, deliveryPending: Boolean(params.delivery_pending) }
				saveGraphWorkspaces(join(dirname(activeLocks[0].path), "completed", `${workspaces.key}.json`), workspaces)
			}
			for (const lock of activeLocks.reverse()) releaseTaskGraphLock(lock)
			activeLocks = []
			activeRunKey = undefined
			activeRunObjective = undefined
			activeOrcaRunId = undefined
			boundRunObjective = undefined
			resumingRun = false
			runCreationAttempted = false
			recoveredOrcaRunId = undefined
			recoveredPlanContract = undefined
			approvedTaskMarkers = []
			approvedPlans = []
			finished = true
			approved = false
			planning = false
			// Keep deletion in its own tool call so Pi's permission hooks can deny cleanup independently.
			const cleanup = workspaces?.cleanupWorkers ? { status: "pending", tool: "cleanup_completed_task_graph", run_id: params.run_id } : "not-authorized"
			return { content: [{ type: "text", text: `Task graph finished locally: ${params.evidence}\n${workspaces?.repositories.filter((repo) => repo.workspace).map((repo) => `${repo.workspace!.branch}: ${repo.workspace!.path} (base ${repo.base})`).join("\n") ?? ""}\nDelivery worktrees are retained. Publishing, merge-back and source reconciliation still require separate authorization. Worker cleanup: ${JSON.stringify(cleanup)}. If pending, call cleanup_completed_task_graph separately now; its normal Pi permission gates apply.` }], details: { status: params.delivery_pending ? "local-ready" : "complete", evidence: params.evidence, workspaces, delivery: "not-authorized", cleanup }, terminate: !workspaces?.cleanupWorkers }
		},
	})

	pi.registerTool({
		name: "propose_task_graph",
		label: "Propose Task Graph",
		description: "Submit a candidate DAG for validation and interactive approval during an active /graph planning run.",
		parameters: graphSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!planning) throw new Error("propose_task_graph requires an active /graph command.")
			if (reviewClosed) throw new Error("This graph review is closed. Start another /graph command to propose a new graph.")
			if (planChain && !planExecutable) throw new Error("The selected plan status does not permit execution. Resolve its status or blocker before running /graph again.")
			if (planChain && params.mode !== "execute") throw new Error("A selected execution plan requires execute mode.")
			if (planOnlyRequired && params.mode !== "plan-only") throw new Error("This plan status permits a plan-only graph, not implementation dispatch.")
			const root = repositoryRoot(ctx.cwd)
			workspaceFile = join(activeLocks[0].path, "workspaces.json")
			const existingWorkspaces = existsSync(workspaceFile) ? readGraphWorkspaces(workspaceFile) : undefined
			let plan = normalizeTaskGraphOwnership(params, root)
			if (plan.mode === "plan-only" && plan.tasks.some((task) => task.owns.some((path) => path !== "docs" && !path.startsWith("docs/")))) throw new Error("Planning-only tasks may own documentation paths under docs/ only.")
			validateTaskGraphRepositories(plan, root)
			validateTaskGraph(plan, planChain)
			const recoveredPlan = recoveredPlanContract ? JSON.parse(recoveredPlanContract) as TaskGraphPlan : undefined
			if (recoveredPlan && !isDeepStrictEqual(normalizeTaskGraphOwnership(recoveredPlan, root), plan)) throw new Error("Crash recovery must use the previously approved task graph contract.")
			if (recoveredPlan) plan = recoveredPlan // Preserve exact task markers while accepting equivalent normalized path spelling.
			const chainLocks: TaskGraphLock[] = []
			let keys: string[] = []
			if (planChain) {
				if (!activeRunKey) throw new Error("The selected plan has no stable Run identity.")
				keys = validatePlanChainPlans(plan, root, activeRunKey, repositoryRoots, Boolean(recoveredPlan), existingWorkspaces)
				plan = normalizeTaskGraphOwnership(plan, root)
				validateTaskGraph(plan, true)
				if (recoveredPlan && !isDeepStrictEqual(recoveredPlan, plan)) throw new Error("Current plan metadata no longer matches the approved recovery contract.")
			}
			const proposedContract = recoveredPlanContract ?? JSON.stringify(plan)
			if (planChain) {
				try {
					const lockRoot = join(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir(), "task-graph-locks")
					const heldKeys = new Set(taskGraphLockKeysForRun(lockRoot, activeRunKey!))
					for (const key of keys) {
						if (heldKeys.has(key)) continue
						chainLocks.push(acquireTaskGraphLock(lockRoot, key, process.pid, activeRunKey!))
					}
					activeLocks.push(...chainLocks)
				} catch (error) {
					for (const lock of chainLocks.reverse()) releaseTaskGraphLock(lock)
					throw error
				}
			}
			const releaseChainLocks = () => {
				for (const lock of chainLocks.reverse()) {
					releaseTaskGraphLock(lock)
					activeLocks = activeLocks.filter((active) => active !== lock)
				}
			}
			const graph = formatTaskGraph(plan)
			if (recoveredOrcaRunId && !existingWorkspaces && !plan.current_checkout) throw new Error("This legacy Run has no isolated workspace contract. Resume only with an explicitly approved current_checkout override; do not migrate live workers implicitly.")
			const proposedWorkspaces = existingWorkspaces ?? captureGraphWorkspaces(root, plan, plan.inputs, plan.current_checkout)
			if (existingWorkspaces && existingWorkspaces.contractHash !== createHash("sha256").update(proposedContract).digest("hex")) throw new Error("Workspace recovery must preserve its approved graph contract.")
			if (planChain && !existingWorkspaces) for (const task of plan.tasks) {
				const repo = proposedWorkspaces.repositories.find((item) => item.source === realpathSync(resolve(root, task.repository ?? ".")))!
				const path = relative(repo.source, planPathsById(repo.source, task.id)[0]).split(sep).join("/")
				if (graphDirtyPaths(repo.source).includes(path) && !repo.inputs.some((input) => input.path === path)) throw new Error(`Include the selected dirty plan in inputs before approval: ${path}`)
			}
			const workspaceSummary = `Worker cleanup: ${proposedWorkspaces.cleanupWorkers ? "APPROVED WITH THIS GRAPH: after local closeout, remove only verified clean, integrated worker worktrees without terminals. Includes ignored setup artifacts. No force or hooks. Sources and delivery worktrees remain, with readable delivery labels." : "not authorized; retain worker worktrees"}.\nWorkspace policy: ${proposedWorkspaces.currentCheckout ? "EXCEPTION: source checkout writes" : "isolated run and worker worktrees"}.\nApproval authorizes the listed input captures, scoped local commits and integration inside this Run. Input snapshots bypass commit hooks and use a temporary private index. Normal checkpoints run hooks. Orca setup hooks are skipped during creation; inspect configured default terminals before approval. Run each declared task setup command in its worker workspace before launch. Publishing, PRs, merge-back, source reconciliation and any deletion beyond the worker-cleanup option require separate authorization.\n${proposedWorkspaces.repositories.map((repo) => `${repo.source}\n  base: ${repo.base} (${repo.sourceBranch}); delivery target: confirm from repository rules before publishing\n  inputs: ${repo.inputs.map((input) => `${input.path} [${input.hash ?? "deleted"}]`).join(", ") || "none"}\n  workspace: ${repo.workspace?.path ?? repo.workspace?.name ?? "read-only"}`).join("\n")}`
			if (!ctx.hasUI) {
				releaseChainLocks()
				return {
					content: [{ type: "text", text: `${graph}\n\nInteractive approval is unavailable. Show the plan and stop without dispatching.` }],
					details: { status: "approval-required", plan },
				}
			}

			let review: Awaited<ReturnType<typeof reviewTaskGraph>>
			try {
				review = await reviewTaskGraph(plan, ctx.ui, signal, planChain, workspaceSummary)
				if (review.status === "approved" && proposedWorkspaces.currentCheckout && !await ctx.ui.confirm("Allow source-checkout writes?", "This is an explicit exception to graph isolation. Only clean source checkouts are allowed. Local commits change these source branches.", { signal })) review = { status: "cancelled" }
				if (review.status === "approved" && !existingWorkspaces) for (const repository of proposedWorkspaces.repositories) {
					assertGraphInputs(repository)
					if (proposedWorkspaces.currentCheckout && graphDirtyPaths(repository.source).length) throw new Error("The source became dirty during approval; reapprove from a clean checkout.")
				}
			} catch (error) {
				releaseChainLocks()
				throw error
			}
			approved = review.status === "approved"
			if (approved) {
				workspaces = proposedWorkspaces
				persistWorkspaces()
			}
			if (approved) for (const lock of activeLocks) bindTaskGraphLockToPlanContract(lock, proposedContract)
			recoveredPlanContract = approved ? proposedContract : recoveredPlanContract
			approvedTaskMarkers = approved ? (recoveredPlan ?? plan).tasks.map((task) => `[${planChain ? "plan" : "graph-task"}:${task.id}][graph-contract:${createHash("sha256").update(JSON.stringify(task)).digest("hex")}]`) : []
			approvedPlans = approved && planChain ? plan.tasks.map((task) => ({ root: realpathSync(resolve(root, task.repository ?? ".")), id: task.id })) : []
			approvedTaskRepositories.clear()
			approvedTaskDependencies.clear()
			if (approved) for (const task of plan.tasks) {
				approvedTaskRepositories.set(task.id, realpathSync(resolve(root, task.repository ?? ".")))
				approvedTaskDependencies.set(task.id, task.depends_on)
			}
			if (!approved) releaseChainLocks()
			reviewClosed = review.status !== "revise"
			const text = review.status === "approved"
				? `${planChain
					? "The user approved the full plan chain. Execute every plan in dependency order without further routine approval."
					: "The user approved this task graph. Execute it through Orca orchestration."}\nUse these exact top-level ledger prefixes:\n${approvedTaskMarkers.join("\n")}\nAfter binding the Run, call prepare_task_graph_workspace before any repository writes. Use bash with repository set to the exact prepared workspace for coordinator checks and setup. Use checkpoint_task_graph for explicit-path local commits and returned absolute workspace paths for edits. Prepare each worker with its Orca task ID before launch. ${plan.mode === "plan-only" ? "Only approved documentation planning work is authorized; no implementation or plan promotion." : ""}`
				: review.status === "revise"
						? `Revise the graph and call propose_task_graph again. User feedback: ${review.feedback}`
						: "The user cancelled task graph execution. Stop without dispatching."
			return {
				content: [{ type: "text", text }],
				details: { ...review, plan },
				terminate: review.status === "cancelled",
			}
		},
	})

	pi.registerCommand("graph", {
		description: "Plan and run an Orca task graph from an objective or execution plan",
		handler: async (rawArgs, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish, then run /graph again.", "warning")
				return
			}

			let objective = rawArgs.trim()
			if (!objective && ctx.hasUI) objective = (await ctx.ui.input("Task graph objective", "Build, change, or select a plan..."))?.trim() ?? ""
			if (!objective) {
				ctx.ui.notify(TASK_GRAPH_USAGE, "warning")
				return
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error")
				return
			}

			let selectedPlan: LocalPlan | undefined
			try {
				selectedPlan = resolveLocalPlan(ctx.cwd, objective)
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
				return
			}
			if (!selectedPlan && /(?:^|\/)docs\/(?:future|exec-plans\/(?:active|completed))\/.+\.md$/.test(objective.replaceAll("\\", "/"))) {
				ctx.ui.notify(`Plan not found: ${objective}`, "error")
				return
			}
			let planChain = localPlanChain(selectedPlan)
			let needsRecovery = Boolean(planChain && selectedPlan && planningDocumentNeedsRecovery(selectedPlan.local, selectedPlan.markdown))
			let recoveryOnly = needsRecovery && Boolean(selectedPlan && planSecurityApproved(selectedPlan.markdown))
			let planExecutable = !planChain || recoveryOnly || planningDocumentIsExecutable(selectedPlan!.local, selectedPlan!.markdown)
			if (!planExecutable) planChain = false
			let registeredRepositories: string[] = []
			if (planChain) {
				try {
					registeredRepositories = orcaRepositoryRoots()
				} catch (error) {
					ctx.ui.notify(`Cannot read Orca repository inventory: ${error instanceof Error ? error.message : String(error)}`, "error")
					return
				}
			}
			const promptObjective = selectedPlan ? relative(ctx.cwd, selectedPlan.target).split(sep).join("/") : objective
			let runKey: string
			try {
				runKey = taskGraphRunKey(ctx.cwd, objective, selectedPlan)
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
				return
			}
			try {
				const lockRoot = join(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir(), "task-graph-locks")
				const mutationLock = acquireTaskGraphMutationLock(lockRoot)
				try {
					const identity = repositoryIdentity(selectedPlan?.root ?? repositoryRoot(ctx.cwd))
					if (!runKey.startsWith(`${identity}::`)) throw new Error("Graph source changed before startup.")
					const recoveredRunIds = taskGraphOrcaRunIdsForLockRun(lockRoot, runKey)
					const recoveredContracts = taskGraphPlanContractsForLockRun(lockRoot, runKey)
					resumingRun = recoveredRunIds.length > 0 || recoveredContracts.length > 0
					if (recoveredRunIds.length > 1 || recoveredContracts.length > 1) throw new Error("Recovered graph locks disagree about durable Run state.")
					recoveredOrcaRunId = recoveredRunIds[0]
					recoveredPlanContract = recoveredContracts[0]
					activeLocks.push(acquireTaskGraphLock(lockRoot, runKey))
					for (const key of taskGraphLockKeysForRun(lockRoot, runKey)) {
						if (key !== runKey) activeLocks.push(acquireTaskGraphLock(lockRoot, key, process.pid, runKey))
					}
					activeRunKey = runKey
				} finally { releaseTaskGraphLock(mutationLock) }
			} catch (error) {
				for (const lock of activeLocks.reverse()) resumingRun ? abandonTaskGraphLock(lock) : releaseTaskGraphLock(lock)
				activeLocks = []
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning")
				return
			}
			const storedWorkspaceFile = join(activeLocks[0].path, "workspaces.json")
			if (existsSync(storedWorkspaceFile) && selectedPlan) {
				const stored = readGraphWorkspaces(storedWorkspaceFile)
				const executionRoot = stored.repositories.find((repo) => repo.source === selectedPlan!.root)?.workspace?.path
				const id = planId(selectedPlan.markdown)
				const paths = executionRoot && id ? planPathsById(executionRoot, id) : []
				if (paths.length === 1) {
					selectedPlan = { root: executionRoot!, target: paths[0], local: relative(executionRoot!, paths[0]).split(sep).join("/"), markdown: readFileSync(paths[0], "utf8") }
					planChain = stored.mode === "execute" && localPlanChain(selectedPlan)
					needsRecovery = planChain && planningDocumentNeedsRecovery(selectedPlan.local, selectedPlan.markdown)
					recoveryOnly = needsRecovery && planSecurityApproved(selectedPlan.markdown)
					planExecutable = !planChain || recoveryOnly || planningDocumentIsExecutable(selectedPlan.local, selectedPlan.markdown)
				}
			}
			const selectedWorkerModel = `${ctx.model.provider}/${ctx.model.id}`.toLowerCase()
			const sourceAgentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? getAgentDir()
			const profile = ctx.model.provider === "openai-codex" ? process.env.AGENT_TOOLKIT_CODEX_ACCOUNT ?? defaultPiAccount(sourceAgentDir) : undefined
			if (ctx.model.provider === "openai-codex" && !profile) {
				for (const lock of activeLocks.reverse()) resumingRun ? abandonTaskGraphLock(lock) : releaseTaskGraphLock(lock)
				activeLocks = []
				activeRunKey = undefined
				ctx.ui.notify("Cannot pin the Codex account for graph workers.", "error")
				return
			}
			const email = profile ? piAccountEmail(join(sourceAgentDir, "auth-profiles", profile)) : undefined
			const accountId = profile ? piProfileAccountId(profile, sourceAgentDir) : undefined
			if (profile && (!email || !accountId)) {
				for (const lock of activeLocks.reverse()) resumingRun ? abandonTaskGraphLock(lock) : releaseTaskGraphLock(lock)
				activeLocks = []
				activeRunKey = undefined
				ctx.ui.notify("Cannot resolve the selected Codex account email for graph workers.", "error")
				return
			}
			const selectedWorkerAccount = profile && email && accountId ? { profile, profileHash: createHash("sha256").update(profile).digest("hex"), email, accountId, agentDir: sourceAgentDir } : undefined
			const prompt = taskGraphPrompt(promptObjective, planChain, runKey, selectedWorkerModel, recoveryOnly, registeredRepositories, selectedWorkerAccount)
				+ (recoveredOrcaRunId ? `\n\nCrash recovery is pinned to Orca Run ${recoveredOrcaRunId}. Bind it even when every existing task is completed; do not create another Run.` : "")
				+ (recoveredPlanContract ? `\n\nPropose exactly this previously approved normalized graph contract for recovery: ${recoveredPlanContract}` : "")
			try {
				pending = {
					prompt,
					planChain,
					planExecutable,
					planOnlyRequired: !planChain && Boolean(selectedPlan && planningDocumentRequiresPlanOnly(selectedPlan.local, selectedPlan.markdown)),
					recoveryOnly,
					recoveryPlan: needsRecovery ? selectedPlan : undefined,
					workerModel: selectedWorkerModel,
					workerAccount: selectedWorkerAccount,
					repositoryRoots: registeredRepositories,
					runObjective: `${planChain ? "Pi plan chain" : "Pi task graph"}: ${runKey}`,
				}
				pi.sendUserMessage(prompt)
			} catch (error) {
				pending = null
				for (const lock of activeLocks.reverse()) resumingRun ? abandonTaskGraphLock(lock) : releaseTaskGraphLock(lock)
				activeLocks = []
				activeRunKey = undefined
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
			}
		},
	})

	pi.on("before_agent_start", (event) => {
		if (!pending || event.prompt !== pending.prompt) return
		planning = true
		approved = false
		finished = false
		approvedTaskMarkers = []
		approvedPlans = []
		reviewClosed = false
		planChain = pending.planChain
		planExecutable = pending.planExecutable
		planOnlyRequired = pending.planOnlyRequired
		recoveryOnly = pending.recoveryOnly
		recoveryPlan = pending.recoveryPlan
		workerModel = pending.workerModel
		workerAccount = pending.workerAccount
		repositoryRoots = pending.repositoryRoots
		activeRunObjective = pending.runObjective
		workerTerminalTitle = taskGraphTerminalTitle(pending.runObjective)
		pending = null
	})

	pi.on("tool_call", async (event, ctx) => {
		if (workerWorkspaceFile || workerTask) {
			if (!workerWorkspaceFile || !workerTask) return { block: true, reason: "Incomplete graph worker workspace binding." }
			const state = readGraphWorkspaces(workerWorkspaceFile)
			const worker = state.workers.find((item) => item.task === workerTask)
			const repository = state.repositories.find((repo) => repo.source === worker?.source)
			if (!worker || !repository || realpathSync(ctx.cwd) !== worker.path) return { block: true, reason: "Worker cwd does not match its recorded graph workspace." }
			verifyGraphWorkspace(repository, worker)
			if (event.toolName === "write" || event.toolName === "edit") graphWritePath(state, resolve(ctx.cwd, String(event.input.path).replace(/^@/, "")), worker)
			if (event.toolName === "bash") {
				const command = String(event.input.command)
				if (!worker.owns.length && !graphReportingCommand(command)) return { block: true, reason: "Read-only workers use read/search tools and standalone Orca reporting only." }
				if (!graphReportingCommand(command)) assertGraphShell(command, state, worker.path!)
			}
			if (!["read", "fffind", "ffgrep", "grep", "find", "ls", "bash", "write", "edit", "checkpoint_task_graph"].includes(event.toolName)) return { block: true, reason: "Graph workers may use scoped file tools and shell commands only; escalate other mutations to the coordinator." }
			return
		}
		if (!planning) return
		const powershell = event.toolName === "powershell"
		const command = isToolCallEventType("bash", event)
			? event.input.command
			: powershell && typeof (event.input as { command?: unknown }).command === "string"
				? (event.input as { command: string }).command
				: undefined
		if (approved) {
			if (["edit", "write"].includes(event.toolName)) {
				if (!workspaces || !activeOrcaRunId) return { block: true, reason: "Prepare the bound graph workspace before writing." }
				const path = resolve(ctx.cwd, String(event.input.path).replace(/^@/, ""))
				graphWritePath(workspaces, path)
				const repository = workspaces.repositories.find((repo) => repo.workspace?.path && path.startsWith(`${repo.workspace.path}${sep}`))!
				if (workspaces.workers.some((reader) => !reader.integrated && reader.prerequisites?.[repository.source])) return { block: true, reason: "Finish dependent workers before changing their pinned prerequisite workspace." }
				const contract = JSON.parse(recoveredPlanContract!) as TaskGraphPlan
				const local = relative(repository.workspace!.path!, path).split(sep).join("/")
				if (!contract.tasks.some((task) => approvedTaskRepositories.get(task.id) === repository.source && graphOwns(task.owns, local))) return { block: true, reason: "Coordinator write is outside the approved graph targets." }
			}
			if (command && typeof event.input.repository === "string") {
				const { workspace } = shellWorkspace(event.input.repository)
				assertGraphShell(command, workspaces!, workspace.path!)
				return
			}
			if (command && !taskGraphOrcaInvocations(command).length) return { block: true, reason: "Use bash with repository set to the exact prepared workspace for graph shell commands." }
			if (command && !taskGraphStandaloneOrca(command)) return { block: true, reason: "Use one standalone Orca invocation, without shell wrappers." }
			if (command) {
				const args = taskGraphOrcaArgv(command) ?? []
				const allowed = args[0] === "orchestration" && ["run-list", "run-show", "run-create", "task-list", "task-create", "task-update", "dispatch", "dispatch-show", "worker-list", "worker-show", "worker-read", "worker-release", "worker-stop", "worker-abandon", "check", "inbox", "send", "ask", "reply", "gate-create", "gate-list"].includes(args[1]) || args[0] === "status" || args[0] === "skills" && args[1] === "get" || args[0] === "repo" && ["list", "show"].includes(args[1]) || args[0] === "worktree" && ["list", "show", "current", "ps"].includes(args[1]) || args[0] === "terminal" && ["list", "show", "read", "wait", "create", "close"].includes(args[1])
				if (!allowed) return { block: true, reason: "This Orca operation is outside graph execution authority." }
			}
			if (command && /(?:^|\s)worktree\s+(?:create|rm|set|move)\b/.test(command)) return { block: true, reason: "Graph worktrees are created by prepare_task_graph_workspace; cleanup needs separate authorization." }
			if (recoveryOnly) {
				if (command !== undefined) {
					if (!isTaskGraphRecoveryCommand(command)) return { block: true, reason: "Completed-plan recovery permits only read-only Orca inspection, bound-Run task reconciliation, and verified terminal cleanup commands." }
					const argv = taskGraphOrcaArgv(command) ?? []
					const operation = `${argv[0] ?? ""} ${argv[1] ?? ""}`.toLowerCase()
					const consumingCheck = operation === "orchestration check" && hasOption(argv, "--ack")
					const mutation = consumingCheck || ["orchestration task-create", "orchestration task-update", "orchestration worker-release", "terminal close"].includes(operation)
					if (mutation && !activeOrcaRunId) return { block: true, reason: "Bind this graph's Orca Run before recovery mutations." }
					const runIds = optionValues(argv, "--run")
					if (mutation && (runIds.length > 1 || runIds.some((runId) => runId !== activeOrcaRunId) || hasOption(argv, "--from"))) return { block: true, reason: "Recovery mutations must target the bound Orca Run." }
					if (operation === "orchestration task-create") {
						const specs = optionValues(argv, "--spec")
						const marker = specs.length === 1 ? approvedTaskMarkers.find((prefix) => specs[0].startsWith(prefix)) : undefined
						const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId!, "--json"])?.result?.tasks
						const exists = Array.isArray(tasks) && tasks.some((task: { parent_id?: unknown; spec?: unknown }) => task.parent_id == null && String(task.spec ?? "").startsWith(marker ?? "<missing>"))
						if (!marker || !Array.isArray(tasks) || exists || [...pendingTaskCreates.values()].includes(marker) || optionValues(argv, "--parent").length || !approvedDependenciesMatch(marker, tasks, argv)) return { block: true, reason: "Recovery can create only one missing approved top-level ledger task with its exact contract prefix and dependencies." }
						pendingTaskCreates.set(event.toolCallId, marker)
					}
					if (operation === "orchestration task-update") {
						const ids = optionValues(argv, "--id")
						const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId!, "--json"])?.result?.tasks
						if (ids.length !== 1 || !Array.isArray(tasks) || !tasks.some((task: { id?: unknown }) => task.id === ids[0])) return { block: true, reason: "Recovery can update only one task in the bound Orca Run." }
					}
					if (consumingCheck) {
						const terminals = optionValues(argv, "--terminal")
						const run = orcaJson(["orchestration", "run-show", "--id", activeOrcaRunId!, "--json"])?.result?.run
						if (terminals.length > 1 || terminals.some((handle) => handle !== run?.coordinator_handle && !graphWorkerTerminals.has(handle))) return { block: true, reason: "Recovery can acknowledge messages only in the bound Orca Run." }
					}
					const dispatches = operation === "orchestration worker-release" ? optionValues(argv, "--dispatch") : []
					const terminals = operation === "terminal close" ? optionValues(argv, "--terminal") : []
					if (operation === "terminal close" && (terminals.length !== 1 || hasOption(argv, "--tab"))) return { block: true, reason: "Recovery can close exactly one owned worker terminal by handle." }
					if (operation === "orchestration worker-release" && dispatches.length !== 1) return { block: true, reason: "Recovery can release exactly one owned worker dispatch." }
					if (dispatches.length || terminals.length) {
						const workers = orcaJson(["orchestration", "worker-list", "--run", activeOrcaRunId!, "--json"])?.result?.workers
						const worker = Array.isArray(workers) ? workers.find((candidate: { dispatchId?: unknown; agentTerminalHandle?: unknown }) => dispatches.includes(String(candidate.dispatchId)) || terminals.includes(String(candidate.agentTerminalHandle))) : undefined
						if (dispatches.length && !worker || terminals.length && (!graphWorkerTerminals.has(terminals[0]) || worker && !["completed", "failed"].includes(String(worker.dispatchStatus)))) return { block: true, reason: "Recovery can release owned dispatches or close only settled worker terminals in the bound Orca Run." }
					}
					return
				}
				if (["edit", "write"].includes(event.toolName)) return { block: true, reason: "Completed-plan recovery may reconcile Orca state but cannot edit files." }
				return
			}
			if (!command) {
				if (!["read", "fffind", "ffgrep", "grep", "find", "ls", "edit", "write", "propose_task_graph", "bind_task_graph_run", "prepare_task_graph_workspace", "integrate_task_graph_worker", "checkpoint_task_graph", "recover_plan_lifecycle", "finish_task_graph", "ask_user_question", "enable_web_access", "web_search", "fetch_content", "get_search_content"].includes(event.toolName)) return { block: true, reason: "Use the graph's scoped tools; other mutation tools are not authorized by graph approval." }
				return
			}
			const operations = taskGraphOrcaOperations(command)
			const argv = taskGraphOrcaArgv(command) ?? []
			if (operations.includes("run-use") || activeOrcaRunId && operations.includes("run-create")) return { block: true, reason: "Use bind_task_graph_run and keep Orca on the bound Run." }
			if (operations.includes("run-create")) {
				const objectives = optionValues(argv, "--objective")
				const unfinishedMatch = orcaRuns().some((run: { id?: unknown; objective?: unknown }) => {
					if (run.objective !== activeRunObjective) return false
					const tasks = orcaJson(["orchestration", "task-list", "--run", String(run.id), "--json"])?.result?.tasks
					return !Array.isArray(tasks) || tasks.length === 0 || tasks.some((task: { status?: unknown }) => task.status !== "completed")
				})
				if (recoveredOrcaRunId || unfinishedMatch || runCreationAttempted || operations.length !== 1 || objectives.length !== 1 || objectives[0] !== activeRunObjective || hasOption(argv, "--from") || hasOption(argv, "--retry-request")) return { block: true, reason: recoveredOrcaRunId ? `Resume persisted Orca Run ${recoveredOrcaRunId}; do not create another.` : unfinishedMatch ? "Bind the existing unfinished Orca Run; do not create another." : "Create the approved Orca Run exactly once; rerun /graph to reconcile an uncertain result." }
				runCreationAttempted = true
			}
			const workerLaunch = isTaskGraphWorkerLaunch(command)
			const runMutation = operations.some((operation) => ["task-create", "task-update", "dispatch", "worker-start", "worker-release", "worker-stop", "worker-abandon"].includes(operation))
			if ((workerLaunch || runMutation) && !activeOrcaRunId) return { block: true, reason: "Bind this graph's Orca Run before creating tasks or workers." }
			const mutationRunIds = optionValues(argv, "--run")
			if (runMutation && (operations.length !== 1 || mutationRunIds.length > 1 || mutationRunIds.some((runId) => runId !== activeOrcaRunId) || optionValues(argv, "--from").length)) return { block: true, reason: "Graph mutations must remain scoped to the bound Orca Run." }
			if (operations.includes("task-update")) {
				const ids = optionValues(argv, "--id")
				const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId!, "--json"])?.result?.tasks
				if (ids.length !== 1 || !Array.isArray(tasks) || !tasks.some((task: any) => task.id === ids[0])) return { block: true, reason: "Update only a task in the bound Run." }
			}
			if (operations.includes("task-create")) {
				const parents = optionValues(argv, "--parent")
				const specs = optionValues(argv, "--spec")
				const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId!, "--json"])?.result?.tasks
				const topPrefix = parents.length === 0 && specs.length === 1 ? approvedTaskMarkers.find((prefix) => specs[0].startsWith(prefix)) : undefined
				const duplicate = topPrefix && (Array.isArray(tasks) && tasks.some((task: { parent_id?: unknown; spec?: unknown }) => task.parent_id == null && String(task.spec ?? "").startsWith(topPrefix)) || [...pendingTaskCreates.values()].includes(topPrefix))
				if (parents.length > 1 || parents.length === 1 && (!Array.isArray(tasks) || !tasks.some((task: { id?: unknown }) => task.id === parents[0])) || parents.length === 0 && (!topPrefix || !Array.isArray(tasks) || duplicate || !approvedDependenciesMatch(topPrefix, tasks, argv))) return { block: true, reason: "Create each approved top-level ledger task once with its approved dependencies, or create children only under tasks in the bound Run." }
				if (topPrefix) pendingTaskCreates.set(event.toolCallId, topPrefix)
			}
			if (operations.some((operation) => ["worker-release", "worker-stop", "worker-abandon"].includes(operation))) {
				const dispatches = optionValues(argv, "--dispatch")
				const workers = orcaJson(["orchestration", "worker-list", "--run", activeOrcaRunId!, "--json"])?.result?.workers
				if (dispatches.length !== 1 || !Array.isArray(workers) || !workers.some((worker: { dispatchId?: unknown }) => worker.dispatchId === dispatches[0])) return { block: true, reason: "Change only a worker dispatch owned by the bound Orca Run." }
			}
			if (operations.includes("dispatch")) {
				const terminals = optionValues(argv, "--to")
				const taskIds = optionValues(argv, "--task")
				const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId!, "--json"])?.result?.tasks
				let task = Array.isArray(tasks) && taskIds.length === 1 ? tasks.find((candidate: { id?: unknown }) => candidate.id === taskIds[0]) : undefined
				const seen = new Set<string>()
				while (task?.parent_id && !seen.has(task.id)) {
					seen.add(task.id)
					task = tasks.find((candidate: { id?: unknown }) => candidate.id === task.parent_id)
				}
				const approvedId = String(task?.spec ?? "").match(/^\[(?:plan|graph-task):([^\]]+)\]/)?.[1]
				const source = approvedId ? approvedTaskRepositories.get(approvedId) : undefined
				const worker = workspaces?.workers.find((item) => item.task === taskIds[0] && item.approvedTask === approvedId)
				const record = workspaces?.repositories.find((repo) => repo.source === source)
				if (!worker || !record || worker.terminal !== terminals[0]) return { block: true, reason: "Dispatch requires the prepared worker's exact task, terminal and workspace binding." }
				if (!approvedTaskMarkers.some((marker) => String(task?.spec ?? "").startsWith(marker))) return { block: true, reason: "Dispatch ledger contract changed after approval." }
				const terminal = orcaJson(["terminal", "show", "--terminal", terminals[0], "--json"])?.result?.terminal
				const livePath = terminal?.worktreePath || terminal?.worktreeId?.split("::").at(-1)
				if (terminal?.handle !== terminals[0] || !livePath || realpathSync(livePath) !== worker.path) return { block: true, reason: "Live terminal moved away from the prepared task workspace." }
				verifyGraphWorkspace(record, worker, worker.owns.length > 0 && worker.path !== record.source)
				const dispatchedTask = tasks.find((item: any) => item.id === taskIds[0])
				for (const dependency of JSON.parse(dispatchedTask.deps)) {
					if (!tasks.some((item: any) => item.id === dependency && item.status === "completed")) return { block: true, reason: "Task dependencies changed before dispatch." }
					const predecessor = workspaces!.workers.find((item) => item.task === dependency)
					if (predecessor?.owns.length && !predecessor.integrated) return { block: true, reason: "Integrate prerequisites before dispatch." }
					if (predecessor?.integrated && predecessor.source === worker.source) graphGit(worker.path!, "merge-base", "--is-ancestor", predecessor.integrated, "HEAD")
				}
				if (graphDirtyPaths(worker.path!).length && !workspaces!.currentCheckout && worker.owns.length) return { block: true, reason: "Worker workspace changed before dispatch." }
				const repository = worker.path
				if (terminals.length !== 1 || !approvedWorkerTerminals.has(terminals[0]) || !repository || terminalRepositories.get(terminals[0]) !== repository || planChain && taskIds[0] === task?.id || !hasOption(argv, "--inject") || hasOption(argv, "--dry-run") || hasOption(argv, "--return-preamble")) return { block: true, reason: "Dispatch only an internal plan task or approved graph task to a fresh checked worker terminal in its repository with --inject." }
				pendingDispatches.set(event.toolCallId, terminals[0])
			}
			const invocations = taskGraphOrcaInvocations(command)
			const closes = invocations.filter((candidate) => candidate[0]?.toLowerCase() === "terminal" && candidate[1]?.toLowerCase() === "close")
			if (closes.length) {
				const terminals = optionValues(closes[0], "--terminal")
				const workers = activeOrcaRunId ? orcaJson(["orchestration", "worker-list", "--run", activeOrcaRunId, "--json"])?.result?.workers : []
				const worker = Array.isArray(workers) ? workers.find((candidate: { agentTerminalHandle?: unknown }) => candidate.agentTerminalHandle === terminals[0]) : undefined
				const activeWorker = worker && !["completed", "failed"].includes(String(worker.dispatchStatus))
				if (invocations.length !== 1 || closes.length !== 1 || terminals.length !== 1 || !graphWorkerTerminals.has(terminals[0]) || hasOption(closes[0], "--tab") || activeWorker) return { block: true, reason: "Close only one settled or undispatched worker terminal created by this graph." }
			}
			if (!workerLaunch) return
			const environment = taskGraphWorkerEnvironment(command)
			const worker = workspaces?.workers.find((item) => item.task === environment?.AGENT_TOOLKIT_GRAPH_TASK)
			const repository = workspaces?.repositories.find((repo) => repo.source === worker?.source)
			if (!worker || !repository || environment?.AGENT_TOOLKIT_GRAPH_WORKSPACES !== workspaceFile || worker.terminal || worker.launch) return { block: true, reason: "Prepare a fresh worker workspace and include its exact returned environment assignments before pi-yolo." }
			verifyGraphWorkspace(repository, worker, worker.owns.length > 0 && worker.path !== repository.source)
			const selector = worker.id?.startsWith("path:") ? worker.id : `id:${worker.id}`
			if (argv[0] !== "terminal" || argv[1] !== "create" || optionValues(argv, "--worktree").length !== 1 || optionValues(argv, "--worktree")[0] !== selector) return { block: true, reason: "Launch only in the exact prepared task worktree selector." }
			const taskContract = (JSON.parse(recoveredPlanContract!) as TaskGraphPlan).tasks.find((task) => task.id === worker.approvedTask)
			if (taskContract?.setup && !worker.setupComplete) return { block: true, reason: "Run the approved setup command in this worker workspace through bash before launch." }
			if (taskGraphWorkerThinking(command) !== taskContract?.thinking || Object.keys(environment!).some((key) => !["AGENT_TOOLKIT_GRAPH_WORKSPACES", "AGENT_TOOLKIT_GRAPH_TASK", "AGENT_TOOLKIT_CODEX_PROFILE_SHA256", "AGENT_TOOLKIT_CODEX_ACCOUNT_EMAIL_B64", "AGENT_TOOLKIT_CODEX_ACCOUNT_ID", "AGENT_TOOLKIT_PI_AGENT_DIR"].includes(key))) return { block: true, reason: "Launch exactly pi-yolo with the approved --model and --thinking, required account/workspace assignments, and no other flags or environment overrides." }
			const requestedModel = taskGraphWorkerModel(command)
			if (!requestedModel) return { block: true, reason: `Cannot verify the worker launch command. Use one standalone orca terminal create/split invocation with exactly one --command containing 'pi-yolo --model ${workerModel} --thinking medium' (high only if explicitly requested). Keep the account environment assignments from the approved graph prompt before pi-yolo. Do not nest a shell, combine commands, or use --provider/-m. This is command-format validation, not evidence that the launcher is broken; no source inspection or launch dry-run is required. If debugging is needed, search $PI_CODING_AGENT_DIR/extensions/task-graph, not the runtime root.` }
			if (requestedModel !== workerModel) return { block: true, reason: `Graph workers must use the approved model ${workerModel}.` }
			if (requestedModel.startsWith("openai-codex/")) {
				const requestedAccount = taskGraphWorkerAccount(command)
				if (!workerAccount || !requestedAccount || requestedAccount.profileHash !== workerAccount.profileHash || requestedAccount.email !== workerAccount.email || requestedAccount.accountId !== workerAccount.accountId || requestedAccount.agentDir !== workerAccount.agentDir) {
					return { block: true, reason: `Codex graph workers must use the approved account ${workerAccount?.email ?? "unknown"}.` }
				}
				const quotaPauseReason = taskGraphQuotaPauseReason(await fetchCodexUsage(join(workerAccount.agentDir, "auth-profiles", workerAccount.profile)), TASK_GRAPH_WEEKLY_QUOTA_RESERVE, TASK_GRAPH_SHORT_QUOTA_RESERVE)
				if (quotaPauseReason) return { block: true, reason: `${quotaPauseReason} This automatic check cannot be replaced by user confirmation. Do not ask the user to verify quota, retry launches, or start more workers. Mark the active plan budget-exhausted, report this blocker once, and stop; resume with the same /graph command after quota resets.` }
			}
			if (!hasOption(argv, "--json") || optionValues(argv, "--title").length !== 1 || optionValues(argv, "--title")[0] !== launchTitle(worker)) return { block: true, reason: `Worker terminal launches require --json --title ${launchTitle(worker)} for crash recovery.` }
			pendingTerminalLaunches.add(event.toolCallId)
			return
		}
		if (!["read", "fffind", "ffgrep", "grep", "find", "ls", "propose_task_graph", "ask_user_question", "enable_web_access", "web_search", "fetch_content", "get_search_content"].includes(event.toolName)) {
			return { block: true, reason: "Mutation tools are disabled until the user approves the task graph. Use read and search tools while planning." }
		}
	})

	pi.on("tool_result", (event) => {
		pendingTaskCreates.delete(event.toolCallId)
		if (pendingTerminalLaunches.delete(event.toolCallId) && !event.isError) {
			try {
				const output = event.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
				const receipt = terminalReceiptFromOutput(output)
				if (receipt) {
					approvedWorkerTerminals.add(receipt.handle)
					graphWorkerTerminals.add(receipt.handle)
					terminalRepositories.set(receipt.handle, receipt.repository)
					const environment = typeof event.input.command === "string" ? taskGraphWorkerEnvironment(event.input.command) : undefined
					const worker = workspaces?.workers.find((item) => item.path === receipt.repository && item.task === environment?.AGENT_TOOLKIT_GRAPH_TASK && !item.terminal)
					if (worker) { worker.terminal = receipt.handle; persistWorkspaces() }
				}
			} catch {}
		}
		if (!event.isError && typeof event.input.command === "string") {
			const argv = taskGraphOrcaArgv(event.input.command) ?? []
			if (argv[0]?.toLowerCase() === "terminal" && argv[1]?.toLowerCase() === "close") {
				const handle = optionValues(argv, "--terminal")[0]
				graphWorkerTerminals.delete(handle)
				terminalRepositories.delete(handle)
			}
		}
		const dispatched = pendingDispatches.get(event.toolCallId)
		if (dispatched) {
			pendingDispatches.delete(event.toolCallId)
			if (!event.isError) approvedWorkerTerminals.delete(dispatched)
		}
	})

	pi.on("agent_settled", () => {
		boundRunObjective = undefined
		for (const lock of activeLocks.reverse()) {
			if ((approved || resumingRun) && !finished) abandonTaskGraphLock(lock)
			else releaseTaskGraphLock(lock)
		}
		activeLocks = []
		activeRunKey = undefined
		activeRunObjective = undefined
		activeOrcaRunId = undefined
		resumingRun = false
		runCreationAttempted = false
		recoveredOrcaRunId = undefined
		recoveredPlanContract = undefined
		approvedTaskMarkers = []
		approvedPlans = []
		approvedWorkerTerminals.clear()
		graphWorkerTerminals.clear()
		terminalRepositories.clear()
		approvedTaskRepositories.clear()
		approvedTaskDependencies.clear()
		pendingTaskCreates.clear()
		pendingTerminalLaunches.clear()
		pendingDispatches.clear()
		pending = null
		workspaces = undefined
		workspaceFile = undefined
		planning = false
		approved = false
		finished = false
		reviewClosed = false
		planChain = false
		planExecutable = true
		planOnlyRequired = false
		recoveryOnly = false
		recoveryPlan = undefined
		workerModel = ""
		workerTerminalTitle = ""
		workerAccount = undefined
		repositoryRoots = []
	})

	pi.on("session_shutdown", () => {
		boundRunObjective = undefined
		for (const lock of activeLocks.reverse()) {
			if ((approved || resumingRun) && !finished) abandonTaskGraphLock(lock)
			else releaseTaskGraphLock(lock)
		}
		activeLocks = []
		activeRunKey = undefined
		activeRunObjective = undefined
		activeOrcaRunId = undefined
		resumingRun = false
		runCreationAttempted = false
		recoveredOrcaRunId = undefined
		recoveredPlanContract = undefined
		workerTerminalTitle = ""
	})
}
