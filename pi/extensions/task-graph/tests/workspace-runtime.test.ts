import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { repositoryIdentity } from "../task-graph-core.ts"
import { graphGit } from "../workspaces.ts"

test("runtime gates approval, worker placement, dependency integration, source writes and resumed input capture", async () => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "graph-runtime-")))
	const source = join(directory, "source")
	const agentDir = join(directory, "agent")
	const oldAgentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR
	const globals = globalThis as any
	const hooks = registerHooks({
		resolve(specifier, context, next) {
			if (!context.parentURL?.endsWith("/task-graph/index.ts")) return next(specifier, context)
			const mocks: Record<string, string> = {
				"@earendil-works/pi-coding-agent": `export const createBashTool = () => { throw new Error('Unexpected shell execution'); }; export const getAgentDir = () => ${JSON.stringify(agentDir)}; export const isToolCallEventType = (type, event) => event.toolName === type;`,
				"typebox": "export const Type = new Proxy({}, {get: () => (...args) => ({})});",
				"../codex-account/index.ts": "export const defaultPiAccount = () => undefined; export const fetchCodexUsage = () => undefined; export const piAccountEmail = () => undefined; export const piProfileAccountId = () => undefined;",
				"node:child_process": "export const execFileSync = (_command, args) => globalThis.graphWorkspaceRpc(args);",
			}
			return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context)
		},
	})
	let settle: (() => void) | undefined
	try {
		Object.assign(process.env, { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com", AGENT_TOOLKIT_PI_AGENT_DIR: agentDir })
		execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source])
		mkdirSync(join(source, "docs/future"), { recursive: true })
		mkdirSync(join(source, "src"))
		writeFileSync(join(source, "docs/future/input.md"), "original\n")
		writeFileSync(join(source, "src/a.ts"), "a\n")
		writeFileSync(join(source, "src/b.ts"), "b\n")
		graphGit(source, "add", "--", "docs", "src")
		graphGit(source, "commit", "-m", "baseline")
		writeFileSync(join(source, "docs/future/input.md"), "approved draft\n")
		const sourceIndex = readFileSync(join(source, ".git/index"))
		const run = { id: "run_fixture", objective: `Pi task graph: ${repositoryIdentity(source)}::objective:Fixture` }
		const tasks: any[] = []
		const terminals: any[] = []
		const dispatches: Record<string, any> = {}
		const worktrees: any[] = []
		globals.graphWorkspaceRpc = (args: string[]) => {
			let result: any
			switch (args.slice(0, 2).join(" ")) {
				case "repo list": result = { repos: [{ id: "registered-source", path: source }] }; break
				case "orchestration run-list": result = { runs: [run] }; break
				case "orchestration run-show": case "orchestration run-use": result = { run }; break
				case "orchestration task-list": result = { tasks }; break
				case "orchestration dispatch-show": result = { dispatch: dispatches[args[args.indexOf("--task") + 1]] }; break
				case "orchestration worker-list": result = { workers: Object.values(dispatches).map((dispatch: any) => ({ taskId: dispatch.task_id, dispatchId: dispatch.id, runId: run.id, dispatchStatus: dispatch.status, agentTerminalHandle: dispatch.assignee_handle })) }; break
				case "terminal list": result = { terminals }; break
				case "terminal show": result = { terminal: terminals.find((terminal) => terminal.handle === args[args.indexOf("--terminal") + 1]) }; break
				case "worktree list": assert.equal(args[args.indexOf("--repo") + 1], "id:registered-source"); result = { worktrees }; break
				case "worktree create": {
					assert.equal(args[args.indexOf("--repo") + 1], "id:registered-source")
					const name = args[args.indexOf("--name") + 1]
					const base = args[args.indexOf("--base-branch") + 1]
					const path = join(directory, name)
					graphGit(source, "worktree", "add", "--quiet", "-b", name, path, base)
					const worktree = { id: `fixture::${path}`, path, branch: `refs/heads/${name}`, displayName: name }
					worktrees.push(worktree)
					result = { worktree }
					break
				}
				default: throw new Error(`Unexpected RPC: ${args.join(" ")}`)
			}
			return JSON.stringify({ ok: true, result })
		}
		const { default: extension } = await import("../index.ts")
		function runtime() {
			const tools = new Map<string, any>(), commands = new Map<string, any>(), events = new Map<string, any>()
			extension({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command), on: (name: string, handler: any) => events.set(name, handler), sendUserMessage: (prompt: string) => events.get("before_agent_start")({ prompt }) } as never)
			return { tools, commands, events }
		}
		let r = runtime()
		settle = () => r.events.get("agent_settled")()
		const ctx = { cwd: source, hasUI: true, isIdle: () => true, model: { provider: "test", id: "model" }, ui: { select: async () => "Approve and execute", confirm: async () => true, notify: (message: string) => { throw new Error(message) } } }
		const candidate = { objective: "Fixture", mode: "execute", inputs: [{ paths: ["docs/future/input.md"] }], tasks: ["a", "b"].map((id) => ({ id, goal: id, depends_on: id === "b" ? ["a"] : [], owns: [`src/${id}.ts`, ...(id === "a" ? ["docs/future/input.md"] : [])], specialty: "test", thinking: "medium", done_when: ["checked"], validation: "test" })) }
		const call = (name: string, params: any) => r.tools.get(name).execute(name, params, undefined, undefined, ctx)
		const gate = (toolName: string, input: any, toolCallId = "fixture") => r.events.get("tool_call")({ toolName, input, toolCallId }, ctx)
		await r.commands.get("graph").handler("Fixture", ctx)
		assert.equal((await gate("write", { path: "source.ts" })).block, true)
		const approved = await call("propose_task_graph", candidate)
		await assert.rejects(call("prepare_task_graph_workspace", {}), /Approve and bind/)
		await call("bind_task_graph_run", { run_id: run.id })
		await assert.rejects(gate("write", { path: join(source, "src/a.ts") }), /isolated workspace/)
		assert.equal((await gate("bash", { command: "git status" })).block, true)
		assert.equal((await gate("bash", { command: "orca status; git push" })).block, true)
		assert.equal((await gate("bash", { command: "orca terminal send --terminal user --text dangerous --enter" })).block, true)
		await call("prepare_task_graph_workspace", {})
		for (const task of approved.details.plan.tasks) tasks.push({ id: `task_${task.id}`, parent_id: null, run_id: run.id, status: "ready", deps: JSON.stringify(task.depends_on.map((id: string) => `task_${id}`)), spec: `[graph-task:${task.id}][graph-contract:${createHash("sha256").update(JSON.stringify(task)).digest("hex")}]\n${task.goal}` })
		await assert.rejects(call("prepare_task_graph_workspace", { task_id: "task_b" }), /prerequisite/)
		const prepared = await call("prepare_task_graph_workspace", { task_id: "task_a" })
		const a = prepared.details.workspace
		const environment = JSON.parse(prepared.content[0].text).environment
		const assignments = Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")
		const command = `orca terminal create --worktree id:${a.id} --title ${JSON.parse(prepared.content[0].text).launchTitle} --command '${assignments} pi-yolo --model test/model --thinking medium' --json`
		assert.equal((await gate("bash", { command: command.replace(`id:${a.id}`, "active") })).block, true)
		assert.equal((await gate("bash", { command: command.replace("--thinking medium", "--thinking high") })).block, true)
		assert.equal((await gate("bash", { command: command.replace("--thinking medium", "--thinking medium --no-extensions") })).block, true)
		assert.equal(await gate("bash", { command }, "launch"), undefined)
		terminals.push({ handle: "term_a", worktreePath: a.path })
		await r.events.get("tool_result")({ toolCallId: "launch", input: { command }, isError: false, content: [{ type: "text", text: JSON.stringify({ result: { terminal: terminals[0] } }) }] })
		const dispatchCommand = "orca orchestration dispatch --task task_a --to term_a --inject --json"
		terminals[0].worktreePath = source
		assert.equal((await gate("bash", { command: dispatchCommand })).block, true)
		terminals[0].worktreePath = a.path
		assert.equal(await gate("bash", { command: dispatchCommand }), undefined)
		dispatches.task_a = { id: "dispatch_a", task_id: "task_a", run_id: run.id, status: "completed", assignee_handle: "term_a" }
		tasks[0].status = "completed"
		await assert.rejects(call("prepare_task_graph_workspace", { task_id: "task_b" }), /Integrate prerequisite/)
		writeFileSync(join(a.path, "src/a.ts"), "implemented\n")
		graphGit(a.path, "add", "--", "src/a.ts")
		graphGit(a.path, "commit", "-m", "worker a", "--", "src/a.ts")
		terminals.length = 0
		await call("integrate_task_graph_worker", { task_id: "task_a" })
		const b = (await call("prepare_task_graph_workspace", { task_id: "task_b" })).details.workspace
		assert.equal(readFileSync(join(b.path, "src/a.ts"), "utf8"), "implemented\n")
		const count = worktrees.length
		terminals.length = 0
		settle()
		r = runtime()
		await r.commands.get("graph").handler("Fixture", ctx)
		await call("propose_task_graph", candidate)
		await call("bind_task_graph_run", { run_id: run.id })
		writeFileSync(join(source, "docs/future/input.md"), "later user draft\n")
		await call("prepare_task_graph_workspace", {})
		assert.equal((await call("prepare_task_graph_workspace", { task_id: "task_b" })).details.workspace.path, b.path)
		assert.equal(worktrees.length, count)
		assert.equal(readFileSync(join(b.path, "docs/future/input.md"), "utf8"), "approved draft\n")
		assert.deepEqual(readFileSync(join(source, ".git/index")), sourceIndex)

		// A plan chain resumes its isolated lifecycle, not the stale future file left in the source checkout.
		settle()
		const markdown = "## Metadata\n\n- Plan-ID: plan-a\n- Status: ready-for-promotion\n- Priority: p1\n- Dependencies: none\n- Security-Approval: not-required\n- Acceptance-Criteria: fixture accepted\n- Validation-Lanes: always\n- Risk-Tier: low\n- Spec-Targets: docs/future/plan.md\n- Implementation-Targets: src/a.ts\n"
		writeFileSync(join(source, "docs/future/plan.md"), markdown)
		run.id = "run_chain"
		run.objective = `Pi plan chain: ${repositoryIdentity(source)}::plan:plan-a`
		tasks.length = 0
		delete dispatches.task_a
		r = runtime()
		const chain = { ...candidate, objective: "Plan A", inputs: [{ paths: ["docs/future/plan.md"] }], tasks: [{ ...candidate.tasks[0], id: "plan-a" }] }
		await r.commands.get("graph").handler("docs/future/plan.md", ctx)
		const chainApproval = await call("propose_task_graph", chain)
		await call("bind_task_graph_run", { run_id: run.id })
		const coordinator = (await call("prepare_task_graph_workspace", {})).details.workspaces.repositories[0].workspace.path
		const approvedTask = chainApproval.details.plan.tasks[0]
		tasks.push({ id: "task_plan", run_id: run.id, parent_id: null, status: "completed", deps: "[]", spec: `[plan:plan-a][graph-contract:${createHash("sha256").update(JSON.stringify(approvedTask)).digest("hex")}]\nPlan A` })
		mkdirSync(join(coordinator, "docs/exec-plans/active"), { recursive: true })
		renameSync(join(coordinator, "docs/future/plan.md"), join(coordinator, "docs/exec-plans/active/plan.md"))
		writeFileSync(join(coordinator, "docs/exec-plans/active/plan.md"), markdown.replace("ready-for-promotion", "completed"))
		graphGit(coordinator, "add", "--", "docs")
		graphGit(coordinator, "commit", "-m", "fixture lifecycle closeout", "--", "docs")
		settle()
		r = runtime()
		await r.commands.get("graph").handler("docs/future/plan.md", ctx)
		await call("propose_task_graph", chainApproval.details.plan)
		await call("bind_task_graph_run", { run_id: run.id })
		await call("prepare_task_graph_workspace", {})
		await call("recover_plan_lifecycle", {})
		assert.equal((await call("finish_task_graph", { run_id: run.id, evidence: "fixture lifecycle recovery" })).details.status, "complete")
		assert.equal(readFileSync(join(source, "docs/future/plan.md"), "utf8"), markdown)
		assert.deepEqual(readFileSync(join(source, ".git/index")), sourceIndex)

		// Publication is separate authority: close local work without pretending the product shipped.
		run.id = "run_delivery"
		tasks.length = 0
		r = runtime()
		await r.commands.get("graph").handler("docs/future/plan.md", ctx)
		const deliveryApproval = await call("propose_task_graph", chain)
		await call("bind_task_graph_run", { run_id: run.id })
		const deliveryRoot = (await call("prepare_task_graph_workspace", {})).details.workspaces.repositories[0].workspace.path
		const deliveryTask = deliveryApproval.details.plan.tasks[0]
		tasks.push({ id: "task_delivery", run_id: run.id, parent_id: null, status: "completed", deps: "[]", spec: `[plan:plan-a][graph-contract:${createHash("sha256").update(JSON.stringify(deliveryTask)).digest("hex")}]\nPlan A` })
		const evidencePath = "docs/exec-plans/evidence-index/plan-a.md"
		assert.equal(await gate("write", { path: join(deliveryRoot, evidencePath) }), undefined)
		mkdirSync(join(deliveryRoot, "docs/exec-plans/active"), { recursive: true })
		mkdirSync(join(deliveryRoot, "docs/exec-plans/evidence-index"), { recursive: true })
		renameSync(join(deliveryRoot, "docs/future/plan.md"), join(deliveryRoot, "docs/exec-plans/active/plan.md"))
		writeFileSync(join(deliveryRoot, "docs/exec-plans/active/plan.md"), markdown.replace("ready-for-promotion", "validation"))
		writeFileSync(join(deliveryRoot, evidencePath), "Local fixture passed. Publication pending.\n")
		await call("checkpoint_task_graph", { repository: deliveryRoot, paths: ["docs/future/plan.md", "docs/exec-plans/active/plan.md", evidencePath], message: "Record local readiness" })
		await assert.rejects(call("finish_task_graph", { run_id: run.id, evidence: "Not shipped" }), /local closeout/)
		const local = await call("finish_task_graph", { run_id: run.id, evidence: "Local fixture passed; publication pending", delivery_pending: true })
		assert.equal(local.details.status, "local-ready")
		assert.equal(local.details.workspaces.completion.deliveryPending, true)
		assert.match(readFileSync(join(deliveryRoot, "docs/exec-plans/active/plan.md"), "utf8"), /Status: validation/)
	} finally {
		settle?.()
		hooks.deregister()
		delete globals.graphWorkspaceRpc
		if (oldAgentDir === undefined) delete process.env.AGENT_TOOLKIT_PI_AGENT_DIR
		else process.env.AGENT_TOOLKIT_PI_AGENT_DIR = oldAgentDir
		rmSync(directory, { recursive: true, force: true })
	}
})
