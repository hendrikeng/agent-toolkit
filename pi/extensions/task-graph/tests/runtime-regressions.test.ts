import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { graphGit, readGraphWorkspaces } from "../workspaces.ts"
import { repositoryIdentity, taskGraphOrcaArgv, type TaskGraphPlan } from "../task-graph-core.ts"

const globals = globalThis as any
const hooks = registerHooks({
	resolve(specifier, context, next) {
		if (!context.parentURL?.endsWith("/task-graph/index.ts")) return next(specifier, context)
		const mocks: Record<string, string> = {
			"@earendil-works/pi-coding-agent": "export const createBashTool = (cwd, options) => ({execute: (_id, params) => globalThis.graphRegressionShell(cwd, params, options)}); export const getAgentDir = () => globalThis.graphRegressionAgentDir; export const isToolCallEventType = (type, event) => event.toolName === type;",
			"typebox": "export const Type = new Proxy({}, {get: () => () => ({})});",
			"../codex-account/index.ts": "export const defaultPiAccount = () => undefined; export const fetchCodexUsage = () => undefined; export const piAccountEmail = () => undefined; export const piProfileAccountId = () => undefined;",
			"node:child_process": "export const execFileSync = (_command, args) => JSON.stringify(globalThis.graphRegressionRpc(args));",
		}
		return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context)
	},
})
const { default: extension, assertGraphShell } = await import("../index.ts")
test.after(() => { hooks.deregister(); delete globals.graphRegressionShell; delete globals.graphRegressionAgentDir; delete globals.graphRegressionRpc })

