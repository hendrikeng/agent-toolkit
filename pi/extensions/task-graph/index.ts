import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { getAgentDir, isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { defaultPiAccount, fetchCodexUsage, piAccountEmail, piProfileAccountId } from "../codex-account/index.ts"
import {
	abandonTaskGraphLock,
	acquireTaskGraphLock,
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
	taskGraphLockKeysForRun,
	taskGraphOrcaRunIdsForLockRun,
	taskGraphPlanContractsForLockRun,
	taskGraphOrcaArgv,
	taskGraphOrcaInvocations,
	taskGraphOrcaOperations,
	taskGraphQuotaPauseReason,
	taskGraphPrompt,
	taskGraphTerminalTitle,
	taskGraphWorkerAccount,
	taskGraphWorkerModel,
	TASK_GRAPH_SHORT_QUOTA_RESERVE,
	TASK_GRAPH_USAGE,
	TASK_GRAPH_WEEKLY_QUOTA_RESERVE,
	type TaskGraphLock,
	type TaskGraphPlan,
	validateTaskGraph,
	validateTaskGraphRepositories,
} from "./task-graph-core.ts"

const taskSchema = Type.Object({
	id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$", description: "Stable lowercase task ID" }),
	goal: Type.String({ minLength: 1, description: "One bounded outcome" }),
	depends_on: Type.Array(Type.String({ minLength: 1 }), { maxItems: 11, description: "Hard prerequisite task IDs" }),
	repository: Type.Optional(Type.String({ minLength: 1, description: "Local Git repository root relative to the current repository; defaults to the current repository" })),
	owns: Type.Array(Type.String({ minLength: 1 }), { maxItems: 20, description: "Exclusive write paths relative to this task's repository; empty for read-only work" }),
	specialty: Type.String({ minLength: 1, description: "Worker expertise needed for this task" }),
	thinking: Type.Union([Type.Literal("medium"), Type.Literal("high")], { description: "Worker thinking level" }),
	done_when: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10, description: "Observable completion criteria" }),
	validation: Type.String({ minLength: 1, description: "Smallest focused validation command or manual check" }),
}, { additionalProperties: false })

const graphSchema = Type.Object({
	objective: Type.String({ minLength: 1 }),
	mode: Type.Union([Type.Literal("plan-only"), Type.Literal("execute")], {
		description: "plan-only for blocked work or execute for approved work",
	}),
	tasks: Type.Array(taskSchema, { minItems: 1, maxItems: 12 }),
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
				if (typeof terminal?.handle === "string" && repository && existsSync(repository)) return { handle: terminal.handle, repository: repositoryIdentity(repository) }
			} catch {}
		}
	}
	return undefined
}

