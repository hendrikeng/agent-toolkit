import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import {
	assertNoLikelySecrets,
	missingDecisionValues,
	parseProjectArgs,
	PROJECT_USAGE,
	projectPlanningPrompt,
	questionForPlaceholder,
	questionnairePlaceholders,
	validateDecisionValues,
	type BootstrapQuestionnaire,
	type ProjectMode,
} from "./project-blueprint-core.ts"

const decisionSchema = Type.Object({
	values: Type.Record(Type.String(), Type.String(), {
		description: "Inferred template placeholder values. Omit values that need user input.",
	}),
	evidence: Type.Optional(Type.Record(Type.String(), Type.String(), {
		description: "Short repository-relative evidence path or reason for each inferred value.",
	})),
}, { additionalProperties: false })

interface ActiveProject {
	mode: ProjectMode
	target: string
	blueprintRoot: string
	questionnaire: BootstrapQuestionnaire
}

function isWithin(parent: string, child: string): boolean {
	const local = relative(parent, child)
	return local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}

function expandTarget(value: string, cwd: string): string {
	if (value === "~") return homedir()
	if (value.startsWith(`~${sep}`)) return join(homedir(), value.slice(2))
	return resolve(cwd, value)
}

function safeTarget(value: string, mode: ProjectMode, cwd: string): string {
	const home = realpathSync(homedir())
	let target = expandTarget(value, cwd)
	if (existsSync(target)) target = realpathSync(target)
	else if (existsSync(dirname(target))) target = join(realpathSync(dirname(target)), target.slice(dirname(target).length + 1))
	const configuredRoots = process.env.AGENT_PROJECT_ALLOWED_ROOTS
		?.split(delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => realpathSync(expandTarget(entry, cwd)))
	const allowedRoots = configuredRoots?.length ? configuredRoots : [home]
	if (!allowedRoots.some((root) => isWithin(root, target))) {
		throw new Error("The project target must be below an allowed root, not the root itself.")
	}
	const homeLocal = relative(home, target).split(sep)
	if ([".ssh", ".gnupg", ".pi", ".codex", ".config", ".local", "Library"].includes(homeLocal[0])) {
		throw new Error("The project target is inside a protected user directory.")
	}
	if (mode !== "new" && !existsSync(target)) throw new Error(`Target does not exist: ${target}`)
	return target
}

function findBlueprintRoot(): string {
	const extensionDir = dirname(realpathSync(fileURLToPath(import.meta.url)))
	const candidates = [
		process.env.AGENT_PROJECT_BLUEPRINT_DIR,
		resolve(extensionDir, "../../../vendor/agent-project-blueprint"),
	].filter((value): value is string => Boolean(value))
	for (const candidate of candidates) {
		const root = resolve(candidate)
		if (
			existsSync(join(root, "distribution", "bootstrap-questionnaire.json")) &&
			existsSync(join(root, "scripts", "harness-sync.mjs")) &&
			existsSync(join(root, "scripts", "bootstrap-configure.mjs"))
		) {
			return realpathSync(root)
		}
	}
	throw new Error("Agent Project Blueprint was not found. Run git submodule update --init --recursive in agent-toolkit, or set AGENT_PROJECT_BLUEPRINT_DIR to another reviewed checkout.")
}

