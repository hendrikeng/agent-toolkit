import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path"

export const TASK_GRAPH_USAGE = "Usage: /graph <objective-or-plan-path>"
export const TASK_GRAPH_WEEKLY_QUOTA_RESERVE = 15
export const TASK_GRAPH_SHORT_QUOTA_RESERVE = 5

// ponytail: one host-local startup/cleanup mutex; use per-repository leases if contention matters.
export function acquireTaskGraphMutationLock(root: string): TaskGraphLock {
	return acquireTaskGraphLock(join(root, "mutation-locks"), "graph-startup-and-cleanup")
}

export function repositoryIdentity(root: string): string {
	const common = execFileSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8", timeout: 10_000 }).trim()
	return realpathSync(resolve(root, common))
}

export function taskGraphTerminalTitle(runObjective: string): string {
	return `pi-graph-${createHash("sha256").update(runObjective).digest("hex")}`
}

export interface TaskGraphLock {
	path: string
	token: string
}

type TaskGraphQuotaWindow = { remainingPercent: number; windowMinutes?: number; resetsAt?: number }
type TaskGraphQuota = { primary?: TaskGraphQuotaWindow; secondary?: TaskGraphQuotaWindow }

export function taskGraphQuotaPauseReason(usage: TaskGraphQuota | undefined, weeklyReserve: number, shortReserve: number): string | undefined {
	const windows = [usage?.primary, usage?.secondary]
		.filter((window): window is TaskGraphQuotaWindow & { windowMinutes: number } => Boolean(window?.windowMinutes))
		.sort((left, right) => left.windowMinutes - right.windowMinutes)
	const weekly = windows.findLast((window) => window.windowMinutes >= 1_440)
	if (!weekly) return "Codex long-window quota is unavailable, so the reserve cannot be verified."
	if (weekly.remainingPercent <= weeklyReserve) {
		return `Codex long-window quota is ${weekly.remainingPercent}% (reserve: ${weeklyReserve}%).`
	}
	const short = windows.find((window) => window.windowMinutes < 1_440)
	if (short && short.remainingPercent <= shortReserve) {
		return `Codex short-window quota is ${short.remainingPercent}% (reserve: ${shortReserve}%).`
	}
	return undefined
}

const shellControls = new Set([";", "|", "||", "&", "&&"])

function shellWords(command: string): string[] | undefined {
	const words: string[] = []
	let word = ""
	let quote = ""
	const flush = () => {
		if (!word) return
		words.push(word)
		word = ""
	}
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]
		if (quote) {
			if (character === quote) quote = ""
			else if (character === "\\" && quote === '"' && index + 1 < command.length) {
				if (command[index + 1] === "\n") index += 1
				else if (command[index + 1] === "\r" && command[index + 2] === "\n") index += 2
				else word += command[++index]
			} else word += character
		} else if (character === '"' || character === "'") quote = character
		else if (character === "\\" && index + 1 < command.length) {
			if (command[index + 1] === "\n") index += 1
			else if (command[index + 1] === "\r" && command[index + 2] === "\n") index += 2
			else word += command[++index]
		}
		else if (character === "\n" || character === "\r") {
			flush()
			words.push(";")
			if (character === "\r" && command[index + 1] === "\n") index += 1
		} else if (character === ";" || character === "|" || character === "&") {
			flush()
			const doubled = command[index + 1] === character
			words.push(doubled ? character + command[++index] : character)
		} else if (/\s/.test(character)) flush()
		else word += character
	}
	if (quote) return undefined
	flush()
	return words
}

export function shellSegments(command: string): string[][] | undefined {
	const words = shellWords(command)
	if (!words) return undefined
	const segments: string[][] = [[]]
	for (const word of words) shellControls.has(word) ? segments.push([]) : segments.at(-1)!.push(word)
	return segments.filter((segment) => segment.length > 0)
}

function orcaExecutableNames(): Set<string> {
	const configured = process.env.ORCA_CLI_COMMAND
	return new Set(["orca", "orca-dev", "orca-ide", ...(configured ? [basename(configured)] : [])].map((name) => name.toLowerCase()))
}

export function taskGraphOrcaInvocations(command: string): string[][] {
	return shellSegments(command)?.flatMap((segment) => {
		const orca = segment.findIndex((word) => orcaExecutableNames().has(basename(word).toLowerCase()))
		return orca >= 0 ? [segment.slice(orca + 1)] : []
	}) ?? []
}