function fixture(mode: TaskGraphPlan["mode"] = "execute", currentCheckout = false) {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "graph-regression-")))
	const sources = ["api", "app"].map((name) => join(directory, name))
	const agentDir = join(directory, "agent")
	const environment = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" }
	const prior = { agentDir: process.env.AGENT_TOOLKIT_PI_AGENT_DIR, workerFile: process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES, task: process.env.AGENT_TOOLKIT_GRAPH_TASK }
	Object.assign(process.env, { GIT_AUTHOR_NAME: environment.GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL: environment.GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME: environment.GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL: environment.GIT_COMMITTER_EMAIL })
	process.env.AGENT_TOOLKIT_PI_AGENT_DIR = agentDir
	delete process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES
	delete process.env.AGENT_TOOLKIT_GRAPH_TASK
	for (const source of sources) {
		execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source], { env: environment })
		mkdirSync(join(source, "docs/future"), { recursive: true })
		writeFileSync(join(source, "owned.txt"), "baseline\n")
		writeFileSync(join(source, "unowned.txt"), "keep\n")
		writeFileSync(join(source, ".gitignore"), ".setup-ready\n")
		writeFileSync(join(source, "setup.cjs"), "require('node:fs').writeFileSync('.setup-ready','ready')\n")
		writeFileSync(join(source, "inspect.cjs"), "const fs=require('node:fs'); const repos=JSON.parse(process.env.AGENT_TOOLKIT_GRAPH_REPOSITORIES); console.log(JSON.stringify(repos));\n")
		graphGit(source, "add", "--", "owned.txt", "unowned.txt", ".gitignore", "setup.cjs", "inspect.cjs")
		graphGit(source, "commit", "-m", "baseline")
	}
	const indexes = sources.map((source) => readFileSync(join(source, ".git/index")))
	const heads = sources.map((source) => graphGit(source, "rev-parse", "HEAD"))
	const run = { id: "run_regression", objective: `Pi task graph: ${repositoryIdentity(sources[0])}::objective:Fixture` }
	const tasks: any[] = [], terminals: any[] = [], worktrees: any[] = []
	const dispatches: Record<string, any> = {}
	let failAfterCreate = false
	let permissionDenied = false
	let shellCalls = 0
	let terminalSequence = 0
	const rpc = (args: string[]) => {
		const value = (name: string) => args[args.indexOf(name) + 1]
		let result: any
		switch (args.slice(0, 2).join(" ")) {
			case "orchestration run-list": result = { runs: [run] }; break
			case "orchestration run-show": case "orchestration run-use": result = { run }; break
			case "orchestration task-list": result = { tasks }; break
			case "orchestration dispatch-show": result = { dispatch: dispatches[value("--task")] ?? null }; break
			case "orchestration worker-list": result = { workers: Object.values(dispatches).map((dispatch) => ({ taskId: dispatch.task_id, dispatchId: dispatch.id, runId: run.id, dispatchStatus: dispatch.status, agentTerminalHandle: dispatch.assignee_handle, workerState: "unsupervised", resource: null })) }; break
			case "orchestration dispatch": {
				const task = tasks.find((task) => task.id === value("--task"))
				task.status = "dispatched"
				result = { dispatch: dispatches[task.id] = { id: `dispatch_${task.id}_${terminals.length}`, task_id: task.id, run_id: run.id, status: "active", assignee_handle: value("--to") } }
				break
			}
			case "terminal list": result = { terminals }; break
			case "terminal show": result = { terminal: terminals.find((terminal) => terminal.handle === value("--terminal")) }; break
			case "terminal create": {
				const workspace = worktrees.find((workspace) => `id:${workspace.id}` === value("--worktree"))
				assert.ok(workspace)
				const terminal = { handle: `term_${terminalSequence++}`, worktreePath: workspace.path, title: value("--title") }
				terminals.push(terminal)
				if (failAfterCreate) { failAfterCreate = false; throw new Error("Lost create receipt") }
				result = { terminal }; break
			}
			case "worktree list": result = { worktrees: worktrees.filter((workspace) => workspace.source === value("--repo").slice(5)) }; break
			case "worktree create": {
				const source = value("--repo").slice(5), name = value("--name"), path = join(directory, name)
				assert.equal(value("--setup"), "skip")
				graphGit(source, "worktree", "add", "--quiet", "-b", `hendrikeng/${name}`, path, value("--base-branch"))
				const workspace = { id: `fixture::${path}`, source, path, displayName: name, branch: `refs/heads/hendrikeng/${name}` }
				worktrees.push(workspace); result = { worktree: workspace }; break
			}
			default: throw new Error(`Unexpected fixture RPC: ${args.join(" ")}`)
		}
		return { ok: true, result }
	}
	globals.graphRegressionAgentDir = agentDir
	globals.graphRegressionRpc = rpc
	globals.graphRegressionShell = (cwd: string, params: any, options: any) => {
		shellCalls++
		const argv = taskGraphOrcaArgv(params.command)
		const text = argv ? JSON.stringify(rpc(argv)) : execFileSync("/bin/sh", ["-c", params.command], { cwd, encoding: "utf8", env: options?.spawnHook?.({ command: params.command, cwd, env: environment }).env ?? environment, stdio: ["ignore", "pipe", "pipe"] })
		return { content: [{ type: "text", text }], details: {} }
	}
	function runtime(cwd = sources[0], worker?: any) {
		if (worker) {
			process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES = worker.environment.AGENT_TOOLKIT_GRAPH_WORKSPACES
			process.env.AGENT_TOOLKIT_GRAPH_TASK = worker.workspace.task
		}
		const tools = new Map<string, any>(), commands = new Map<string, any>(), events = new Map<string, any>()
		extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command), on: (name: string, handler: any) => events.set(name, handler), sendUserMessage: (prompt: string) => events.get("before_agent_start")({ prompt }) } as never)
		delete process.env.AGENT_TOOLKIT_GRAPH_WORKSPACES
		delete process.env.AGENT_TOOLKIT_GRAPH_TASK
		const ctx = { cwd, hasUI: true, isIdle: () => true, model: { provider: "test", id: "model" }, ui: { select: async () => mode === "execute" ? "Approve and execute" : "Approve planning work", confirm: async () => true, notify: (message: string) => { throw new Error(message) } } }
		let sequence = 0
		return {
			tools, commands, events, ctx,
			async call(name: string, input: any) {
				const toolCallId = `call_${sequence++}`
				const blocked = await events.get("tool_call")({ toolName: name, input, toolCallId }, ctx)
				if (blocked?.block) throw new Error(blocked.reason)
				// Model the standard permission hook after graph preflight. No command executes on denial.
				if (name === "bash" && permissionDenied) throw new Error("Native bash permission denied")
				let result
				try { result = await tools.get(name).execute(toolCallId, input, undefined, undefined, ctx) }
				catch (error) { await events.get("tool_result")({ toolCallId, toolName: name, input, isError: true, content: [] }); throw error }
				await events.get("tool_result")({ toolCallId, toolName: name, input, isError: false, ...result })
				return result
			},
		}
	}
	let r = runtime()
	const candidate: TaskGraphPlan = { objective: "Fixture", mode, current_checkout: currentCheckout, tasks: ["a", "b"].map((id, index) => ({ id, goal: id, repository: index ? "../app" : ".", depends_on: index ? ["a"] : [], owns: mode === "execute" ? ["owned.txt"] : ["docs/"], specialty: "test", thinking: "medium", done_when: ["checked"], validation: "node inspect.cjs", setup: "node setup.cjs" })) }
	async function approve(resume = false) {
		await r.commands.get("graph").handler("Fixture", r.ctx)
		const result = await r.call("propose_task_graph", candidate)
		await r.call("bind_task_graph_run", { run_id: run.id })
		await r.call("prepare_task_graph_workspace", {})
		if (!resume) result.details.plan.tasks.forEach((task: any, index: number) => tasks.push({ id: `task_${task.id}`, run_id: run.id, parent_id: null, spec: result.content[0].text.match(/\[graph-task:[^\n]+/g)![index], deps: JSON.stringify(task.depends_on.map((id: string) => `task_${id}`)), status: "ready" }))
	}
	const prepare = async (id: string) => JSON.parse((await r.call("prepare_task_graph_workspace", { task_id: `task_${id}` })).content[0].text)
	const command = (worker: any) => `orca terminal create --worktree id:${worker.workspace.id} --title ${worker.launchTitle} --command '${Object.entries(worker.environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")} pi-yolo --model test/model --thinking medium' --json`
	return {
		directory, sources, indexes, heads, tasks, terminals, worktrees, run, candidate, prepare, command, approve,
		get r() { return r },
		get shellCalls() { return shellCalls },
		set deny(value: boolean) { permissionDenied = value },
		set loseReceipt(value: boolean) { failAfterCreate = value },
		worker: (worker: any) => runtime(worker.workspace.path, worker),
		async resume() { r.events.get("agent_settled")(); r = runtime(); await approve(true) },
		async launch(worker: any) {
			await r.call("bash", { repository: worker.workspace.path, command: "node setup.cjs" })
			const result = await r.call("bash", { command: command(worker) })
			const terminal = JSON.parse(result.content[0].text).result.terminal
			await r.call("bash", { command: `orca orchestration dispatch --task ${worker.workspace.task} --to ${terminal.handle} --inject --json` })
		},
		complete(id: string, status = "completed") {
			tasks.find((task) => task.id === `task_${id}`).status = status
			dispatches[`task_${id}`].status = status
			terminals.splice(terminals.findIndex((terminal) => terminal.handle === dispatches[`task_${id}`].assignee_handle), 1)
		},
		cleanup() {
			r.events.get("agent_settled")()
			for (const [name, value] of Object.entries({ AGENT_TOOLKIT_PI_AGENT_DIR: prior.agentDir, AGENT_TOOLKIT_GRAPH_WORKSPACES: prior.workerFile, AGENT_TOOLKIT_GRAPH_TASK: prior.task })) value === undefined ? delete process.env[name] : process.env[name] = value
			rmSync(directory, { recursive: true, force: true })
		},
	}
}

