import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, writeFile, rm, readdir, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerHooks } from "node:module"
import test from "node:test"

// The host supplies TypeBox. Stub schema construction only; run real command/tool handlers and sync scripts.
const hook = registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "typebox") return { url: "data:text/javascript,export const Type = new Proxy({}, {get: () => () => ({})});", shortCircuit: true }
		return next(specifier, context)
	},
})
const { default: extension } = await import("../index.ts")
hook.deregister()

const blueprintRoot = await realpath(new URL("../../../../vendor/agent-project-blueprint", import.meta.url))

test("update requires approval, preserves decisions and local edits, and configures a guarded sync", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "project-update-")))
	const target = join(root, "app")
	const previousRoot = process.env.AGENT_PROJECT_ALLOWED_ROOTS
	const previousBlueprint = process.env.AGENT_PROJECT_BLUEPRINT_DIR
	process.env.AGENT_PROJECT_ALLOWED_ROOTS = root
	process.env.AGENT_PROJECT_BLUEPRINT_DIR = blueprintRoot
	try {
		const install = spawnSync(process.execPath, [join(blueprintRoot, "scripts/harness-sync.mjs"), "install", "--target", target], { encoding: "utf8" })
		assert.equal(install.status, 0, install.stderr)
		await writeFile(join(target, "package.json"), JSON.stringify({ name: "example", scripts: { "verify:fast": "existing-check" } }))
		await writeFile(join(target, "package-lock.json"), "{}")
		const questionnaire = JSON.parse(await readFile(join(blueprintRoot, "distribution/bootstrap-questionnaire.json"), "utf8"))
		const values = Object.fromEntries(questionnaire.sections.flatMap((section: any) => section.questions.flatMap((question: any) => question.placeholders)).map((key: string) => [key, key.startsWith("SCORE_") ? "4" : key.toLowerCase()]))
		Object.assign(values, {
			LAST_UPDATED_ISO_DATE: "2026-03-22", CURRENT_STATE_DATE: "2026-03-22", GENERATED_AT_UTC_ISO: "2026-03-22T12:00:00.000Z",
			PRODUCT: "Example", NODE_VERSION: "24", CI_INSTALL_COMMAND: "npm ci", PACKAGE_MANAGER_CACHE: "npm", PACKAGE_MANAGER_LOCKFILE: "package-lock.json",
			CODEOWNERS_DEFAULT_TEAM: "@acme/platform", CODEOWNERS_SECURITY_TEAM: "@acme/security",
		})
		const originalPacket = join(target, "docs/ops/automation/bootstrap-decisions.json")
		const originalContent = `${JSON.stringify({ schemaVersion: 1, values, evidence: { PRODUCT: "test fixture" } }, null, 2)}\n`
		await writeFile(originalPacket, originalContent)
		const configure = spawnSync(process.execPath, [join(blueprintRoot, "scripts/bootstrap-configure.mjs"), "--target", target, "--decisions", originalPacket, "--json", "true"], { encoding: "utf8" })
		assert.equal(configure.status, 0, configure.stderr)
		await writeFile(join(target, "product.txt"), "keep product behavior\n")
		await rm(join(target, "package.scripts.fragment.json"))
		const events: Record<string, Function> = {}
		let command: any, tool: any, prompt = "", reviewedPacket: any
		const notifications: string[] = []
		let choice: string | undefined = "Cancel"
		extension({
			registerTool(definition: any) { tool = definition },
			registerCommand(_name: string, definition: any) { command = definition },
			on(name: string, handler: Function) { events[name] = handler },
			sendUserMessage(message: string) { prompt = message },
		} as any)
		const ctx: any = {
			cwd: root, hasUI: true, isIdle: () => true, abort() {},
			ui: {
				notify(message: string) { notifications.push(message) },
				editor(_title: string, packet: string) { reviewedPacket = JSON.parse(packet); return packet },
				select() { return choice },
				input() { throw new Error("Complete values must not ask bootstrap questions") },
			},
		}
		async function start() {
			await command.handler(`update ${target}`, ctx)
			assert.deepEqual(notifications, [])
			events.before_agent_start({ prompt })
		}
		const manifestPath = join(target, "docs/ops/automation/harness-manifest.json")
		const before = await readFile(manifestPath, "utf8")
		const escapedManifest = JSON.parse(before)
		escapedManifest.decisionsPath = "../outside-decisions.json"
		await writeFile(manifestPath, JSON.stringify(escapedManifest))
		await command.handler(`update ${target}`, ctx)
		assert.match(notifications.pop() ?? "", /escapes the project/)
		assert.equal(prompt, "")
		await writeFile(manifestPath, before)
		await start()
		assert.ok(events.tool_call({ toolName: "write" })?.block)
		ctx.hasUI = false
		assert.equal((await tool.execute("test", { values }, undefined, undefined, ctx)).details.status, "approval-required")
		assert.equal(await readFile(manifestPath, "utf8"), before)
		ctx.hasUI = true
		assert.equal((await tool.execute("test", { values }, undefined, undefined, ctx)).details.status, "cancelled")
		assert.ok(events.tool_call({ toolName: "bash" })?.block)
		assert.equal(await readFile(manifestPath, "utf8"), before)
		assert.ok(reviewedPacket.blueprintComparison.sourceRevision)
		assert.ok(reviewedPacket.blueprintComparison.installedRevision)
		assert.equal(reviewedPacket.blueprintComparison.configuredBaseline, true)
		assert.equal(reviewedPacket.blueprintComparison.decisionsPath, "docs/ops/automation/bootstrap-decisions.json")

		events.agent_settled()
		await start()
		choice = "Approve and update"
		const result = await tool.execute("test", { values }, undefined, undefined, ctx)
		assert.equal(result.details.sync.command, "update")
		assert.equal(result.details.status, "approved")
		assert.equal(events.tool_call({ toolName: "write" }), undefined)
		assert.equal(await readFile(originalPacket, "utf8"), originalContent)
		assert.equal(await readFile(join(target, "product.txt"), "utf8"), "keep product behavior\n")
		assert.match(await readFile(join(target, "README.md"), "utf8"), /Example/)
		assert.equal(JSON.parse(await readFile(join(target, "package.json"), "utf8")).scripts["verify:fast"], "existing-check")
		assert.equal((await readdir(target)).includes("package.scripts.fragment.json"), false)
		assert.match(result.details.packetPath, /blueprint-update-decisions-\d+\.json$/)
		assert.equal(result.details.drift.driftDetected, false)
		assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).decisionsPath, result.details.packetPath)

		// A genuine local change blocks the next sync rather than being overwritten.
		const configuredManifest = await readFile(manifestPath, "utf8")
		const configuredReadme = await readFile(join(target, "README.md"), "utf8")
		const locallyEditedReadme = `${configuredReadme}\nlocal edit\n`
		await writeFile(join(target, "README.md"), locallyEditedReadme)
		events.agent_settled()
		await start()
		await assert.rejects(tool.execute("test", { values }, undefined, undefined, ctx), /MODIFIED_MANAGED_FILES.*README\.md/)
		assert.ok(events.tool_call({ toolName: "edit" })?.block)
		assert.equal(await readFile(manifestPath, "utf8"), configuredManifest)
		assert.equal(await readFile(join(target, "README.md"), "utf8"), locallyEditedReadme)
	} finally {
		if (previousRoot === undefined) delete process.env.AGENT_PROJECT_ALLOWED_ROOTS
		else process.env.AGENT_PROJECT_ALLOWED_ROOTS = previousRoot
		if (previousBlueprint === undefined) delete process.env.AGENT_PROJECT_BLUEPRINT_DIR
		else process.env.AGENT_PROJECT_BLUEPRINT_DIR = previousBlueprint
		await rm(root, { recursive: true, force: true })
	}
})