async function assertModeCompatibility(mode: ProjectMode, target: string): Promise<void> {
	if (mode !== "audit" && Number(process.versions.node.split(".")[0]) !== 24) {
		throw new Error(`Automatic blueprint mutation requires Node.js 24; current runtime is ${process.versions.node}.`)
	}
	if (mode === "new") {
		if (!existsSync(target)) {
			if (!existsSync(dirname(target))) throw new Error("The parent directory for a new project must already exist.")
			return
		}
		const entries = (await readdir(target)).filter((entry) => entry !== ".git")
		if (entries.length) throw new Error("New mode requires an empty target directory. Use adopt for an existing project.")
		return
	}
	if (!(await stat(target)).isDirectory()) throw new Error("The project target must be a directory.")
	if (mode === "audit") return
	const hasManifest = existsSync(join(target, "docs", "ops", "automation", "harness-manifest.json"))
	if (mode === "update") {
		if (!hasManifest) throw new Error("Update requires an existing blueprint harness manifest. Use adopt for first-time setup.")
		return // The updater validates ownership, paths, and local modifications before writing.
	}
	if (hasManifest) {
		throw new Error("This project already has a blueprint harness manifest. Use /project update or /project audit.")
	}
	const packagePath = join(target, "package.json")
	if (!existsSync(packagePath)) {
		throw new Error("Automatic adoption currently requires an existing Node.js package.json. Use audit mode for other stacks.")
	}
	if ((await lstat(packagePath)).isSymbolicLink()) throw new Error("Automatic adoption refuses a symbolic-link package.json.")
	const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]
	if (!lockfiles.some((name) => existsSync(join(target, name)))) {
		throw new Error("Automatic adoption requires an npm, pnpm, or yarn lockfile. Use audit mode until the package manager is explicit.")
	}
}