test("two repositories complete through setup, native bash, scoped commits, integration, resume and local closeout", async () => {
	const f = fixture()
	try {
		await f.approve()
		await assert.rejects(f.prepare("b"), /prerequisite/)
		const a = await f.prepare("a")
		await assert.rejects(f.r.call("bash", { command: f.command(a) }), /setup command/)
		await f.launch(a)
		writeFileSync(join(a.workspace.path, "owned.txt"), "api implemented\n")
		await f.worker(a).call("checkpoint_task_graph", { paths: ["owned.txt"], message: "Implement API" })
		f.complete("a")
		await assert.rejects(f.prepare("b"), /Integrate prerequisite/)
		await f.r.call("integrate_task_graph_worker", { task_id: "task_a" })
		await f.resume()
		const b = await f.prepare("b")
		await assert.rejects(f.r.call("write", { path: join(b.repositories[f.sources[0]].path, "owned.txt"), content: "would move a prerequisite" }), /pinned prerequisite/)
		await assert.rejects(f.r.call("bash", { repository: b.repositories[f.sources[0]].path, command: "node inspect.cjs" }), /pinned prerequisite/)
		await f.launch(b)
		const worker = f.worker(b)
		const output = await worker.call("bash", { command: "node inspect.cjs" })
		const map = JSON.parse(output.content[0].text)
		assert.notEqual(map[f.sources[0]].path, f.sources[0])
		assert.equal(readFileSync(join(map[f.sources[0]].path, "owned.txt"), "utf8"), "api implemented\n")
		assert.equal(b.workspace.prerequisites[f.sources[0]], map[f.sources[0]].head)
		writeFileSync(join(b.workspace.path, "owned.txt"), "app implemented\n")
		await worker.call("checkpoint_task_graph", { paths: ["owned.txt"], message: "Implement app" })
		f.complete("b")
		await f.r.call("integrate_task_graph_worker", { task_id: "task_b" })
		const finished = await f.r.call("finish_task_graph", { run_id: f.run.id, evidence: "Two-repository fixture checks passed" })
		assert.equal(finished.details.status, "complete")
		assert.equal(finished.details.delivery, "not-authorized")
		for (const [index, source] of f.sources.entries()) {
			assert.equal(readFileSync(join(source, "owned.txt"), "utf8"), "baseline\n")
			assert.equal(graphGit(source, "rev-parse", "HEAD"), f.heads[index])
			assert.deepEqual(readFileSync(join(source, ".git/index")), f.indexes[index])
		}
	} finally { f.cleanup() }
})