export function taskGraphStandaloneOrca(command: string): boolean {
	if (/\$\(|`|[<>]/.test(command)) return false
	const segments = shellSegments(command)
	return Boolean(segments?.length === 1 && orcaExecutableNames().has(basename(segments[0][0]).toLowerCase()))
}

export function taskGraphOrcaArgv(command: string): string[] | undefined {
	const words = shellWords(command)
	if (!words) return undefined
	const orca = words.findIndex((word) => orcaExecutableNames().has(basename(word).toLowerCase()))
	return orca >= 0 ? words.slice(orca + 1) : undefined
}

export function taskGraphOrcaOperations(command: string): string[] {
	const operations = taskGraphOrcaInvocations(command).flatMap((argv) => argv[0]?.toLowerCase() === "orchestration" && argv[1] ? [argv[1].toLowerCase()] : [])
	if (operations.length > 0) return operations
	return [...command.matchAll(/\borchestration\s+([a-z-]+)/gi)].map((match) => match[1].toLowerCase())
}

function workerLaunchType(segment: string[]): "terminal" | "fresh" | "attachment" | "workspace" | undefined {
	const executables = orcaExecutableNames()
	const orca = segment.findIndex((word) => executables.has(basename(word).toLowerCase()))
	if (orca < 0) return undefined
	const args = segment.slice(orca + 1)
	if (args[0]?.toLowerCase() === "terminal" && ["create", "split"].includes(args[1]?.toLowerCase())) return "terminal"
	if (args[0]?.toLowerCase() === "worktree" && args[1]?.toLowerCase() === "create") return args.some((argument) => argument === "--agent" || argument.startsWith("--agent=")) ? "fresh" : "workspace"
	if (args[0]?.toLowerCase() === "orchestration" && args[1]?.toLowerCase() === "worker-start") {
		return args.some((argument) => argument === "--terminal" || argument.startsWith("--terminal=")) ? "attachment" : "fresh"
	}
	return undefined
}

export function isTaskGraphWorkerLaunch(command: string): boolean {
	const segments = shellSegments(command)
	if (!segments) return /\b(?:worker-start|terminal\s+(?:create|split)|worktree\s+create)\b/i.test(command)
	if (segments.some((segment) => {
		let executable = segment.findIndex((argument) => !/^[A-Z_][A-Z0-9_]*=/.test(argument))
		if (basename(segment[executable] ?? "").toLowerCase() === "env") {
			executable += 1
			while (segment[executable]?.startsWith("-") || /^[A-Z_][A-Z0-9_]*=/.test(segment[executable] ?? "")) executable += 1
		}
		while (["command", "exec"].includes(basename(segment[executable] ?? "").toLowerCase())) executable += 1
		if (["pi-yolo", "agent-yolo"].includes(basename(segment[executable] ?? "").toLowerCase())) return true
		if (["sh", "bash", "zsh"].includes(basename(segment[executable] ?? "").toLowerCase())) {
			const commandOption = segment.indexOf("-c", executable + 1)
			return commandOption >= 0 && Boolean(segment[commandOption + 1]) && isTaskGraphWorkerLaunch(segment[commandOption + 1])
		}
		return false
	})) return true
	const operations = segments.map(workerLaunchType).filter(Boolean)
	if (operations.some((operation) => operation === "terminal" || operation === "fresh" || operation === "attachment")) return true
	if (operations.includes("workspace")) return false
	return false
}

function taskGraphWorkerArgv(command: string): string[] | undefined {
	if (/\$\(|`|[<>]\(/.test(command)) return undefined
	const segments = shellSegments(command)
	if (!segments || segments.length !== 1) return undefined
	const launches = segments.flatMap((segment) => ["terminal", "fresh"].includes(workerLaunchType(segment) ?? "") ? [segment] : [])
	if (!launches || launches.length !== 1 || workerLaunchType(launches[0]) !== "terminal") return undefined
	const scripts = launches[0].flatMap((argument, index) => argument === "--command" ? [launches[0][index + 1]] : argument.startsWith("--command=") ? [argument.slice(10)] : [])
	if (scripts.length !== 1 || !scripts[0] || /[#`$\r\n]/.test(scripts[0])) return undefined
	if (shellSegments(command)?.some((segment) => segment.some((argument) => ["pi-yolo", "agent-yolo"].includes(basename(argument).toLowerCase())))) return undefined
	const argv = shellWords(scripts[0])
	if (!argv || argv.some((argument) => shellControls.has(argument))) return undefined
	const executable = argv.findIndex((argument) => ["pi-yolo", "agent-yolo"].includes(basename(argument).toLowerCase()))
	if (executable < 0 || argv.slice(0, executable).some((argument) => !/^[A-Z_][A-Z0-9_]*=/.test(argument))) return undefined
	return argv
}

export function taskGraphWorkerModel(command: string): string | undefined {
	const argv = taskGraphWorkerArgv(command)
	if (!argv) return undefined
	const executable = argv.findIndex((argument) => ["pi-yolo", "agent-yolo"].includes(basename(argument).toLowerCase()))
	const remaining = argv.slice(executable + 1)
	const options = remaining.slice(0, remaining.indexOf("--") < 0 ? remaining.length : remaining.indexOf("--"))
	if (options.some((argument) => argument === "--provider" || argument.startsWith("--provider=") || argument === "-m" || argument.startsWith("-m="))) return undefined
	const models = options.flatMap((argument, index) => argument === "--model" ? [options[index + 1]] : argument.startsWith("--model=") ? [argument.slice(8)] : [])
	return models.length === 1 && models[0] ? models[0].toLowerCase() : undefined
}

export function taskGraphWorkerThinking(command: string): "medium" | "high" | undefined {
	const argv = taskGraphWorkerArgv(command)
	if (!argv) return undefined
	const executable = argv.findIndex((argument) => basename(argument) === "pi-yolo")
	if (executable < 0) return undefined
	const options = argv.slice(executable + 1)
	if (options.length !== 4 || !["--model", "--thinking"].includes(options[0]) || !["--model", "--thinking"].includes(options[2]) || options[0] === options[2]) return undefined
	const thinking = options[options.indexOf("--thinking") + 1]
	return thinking === "medium" || thinking === "high" ? thinking : undefined
}

export function taskGraphWorkerEnvironment(command: string): Record<string, string> | undefined {
	const argv = taskGraphWorkerArgv(command)
	if (!argv) return undefined
	const executable = argv.findIndex((argument) => ["pi-yolo", "agent-yolo"].includes(basename(argument)))
	const entries = argv.slice(0, executable).map((argument) => [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)])
	if (new Set(entries.map(([name]) => name)).size !== entries.length) return undefined
	return Object.fromEntries(entries)
}

export function taskGraphWorkerAccount(command: string): { profileHash: string; email: string; accountId: string; agentDir: string } | undefined {
	const argv = taskGraphWorkerArgv(command)
	if (!argv) return undefined
	const executable = argv.findIndex((argument) => ["pi-yolo", "agent-yolo"].includes(basename(argument).toLowerCase()))
	const entries = argv.slice(0, executable).map((argument) => {
		const separator = argument.indexOf("=")
		return [argument.slice(0, separator), argument.slice(separator + 1)]
	})
	if (new Set(entries.map(([name]) => name)).size !== entries.length) return undefined
	const values = Object.fromEntries(entries)
	if (!/^[a-f0-9]{64}$/.test(values.AGENT_TOOLKIT_CODEX_PROFILE_SHA256 ?? "") || !values.AGENT_TOOLKIT_CODEX_ACCOUNT_EMAIL_B64 || !values.AGENT_TOOLKIT_CODEX_ACCOUNT_ID || !values.AGENT_TOOLKIT_PI_AGENT_DIR) return undefined
	try {
		return { profileHash: values.AGENT_TOOLKIT_CODEX_PROFILE_SHA256, email: Buffer.from(values.AGENT_TOOLKIT_CODEX_ACCOUNT_EMAIL_B64, "base64url").toString("utf8"), accountId: values.AGENT_TOOLKIT_CODEX_ACCOUNT_ID, agentDir: values.AGENT_TOOLKIT_PI_AGENT_DIR }
	} catch {
		return undefined
	}
}

export function isTaskGraphRecoveryCommand(command: string): boolean {
	const value = command.trim()
	if (/[\n\r;&|`$<>()@>]/.test(value)) return false
	const words = shellWords(value)
	if (!words || !orcaExecutableNames().has(basename(words[0]).toLowerCase())) return false
	const operation = words.slice(1, 3).join(" ").toLowerCase()
	return words[1]?.toLowerCase() === "status"
		|| operation === "skills get" && words[3]?.toLowerCase() === "orchestration"
		|| words[1]?.toLowerCase() === "terminal" && ["list", "close"].includes(words[2]?.toLowerCase())
		|| words[1]?.toLowerCase() === "orchestration" && ["run-list", "run-show", "task-create", "task-list", "task-update", "dispatch-show", "check", "worker-list", "worker-show", "worker-read", "worker-release"].includes(words[2]?.toLowerCase())
}

function processStartToken(pid: number): string | undefined {
	try {
		if (process.platform === "linux") return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[21]
		return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined
	} catch {
		return undefined
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH"
	}
}

// Only the primary Run lock owns workspaces.json; plan-chain locks point to it.
export function taskGraphWorkspaceRecordForLock(root: string, entry: string): string | undefined {
	const directory = join(root, entry)
	const local = join(directory, "workspaces.json")
	if (existsSync(local)) return local
	const readOwner = (path: string) => {
		try {
			const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"))
			if (typeof owner.key !== "string" || !owner.key || typeof owner.runKey !== "string" || !owner.runKey || typeof owner.token !== "string" || !owner.token || !Number.isSafeInteger(owner.pid) || owner.pid < 0 || owner.processStart !== undefined && (typeof owner.processStart !== "string" || !owner.processStart) || basename(path) !== `${createHash("sha256").update(owner.key).digest("hex")}.lock`) throw new Error()
			return owner
		} catch { throw new Error(`Graph lock ${path} has missing or invalid ownership metadata; cleanup must wait.`) }
	}
	const owner = readOwner(directory)
	const primary = join(root, `${createHash("sha256").update(owner.runKey).digest("hex")}.lock`)
	const primaryOwner = primary === directory ? owner : existsSync(primary) ? readOwner(primary) : undefined
	const blocker = `Graph lock ${directory} (target ${owner.runKey}, Run ${owner.orcaRunId ?? primaryOwner?.orcaRunId ?? "unbound"})`
	if (primaryOwner && (primaryOwner.key !== owner.runKey || primaryOwner.runKey !== owner.runKey || owner.orcaRunId && primaryOwner.orcaRunId !== owner.orcaRunId || owner.planContract && primaryOwner.planContract !== owner.planContract)) throw new Error(`${blocker} disagrees with its primary lock ${primary}; cleanup must wait.`)
	const workspace = join(primary, "workspaces.json")
	if (primaryOwner && existsSync(workspace)) return workspace
	for (const record of [owner, primaryOwner].filter(Boolean)) {
		// A dead process is not proof that its approved workers/resources are gone.
		if (record.orcaRunId !== undefined || record.planContract !== undefined) throw new Error(`${blocker} has approved or bound work but no workspace record at ${workspace}; resume that graph before cleanup.`)
		if (record.pid === 0) {
			if (typeof record.abandonedAt !== "string" || !Number.isFinite(Date.parse(record.abandonedAt))) throw new Error(`${blocker} has no verified abandonment record; cleanup must wait.`)
		} else if (processIsAlive(record.pid)) {
			const started = processStartToken(record.pid)
			if (!record.processStart || !started || record.processStart === started) throw new Error(`${blocker} is still planning (PID ${record.pid}) without a workspace record; cleanup must wait.`)
		}
	}
	// Stale pre-approval locks cannot own workers. Preserve their records for recovery.
	return undefined
}

function taskGraphLockValuesForRun(root: string, runKey: string, field: string): string[] {
	if (!existsSync(root)) return []
	return [...new Set(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock")).flatMap((entry) => {
		try {
			const owner = JSON.parse(readFileSync(join(root, entry.name, "owner.json"), "utf8"))
			return owner?.runKey === runKey && typeof owner?.[field] === "string" ? [owner[field]] : []
		} catch {
			return []
		}
	}))]
}

export function taskGraphPlanContractsForLockRun(root: string, runKey: string): string[] {
	return taskGraphLockValuesForRun(root, runKey, "planContract")
}

export function taskGraphOrcaRunIdsForLockRun(root: string, runKey: string): string[] {
	return taskGraphLockValuesForRun(root, runKey, "orcaRunId")
}

function updateTaskGraphLock(lock: TaskGraphLock, fields: Record<string, string>): void {
	const ownerPath = join(lock.path, "owner.json")
	const owner = JSON.parse(readFileSync(ownerPath, "utf8"))
	if (owner?.token !== lock.token) throw new Error("Task graph lock ownership changed before Run binding.")
	const replacement = join(lock.path, `owner-${lock.token}.tmp`)
	writeFileSync(replacement, `${JSON.stringify({ ...owner, ...fields })}\n`, { mode: 0o600 })
	renameSync(replacement, ownerPath)
}

export function bindTaskGraphLockToOrcaRun(lock: TaskGraphLock, orcaRunId: string): void {
	updateTaskGraphLock(lock, { orcaRunId })
}

export function bindTaskGraphLockToPlanContract(lock: TaskGraphLock, planContract: string): void {
	updateTaskGraphLock(lock, { planContract })
}

export function taskGraphLockKeysForRun(root: string, runKey: string): string[] {
	if (!existsSync(root)) return []
	return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock")).flatMap((entry) => {
		try {
			const owner = JSON.parse(readFileSync(join(root, entry.name, "owner.json"), "utf8"))
			return owner?.runKey === runKey && typeof owner?.key === "string" ? [owner.key] : []
		} catch {
			return []
		}
	})
}

// ponytail: host-local PID lease; replace it when Orca exposes cross-host Run leases.
export function acquireTaskGraphLock(root: string, key: string, pid = process.pid, runKey = key): TaskGraphLock {
	mkdirSync(root, { recursive: true, mode: 0o700 })
	const path = join(root, `${createHash("sha256").update(key).digest("hex")}.lock`)
	for (;;) {
		const token = randomUUID()
		try {
			mkdirSync(path, { mode: 0o700 })
			try {
				writeFileSync(join(path, "owner.json"), `${JSON.stringify({ key, pid, processStart: processStartToken(pid), runKey, token, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
			} catch (error) {
				rmSync(path, { recursive: true, force: true })
				throw error
			}
			return { path, token }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		}
		let ownerPid = 0
		let ownerRunKey: string | undefined
		let ownerProcessStart: string | undefined
		let ownerSnapshot: string | undefined
		let ownerOrcaRunId: string | undefined
		let ownerPlanContract: string | undefined
		try {
			ownerSnapshot = readFileSync(join(path, "owner.json"), "utf8")
			const owner = JSON.parse(ownerSnapshot)
			ownerPid = Number(owner?.pid)
			ownerRunKey = typeof owner?.runKey === "string" ? owner.runKey : undefined
			ownerProcessStart = typeof owner?.processStart === "string" ? owner.processStart : undefined
			ownerOrcaRunId = typeof owner?.orcaRunId === "string" ? owner.orcaRunId : undefined
			ownerPlanContract = typeof owner?.planContract === "string" ? owner.planContract : undefined
		} catch {
			try {
				if (Date.now() - statSync(path).mtimeMs < 5_000) throw new Error("Another /graph run is starting for this objective.")
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
				throw error
			}
		}
		if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && processIsAlive(ownerPid) && (!ownerProcessStart || processStartToken(ownerPid) === ownerProcessStart)) {
			throw new Error(`Another /graph run is active for this objective (PID ${ownerPid}).`)
		}
		if (ownerRunKey && ownerRunKey !== runKey) {
			throw new Error(`This plan belongs to crashed graph target ${ownerRunKey}. Resume that target before starting another chain.`)
		}

		const reaper = join(path, "reaper.json")
		for (;;) {
			try {
				writeFileSync(reaper, `${JSON.stringify({ pid: process.pid, processStart: processStartToken(process.pid), token })}\n`, { flag: "wx", mode: 0o600 })
				break
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") break
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
				let reaperPid = 0
				let reaperProcessStart: string | undefined
				try {
					const reaperOwner = JSON.parse(readFileSync(reaper, "utf8"))
					reaperPid = Number(reaperOwner?.pid)
					reaperProcessStart = typeof reaperOwner?.processStart === "string" ? reaperOwner.processStart : undefined
				} catch {}
				if (Number.isSafeInteger(reaperPid) && reaperPid > 0 && processIsAlive(reaperPid) && (!reaperProcessStart || processStartToken(reaperPid) === reaperProcessStart)) {
					throw new Error("Another /graph run is recovering this objective.")
				}
				rmSync(reaper, { force: true })
			}
		}
		if (!existsSync(reaper)) continue
		const ownerPath = join(path, "owner.json")
		try {
			if (ownerSnapshot === undefined ? existsSync(ownerPath) : readFileSync(ownerPath, "utf8") !== ownerSnapshot) continue
			const replacement = join(path, `owner-${token}.tmp`)
			try {
				writeFileSync(replacement, `${JSON.stringify({ key, pid, processStart: processStartToken(pid), runKey, ...(ownerOrcaRunId ? { orcaRunId: ownerOrcaRunId } : {}), ...(ownerPlanContract ? { planContract: ownerPlanContract } : {}), token, startedAt: new Date().toISOString() })}\n`, { flag: "wx", mode: 0o600 })
				renameSync(replacement, ownerPath)
				return { path, token }
			} finally {
				rmSync(replacement, { force: true })
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		} finally {
			rmSync(reaper, { force: true })
		}
	}
}

export function abandonTaskGraphLock(lock: TaskGraphLock | undefined): void {
	if (!lock) return
	try {
		const ownerPath = join(lock.path, "owner.json")
		const current = JSON.parse(readFileSync(ownerPath, "utf8"))
		if (current?.token !== lock.token) return
		const replacement = join(lock.path, `owner-${lock.token}.tmp`)
		try {
			writeFileSync(replacement, `${JSON.stringify({ ...current, pid: 0, abandonedAt: new Date().toISOString() })}\n`, { flag: "wx", mode: 0o600 })
			renameSync(replacement, ownerPath)
		} finally {
			rmSync(replacement, { force: true })
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error
	}
}

export function releaseTaskGraphLock(lock: TaskGraphLock | undefined): void {
	if (!lock) return
	try {
		const current = JSON.parse(readFileSync(join(lock.path, "owner.json"), "utf8"))
		if (current?.token === lock.token) rmSync(lock.path, { recursive: true })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error
	}
}

export interface TaskGraphTask {
	id: string
	goal: string
	depends_on: string[]
	repository?: string
	owns: string[]
	specialty: string
	thinking: "medium" | "high"
	done_when: string[]
	validation: string
	setup?: string
}

export interface TaskGraphPlan {
	objective: string
	mode: "plan-only" | "execute"
	tasks: TaskGraphTask[]
	inputs?: Array<{ repository?: string; paths: string[] }>
	current_checkout?: boolean
	cleanup_workers?: boolean
}

export function taskGraphOwnershipRoot(owner: string): string {
	let path = posix.normalize(owner.trim().replaceAll("\\", "/"))
	const glob = path.search(/[*?[\]{}]/)
	if (glob >= 0) {
		const slash = path.slice(0, glob).lastIndexOf("/")
		path = slash >= 0 ? path.slice(0, slash) : "."
	}
	return path.replace(/\/$/, "") || "."
}

export function normalizeTaskGraphOwnership(plan: TaskGraphPlan, repositoryRoot: string): TaskGraphPlan {
	return {
		...plan,
		tasks: plan.tasks.map((task) => {
			const requestedRoot = resolve(repositoryRoot, task.repository?.trim() || ".")
			const taskRoot = existsSync(requestedRoot) ? realpathSync(requestedRoot) : requestedRoot
			return {
				...task,
				repository: relative(repositoryRoot, taskRoot).split(sep).join("/") || ".",
				owns: task.owns.map((owner) => {
					let raw = owner.trim()
					if (!raw) return raw
					if (isAbsolute(raw)) {
						const local = relative(taskRoot, raw)
						if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return raw
						raw = local.split(sep).join("/")
					}
					return taskGraphOwnershipRoot(raw)
				}),
			}
		}),
	}
}

export function validateTaskGraphRepositories(plan: TaskGraphPlan, repositoryRoot: string): void {
	for (const task of plan.tasks) {
		const repository = resolve(repositoryRoot, task.repository ?? ".")
		if (!existsSync(join(repository, ".git"))) throw new Error(`Task ${task.id} repository is not a Git repository root: ${task.repository ?? "."}`)
	}
}

export function validateTaskGraph(plan: TaskGraphPlan, planChain = false): void {
	const minimum = planChain ? 1 : 2
	const maximum = planChain ? 12 : 6
	if (plan.tasks.length < minimum || plan.tasks.length > maximum) {
		throw new Error(planChain ? "A plan chain must contain one to twelve plans." : "A task graph must contain two to six tasks.")
	}

	const ids = new Set<string>()
	const owners: Array<{ taskId: string; path: string; display: string }> = []
	for (const task of plan.tasks) {
		if (!task.id.trim() || ids.has(task.id)) throw new Error(`Task IDs must be non-empty and unique: ${task.id || "(empty)"}`)
		if (!task.goal.trim() || !task.specialty.trim() || !task.validation.trim() || task.done_when.length === 0 || task.done_when.some((criterion) => !criterion.trim())) {
			throw new Error(`Task ${task.id} needs a goal, specialty, non-empty completion criteria, and validation.`)
		}
		if (task.setup !== undefined && (!task.setup.trim() || !task.owns.length)) throw new Error(`Task ${task.id} setup requires a non-empty command and writing ownership.`)
		ids.add(task.id)
		const repository = posix.normalize((task.repository ?? ".").trim().replaceAll("\\", "/"))
		if (!repository || posix.isAbsolute(repository)) throw new Error(`Task ${task.id} repository must be relative to the current repository: ${task.repository || "(empty)"}`)
		for (const owner of task.owns) {
			const raw = owner.trim()
			if (!raw) throw new Error("Write ownership must be non-empty and disjoint: (empty)")
			let normalized = posix.normalize(raw.replaceAll("\\", "/"))
			if (posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
				throw new Error(`Write ownership must be repository-relative: ${owner}`)
			}
			normalized = taskGraphOwnershipRoot(normalized)
			owners.push({
				taskId: task.id,
				path: posix.resolve("/workspace/current", repository, normalized),
				display: `${repository}/${owner}`,
			})
		}
	}

	for (const task of plan.tasks) {
		for (const dependency of task.depends_on) {
			if (!ids.has(dependency)) throw new Error(`Task ${task.id} has unknown dependency ${dependency}.`)
			if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself.`)
		}
	}
	if (planChain) {
		const positions = new Map(plan.tasks.map((task, index) => [task.id, index]))
		for (const task of plan.tasks) {
			if (task.depends_on.some((dependency) => positions.get(dependency)! > positions.get(task.id)!)) {
				throw new Error(`Plan-chain tasks must list every dependency before its dependent task: ${task.id}`)
			}
		}
	}

	const byId = new Map(plan.tasks.map((task) => [task.id, task]))
	const depth = (id: string, path = new Set<string>()): number => {
		if (path.has(id)) throw new Error(`The task graph contains a cycle at ${id}.`)
		const nextPath = new Set(path).add(id)
		return 1 + Math.max(0, ...byId.get(id)!.depends_on.map((dependency) => depth(dependency, nextPath)))
	}
	const maxDepth = planChain ? 12 : 4
	if (Math.max(...plan.tasks.map((task) => depth(task.id))) > maxDepth) {
		throw new Error(`Task dependency chains must be at most ${maxDepth} tasks deep.`)
	}

	const dependsOn = (taskId: string, dependencyId: string): boolean => byId.get(taskId)!.depends_on.some(
		(dependency) => dependency === dependencyId || dependsOn(dependency, dependencyId),
	)
	for (let index = 0; index < owners.length; index++) {
		for (let otherIndex = index + 1; otherIndex < owners.length; otherIndex++) {
			const owner = owners[index]
			const other = owners[otherIndex]
			if (owner.taskId === other.taskId) continue
			const overlaps = owner.path === other.path || owner.path.startsWith(`${other.path}/`) || other.path.startsWith(`${owner.path}/`)
			const sequential = dependsOn(owner.taskId, other.taskId) || dependsOn(other.taskId, owner.taskId)
			if (overlaps && !sequential) throw new Error(`Write ownership must be non-empty and disjoint across concurrent tasks: ${owner.display}`)
		}
	}
}

export function formatTaskGraph(plan: TaskGraphPlan): string {
	return [
		`${plan.objective}\nmode: ${plan.mode}`,
		...plan.tasks.map((task) => `${task.id} [${task.specialty}, ${task.thinking}]${task.depends_on.length ? ` ← ${task.depends_on.join(", ")}` : ""}\n  ${task.goal}\n  repo: ${task.repository ?? "."}\n  owns: ${task.owns.join(", ") || "read-only"}\n  done: ${task.done_when.join("; ")}\n  setup: ${task.setup || "not required"}\n  validate: ${task.validation}`),
	].join("\n\n")
}

interface TaskGraphReviewUi {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>
}

export type TaskGraphReview =
	| { status: "approved" }
	| { status: "revise"; feedback: string }
	| { status: "cancelled" }

export async function reviewTaskGraph(plan: TaskGraphPlan, ui: TaskGraphReviewUi, signal?: AbortSignal, planChain = false, workspaceSummary = ""): Promise<TaskGraphReview> {
	validateTaskGraph(plan, planChain)
	const approveLabel = plan.mode === "execute" ? "Approve and execute" : "Approve planning work"
	const options = signal ? { signal } : undefined
	const title = planChain ? "Review plan chain (top to bottom execution order)" : "Review task graph"
	const choice = await ui.select(`${title}\n\n${formatTaskGraph(plan)}${workspaceSummary ? `\n\n${workspaceSummary}` : ""}`,  [approveLabel, "Revise the plan", "Cancel"], options)
	if (choice === approveLabel) return { status: "approved" }
	if (choice === "Revise the plan") {
		const feedback = (await ui.input("Plan revisions", "What must change?", options))?.trim()
		if (feedback) return { status: "revise", feedback }
	}
	return { status: "cancelled" }
}

export function planMetadata(markdown: string, field: string): string | undefined {
	const start = markdown.search(/^##\s+Metadata\s*$/im)
	if (start < 0) return undefined
	const remainder = markdown.slice(start).replace(/^##\s+Metadata\s*$/im, "")
	const end = remainder.search(/^##\s+/m)
	const metadata = end < 0 ? remainder : remainder.slice(0, end)
	return metadata.match(new RegExp(`^\\s*-\\s*${field}:\\s*([^\\n]+)`, "im"))?.[1].trim()
}

export function planId(markdown: string): string | undefined {
	return planMetadata(markdown, "Plan-ID")
}

export function replacePlanStatus(markdown: string, status: string): string {
	const header = /^##\s+Metadata\s*$/im.exec(markdown)
	if (!header || header.index == null) throw new Error("Plan has no Metadata section.")
	const start = header.index + header[0].length
	const next = markdown.slice(start).search(/^##\s+/m)
	const end = next < 0 ? markdown.length : start + next
	const prefix = markdown.slice(0, header.index).replace(/(^Status:\s*)[^\n]+/im, `$1${status}`)
	const metadata = markdown.slice(start, end)
	const updated = metadata.replace(/(^\s*-\s*Status:\s*)[^\n]+/im, `$1${status}`)
	if (updated === metadata) throw new Error("Plan Metadata has no Status field.")
	return prefix + markdown.slice(header.index, start) + updated + markdown.slice(end)
}

export function planStatus(markdown: string): string | undefined {
	return planMetadata(markdown, "Status")?.toLowerCase()
}

export function planDependencies(markdown: string): string[] {
	const value = planMetadata(markdown, "Dependencies")
	if (!value) throw new Error("Plan metadata must declare Dependencies or none.")
	if (value.toLowerCase() === "none") return []
	return value.split(",").map((dependency) => dependency.trim()).filter(Boolean)
}

export function planPriority(markdown: string): number | undefined {
	const priority = planMetadata(markdown, "Priority")?.toLowerCase()
	return priority && /^p[0-3]$/.test(priority) ? Number(priority[1]) : undefined
}

export function resolvePlanLifecyclePath(cwd: string, objective: string): string | undefined {
	const requested = resolve(cwd, objective)
	if (extname(requested) !== ".md") return undefined
	const locations = [
		`${sep}docs${sep}future${sep}`,
		`${sep}docs${sep}exec-plans${sep}active${sep}`,
		`${sep}docs${sep}exec-plans${sep}completed${sep}`,
	]
	const location = locations.findIndex((marker) => requested.includes(marker))
	if (location < 0) return existsSync(requested) ? realpathSync(requested) : undefined
	const marker = locations[location]
	const index = requested.lastIndexOf(marker)
	const repository = requested.slice(0, index)
	const filename = requested.slice(index + marker.length)
	const paths = locations.map((candidate) => `${repository}${candidate}${filename}`)
	if (existsSync(requested)) {
		if (paths.slice(location + 1).some((path) => existsSync(path))) throw new Error(`A later lifecycle path already exists for ${objective}.`)
		return realpathSync(requested)
	}
	const fallback = location === 0 ? [paths[1], paths[2]] : location === 1 ? [paths[2], paths[0]] : [paths[1], paths[0]]
	const matches = fallback.filter((path) => existsSync(path))
	if (matches.length > 1) throw new Error(`More than one lifecycle fallback exists for ${objective}.`)
	return matches[0] ? realpathSync(matches[0]) : undefined
}

export function planRequiresPlanOnly(markdown: string): boolean {
	const status = planStatus(markdown)
	return !status || !["queued", "in-progress", "in-review", "validation", "budget-exhausted"].includes(status)
}

export function planSecurityApproved(markdown: string): boolean {
	return ["not-required", "approved"].includes(planMetadata(markdown, "Security-Approval")?.toLowerCase() ?? "")
}

export function planningDocumentNeedsRecovery(path: string, markdown: string): boolean {
	const local = path.replaceAll("\\", "/")
	return /^docs\/exec-plans\/completed\/.+\.md$/.test(local)
		|| (/^docs\/exec-plans\/active\/.+\.md$/.test(local) && planStatus(markdown) === "completed")
}

export function planningDocumentIsExecutable(path: string, markdown: string): boolean {
	if (!planSecurityApproved(markdown)) return false
	const local = path.replaceAll("\\", "/")
	if (/^docs\/future\/.+\.md$/.test(local)) return planStatus(markdown) === "ready-for-promotion"
	if (/^docs\/exec-plans\/active\/.+\.md$/.test(local)) return planStatus(markdown) === "ready-for-promotion" || !planRequiresPlanOnly(markdown)
	return false
}

export function planningDocumentRequiresPlanOnly(path: string, markdown: string): boolean {
	const local = path.replaceAll("\\", "/")
	if (/^docs\/future\/.+\.md$/.test(local)) return !planningDocumentIsExecutable(local, markdown)
	if (/^docs\/exec-plans\/active\/.+\.md$/.test(local)) return planRequiresPlanOnly(markdown)
	return /^docs\/exec-plans\/.*\.md$/.test(local)
}

export function taskGraphPrompt(
	objective: string,
	planChain = false,
	runKey = objective,
	workerModel = "provider/model",
	recoveryOnly = false,
	repositoryRoots: string[] = [],
	workerAccount?: { profileHash: string; email: string; accountId: string; agentDir: string },
): string {
	const runObjective = `${planChain ? "Pi plan chain" : "Pi task graph"}: ${runKey}`
	const terminalTitle = "<returned-launchTitle>"
	const quotaPolicy = `Quota checks are automatic: the extension fetches usage for the pinned Codex account in the worker-launch hook. Do not ask the user to confirm remaining quota or whether reserves are met. Do not request manual quota checks, screenshots, or per-worker permission to continue. Submit the approved worker launch normally; the hook enforces the gate. Reserve ${TASK_GRAPH_WEEKLY_QUOTA_RESERVE}% of the long window and ${TASK_GRAPH_SHORT_QUOTA_RESERVE}% of the short window. Long-window data is required. The hook checks the short-window reserve only when Codex reports that window. If the gate passes, continue automatically without another approval. If quota data is unavailable or the gate blocks a launch, do not treat it as a task failure or ask the user to attest quota. Mark the active plan budget-exhausted, preserve the Run and task state, report the blocker once, and stop without repeated questions or launch retries. The same /graph command resumes after quota resets. Non-Codex workers do not require this Codex quota check.`
	const workerCommand = `${workerAccount ? `AGENT_TOOLKIT_CODEX_PROFILE_SHA256=${workerAccount.profileHash} AGENT_TOOLKIT_CODEX_ACCOUNT_EMAIL_B64=${Buffer.from(workerAccount.email).toString("base64url")} AGENT_TOOLKIT_CODEX_ACCOUNT_ID=${JSON.stringify(workerAccount.accountId)} AGENT_TOOLKIT_PI_AGENT_DIR=${JSON.stringify(workerAccount.agentDir)} ` : ""}pi-yolo --model ${workerModel} --thinking <task-thinking>`
	const workerAccountNote = workerAccount ? `Graph workers are pinned to the selected Codex account ${workerAccount.email}. ` : ""
	const isolation = `Workspace contract: inspect with read/search tools before approval. In propose_task_graph, list exact dirty input files under inputs (repository plus paths); include selected dirty plans and necessary supporting documents, not unrelated changes. Approval authorizes isolated run/task worktrees, these input captures, scoped local commits and integration within the Run. Source checkouts and indexes remain untouched. current_checkout is an explicit, separately confirmed clean-checkout exception, never a fallback. For new graphs, propose cleanup_workers: true so the approval screen offers verified temporary-worker cleanup; use false if the user wants retention. Never add cleanup authority silently when resuming an existing contract. The approval screen explicitly authorizes removal of verified, integrated worker worktrees after local closeout, including ignored setup artifacts. Never remove sources, delivery worktrees, dirty/unintegrated workers or worktrees with terminals.\nAfter binding, call prepare_task_graph_workspace without task_id before any preparation documents, plan moves, setup or other writes. Use the returned absolute paths for file tools. For shell checks and setup, use bash with repository set to the exact returned workspace path; Pi's normal bash permission gates remain active. Use checkpoint_task_graph with exact paths for local commits, never shell git add/commit. Do not create worktrees manually. Capture uses immutable Git objects and a private temporary index, without commit hooks. Ordinary checkpoints still run required hooks and reviews. Declare required setup in each task's setup field and run that exact command in the prepared worker workspace before launch. Ignored setup outputs do not transfer from coordinator to worker.\nBefore each worker, create its Orca task, then call prepare_task_graph_workspace with the task_id and an explicit owns subset for internal plan tasks. Launch in the exact returned worktree selector and prepend both returned AGENT_TOOLKIT_GRAPH_WORKSPACES and AGENT_TOOLKIT_GRAPH_TASK environment assignments to the pinned worker command. Use its exact returned launchTitle. Launch intent is durable; after an uncertain result reconcile the existing terminal, never launch another. The returned repositories map and the AGENT_TOOLKIT_GRAPH_REPOSITORIES JSON environment expose each approved repository's execution path and HEAD. Cross-repository builds must use these explicit paths, not assume ../sibling resolves to isolation. Inspect local dependency configuration before approval and include required setup mappings in the task. Declare cross-repository dependencies in the DAG. A dependent worker pins its prerequisite repositories until integration; coordinator writes and other integrations into those repositories must wait. Workers may commit only scoped changes after required checks and risk-gated reviews; never push or merge back. After successful settlement call integrate_task_graph_worker before preparing dependents, so they receive integrated prerequisite commits. Reuse verified workspaces on recovery; never silently recopy inputs or migrate legacy live workers.\nReview the complete delivery diff, including captured inputs, against the approved base and intended target. Local completion does not authorize publishing, PR creation, merge-back or source reconciliation. Worker worktree deletion is allowed only with the explicit cleanup_workers approval and checked cleanup operation. Report one coherent delivery unit per executable plan and affected repository, without assuming a hosting provider or branch name. Keep one delivery worktree per writing repository. After finish_task_graph releases graph locks and reports pending cleanup, call cleanup_completed_task_graph as a separate tool invocation. This preserves Pi's independent permission gate for deletion. Report retained worktrees and their blockers; never force removal or bypass Pi restrictions. cleanup_completed_task_graph can retry cleanup of a completed Run or request one explicit cleanup approval for an older Run. Do not combine or remove coordinator worktrees from different Runs automatically.`
	if (planChain) return `${isolation}\n\nCoordinate this objective as an unattended plan chain:

${objective}

${recoveryOnly ? "The selected plan has an interrupted completed lifecycle. Propose its execute-mode recovery task so the approved coordinator can reconcile only an existing unfinished Orca Run." : ""}

Registered Orca repository roots: ${JSON.stringify(repositoryRoots)}. Resolve cross-repository Plan-IDs only within this inventory.

First inspect the repository, its planning rules, the named final plan, and the real execution paths with read and search tools. The mutation tools stay blocked until the user approves the complete plan chain.

Resolve the selected plan's full unfinished dependency chain by Plan-ID. Omit completed dependencies. Resolve dependencies across the current repository and local sibling Git repositories available to Orca. Require exactly one matching plan for each Plan-ID and stop on missing or duplicate matches. Include ready future plans and executable active plans. If a required plan is draft, blocked, ambiguous, or waiting for an external approval, report the blockers and stop. Do not propose a plan-only graph and do not invent approval for an unresolved gate.

Call propose_task_graph in execute mode with one to twelve plan tasks. Each plan-chain task represents one durable plan, not one worker. Use that plan's exact Plan-ID as the task id. Preserve the plan dependencies, repository, combined write targets, acceptance criteria, user-requested thinking level (medium by default), and required validation. Dependent plan tasks may own the same paths because they run sequentially. Independent tasks must have disjoint ownership. Put tasks in deterministic topological order. Among ready plans, order Priority p0 before p1, p2, and p3, then order by Plan-ID.

The review is the user's one approval for the full plan chain. After approval, do not ask for routine confirmation between plans. Run \`orca skills get orchestration\` and follow that version-matched guide. Confirm Orca is ready. Use the exact Run objective ${JSON.stringify(runObjective)}. Before creating a Run, list existing Runs with that exact objective. If one unfinished Run exists, bind it and resume its existing tasks and dispatches. If more than one unfinished Run exists, stop and report the duplicate Runs. ${recoveryOnly ? "This target is already completed locally. Recovery may bind its completed or unfinished existing Run and reconcile it, but it must not create a Run, directly edit files, or dispatch workers. After reconciliation, call recover_plan_lifecycle for the exact missing status or move step." : "Create a new Run only when no unfinished matching Run exists."} Call bind_task_graph_run with the selected Run ID before creating or updating tasks.

Reconcile the approved plan chain with the bound Run before implementation. Start each top-level plan-task spec with \`[plan:<Plan-ID>]\`. Create only missing non-dispatched plan tasks and preserve existing task IDs, dependencies, results, and dispatches. These plan tasks are the durable execution ledger. If a dispatch is still live, continue supervising it instead of starting a duplicate worker. If a dispatch settled before the crash, process its result before scheduling more work.

Use Orca's ready-task state to find eligible plans. Select the first unfinished ready plan in the approved order. Immediately before that plan starts, re-read its status, dependencies, approval gates, and repository rules. If a lifecycle move was interrupted, reconcile its existing Run and finish only the missing status or move step without implementation workers. Promote a ready future plan into \`docs/exec-plans/active/\` only when its dependencies are complete, then change its status to \`queued\` and \`in-progress\`. Never promote later plans early.

For each active plan, derive the smallest internal DAG of one to six worker tasks from its must-land checklist and targets. Create these internal tasks as children of the plan task directly in Orca without another propose_task_graph approval. ${quotaPolicy} Start every ready independent task before waiting. Every task gets a fresh worker terminal in its verified isolated task worktree; never reuse a completed worker. Resolve and use the repository's exact Orca selector. ${workerAccountNote}Start the quoted \`${workerCommand}\` command through low-level Orca terminal creation with \`--json --title ${terminalTitle}\`. After readiness, attach the task with low-level \`dispatch --inject\`. After an accepted settlement, close that exact coordinator-created terminal. Do not use \`worker-start\`, because it cannot prove the required wrapper before launch. Use medium thinking for every worker unless the user explicitly requests high. Task risk or complexity does not authorize high thinking. Specialize each worker through its task brief.

Supervise every dispatch until it settles. Release each completed worker before continuing. Workers may make scoped local commits after required checks and risk-gated review; they must not push. If a worker fails or escalates, make one replacement attempt with a fresh worker at the same thinking level. Do not increase thinking unless the user explicitly requests high. Stop the plan chain after any unresolved failure, blocker, required external decision, or failed validation. Leave every affected plan in a truthful status.

After each plan's workers finish, integrate their work and complete that plan's full closeout. Run all required validation, reviews, approval gates, evidence updates, and plan-closeout checks. Move the plan to completed only after every requirement passes. Mark its plan task completed with concise evidence. Then read the ready-task state again and continue automatically.

The plan-chain approval authorizes required local commits and checked integration inside the Run after the repository's risk-gated checks. Do not bypass trusted push, pull-request, merge, release, credential, or permission boundaries. If a plan reaches one of these boundaries without prior authorization, stop with the completed local work and report the required action.

Call finish_task_graph with the bound Run ID and concise evidence only after every dispatch is settled and released and every plan has passed closeout. Do not call it after a blocker, failure, or incomplete recovery.`

	return `${isolation}\n\nCoordinate this objective with a task graph:

${objective}

First inspect the repository and the real execution path with read and search tools. Mutation tools stay blocked until an executable graph is approved. Do not move a ready future plan before approval. After execute approval and workspace preparation, move it from \`docs/future/\` to \`docs/exec-plans/active/\`, change only that plan's \`Status\` from \`ready-for-promotion\` to \`queued\`, and start the workers. If the objective names a future or active plan file, read that file and its repository planning rules first. Treat its status, dependencies, must-land checklist, approval gates, and write targets as authoritative.

A draft or blocked plan permits planning and blocker-resolution work only. Set graph mode to plan-only and dispatch only approved documentation workers in isolation. Do not dispatch implementation workers. Promote a ready future after execute approval and before dispatch. Set mode to execute only for an active executable slice whose dependencies and approval gates are satisfied.

Keep one future file per executable slice. If one future contains independent outcomes, propose separate future files linked by Dependencies. Use graph tasks only for parallel work inside one executable slice; do not use them to hide multiple durable slices in one plan.

Then decide whether parallel workers provide a clear benefit. If the work is small or tightly coupled, explain that decision and stop. The user can run that work directly without graph overhead.

If a graph helps, call propose_task_graph with plan-only or execute mode and a DAG of two to six bounded tasks. A graph may span local Git repositories. For each task outside the current repository, set its repository to that Git root relative to the current repository (for example, \`../tracn-api\`), and keep its owned paths relative to that repository. Give each task an id, goal, dependencies, repository, owned files or areas, specialty, thinking level, completion criteria, and validation. Use medium thinking for every worker unless the user explicitly requests high. Task risk or complexity does not authorize high thinking. Keep dependency chains at most four tasks deep. Include integration and focused validation work when necessary.

The tool validates the graph and asks the user to approve, revise, or cancel it. If the user requests revisions, update the graph and call propose_task_graph again. Do not dispatch implementation workers until an execute-mode graph is approved. Planning-work approval permits Markdown documentation under docs/, excluding docs/exec-plans/. It does not permit lifecycle promotion.

After execute or planning-work approval, run \`orca skills get orchestration\` and follow that version-matched guide. Confirm Orca is ready. Use the exact Run objective ${JSON.stringify(runObjective)}. List Runs with that exact objective before creation. Bind and reconcile one unfinished match, stop on multiple unfinished matches, and create a Run only when none exists. Call bind_task_graph_run with the selected Run ID before creating or updating tasks. Preserve matching task IDs and settled or live dispatches during recovery. For active-plan execution, the coordinator owns plan lifecycle updates; set the plan's truthful execution status before dispatch instead of delegating that state to a worker. Create missing tasks with their dependencies, start every top-level task spec with its \`[graph-task:<task-id>]\` marker, and start every ready independent worker before waiting. ${workerAccountNote}Every graph worker must run \`${workerCommand}\`, not plain \`pi\`. Start this quoted command through low-level Orca terminal creation with \`--json --title ${terminalTitle}\`. After readiness, attach the task with low-level \`dispatch --inject\`. After an accepted settlement, close that exact coordinator-created terminal. Do not use \`worker-start\` or Orca's generic \`--agent pi\` launcher, because neither proves the required wrapper before launch. Use Orca for task state, dispatch, worker lifecycle, and messages. Do not recreate those features in Pi or in project files.

${quotaPolicy}

Launch each worker with \`${workerCommand}\` in the task's repository. Resolve that repository's exact Orca selector and pass it when the worker is outside the current repository. Specialize workers through their task briefs and tools instead of permanent role classes. Keep work in each repository's verified isolated workspaces. The source checkout is not an execution workspace unless the user explicitly approved that exception. Supervise until every dispatch settles. Release completed workers, integrate the results, and run the smallest focused checks. If a worker fails or requests escalation, keep the same thinking level for its one replacement attempt. Do not increase thinking unless the user explicitly requests high. Replan only a failed or blocked task, and allow at most one replacement attempt unless the user approves more.

For active-plan execution, focused task checks do not replace plan closeout. After integration, re-read the active plan and repository planning rules. Complete every must-land item, satisfy review and approval gates, run the exact validation lanes and required full verification, record evidence, update Done-Evidence and status, move the plan from active to completed, update any required evidence index, and run the repository's plan-closeout check. Do not report completion unless all required checks pass and the plan is closed. If closeout cannot finish, leave the plan in a truthful active status and report the blocker. Never close or edit dependent future plans; they remain future work until separately promoted.

Call finish_task_graph with the bound Run ID and concise evidence only after every dispatch is settled and released and all required validation and closeout pass. Do not call it after a blocker, failure, or incomplete recovery.`
}
