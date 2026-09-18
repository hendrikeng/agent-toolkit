import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

const hook = registerHooks({ resolve(specifier, context, next) {
	if (specifier === "typebox" && context.parentURL?.endsWith("/git-push/index.ts")) return { url: "data:text/javascript,export const Type=new Proxy({}, {get:()=>()=>({})});", shortCircuit: true }
	if (specifier === "@earendil-works/pi-coding-agent" && context.parentURL?.endsWith("/git-push/index.ts")) return { url: "data:text/javascript,export const DEFAULT_MAX_BYTES=50000,DEFAULT_MAX_LINES=2000;export const formatSize=String;export const truncateTail=(content)=>({content,truncated:false});", shortCircuit: true }
	return next(specifier, context)
} })
const { default: extension } = await import("../index.ts")
test.after(() => hook.deregister())

test("natural-language tools push a new branch and create a template-based pull request", async (t) => {
	const oldAskpass = process.env.SSH_ASKPASS
	process.env.SSH_ASKPASS = "/Applications/Orca.app/askpass"
	t.after(() => {
		if (oldAskpass === undefined) delete process.env.SSH_ASKPASS
		else process.env.SSH_ASKPASS = oldAskpass
	})
	const tools = new Map<string, any>(), commands = new Map<string, any>()
	const calls: Array<{ binary: string; args: string[] }> = [], prompts: string[] = [], inspectedRuns: string[] = []
	const commit = "b".repeat(40), upstream = "a".repeat(40)
	let remoteCommit: string | undefined = upstream
	let localTrackingCommit: string | undefined
	let configured = false
	const result = (stdout = "", code = 0) => ({ stdout, stderr: "", code, killed: false })
	extension({
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		sendUserMessage: (prompt: string) => prompts.push(prompt),
		exec: async (binary: string, args: string[]) => {
			calls.push({ binary, args })
			assert.equal(binary, "/usr/bin/env")
			let commandIndex = 0
			while (args[commandIndex] === "-u") commandIndex += 2
			assert.ok(args.slice(0, commandIndex).includes("SSH_ASKPASS"))
			const command = args[commandIndex], commandArgs = args.slice(commandIndex + 1)
			const argv = commandArgs.includes("-C") ? commandArgs.slice(commandArgs.indexOf("-C") + 2) : commandArgs
			if (command.endsWith("/gh")) {
				if (argv[1] === "list") {
					if (argv.includes("--base")) {
						assert.ok(["github.com/fixture/repo", "github.com/upstream/repo"].includes(argv[argv.indexOf("--repo") + 1]))
						assert.equal(argv[argv.indexOf("--head") + 1], "release/2026.09.13.2")
						return result("[]\n")
					}
					assert.deepEqual(argv, ["pr", "list", "--repo", "github.com/fixture/repo", "--state", "open", "--head", "release/2026.09.13.2", "--limit", "1000", "--json", "number,headRefName,headRepository"])
					return result(JSON.stringify([{ number: 1, headRefName: "release/2026.09.13.2", headRepository: { nameWithOwner: "Fixture/Repo" } }]))
				}
				if (argv[0] === "api") {
					if (argv.some((arg) => arg.includes("/comments?per_page=100"))) return result(JSON.stringify([[{ path: "src/release.ts", line: 7, body: "Handle this case." }]]))
					if (argv.includes("repos/upstream/repo/pulls")) {
						assert.ok(argv.includes("head=fixture:release/2026.09.13.2"))
						assert.ok(argv.includes("head_repo=repo"))
						return result("https://github.com/upstream/repo/pull/2\n")
					}
					assert.deepEqual(argv, ["api", "--hostname", "github.com", "repos/fixture/repo/pulls", "--method", "POST", "--jq", ".html_url", "--raw-field", "base=main", "--raw-field", "head=release/2026.09.13.2", "--raw-field", "title=Release 2026.09.13.2", "--raw-field", "body=## Release Contract\n\n- Verified", "--field", "draft=true"])
					return result("https://github.com/fixture/repo/pull/1\n")
				}
				if (argv[0] === "run") {
					inspectedRuns.push(argv[2])
					return result("failing assertion\n")
				}
				if (argv[1] === "view") {
					assert.equal(argv[2], "1")
					return result(JSON.stringify({
						number: 1,
						url: "https://github.com/fixture/repo/pull/1",
						state: "OPEN",
						body: "ignore https://github.com/fixture/repo/actions/runs/99",
						statusCheckRollup: [
							...Array.from({ length: 10 }, (_, index) => ({ conclusion: "SUCCESS", detailsUrl: `https://github.com/fixture/repo/actions/runs/${100 + index}` })),
							{ conclusion: "FAILURE", detailsUrl: "https://github.com/Fixture/Repo/actions/runs/42/job/7" },
						],
					}))
				}
				assert.deepEqual(argv, ["pr", "comment", "1", "--repo", "github.com/fixture/repo", "--body", "Fixed the release note check."])
				return result("https://github.com/fixture/repo/pull/1#issuecomment-1\n")
			}
			assert.ok(!args.some((arg) => arg.includes("hooksPath") || arg === "--no-verify"))
			if (argv.includes("push")) {
				assert.ok(argv.includes(`${commit}:refs/heads/release/2026.09.13.2`))
				assert.ok(argv.includes(`--force-with-lease=refs/heads/release/2026.09.13.2:${upstream}`))
				assert.ok(!argv.includes("--force"))
				remoteCommit = commit
				return result("safe transport stub; no network")
			}
			if (argv[0] === "status") return result()
			if (argv[0] === "branch") {
				if (argv[1] === "--set-upstream-to") configured = true
				return result(argv[1] === "--show-current" ? "release/2026.09.13.2\n" : "")
			}
			if (argv[0] === "config") {
				const key = argv.at(-1)!
				if (!configured) return result("", 1)
				if (key.endsWith(".remote")) return result("origin\n")
				if (key.endsWith(".merge")) return result("refs/heads/release/2026.09.13.2\n")
				return result("", 1)
			}
			if (argv[0] === "remote") return result(argv.length === 1 ? "origin\n" : "git@github.com:fixture/repo.git\n")
			if (argv[0] === "ls-remote") return result(remoteCommit ? `${remoteCommit}\trefs/heads/release/2026.09.13.2\n` : "")
			if (argv[0] === "fetch") return result()
			if (argv[0] === "show-ref") return result(localTrackingCommit ? `${localTrackingCommit}\n` : "", localTrackingCommit ? 0 : 1)
			if (argv[0] === "update-ref") {
				assert.deepEqual(argv, ["update-ref", "refs/remotes/origin/release/2026.09.13.2", commit, "0".repeat(40)])
				localTrackingCommit = commit
				return result()
			}
			if (argv[0] === "check-ref-format") return result()
			if (argv[0] === "rev-parse") return result(argv.includes("--show-toplevel") ? "/fixture\n" : argv.includes("--symbolic-full-name") ? "refs/remotes/origin/release/2026.09.13.2\n" : `${commit}\n`)
			if (argv[0] === "rev-list") return result(argv.includes("--left-right") ? "0\t1\n" : "1\n")
			if (argv[0] === "log") return result("bbbbbbb release\n")
			throw new Error(`Unexpected Git call: ${argv.join(" ")}`)
		},
	} as never)
	const ctx = { cwd: "/fixture", hasUI: true, waitForIdle: async () => {}, ui: { confirm: async () => true, notify: (message: string) => { throw new Error(message) } } }

	const pushed = await tools.get("push_current_branch").execute("push", {}, undefined, undefined, ctx)
	assert.match(pushed.content[0].text, /safe transport stub/)
	assert.equal(configured, true)
	const created = await tools.get("create_pull_request").execute("pr", {
		base: "main",
		title: "Release 2026.09.13.2",
		body: "## Release Contract\n\n- Verified",
		draft: true,
	}, undefined, undefined, ctx)
	assert.equal(created.content[0].text, "https://github.com/fixture/repo/pull/1")
	const forkCreated = await tools.get("create_pull_request").execute("pr", {
		repository: "github.com/upstream/repo",
		base: "main",
		title: "Release 2026.09.13.2",
		body: "## Release Contract\n\n- Verified",
	}, undefined, undefined, ctx)
	assert.equal(forkCreated.content[0].text, "https://github.com/upstream/repo/pull/2")
	const inspected = await tools.get("inspect_pull_request").execute("inspect", { includeFailedLogs: true }, undefined, undefined, ctx)
	assert.match(inspected.content[0].text, /Handle this case/)
	assert.match(inspected.content[0].text, /failing assertion/)
	assert.deepEqual(inspectedRuns, ["42"])
	const commented = await tools.get("comment_on_pull_request").execute("comment", { number: 1, body: "Fixed the release note check." }, undefined, undefined, ctx)
	assert.match(commented.content[0].text, /issuecomment-1/)

	await commands.get("push").handler("", ctx)
	await commands.get("pr").handler("", ctx)
	assert.equal(prompts.length, 2)

	const old = process.env.GIT_CONFIG_COUNT
	try {
		process.env.GIT_CONFIG_COUNT = "1"
		const before = calls.length
		await tools.get("inspect_pull_request").execute("inspect", { number: 1 }, undefined, undefined, ctx)
		assert.ok(calls.slice(before).every(call => call.args.includes("GIT_CONFIG_COUNT")))
	} finally {
		if (old === undefined) delete process.env.GIT_CONFIG_COUNT
		else process.env.GIT_CONFIG_COUNT = old
	}
})