test("native permission denial creates no launch intent; a lost receipt resumes the original terminal", async () => {
	const f = fixture()
	try {
		await f.approve()
		const a = await f.prepare("a")
		await f.r.call("bash", { repository: a.workspace.path, command: "node setup.cjs" })
		f.deny = true
		const count = f.shellCalls
		await assert.rejects(f.r.call("bash", { command: f.command(a) }), /permission denied/)
		assert.equal(f.shellCalls, count)
		assert.equal(readGraphWorkspaces(a.environment.AGENT_TOOLKIT_GRAPH_WORKSPACES).workers[0].launch, undefined)
		f.deny = false
		f.loseReceipt = true
		await assert.rejects(f.r.call("bash", { command: f.command(a) }), /Lost create receipt/)
		assert.ok(readGraphWorkspaces(a.environment.AGENT_TOOLKIT_GRAPH_WORKSPACES).workers[0].launch)
		await f.resume()
		const recovered = await f.prepare("a")
		assert.equal(recovered.workspace.terminal, f.terminals[0].handle)
		await assert.rejects(f.r.call("bash", { command: f.command(a) }), /fresh worker workspace/)
		assert.equal(f.terminals.length, 1)
	} finally { f.cleanup() }
})

test("plan-only workers cannot promote, commit implementation, or append shell commands to reporting", async () => {
	const f = fixture("plan-only")
	try {
		await f.approve()
		const a = await f.prepare("a")
		const worker = f.worker(a)
		for (const path of ["docs/script.ts", "docs/exec-plans/active/plan.md"]) await assert.rejects(worker.call("write", { path, content: "bad" }), /Planning-only/)
		for (const command of ["orca orchestration check --json; git push", "orca orchestration send --from other --subject hi", "printf data > ../source/owned.txt", "git add .", "git commit --amend --no-edit"]) await assert.rejects(worker.call("bash", { command }))
		mkdirSync(join(a.workspace.path, "docs"), { recursive: true })
		writeFileSync(join(a.workspace.path, "docs/script.ts"), "implementation\n")
		await assert.rejects(worker.call("checkpoint_task_graph", { paths: ["docs/script.ts"], message: "Not planning" }), /Planning-only/)
	} finally { f.cleanup() }
})

test("failed shell commands still validate ownership; current-checkout workers remain isolated", async () => {
	const f = fixture("execute", true)
	try {
		await f.approve()
		const a = await f.prepare("a")
		assert.notEqual(a.workspace.path, f.sources[0])
		writeFileSync(join(a.workspace.path, "unowned.txt"), "unexpected\n")
		await assert.rejects(f.worker(a).call("bash", { command: "node -e 'process.exit(1)'" }), /outside approved ownership/)
		assert.throws(() => assertGraphShell("git -C /elsewhere status", readGraphWorkspaces(a.environment.AGENT_TOOLKIT_GRAPH_WORKSPACES), a.workspace.path), /read-only/)
	} finally { f.cleanup() }
})

test("one failed, closed worker can be checkpointed and retried in place, never replaced twice", async () => {
	const f = fixture()
	try {
		await f.approve()
		const a = await f.prepare("a")
		await f.launch(a)
		await assert.rejects(f.r.call("prepare_task_graph_workspace", { task_id: "task_a", retry: true }), /failed, closed dispatch/)
		f.complete("a", "failed")
		writeFileSync(join(a.workspace.path, "owned.txt"), "retained partial work\n")
		await assert.rejects(f.r.call("prepare_task_graph_workspace", { task_id: "task_a", retry: true }), /clean retained worktree/)
		await f.r.call("checkpoint_task_graph", { repository: a.workspace.path, paths: ["owned.txt"], message: "Preserve failed worker progress" })
		const retry = JSON.parse((await f.r.call("prepare_task_graph_workspace", { task_id: "task_a", retry: true })).content[0].text)
		assert.equal(retry.workspace.path, a.workspace.path)
		assert.notEqual(retry.launchTitle, a.launchTitle)
		assert.equal(retry.workspace.setupComplete, false)
		await f.launch(retry)
		f.complete("a", "failed")
		await assert.rejects(f.r.call("prepare_task_graph_workspace", { task_id: "task_a", retry: true }), /no second replacement/)
	} finally { f.cleanup() }
})
