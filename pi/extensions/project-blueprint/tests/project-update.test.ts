import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFile, mkdtemp, readFile, writeFile, rm, readdir, realpath, symlink } from "node:fs/promises"
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
const { configureContent } = await import("../../../../vendor/agent-project-blueprint/scripts/bootstrap-configure.mjs")
const managedPath = "docs/agent-hardening/TOOL_POLICY.md"

for (const installation of ["configured", "legacy", "historical", "historical-pruned"]) test(`${installation} update requires approval, preserves decisions and local edits, and configures a guarded sync`, async () => {
	const legacy = installation !== "configured"
	const root = await realpath(await mkdtemp(join(tmpdir(), "project-update-")))
	const target = join(root, "app")
	const previousRoot = process.env.AGENT_PROJECT_ALLOWED_ROOTS
	const previousBlueprint = process.env.AGENT_PROJECT_BLUEPRINT_DIR
	process.env.AGENT_PROJECT_ALLOWED_ROOTS = root
	process.env.AGENT_PROJECT_BLUEPRINT_DIR = blueprintRoot
	const migrationTempsBefore = (await readdir(tmpdir())).filter((name) => name.startsWith("project-blueprint-baseline-")).sort()
	try {
		let installationRoot = blueprintRoot
		if (installation.startsWith("historical")) {
			installationRoot = join(root, "installed-blueprint")
			const clone = spawnSync("git", ["clone", "--local", "--shared", "--revision=b87feacb824ced6ebf80c8bcf9fbe41c127a2b56", blueprintRoot, installationRoot], { encoding: "utf8" })
			assert.equal(clone.status, 0, clone.stderr)
			// This real historical revision has no questionnaire or configure script.
			await assert.rejects(readFile(join(installationRoot, "distribution/bootstrap-questionnaire.json")), { code: "ENOENT" })
			for (const path of ["scripts/harness-sync.mjs", "scripts/bootstrap-configure.mjs", "distribution/bootstrap-questionnaire.json"]) {
				await copyFile(join(blueprintRoot, path), join(installationRoot, path))
			}
		}
		const install = spawnSync(process.execPath, [join(installationRoot, "scripts/harness-sync.mjs"), "install", "--target", target], { encoding: "utf8" })
		assert.equal(install.status, 0, install.stderr)
		await writeFile(join(target, "package.json"), JSON.stringify({ name: "example", scripts: { "verify:fast": "existing-check" } }))
		await writeFile(join(target, "package-lock.json"), "{}")
		const questionnaire = JSON.parse(await readFile(join(blueprintRoot, "distribution/bootstrap-questionnaire.json"), "utf8"))
		const values = Object.fromEntries(questionnaire.sections.flatMap((section: any) => section.questions.flatMap((question: any) => question.placeholders)).map((key: string) => [key, key.startsWith("SCORE_") ? "4" : key.toLowerCase()]))
		Object.assign(values, {
			LAST_UPDATED_ISO_DATE: "2026-03-22", CURRENT_STATE_DATE: "2026-03-22", GENERATED_AT_UTC_ISO: "2026-03-22T12:00:00.000Z",
			PRODUCT: "Example", NODE_VERSION: "24", CI_INSTALL_COMMAND: "npm ci", PACKAGE_MANAGER_CACHE: "npm", PACKAGE_MANAGER_LOCKFILE: "package-lock.json",
			CODEOWNERS_DEFAULT_TEAM: legacy ? "@hendrikeng" : "@acme/platform", CODEOWNERS_SECURITY_TEAM: legacy ? "@hendrikeng" : "@acme/security",
		})
		const originalPacket = join(target, "docs/ops/automation/bootstrap-decisions.json")
		const originalContent = `${JSON.stringify({ schemaVersion: 1, values, evidence: { PRODUCT: "test fixture" } }, null, 2)}\n`
		await writeFile(originalPacket, originalContent)
		if (installation.startsWith("historical")) {
			// Model an already-configured historical project. Retired values belong only
			// to this fixture, not to today's approved decision packet or migration.
			const installed = JSON.parse(await readFile(join(target, "docs/ops/automation/harness-manifest.json"), "utf8"))
			for (const entry of [...installed.managedFiles, ...(installed.projectFiles ?? [])]) {
				const source = await readFile(join(installationRoot, entry.sourcePath))
				const retired = Object.fromEntries([...source.toString().matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => [match[1], match[1].toLowerCase()]))
				await writeFile(join(target, entry.targetPath), configureContent(entry.targetPath, source, { ...retired, ...values }))
			}
		} else {
			const configure = spawnSync(process.execPath, [join(installationRoot, "scripts/bootstrap-configure.mjs"), "--target", target, "--decisions", originalPacket, "--json", "true"], { encoding: "utf8" })
			assert.equal(configure.status, 0, configure.stderr)
		}
		await writeFile(join(target, "product.txt"), "keep product behavior\n")
		if (installation !== "historical") await rm(join(target, "package.scripts.fragment.json"))
		const manifestPath = join(target, "docs/ops/automation/harness-manifest.json")
		if (legacy) {
			// Model pre-decision-packet installations, without blessing target content as a baseline.
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
			delete manifest.decisionsPath
			for (const entry of manifest.managedFiles) {
				delete entry.configuredSha256
				delete entry.preservedLocal
			}
			if (installation === "historical-pruned") {
				const retired = new Set(["PLACEHOLDERS.md", "package.scripts.fragment.json", "scripts/check-template-placeholders.sh"])
				manifest.managedFiles = manifest.managedFiles.filter((entry: any) => !retired.has(entry.targetPath))
				for (const path of retired) await rm(join(target, path), { force: true })
			}
			await writeFile(manifestPath, JSON.stringify(manifest))
			if (installation === "historical-pruned") {
				// Without reviewed policy, even known bootstrap omissions remain blocked.
				const result = spawnSync(process.execPath, [join(installationRoot, "scripts/bootstrap-configure.mjs"), "--target", target, "--decisions", originalPacket, "--baseline-only", "true"], { encoding: "utf8" })
				assert.equal(result.status, 1)
				assert.match(result.stderr, /complete managed file set/)
				assert.equal(await readFile(manifestPath, "utf8"), JSON.stringify(manifest))
			}
			await rm(originalPacket)
		}
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
		const before = await readFile(manifestPath, "utf8")
		const escapedManifest = JSON.parse(before)
		escapedManifest.decisionsPath = "../outside-decisions.json"
		await writeFile(manifestPath, JSON.stringify(escapedManifest))
		await command.handler(`update ${target}`, ctx)
		assert.match(notifications.pop() ?? "", /escapes the project/)
		assert.equal(prompt, "")
		escapedManifest.decisionsPath = "docs/ops/automation/missing-decisions.json"
		await writeFile(manifestPath, JSON.stringify(escapedManifest))
		await command.handler(`update ${target}`, ctx)
		assert.match(notifications.pop() ?? "", /recorded harness decision packet is missing.*Restore it/)
		assert.equal(prompt, "")
		await writeFile(manifestPath, before)
		if (legacy) {
			await symlink(join(root, "absent.json"), originalPacket)
			await command.handler(`update ${target}`, ctx)
			assert.match(notifications.pop() ?? "", /symbolic-link target path/)
			assert.equal(prompt, "")
			await rm(originalPacket)
			await command.handler(`adopt ${target}`, ctx)
			assert.match(notifications.pop() ?? "", /already has a blueprint harness manifest/)
		}
		await start()
		if (legacy) assert.match(prompt, /legacy installation without a decision packet or configured baseline/)
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
		assert.equal(reviewedPacket.blueprintComparison.configuredBaseline, !legacy)
		assert.equal(reviewedPacket.blueprintComparison.decisionsPath, legacy ? null : "docs/ops/automation/bootstrap-decisions.json")

		// Missing dates come from one UTC clock reading, not bootstrap questions.
		events.agent_settled()
		await start()
		const withoutDates = { ...values }
		for (const key of ["LAST_UPDATED_ISO_DATE", "CURRENT_STATE_DATE", "GENERATED_AT_UTC_ISO"]) delete withoutDates[key]
		ctx.hasUI = false
		const clockBefore = Date.now()
		const proposed = (await tool.execute("test", { values: withoutDates }, undefined, undefined, ctx)).details
		assert.equal(proposed.status, "approval-required")
		assert.deepEqual(proposed.missing, [])
		assert.ok(Date.parse(proposed.values.GENERATED_AT_UTC_ISO) >= clockBefore)
		assert.ok(Date.parse(proposed.values.GENERATED_AT_UTC_ISO) <= Date.now())
		assert.equal(proposed.values.LAST_UPDATED_ISO_DATE, proposed.values.GENERATED_AT_UTC_ISO.slice(0, 10))
		assert.equal(proposed.values.CURRENT_STATE_DATE, proposed.values.LAST_UPDATED_ISO_DATE)
		assert.match(proposed.evidence.LAST_UPDATED_ISO_DATE, /UTC system clock/)
		assert.equal(withoutDates.LAST_UPDATED_ISO_DATE, undefined)
		ctx.hasUI = true

		// Invalid dates and JSON reopen the exact edited packet; only valid packets reach approval.
		const originalEditor = ctx.ui.editor
		const originalSelect = ctx.ui.select
		let attempts = 0, corrected = ""
		ctx.ui.editor = (_title: string, packet: string) => {
			assert.ok(events.tool_call({ toolName: "write" })?.block)
			if (++attempts === 3) {
				assert.equal(packet, `${corrected}!`)
				return corrected
			}
			assert.ok(attempts < 3)
			const parsed = JSON.parse(packet)
			assert.equal(parsed.values.CURRENT_STATE_DATE, values.CURRENT_STATE_DATE)
			if (attempts === 1) {
				parsed.values.PRODUCT = "User-edited product"
				parsed.evidence.PRODUCT = "User-edited evidence"
				parsed.values.LAST_UPDATED_ISO_DATE = "today"
				return JSON.stringify(parsed)
			}
			assert.equal(parsed.values.PRODUCT, "User-edited product")
			assert.equal(parsed.evidence.PRODUCT, "User-edited evidence")
			assert.equal(parsed.values.LAST_UPDATED_ISO_DATE, "today")
			parsed.values.LAST_UPDATED_ISO_DATE = "2026-09-08"
			corrected = JSON.stringify(parsed)
			return `${corrected}!`
		}
		ctx.ui.select = () => { assert.equal(attempts, 3); return "Revise" }
		const revised = (await tool.execute("test", { values: { ...withoutDates, CURRENT_STATE_DATE: values.CURRENT_STATE_DATE } }, undefined, undefined, ctx)).details
		assert.equal(revised.status, "revise")
		assert.equal(revised.values.PRODUCT, "User-edited product")
		assert.equal(revised.values.LAST_UPDATED_ISO_DATE, "2026-09-08")
		assert.match(notifications.shift() ?? "", /LAST_UPDATED_ISO_DATE must be a valid YYYY-MM-DD/)
		assert.match(notifications.shift() ?? "", /Invalid decision packet:.*Your edits are preserved/)
		assert.deepEqual(notifications, [])

		// Cancelling an invalid packet never reaches approval or writes to the project.
		attempts = 0
		ctx.ui.editor = () => ++attempts === 1 ? "{" : undefined
		ctx.ui.select = () => { throw new Error("Invalid packets must not reach approval") }
		assert.equal((await tool.execute("test", { values }, undefined, undefined, ctx)).details.status, "cancelled")
		assert.match(notifications.pop() ?? "", /Invalid decision packet/)
		assert.equal(await readFile(manifestPath, "utf8"), before)
		assert.equal((await readdir(join(target, "docs/ops/automation"))).some((name) => name.startsWith("blueprint-update-decisions-")), false)
		assert.ok(events.tool_call({ toolName: "bash" })?.block)
		ctx.ui.editor = originalEditor
		ctx.ui.select = originalSelect
		if (legacy) {
			await assert.rejects(readFile(originalPacket), { code: "ENOENT" })
			assert.equal((await readdir(join(target, "docs/ops/automation"))).some((name) => name.startsWith("blueprint-update-decisions-")), false)

			// Neither a wrong revision nor mismatched templates can produce a baseline.
			for (const mismatch of ["revision", "template", "missing-managed", "duplicate-managed", "unexpected-managed"]) {
				const mismatched = JSON.parse(before)
				if (mismatch === "revision") mismatched.sourceRevision = "0".repeat(40)
				else if (mismatch === "template") mismatched.managedFiles.find((entry: any) => entry.targetPath === managedPath).sha256 = "0".repeat(64)
				else if (mismatch === "missing-managed") mismatched.managedFiles = mismatched.managedFiles.filter((entry: any) => entry.targetPath !== managedPath)
				else if (mismatch === "duplicate-managed") mismatched.managedFiles.push(mismatched.managedFiles[0])
				else mismatched.managedFiles.push({ ...mismatched.managedFiles[0], sourcePath: "template/unexpected.txt", targetPath: "unexpected.txt" })
				await writeFile(manifestPath, JSON.stringify(mismatched))
				events.agent_settled()
				await start()
				choice = "Approve and update"
				await assert.rejects(tool.execute("test", { values }, undefined, undefined, ctx), /Legacy baseline migration blocked:.*(?:does not match|does not contain|Cannot prepare installed blueprint revision).*--baseline-only true.*Approved decisions retained/s, `${installation}: ${mismatch}`)
				assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), mismatched)
				assert.ok(events.tool_call({ toolName: "edit" })?.block)
			}
			await writeFile(manifestPath, before)

			// Migration may record differing content only as preservedLocal, never overwrite it.
			const managedFile = join(target, managedPath)
			const managedContent = await readFile(managedFile, "utf8")
			await writeFile(managedFile, `${managedContent}\nlegacy local edit\n`)
			events.agent_settled()
			await start()
			await assert.rejects(tool.execute("test", { values }, undefined, undefined, ctx), /MODIFIED_MANAGED_FILES.*TOOL_POLICY\.md/)
			assert.equal(await readFile(managedFile, "utf8"), `${managedContent}\nlegacy local edit\n`)
			const migrated = JSON.parse(await readFile(manifestPath, "utf8"))
			assert.equal(migrated.managedFiles.find((entry: any) => entry.targetPath === managedPath).preservedLocal, true)
			assert.ok(events.tool_call({ toolName: "write" })?.block)
			// Restore the fixture to test the conflict-free migration separately.
			await writeFile(manifestPath, before)
			await writeFile(managedFile, managedContent)
		}

		const projectReadme = `${await readFile(join(target, "README.md"), "utf8")}\nproject-owned local edit\n`
		await writeFile(join(target, "README.md"), projectReadme)
		events.agent_settled()
		await start()
		choice = "Approve and update"
		const result = await tool.execute("test", { values }, undefined, undefined, ctx)
		assert.equal(result.details.sync.command, "update")
		const codeowners = await readFile(join(target, ".github/CODEOWNERS"), "utf8")
		assert.ok(codeowners.includes(`* ${values.CODEOWNERS_DEFAULT_TEAM}\n`))
		assert.ok(codeowners.includes(`**/security/** ${values.CODEOWNERS_DEFAULT_TEAM} ${values.CODEOWNERS_SECURITY_TEAM}\n`))
		assert.equal(result.details.status, "approved")
		assert.equal(events.tool_call({ toolName: "write" }), undefined)
		if (legacy) await assert.rejects(readFile(originalPacket), { code: "ENOENT" })
		else assert.equal(await readFile(originalPacket, "utf8"), originalContent)
		assert.equal(await readFile(join(target, "product.txt"), "utf8"), "keep product behavior\n")
		assert.equal(await readFile(join(target, "README.md"), "utf8"), projectReadme)
		assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).managedFiles.some((entry: any) => entry.targetPath === "README.md"), false)
		assert.equal(JSON.parse(await readFile(join(target, "package.json"), "utf8")).scripts["verify:fast"], "existing-check")
		assert.equal((await readdir(target)).includes("package.scripts.fragment.json"), false)
		if (installation === "historical-pruned") {
			for (const path of ["PLACEHOLDERS.md", "scripts/check-template-placeholders.sh"]) {
				await assert.rejects(readFile(join(target, path)), { code: "ENOENT" })
			}
		}
		assert.match(result.details.packetPath, /blueprint-update-decisions-\d+\.json$/)
		assert.equal(result.details.drift.driftDetected, false)
		assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).decisionsPath, result.details.packetPath)

		// A genuine local change blocks the next sync rather than being overwritten.
		const configuredManifest = await readFile(manifestPath, "utf8")
		const configuredContent = await readFile(join(target, managedPath), "utf8")
		const locallyEditedContent = `${configuredContent}\nlocal edit\n`
		await writeFile(join(target, managedPath), locallyEditedContent)
		events.agent_settled()
		await start()
		await assert.rejects(tool.execute("test", { values }, undefined, undefined, ctx), /MODIFIED_MANAGED_FILES.*TOOL_POLICY\.md/)
		assert.ok(events.tool_call({ toolName: "edit" })?.block)
		assert.equal(await readFile(manifestPath, "utf8"), configuredManifest)
		assert.equal(await readFile(join(target, managedPath), "utf8"), locallyEditedContent)
		assert.equal(await readFile(join(target, "README.md"), "utf8"), projectReadme)
		assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith("project-blueprint-baseline-")).sort(), migrationTempsBefore)
	} finally {
		if (previousRoot === undefined) delete process.env.AGENT_PROJECT_ALLOWED_ROOTS
		else process.env.AGENT_PROJECT_ALLOWED_ROOTS = previousRoot
		if (previousBlueprint === undefined) delete process.env.AGENT_PROJECT_BLUEPRINT_DIR
		else process.env.AGENT_PROJECT_BLUEPRINT_DIR = previousBlueprint
		await rm(root, { recursive: true, force: true })
	}
})
