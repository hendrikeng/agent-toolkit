import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import test from "node:test"
import skillsUpdateExtension, { GLOBAL_SKILLS_UPDATE_SCRIPT, toolkitRoot } from "../index.ts"

const BLOCKED_GIT_ENV = new Set([
	"GIT_ASKPASS",
	"GIT_CONFIG_PARAMETERS",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
	"GIT_EXEC_PATH",
	"GIT_PROXY_COMMAND",
	"GIT_SSH",
	"GIT_SSH_COMMAND",
	"SSH_ASKPASS",
])

function isBlockedGitVariable(name: string): boolean {
	return BLOCKED_GIT_ENV.has(name) || name.startsWith("GIT_CONFIG_")
}

function harness(confirm: boolean, globalUpdateCode = 0, dirtyAfterApproval = false, unsafeGit?: [string, string]) {
	let handler: (args: string, ctx: any) => Promise<void> = async () => {}
	const calls: Array<{ command: string; args: string[] }> = []
	const notices: string[] = []
	let reloaded = false
	let statusCalls = 0
	const pi = {
		registerCommand(name: string, options: { handler: typeof handler }) {
			assert.equal(name, "skills-update")
			handler = options.handler
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args })
			let stdout = ""
			if (args.includes("status")) {
				statusCalls++
				if (dirtyAfterApproval && statusCalls > 1) stdout = " M README.md\n"
			} else if (args.includes("--show-current")) stdout = "main\n"
			else if (args.at(-1) === "branch.main.remote") stdout = "team\n"
			else if (args.at(-1) === "branch.main.merge") stdout = "refs/heads/main\n"
			else if (args.includes("get-url")) stdout = "git@github.com:example/agent-toolkit.git\n"
			const code = args[0]?.endsWith(GLOBAL_SKILLS_UPDATE_SCRIPT) ? globalUpdateCode : 0
			return { code, stdout, stderr: code ? "registry unavailable" : "", killed: false }
		},
	}
	skillsUpdateExtension(pi as any)
	const ctx = {
		mode: "tui",
		ui: {
			confirm: async () => confirm,
			notify: (message: string) => notices.push(message),
			setStatus: () => {},
		},
		reload: async () => {
			reloaded = true
		},
	}
	return {
		run: async () => {
			const saved = Object.entries(process.env).filter(([name]) => isBlockedGitVariable(name)) as Array<[string, string]>
			for (const [name] of saved) delete process.env[name]
			if (unsafeGit) process.env[unsafeGit[0]] = unsafeGit[1]
			try {
				await handler("", ctx)
			} finally {
				for (const name of Object.keys(process.env)) {
					if (isBlockedGitVariable(name)) delete process.env[name]
				}
				for (const [name, value] of saved) process.env[name] = value
			}
		},
		calls,
		notices,
		reloaded: () => reloaded,
	}
}

test("resolves the extension's agent-toolkit checkout", () => {
	const expected = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
	assert.equal(toolkitRoot(), expected)
})

test("does not update without approval", async () => {
	const app = harness(false)
	await app.run()
	assert.equal(app.calls.some(({ args }) => args.includes("pull")), false)
	assert.equal(app.reloaded(), false)
})

test("rejects inherited Git executables", async () => {
	const app = harness(true, 0, false, ["GIT_SSH_COMMAND", "unsafe-wrapper"])
	await app.run()
	assert.equal(app.calls.some(({ args }) => args.includes("pull")), false)
	assert.ok(app.notices.some((message) => message.includes("GIT_SSH_COMMAND")))
})

test("rejects checkout changes after approval", async () => {
	const app = harness(true, 0, true)
	await app.run()
	assert.equal(app.calls.some(({ args }) => args.includes("pull")), false)
	assert.ok(app.notices.some((message) => message.includes("checkout changed")))
})

test("pulls the approved upstream and reinstalls after global updates", async () => {
	const app = harness(true)
	await app.run()
	const pull = app.calls.find(({ args }) => args.includes("pull"))
	assert.ok(pull?.args.includes("team"))
	assert.ok(pull?.args.includes("refs/heads/main"))
	const globalIndex = app.calls.findIndex(({ command, args }) => command === "/bin/bash" && args[0]?.endsWith(GLOBAL_SKILLS_UPDATE_SCRIPT))
	const installIndex = app.calls.findIndex(({ command, args }) => command === "/bin/bash" && args[0]?.endsWith("/install.sh"))
	assert.ok(globalIndex >= 0 && installIndex > globalIndex)
	assert.equal(app.reloaded(), true)
})

test("reloads the installed toolkit when a global skill update fails", async () => {
	const app = harness(true, 1)
	await app.run()
	assert.equal(app.reloaded(), true)
	assert.ok(app.notices.some((message) => message.includes("global skills failed")))
})