function orcaTerminalHandles(): Set<string> {
	const terminals = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result?.terminals
	if (!Array.isArray(terminals)) throw new Error("Orca terminal listing is incomplete.")
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

function validatePlanChainPlans(plan: TaskGraphPlan, root: string, targetKey: string, repositoryRoots: string[], recovery = false): string[] {
	const taskRoots = new Set(plan.tasks.map((task) => realpathSync(resolve(root, task.repository ?? "."))))
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
		const taskRoot = realpathSync(resolve(root, task.repository ?? "."))
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
		task.owns = [...new Set([...lifecycleTargets, ...targets])]
		if (task.owns.length > 20) throw new Error(`Plan-chain task ${task.id} exceeds 20 ownership targets.`)
		task.done_when = [acceptance, `Validation lanes: ${validation}`]
		task.thinking = risk === "high" ? "high" : "medium"
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
	let resumingRun = false
	let runCreationAttempted = false
	let recoveredOrcaRunId: string | undefined
	let recoveredPlanContract: string | undefined
	let workerTerminalTitle = ""
	let approvedTaskMarkers: string[] = []
	let approvedPlans: Array<{ root: string; id: string }> = []
	let activeLocks: TaskGraphLock[] = []
	const approvedWorkerTerminals = new Set<string>()
	const graphWorkerTerminals = new Set<string>()
	const terminalRepositories = new Map<string, string>()
	const approvedTaskRepositories = new Map<string, string>()
	const approvedTaskDependencies = new Map<string, string[]>()
	const pendingTaskCreates = new Map<string, string>()
	const pendingTerminalLaunches = new Set<string>()
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
		name: "bind_task_graph_run",
		label: "Bind Task Graph Run",
		description: "Bind the one unfinished Orca Run selected or created for this approved graph.",
		parameters: Type.Object({ run_id: Type.String({ pattern: "^run_[a-zA-Z0-9_-]+$", description: "Selected Orca Run ID" }) }, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			if (!planning || !approved || !activeRunObjective) throw new Error("bind_task_graph_run requires an approved active /graph run.")
			if (recoveredOrcaRunId && params.run_id !== recoveredOrcaRunId) throw new Error(`Resume the Orca Run persisted by this graph: ${recoveredOrcaRunId}`)
			const matchingRuns = orcaRuns().filter((run: { objective?: unknown }) => run.objective === activeRunObjective)
			if (!Array.isArray(matchingRuns) || !matchingRuns.some((run: { id?: unknown }) => run.id === params.run_id)) throw new Error("The supplied Orca Run does not match this approved graph.")
			const unfinishedRuns = matchingRuns.filter((candidate: { id?: unknown }) => {
				const candidateTasks = orcaJson(["orchestration", "task-list", "--run", String(candidate.id), "--json"])?.result?.tasks
				return !Array.isArray(candidateTasks) || candidateTasks.length === 0 || candidateTasks.some((task: { status?: unknown }) => task.status !== "completed")
			})
			if (unfinishedRuns.length > 1 || unfinishedRuns.length === 1 && unfinishedRuns[0].id !== params.run_id) throw new Error("The approved objective has an ambiguous or different unfinished Orca Run.")
			const run = orcaJson(["orchestration", "run-show", "--id", params.run_id, "--json"])?.result?.run
			if (run?.objective !== activeRunObjective) throw new Error("The supplied Orca Run does not match this approved graph.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", params.run_id, "--json"])?.result?.tasks
			if (!recoveryPlan && recoveredOrcaRunId !== params.run_id && Array.isArray(tasks) && tasks.length > 0 && tasks.every((task: { status?: unknown }) => task.status === "completed")) throw new Error("The supplied Orca Run is already complete.")
			orcaJson(["orchestration", "run-use", "--id", params.run_id, "--json"])
			for (const lock of activeLocks) bindTaskGraphLockToOrcaRun(lock, params.run_id)
			recoveredOrcaRunId = params.run_id
			const workers = orcaJson(["orchestration", "worker-list", "--run", params.run_id, "--json"])?.result?.workers
			if (!Array.isArray(workers)) throw new Error("Cannot reconcile worker terminals for the selected Orca Run.")
			const dispatchedTerminals = new Set<string>()
			for (const worker of workers) if (typeof worker?.agentTerminalHandle === "string") {
				graphWorkerTerminals.add(worker.agentTerminalHandle)
				dispatchedTerminals.add(worker.agentTerminalHandle)
			}
			const terminals = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result?.terminals
			if (!Array.isArray(terminals)) throw new Error("Cannot reconcile worker terminals for the selected Orca Run.")
			for (const terminal of terminals.filter((candidate: { title?: unknown }) => candidate.title === workerTerminalTitle)) {
				const repository = String(terminal.worktreePath || terminal.worktreeId || "").split("::").at(-1)
				if (typeof terminal.handle === "string" && repository && existsSync(repository)) {
					graphWorkerTerminals.add(terminal.handle)
					if (!dispatchedTerminals.has(terminal.handle)) approvedWorkerTerminals.add(terminal.handle)
					terminalRepositories.set(terminal.handle, repositoryIdentity(repository))
				}
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
			if (!planning || !approved || !recoveryPlan || !activeOrcaRunId) throw new Error("No approved and bound interrupted plan lifecycle is ready for recovery.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", activeOrcaRunId, "--json"])?.result?.tasks
			if (!approvedLedgerIsComplete(tasks)) throw new Error("Reconcile the complete approved Orca ledger before plan lifecycle recovery.")
			const workers = orcaJson(["orchestration", "worker-list", "--run", activeOrcaRunId, "--json"])?.result?.workers
			if (!Array.isArray(workers) || workers.some((worker: { dispatchStatus?: unknown }) => !["completed", "failed"].includes(String(worker.dispatchStatus)))) throw new Error("Settle every Orca dispatch before plan lifecycle recovery.")
			if (recoveryPlan.local.startsWith("docs/exec-plans/active/")) {
				if (planStatus(readFileSync(recoveryPlan.target, "utf8")) !== "completed") throw new Error("Active plan recovery requires the current Status to remain completed.")
				const destination = join(recoveryPlan.root, recoveryPlan.local.replace("docs/exec-plans/active/", "docs/exec-plans/completed/"))
				if (existsSync(destination)) throw new Error(`Recovery destination already exists: ${destination}`)
				mkdirSync(dirname(destination), { recursive: true })
				renameSync(recoveryPlan.target, destination)
				recoveryPlan = undefined
				return { content: [{ type: "text", text: `Recovered completed plan move to ${destination}` }], details: { status: "recovered", destination } }
			}
			if (recoveryPlan.local.startsWith("docs/exec-plans/completed/")) {
				const target = recoveryPlan.target
				const content = readFileSync(target, "utf8")
				if (planStatus(content) !== "completed") writeFileSync(target, replacePlanStatus(content, "completed"))
				recoveryPlan = undefined
				return { content: [{ type: "text", text: `Recovered completed plan state in ${target}` }], details: { status: "recovered", target } }
			}
			throw new Error("The selected plan has no supported interrupted lifecycle transition.")
		},
	})

	pi.registerTool({
		name: "finish_task_graph",
		label: "Finish Task Graph",
		description: "Release graph locks after every worker is settled and released and all required validation and closeout passed.",
		parameters: Type.Object({
			run_id: Type.String({ pattern: "^run_[a-zA-Z0-9_-]+$", description: "Bound Orca Run ID" }),
			evidence: Type.String({ minLength: 1, description: "Concise completion and closeout evidence" }),
		}, { additionalProperties: false }),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			if (!planning || !approved || !activeRunObjective) throw new Error("finish_task_graph requires an approved active /graph run.")
			if (params.run_id !== activeOrcaRunId) throw new Error("Finish the Orca Run bound for this graph invocation.")
			if (recoveryPlan) throw new Error("Finish the approved plan lifecycle recovery before releasing graph locks.")
			const run = orcaJson(["orchestration", "run-show", "--id", params.run_id, "--json"])?.result?.run
			if (run?.objective !== activeRunObjective) throw new Error("The supplied Orca Run does not match this approved graph.")
			const tasks = orcaJson(["orchestration", "task-list", "--run", params.run_id, "--json"])?.result?.tasks
			if (!approvedLedgerIsComplete(tasks)) {
				throw new Error("Every approved Orca task must exist exactly once and be completed before graph locks are released.")
			}
			for (const approvedPlan of approvedPlans) {
				const matches = planPathsById(approvedPlan.root, approvedPlan.id)
				if (matches.length !== 1 || !relative(approvedPlan.root, matches[0]).split(sep).join("/").startsWith("docs/exec-plans/completed/") || planStatus(readFileSync(matches[0], "utf8")) !== "completed") {
					throw new Error(`Plan ${approvedPlan.id} has not completed lifecycle closeout.`)
				}
			}
			const workers = orcaJson(["orchestration", "worker-list", "--run", params.run_id, "--json"])?.result?.workers
			const terminalInventory = orcaJson(["terminal", "list", "--limit", "1000", "--json"])?.result
			const terminals = terminalInventory?.terminals
			const liveTerminals = new Set(Array.isArray(terminals) ? terminals.map((terminal: { handle?: unknown }) => terminal.handle) : [])
			if (terminalInventory?.truncated || terminalInventory?.hostScope?.omittedHostIds?.length) throw new Error("The live terminal inventory is incomplete; graph locks cannot be released safely.")
			if (Array.isArray(terminals) && terminals.some((terminal: { title?: unknown }) => terminal.title === workerTerminalTitle)) throw new Error("Close every graph-owned worker terminal before finishing.")
			if (!Array.isArray(workers) || !Array.isArray(terminals) || workers.some((worker: { dispatchStatus?: unknown; workerState?: unknown; terminalState?: unknown; resource?: unknown; agentTerminalHandle?: unknown }) =>
				!["completed", "failed"].includes(String(worker.dispatchStatus)) || (!["released", "closed"].includes(String(worker.workerState)) && !["released", "closed"].includes(String(worker.terminalState)) && !(worker.workerState === "unsupervised" && worker.resource == null && typeof worker.agentTerminalHandle === "string" && !liveTerminals.has(worker.agentTerminalHandle))))) {
				throw new Error("Every Orca worker must be settled and released before graph locks are released.")
			}
			for (const lock of activeLocks.reverse()) releaseTaskGraphLock(lock)
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
			finished = true
			approved = false
			planning = false
			return { content: [{ type: "text", text: `Task graph finished: ${params.evidence}` }], details: { status: "complete", evidence: params.evidence }, terminate: true }
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
			let plan = normalizeTaskGraphOwnership(params, root)
			validateTaskGraphRepositories(plan, root)
			validateTaskGraph(plan, planChain)
			const recoveredPlan = recoveredPlanContract ? JSON.parse(recoveredPlanContract) as TaskGraphPlan : undefined
			if (recoveredPlan && !isDeepStrictEqual(recoveredPlan, plan)) throw new Error("Crash recovery must use the previously approved task graph contract.")
			const chainLocks: TaskGraphLock[] = []
			let keys: string[] = []
			if (planChain) {
				if (!activeRunKey) throw new Error("The selected plan has no stable Run identity.")
				keys = validatePlanChainPlans(plan, root, activeRunKey, repositoryRoots, Boolean(recoveredPlan))
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
			if (!ctx.hasUI) {
				releaseChainLocks()
				return {
					content: [{ type: "text", text: `${graph}\n\nInteractive approval is unavailable. Show the plan and stop without dispatching.` }],
					details: { status: "approval-required", plan },
				}
			}

			let review: Awaited<ReturnType<typeof reviewTaskGraph>>
			try {
				review = await reviewTaskGraph(plan, ctx.ui, signal, planChain)
			} catch (error) {
				releaseChainLocks()
				throw error
			}
			approved = review.status === "approved"
			if (approved) for (const lock of activeLocks) bindTaskGraphLockToPlanContract(lock, proposedContract)
			recoveredPlanContract = approved ? proposedContract : recoveredPlanContract
			approvedTaskMarkers = approved ? (recoveredPlan ?? plan).tasks.map((task) => `[${planChain ? "plan" : "graph-task"}:${task.id}][graph-contract:${createHash("sha256").update(JSON.stringify(task)).digest("hex")}]`) : []
			approvedPlans = approved && planChain ? plan.tasks.map((task) => ({ root: realpathSync(resolve(root, task.repository ?? ".")), id: task.id })) : []
			approvedTaskRepositories.clear()
			approvedTaskDependencies.clear()
			if (approved) for (const task of plan.tasks) {
				approvedTaskRepositories.set(task.id, repositoryIdentity(resolve(root, task.repository ?? ".")))
				approvedTaskDependencies.set(task.id, task.depends_on)
			}
			if (!approved) releaseChainLocks()
			reviewClosed = review.status !== "revise"
			const text = review.status === "approved"
				? `${planChain
					? "The user approved the full plan chain. Execute every plan in dependency order without further routine approval."
					: "The user approved this task graph. Execute it through Orca orchestration."}\nUse these exact top-level ledger prefixes:\n${approvedTaskMarkers.join("\n")}`
				: review.status === "plan-approved"
					? "The user approved this plan-only graph. Stop without dispatching implementation workers."
					: review.status === "revise"
						? `Revise the graph and call propose_task_graph again. User feedback: ${review.feedback}`
						: "The user cancelled task graph execution. Stop without dispatching."
			return {
				content: [{ type: "text", text }],
				details: { ...review, plan },
				terminate: review.status === "cancelled" || review.status === "plan-approved",
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
			const planChain = localPlanChain(selectedPlan)
			const needsRecovery = Boolean(planChain && selectedPlan && planningDocumentNeedsRecovery(selectedPlan.local, selectedPlan.markdown))
			const recoveryOnly = needsRecovery && Boolean(selectedPlan && planSecurityApproved(selectedPlan.markdown))
			const planExecutable = !planChain || recoveryOnly || planningDocumentIsExecutable(selectedPlan!.local, selectedPlan!.markdown)
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
			} catch (error) {
				for (const lock of activeLocks.reverse()) resumingRun ? abandonTaskGraphLock(lock) : releaseTaskGraphLock(lock)
				activeLocks = []
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning")
				return
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
		if (!planning) return
		const powershell = event.toolName === "powershell"
		const command = isToolCallEventType("bash", event)
			? event.input.command
			: powershell && typeof (event.input as { command?: unknown }).command === "string"
				? (event.input as { command: string }).command
				: undefined
		if (approved) {
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
			if (!command) return
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
				const repository = approvedId ? approvedTaskRepositories.get(approvedId) : undefined
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
			const requestedModel = taskGraphWorkerModel(command)
			if (!requestedModel) return { block: true, reason: "Every graph worker launch must include an explicit --model provider/model so quota policy can be enforced." }
			if (requestedModel !== workerModel) return { block: true, reason: `Graph workers must use the approved model ${workerModel}.` }
			if (requestedModel.startsWith("openai-codex/")) {
				const requestedAccount = taskGraphWorkerAccount(command)
				if (!workerAccount || !requestedAccount || requestedAccount.profileHash !== workerAccount.profileHash || requestedAccount.email !== workerAccount.email || requestedAccount.accountId !== workerAccount.accountId || requestedAccount.agentDir !== workerAccount.agentDir) {
					return { block: true, reason: `Codex graph workers must use the approved account ${workerAccount?.email ?? "unknown"}.` }
				}
				const quotaPauseReason = taskGraphQuotaPauseReason(await fetchCodexUsage(join(workerAccount.agentDir, "auth-profiles", workerAccount.profile)), TASK_GRAPH_WEEKLY_QUOTA_RESERVE, TASK_GRAPH_SHORT_QUOTA_RESERVE)
				if (quotaPauseReason) return { block: true, reason: `${quotaPauseReason} Do not start more workers. Mark the active plan budget-exhausted and stop; resume with the same /graph command after quota resets.` }
			}
			if (!hasOption(argv, "--json") || optionValues(argv, "--title").length !== 1 || optionValues(argv, "--title")[0] !== workerTerminalTitle) return { block: true, reason: `Worker terminal launches require --json --title ${workerTerminalTitle} for crash recovery.` }
			pendingTerminalLaunches.add(event.toolCallId)
			return
		}
		if (["bash", "powershell", "edit", "write"].includes(event.toolName)) {
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