async function assertNoTargetSymlink(target: string, filePath: string): Promise<void> {
	const local = relative(target, filePath)
	if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error("Target write path escapes the project.")
	let current = target
	for (const segment of local.split(sep)) {
		current = join(current, segment)
		try {
			if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symbolic-link target path: ${local}`)
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return
			throw error
		}
	}
}

async function updateDecisionsPath(target: string): Promise<string> {
	const manifestPath = join(target, "docs", "ops", "automation", "harness-manifest.json")
	await assertNoTargetSymlink(target, manifestPath)
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The harness manifest must contain an object.")
	if (manifest.decisionsPath !== undefined && (typeof manifest.decisionsPath !== "string" || !manifest.decisionsPath.trim())) {
		throw new Error("The harness manifest decisionsPath must be a non-empty string.")
	}
	const path = resolve(target, manifest.decisionsPath ?? "docs/ops/automation/bootstrap-decisions.json")
	await assertNoTargetSymlink(target, path)
	if (!(await lstat(path)).isFile()) throw new Error("The harness decision packet must be a regular file.")
	const canonical = realpathSync(path)
	if (!isWithin(target, canonical)) throw new Error("The harness decision packet must stay inside the project.")
	return relative(target, canonical)
}

async function assertApprovedConfiguration(active: ActiveProject, values: Record<string, string>, comparison: Record<string, unknown>): Promise<void> {
	if (active.mode === "audit") return
	const packetPath = join(active.target, "docs", "ops", "automation", "bootstrap-decisions.json")
	if (active.mode !== "update" && existsSync(packetPath)) throw new Error(`Adoption preserves the existing decision packet: ${relative(active.target, packetPath)}. Move or review it before retrying.`)
	if (active.mode === "new") {
		const name = values.PRODUCT.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "")
		if (!name || name.length > 214 || ["node_modules", "favicon.ico"].includes(name)) {
			throw new Error("PRODUCT must produce a valid, non-reserved npm package name of at most 214 characters.")
		}
		if (values.PACKAGE_MANAGER_CACHE !== "npm" || !["package-lock.json", "npm-shrinkwrap.json"].includes(values.PACKAGE_MANAGER_LOCKFILE)) {
			throw new Error("New projects currently require an npm package-lock.json or npm-shrinkwrap.json toolchain.")
		}
		return
	}
	if (active.mode !== "update") {
		const governed = new Set(questionnairePlaceholders(active.questionnaire))
		for (const targetPath of Array.isArray(comparison.modified) ? comparison.modified : []) {
			if (typeof targetPath !== "string") continue
			const content = await readFile(join(active.target, targetPath), "utf8")
			const conflict = [...content.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].find((match) => governed.has(match[1]))
			if (conflict) throw new Error(`Existing blueprint path ${targetPath} contains governed placeholder ${conflict[0]}; resolve it before adoption.`)
		}
	}
	const packagePath = join(active.target, "package.json")
	await assertNoTargetSymlink(active.target, packagePath)
	const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
	if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) throw new Error("package.json must contain an object.")
	if (packageJson.scripts !== undefined && (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts))) {
		throw new Error("package.json scripts must be an object.")
	}
	const lockPath = join(active.target, values.PACKAGE_MANAGER_LOCKFILE)
	await assertNoTargetSymlink(active.target, lockPath)
	if (!(await lstat(lockPath)).isFile()) throw new Error(`Selected package-manager lockfile is not a file: ${values.PACKAGE_MANAGER_LOCKFILE}`)
}

async function readQuestionnaire(blueprintRoot: string): Promise<BootstrapQuestionnaire> {
	return JSON.parse(await readFile(join(blueprintRoot, "distribution", "bootstrap-questionnaire.json"), "utf8"))
}

function draftPath(target: string): string {
	const id = createHash("sha256").update(target).digest("hex").slice(0, 20)
	return join(homedir(), ".pi", "agent", "project-drafts", `${id}.json`)
}

async function saveDraft(active: ActiveProject, values: Record<string, string>, evidence: Record<string, string>): Promise<string> {
	const path = draftPath(active.target)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify({
		schemaVersion: 1,
		questionnaireVersion: active.questionnaire.schemaVersion,
		mode: active.mode,
		target: active.target,
		values,
		evidence,
	}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
	return path
}

function blueprintRevision(blueprintRoot: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: blueprintRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
	return result.status === 0 ? result.stdout.trim() : "unknown"
}

async function writeDecisionPacket(
	active: ActiveProject,
	values: Record<string, string>,
	evidence: Record<string, string>,
	comparison: Record<string, unknown>,
): Promise<string> {
	const packetName = active.mode === "update" ? `blueprint-update-decisions-${Date.now()}.json` : "bootstrap-decisions.json"
	const packetPath = join(active.target, "docs", "ops", "automation", packetName)
	await assertNoTargetSymlink(active.target, packetPath)
	await mkdir(dirname(packetPath), { recursive: true })
	await writeFile(packetPath, `${JSON.stringify({
		schemaVersion: 1,
		questionnaireVersion: active.questionnaire.schemaVersion,
		mode: active.mode,
		blueprintRevision: blueprintRevision(active.blueprintRoot),
		approvedAt: new Date().toISOString(),
		blueprintComparison: comparison,
		values: Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
		evidence,
	}, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
	return relative(active.target, packetPath)
}

function runBlueprintConfigure(active: ActiveProject, decisionsPath: string): Record<string, unknown> {
	const result = spawnSync(process.execPath, [
		join(active.blueprintRoot, "scripts", "bootstrap-configure.mjs"),
		"--target", active.target,
		"--decisions", decisionsPath,
		"--json", "true",
	], { cwd: active.blueprintRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
	if (result.status !== 0) throw new Error(result.stderr.trim() || "Blueprint configuration failed.")
	return JSON.parse(result.stdout)
}

function summarizeComparison(comparison: Record<string, unknown>): Record<string, unknown> {
	const list = (key: string): unknown[] => Array.isArray(comparison[key]) ? comparison[key] as unknown[] : []
	return {
		managedFileCount: comparison.managedFileCount,
		exactCount: list("exact").length,
		missingCount: list("missing").length,
		missing: list("missing"),
		modified: list("modified"),
		unexpectedManaged: list("unexpectedManaged"),
		manifestStatus: comparison.manifestStatus,
		manifestIssue: comparison.manifestIssue ?? null,
	}
}

function runHarnessCommand(active: ActiveProject, command: "install" | "adopt" | "update" | "drift", decisionsPath?: string): Record<string, unknown> {
	const result = spawnSync(process.execPath, [
		join(active.blueprintRoot, "scripts", "harness-sync.mjs"),
		command,
		"--target", active.target,
		"--json", "true",
		...(decisionsPath ? ["--decisions", decisionsPath] : []),
	], { cwd: active.blueprintRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
	if (result.status !== 0 && !(command === "drift" && result.status === 2)) {
		throw new Error(result.stderr.trim() || `Blueprint ${command} failed.`)
	}
	return JSON.parse(result.stdout)
}

export default function projectBlueprintExtension(pi: ExtensionAPI): void {
	let pending: { prompt: string; active: ActiveProject } | null = null
	let active: ActiveProject | null = null
	let approved = false
	let reviewClosed = false

	pi.registerTool({
		name: "review_project_blueprint_decisions",
		label: "Review Project Blueprint Decisions",
		description: "Complete and review the decision packet for an active /project workflow. Mutation requires interactive approval.",
		parameters: decisionSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!active) throw new Error("review_project_blueprint_decisions requires an active /project command.")
			if (reviewClosed) throw new Error("This project review is closed. Start another /project command.")
			const values = { ...params.values } as Record<string, string>
			const evidence = { ...(params.evidence ?? {}) } as Record<string, string>
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Interactive approval is unavailable. Report the proposed decisions and stop without changing files." }],
					details: { status: "approval-required", missing: missingDecisionValues(active.questionnaire, values), values, evidence },
				}
			}

			for (const placeholder of missingDecisionValues(active.questionnaire, values)) {
				const question = questionForPlaceholder(active.questionnaire, placeholder)
				const defaultValue = question.placeholders.length === 1 ? question.default ?? "" : ""
				const answer = await ctx.ui.input(`${placeholder}: ${question.prompt}`, defaultValue, { signal })
				if (!answer?.trim()) {
					reviewClosed = true
					ctx.abort()
					return { content: [{ type: "text", text: "The user cancelled the questionnaire. No files changed." }], details: { status: "cancelled" } }
				}
				values[placeholder] = answer.trim()
				evidence[placeholder] = "user-provided during interactive review"
			}

			const comparison: Record<string, unknown> = {
				...summarizeComparison(runHarnessCommand(active, "drift")),
				decisionPacketExists: existsSync(join(active.target, "docs", "ops", "automation", "bootstrap-decisions.json")),
			}
			if (active.mode === "update") {
				if (comparison.manifestStatus !== "valid") throw new Error("Update requires a valid harness manifest. Run /project audit and resolve the manifest issue first.")
				const manifestPath = join(active.target, "docs", "ops", "automation", "harness-manifest.json")
				await assertNoTargetSymlink(active.target, manifestPath)
				const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
				Object.assign(comparison, {
					installedRevision: manifest.sourceRevision,
					decisionsPath: manifest.decisionsPath ?? null,
					configuredBaseline: Boolean(manifest.decisionsPath && manifest.managedFiles?.every((entry: { configuredSha256?: string }) => /^[a-f0-9]{64}$/.test(entry.configuredSha256 ?? ""))),
					sourceRevision: blueprintRevision(active.blueprintRoot),
					updatePolicy: "Guarded update only. Locally modified managed files block the entire update. Project-owned files and the original decision packet are preserved. Required checks run afterward.",
				})
			}
			let edited = await ctx.ui.editor("Review project blueprint decision packet", JSON.stringify({
				mode: active.mode,
				target: active.target,
				blueprintComparison: comparison,
				values,
				evidence,
			}, null, 2))
			if (edited === undefined) {
				reviewClosed = true
				ctx.abort()
				return { content: [{ type: "text", text: "The user cancelled review. No files changed." }], details: { status: "cancelled" } }
			}
			let reviewed: { mode: ProjectMode; target: string; values: Record<string, string>; evidence?: Record<string, string> }
			try {
				reviewed = JSON.parse(edited)
				if (reviewed.mode !== active.mode || reviewed.target !== active.target) throw new Error("Mode and target cannot change during review.")
				validateDecisionValues(active.questionnaire, reviewed.values, active.mode !== "audit")
				if (reviewed.evidence && (typeof reviewed.evidence !== "object" || Array.isArray(reviewed.evidence) || Object.values(reviewed.evidence).some((value) => typeof value !== "string"))) {
					throw new Error("Evidence must be an object with string values.")
				}
				assertNoLikelySecrets(reviewed.evidence ?? {})
			} catch (error) {
				throw new Error(`Invalid decision packet: ${error instanceof Error ? error.message : String(error)}`)
			}

			const action = active.mode === "audit" ? "Approve audit" : `Approve and ${active.mode}`
			const choice = await ctx.ui.select("Project blueprint review", [action, "Revise", "Save Draft", "Cancel"], { signal })
			if (choice === "Revise") {
				const revisedPacket = { values: reviewed.values, evidence: reviewed.evidence ?? {} }
				return {
					content: [{ type: "text", text: `Revise this user-edited packet and call review_project_blueprint_decisions again:\n${JSON.stringify(revisedPacket, null, 2)}` }],
					details: { status: "revise", ...revisedPacket },
				}
			}
			if (choice === "Save Draft") {
				const path = await saveDraft(active, reviewed.values, reviewed.evidence ?? {})
				reviewClosed = true
				ctx.abort()
				return { content: [{ type: "text", text: "Draft saved outside the project. Run the same /project command to resume. No project files changed." }], details: { status: "draft-saved", path } }
			}
			if (choice !== action) {
				reviewClosed = true
				ctx.abort()
				return { content: [{ type: "text", text: "The user cancelled. No files changed." }], details: { status: "cancelled" } }
			}

			signal?.throwIfAborted()
			if (active.mode === "update" && blueprintRevision(active.blueprintRoot) !== comparison.sourceRevision) {
				throw new Error("The blueprint revision changed during review. Start /project update again.")
			}
			await assertModeCompatibility(active.mode, active.target)
			await assertApprovedConfiguration(active, reviewed.values, comparison)
			approved = active.mode !== "audit" && active.mode !== "update"
			reviewClosed = true
			if (active.mode === "audit") {
				await rm(draftPath(active.target), { force: true })
				const auditPacket = { comparison, values: reviewed.values, evidence: reviewed.evidence ?? {} }
				return {
					content: [{ type: "text", text: `The user approved this read-only audit packet. Report alignment gaps, adoption classifications, and validation evidence without changing files:\n${JSON.stringify(auditPacket, null, 2)}` }],
					details: { status: "audit-approved", ...auditPacket },
				}
			}

			if (active.mode === "update") {
				const packetPath = await writeDecisionPacket(active, reviewed.values, reviewed.evidence ?? {}, comparison)
				let sync: Record<string, unknown>
				try {
					sync = runHarnessCommand(active, "update", join(active.target, packetPath))
				} catch (error) {
					throw new Error(`${error instanceof Error ? error.message : String(error)} Approved decisions retained at ${packetPath}. Stop and report the blocker; do not bypass the updater.`)
				}
				approved = true
				await rm(draftPath(active.target), { force: true })
				const drift = runHarnessCommand(active, "drift")
				return {
					content: [{ type: "text", text: `Configured blueprint update applied. Decision packet: ${packetPath}. Drift remaining: ${drift.driftDetected === true}. The updater preserves project-owned files, package scripts, and the original decision packet. It does not restore bootstrap-only helpers. Inspect changed instructions and scripts, run the focused blueprint and repository checks, and report failed or unavailable checks. Do not claim application correctness from sync success.` }],
					details: { status: "approved", sync, packetPath, drift },
				}
			}

			const sync = runHarnessCommand(active, active.mode === "new" ? "install" : "adopt")
			const packetPath = await writeDecisionPacket(active, reviewed.values, reviewed.evidence ?? {}, comparison)
			const configured = runBlueprintConfigure(active, join(active.target, packetPath))
			await rm(draftPath(active.target), { force: true })
			const preserved = Array.isArray(sync.preserved) ? sync.preserved : []
			const changedFiles = Array.isArray(configured.changedFiles) ? configured.changedFiles : []
			const scriptConflicts = Array.isArray(configured.scriptConflicts) ? configured.scriptConflicts : []
			return {
				content: [{ type: "text", text: `Blueprint base applied after approval. Decision packet: ${packetPath}. Replaced placeholders in ${changedFiles.length} files. Preserved ${preserved.length} existing files. Package-script conflicts: ${scriptConflicts.length ? scriptConflicts.join(", ") : "none"}. Reconcile preserved files, verify commands against the real package manifest, then run the focused blueprint checks from the installed scripts and repository instructions. Update does not restore removed bootstrap-only helpers. Report failed or unavailable checks and unresolved placeholders; do not claim complete validation from sync success. Do not remove bootstrap helpers until every required check passes.` }],
				details: { status: "approved", sync, packetPath, configured },
			}
		},
	})

	pi.registerCommand("project", {
		description: "Audit, adopt, update, or initialize the Agent Project Blueprint with interactive approval",
		handler: async (rawArgs, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish, then run /project again.", "warning")
				return
			}
			let parsed = parseProjectArgs(rawArgs)
			if ((!parsed || !parsed.target) && ctx.hasUI) {
				const mode = await ctx.ui.select("Project blueprint mode", ["audit", "adopt", "update", "new"])
				if (!mode) return
				const target = await ctx.ui.input("Project target path", ctx.cwd)
				parsed = target?.trim() ? { mode: mode as ProjectMode, target: target.trim() } : null
			}
			if (!parsed?.target) {
				ctx.ui.notify(PROJECT_USAGE, "warning")
				return
			}
			try {
				const target = safeTarget(parsed.target, parsed.mode, ctx.cwd)
				await assertModeCompatibility(parsed.mode, target)
				const blueprintRoot = findBlueprintRoot()
				if (target === blueprintRoot || isWithin(target, blueprintRoot) || isWithin(blueprintRoot, target)) {
					throw new Error("The target must be separate from the blueprint checkout.")
				}
				const questionnaire = await readQuestionnaire(blueprintRoot)
				const next = { mode: parsed.mode, target, blueprintRoot, questionnaire }
				const decisionsPath = parsed.mode === "update" ? await updateDecisionsPath(target) : undefined
				let prompt = projectPlanningPrompt(parsed.mode, target, questionnaire, decisionsPath)
				const savedPath = draftPath(target)
				if (existsSync(savedPath) && ctx.hasUI) {
					const resume = await ctx.ui.select("Saved project draft found", ["Resume", "Start over", "Cancel"])
					if (resume === "Cancel" || !resume) return
					if (resume === "Start over") await rm(savedPath, { force: true })
					else {
						const draft = JSON.parse(await readFile(savedPath, "utf8"))
						if (draft.target !== target || draft.mode !== parsed.mode || draft.questionnaireVersion !== questionnaire.schemaVersion) {
							throw new Error("The saved draft does not match this target, mode, or questionnaire version. Start over to replace it.")
						}
						prompt += `\n\nResume from this saved decision draft. Recheck every inferred value against the current repository before review:\n${JSON.stringify({ values: draft.values, evidence: draft.evidence }, null, 2)}`
					}
				}
				pending = { prompt, active: next }
				pi.sendUserMessage(prompt)
			} catch (error) {
				pending = null
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
			}
		},
	})

	pi.on("before_agent_start", (event) => {
		if (!pending || event.prompt !== pending.prompt) return
		active = pending.active
		pending = null
		approved = false
		reviewClosed = false
	})

	pi.on("tool_call", (event) => {
		if (active && !approved && ["bash", "edit", "write"].includes(event.toolName)) {
			return { block: true, reason: "Mutation tools are disabled until the user approves the project decision packet. Use read and search tools while inspecting." }
		}
	})

	pi.on("agent_settled", () => {
		pending = null
		active = null
		approved = false
		reviewClosed = false
	})
}
