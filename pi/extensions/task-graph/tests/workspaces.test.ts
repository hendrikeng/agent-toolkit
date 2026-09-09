import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { captureGraphWorkspaces, checkpointGraphChanges, createGraphWorkspace, graphDirtyPaths, graphFile, graphGit, graphInput, graphWritePath, importGraphInputs, integrateGraphWorker, readGraphWorkspaces, saveGraphWorkspaces, verifyGraphChanges, verifyGraphWorkspace, type GraphWorkerWorkspace } from "../workspaces.ts"
import { taskGraphStandaloneOrca, type TaskGraphPlan } from "../task-graph-core.ts"

Object.assign(process.env, { GIT_AUTHOR_NAME: "Graph Test", GIT_AUTHOR_EMAIL: "graph@example.com", GIT_COMMITTER_NAME: "Graph Test", GIT_COMMITTER_EMAIL: "graph@example.com" })
const plan: TaskGraphPlan = { objective: "Fixture", mode: "execute", tasks: ["a", "b"].map((id) => ({ id, goal: id, repository: ".", depends_on: [], owns: [`src/${id}.ts`], specialty: "test", thinking: "medium", done_when: ["checked"], validation: "test" })) }

function fixture(branchPrefix = "") {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "graph-workspaces-")))
	const source = join(directory, "source")
	execFileSync("git", ["init", "--quiet", "--initial-branch=dev", source])
	mkdirSync(join(source, "docs/future"), { recursive: true })
	mkdirSync(join(source, "src"))
	writeFileSync(join(source, "docs/future/plan.md"), "original plan\n")
	writeFileSync(join(source, "src/a.ts"), "a\n")
	writeFileSync(join(source, "src/b.ts"), "b\n")
	graphGit(source, "add", "--", "docs", "src")
	graphGit(source, "commit", "-m", "baseline")
	const receipts: any[] = []
	let creates = 0
	const orca = (args: string[]) => {
		if (args[0] === "repo") return { result: { repos: [{ id: "registered-source", path: source }] } }
		assert.equal(args[args.indexOf("--repo") + 1], "id:registered-source")
		if (args[1] === "list") return { result: { worktrees: receipts } }
		assert.equal(args[1], "create")
		assert.equal(args[args.indexOf("--setup") + 1], "skip")
		assert.ok(args.includes("--no-parent"))
		const name = args[args.indexOf("--name") + 1]
		const base = args[args.indexOf("--base-branch") + 1]
		const path = join(directory, name)
		// This is an unregistered disposable Git fixture, not an Orca-managed user worktree.
		graphGit(source, "worktree", "add", "--quiet", "-b", `${branchPrefix}${name}`, path, base)
		const worktree = { id: `fixture::${path}`, path, branch: `refs/heads/${branchPrefix}${name}`, displayName: name }
		receipts.push(worktree)
		creates++
		return { result: { worktree } }
	}
	return { directory, source, orca, creates: () => creates, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

test("prefixed Orca branches recover a lost create receipt without creating another worktree", () => {
	const f = fixture("hendrikeng/")
	try {
		const state = captureGraphWorkspaces(f.source, plan)
		const repo = state.repositories[0]
		const manifest = join(f.directory, "state.json")
		const persist = () => saveGraphWorkspaces(manifest, state)
		assert.throws(() => createGraphWorkspace(repo, repo.workspace!, (args) => {
			const result = f.orca(args)
			if (args[1] === "create") throw new Error("Lost create receipt")
			return result
		}, persist), /Lost create receipt/)
		const recovered = readGraphWorkspaces(manifest)
		const restoredRepo = recovered.repositories[0]
		createGraphWorkspace(restoredRepo, restoredRepo.workspace!, f.orca, () => saveGraphWorkspaces(manifest, recovered))
		assert.equal(restoredRepo.workspace!.branch, `hendrikeng/${repo.workspace!.name}`)
		assert.equal(f.creates(), 1)
		verifyGraphWorkspace(restoredRepo, restoredRepo.workspace!, true)
		assert.throws(() => verifyGraphWorkspace(restoredRepo, { ...restoredRepo.workspace!, branch: "unexpected-branch" }), /branch changed/)
		assert.throws(() => createGraphWorkspace(repo, repo.workspace!, (args) => {
			const result = f.orca(args)
			return args[0] === "repo" ? result : { result: { worktrees: result.result.worktrees!.map((receipt) => ({ ...receipt, branch: "refs/heads/unexpected-branch" })) } }
		}, persist), /branch does not match its receipt/)
		assert.equal(f.creates(), 1)
	} finally { f.cleanup() }
})

test("retained worktree sources resolve through registered repositories without replacing their base or inputs", () => {
	const f = fixture("hendrikeng/")
	try {
		const original = captureGraphWorkspaces(f.source, plan).repositories[0]
		createGraphWorkspace(original, original.workspace!, f.orca, () => {})
		const retained = original.workspace!.path!
		writeFileSync(join(retained, "src/a.ts"), "retained implementation\n")
		graphGit(retained, "add", "--", "src/a.ts")
		graphGit(retained, "commit", "-m", "Retained progress", "--", "src/a.ts")
		const base = graphGit(retained, "rev-parse", "HEAD")
		assert.notEqual(base, graphGit(f.source, "rev-parse", "HEAD"))
		writeFileSync(join(retained, "docs/future/plan.md"), "retained approved input\n")
		const state = captureGraphWorkspaces(retained, plan, [{ paths: ["docs/future/plan.md"] }])
		const repo = state.repositories[0]
		const manifest = join(f.directory, "retained.json")
		assert.throws(() => createGraphWorkspace(repo, repo.workspace!, (args) => {
			const result = f.orca(args)
			if (args[0] === "worktree" && args[1] === "create") throw new Error("Lost receipt")
			return result
		}, () => saveGraphWorkspaces(manifest, state)), /Lost receipt/)
		const recovered = readGraphWorkspaces(manifest)
		const restored = recovered.repositories[0]
		const persist = () => saveGraphWorkspaces(manifest, recovered)
		createGraphWorkspace(restored, restored.workspace!, f.orca, persist)
		assert.equal(f.creates(), 2, "Resume must reuse the worktree created before the lost receipt")
		assert.equal(restored.source, retained)
		assert.equal(graphGit(restored.workspace!.path!, "rev-parse", "HEAD"), base)
		importGraphInputs(restored, persist)
		assert.equal(readFileSync(join(restored.workspace!.path!, "src/a.ts"), "utf8"), "retained implementation\n")
		assert.equal(readFileSync(join(restored.workspace!.path!, "docs/future/plan.md"), "utf8"), "retained approved input\n")
		assert.equal(graphGit(retained, "rev-parse", "HEAD"), base)
		assert.equal(readFileSync(join(retained, "docs/future/plan.md"), "utf8"), "retained approved input\n")
		assert.equal(graphGit(f.source, "rev-parse", "HEAD"), original.base)
		assert.equal(readFileSync(join(f.source, "docs/future/plan.md"), "utf8"), "original plan\n")
	} finally { f.cleanup() }
})

test("repository resolution rejects missing, ambiguous and incomplete Orca registrations before creation", () => {
	const f = fixture()
	try {
		const repo = captureGraphWorkspaces(f.source, plan).repositories[0]
		for (const result of [
			{ repos: [] },
			{ repos: [{ id: "a", path: f.source }, { id: "b", path: f.source }] },
			{ repos: [{ id: "a", path: f.source }], truncated: true },
			{ repos: [{ id: "a", path: f.source }], hostScope: { omittedHostIds: ["offline"] } },
		]) assert.throws(() => createGraphWorkspace(repo, repo.workspace!, (args) => {
			assert.deepEqual(args, ["repo", "list", "--json"])
			return { result }
		}, () => {}), /exactly one registered Orca repository|inventory is incomplete/)
		assert.equal(f.creates(), 0)
	} finally { f.cleanup() }
})

test("captures only approved working-file bytes, preserving source branch, index and unrelated dirty files", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, "docs/future/plan.md"), "staged plan\n")
		graphGit(f.source, "add", "--", "docs/future/plan.md")
		writeFileSync(join(f.source, "docs/future/plan.md"), "approved working plan\n")
		writeFileSync(join(f.source, "docs/future/new.md"), "new plan\n")
		writeFileSync(join(f.source, "unrelated.sql"), "user owned\n")
		const index = readFileSync(join(f.source, ".git/index"))
		const status = graphGit(f.source, "status", "--porcelain=v1")
		const base = graphGit(f.source, "rev-parse", "HEAD")
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["docs/future/plan.md", "docs/future/new.md"] }])
		const manifest = join(f.directory, "state.json")
		const persist = () => saveGraphWorkspaces(manifest, state)
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, persist)
		importGraphInputs(repo, persist)
		const destination = repo.workspace!.path!
		assert.equal(readFileSync(join(destination, "docs/future/plan.md"), "utf8"), "approved working plan\n")
		assert.equal(readFileSync(join(destination, "docs/future/new.md"), "utf8"), "new plan\n")
		assert.equal(existsSync(join(destination, "unrelated.sql")), false)
		assert.equal(graphGit(f.source, "rev-parse", "HEAD"), base)
		assert.equal(graphGit(f.source, "rev-parse", "--abbrev-ref", "HEAD"), "dev")
		assert.equal(graphGit(f.source, "status", "--porcelain=v1"), status)
		assert.deepEqual(readFileSync(join(f.source, ".git/index")), index)
		assert.deepEqual(graphDirtyPaths(destination), [])
		const recovered = readGraphWorkspaces(manifest)
		writeFileSync(join(f.source, "docs/future/new.md"), "later user edits\n")
		createGraphWorkspace(recovered.repositories[0], recovered.repositories[0].workspace!, f.orca, () => {})
		assert.equal(f.creates(), 1)
		assert.equal(readFileSync(join(destination, "docs/future/new.md"), "utf8"), "new plan\n", "resume must not recopy newer source files")
		assert.throws(() => graphWritePath(state, join(f.source, "src/a.ts")), /isolated workspace/)
	} finally { f.cleanup() }
})

test("input races, symlinks, traversal, ignored inputs and interrupted capture fail closed", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, "docs/future/plan.md"), "approved\n")
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["docs/future/plan.md"] }])
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		writeFileSync(join(f.source, "docs/future/plan.md"), "changed during approval\n")
		assert.throws(() => importGraphInputs(repo, () => {}), /input changed/)
		assert.equal(readFileSync(join(repo.workspace!.path!, "docs/future/plan.md"), "utf8"), "original plan\n")
		for (const path of ["../outside", ".git/config", "docs/../../outside", "docs/*", ".env", ".env.production"]) assert.throws(() => graphFile(f.source, path), /literal repository-relative/)
		symlinkSync(join(f.directory, "outside"), join(f.source, "docs/future/link.md"))
		assert.throws(() => graphInput(f.source, "docs/future/link.md"), /regular file/)
		assert.throws(() => captureGraphWorkspaces(f.source, plan, [{ paths: ["src/a.ts"] }]), /selected dirty/)
		assert.throws(() => captureGraphWorkspaces(f.source, plan, [], true), /clean repositories/)
		repo.workspace!.phase = "capturing"
		assert.throws(() => createGraphWorkspace(repo, repo.workspace!, f.orca, () => {}), /preparation is incomplete/)
		assert.equal(f.creates(), 1)
	} finally { f.cleanup() }
})

test("worker identity and ownership are checked, integration is replayable and dependents inherit results", () => {
	const f = fixture()
	try {
		const state = captureGraphWorkspaces(f.source, plan)
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		importGraphInputs(repo, () => {})
		const worker: GraphWorkerWorkspace = { task: "task_a", approvedTask: "a", source: f.source, owns: ["src/a.ts"], name: "worker-a", base: graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), phase: "creating" }
		state.workers.push(worker)
		createGraphWorkspace(repo, worker, f.orca, () => {})
		verifyGraphWorkspace(repo, worker, true)
		assert.throws(() => verifyGraphWorkspace(repo, { ...worker, branch: "wrong" }), /branch changed/)
		assert.throws(() => graphWritePath(state, join(worker.path!, "src/b.ts"), worker), /does not own/)
		writeFileSync(join(worker.path!, "src/a.ts"), "implemented\n")
		graphGit(worker.path!, "add", "--", "src/a.ts")
		graphGit(worker.path!, "commit", "-m", "implement a", "--", "src/a.ts")
		assert.throws(() => verifyGraphWorkspace(repo, worker, true), /starting commit changed/)
		writeFileSync(join(worker.path!, "outside.txt"), "unexpected\n")
		assert.throws(() => verifyGraphChanges(repo, worker, worker.owns), /outside approved ownership/)
		rmSync(join(worker.path!, "outside.txt"))
		integrateGraphWorker(state, worker, () => {})
		const integrated = graphGit(repo.workspace!.path!, "rev-parse", "HEAD")
		worker.integrated = undefined // Simulate a crash after Git merged but before the receipt was persisted.
		integrateGraphWorker(state, worker, () => {})
		assert.equal(graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), integrated)
		const dependent = { ...worker, task: "task_b", name: "worker-b", base: integrated, path: undefined, branch: undefined, id: undefined, integrated: undefined, integration: undefined, phase: "creating" as const }
		createGraphWorkspace(repo, dependent, f.orca, () => {})
		assert.equal(readFileSync(join(dependent.path!, "src/a.ts"), "utf8"), "implemented\n")
		assert.equal(readFileSync(join(f.source, "src/a.ts"), "utf8"), "a\n")
	} finally { f.cleanup() }
})

test("planning-only work stays in Markdown; read-only work needs no worktree; Orca commands cannot chain shells", () => {
	const f = fixture()
	try {
		const readonly = captureGraphWorkspaces(f.source, { ...plan, tasks: plan.tasks.map((task) => ({ ...task, owns: [] })) })
		assert.ok(readonly.repositories.every((repo) => !repo.workspace))
		const planning = captureGraphWorkspaces(f.source, { ...plan, mode: "plan-only", tasks: plan.tasks.map((task) => ({ ...task, owns: ["docs/"] })) })
		const repo = planning.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		importGraphInputs(repo, () => {})
		graphWritePath(planning, join(repo.workspace!.path!, "docs/future/new.md"))
		assert.throws(() => graphWritePath(planning, join(repo.workspace!.path!, "src/a.ts")), /Planning-only/)
		assert.throws(() => graphWritePath(planning, join(repo.workspace!.path!, "docs/script.ts")), /Planning-only/)
		assert.equal(taskGraphStandaloneOrca("orca status --json"), true)
		for (const command of ["orca status; touch source", "orca status && git push", "orca status > source", "orca status $(touch source)", "echo ok; orca status"]) assert.equal(taskGraphStandaloneOrca(command), false)
	} finally { f.cleanup() }
})

test("capture resumes immutable approved bytes after partial copies and a lost final receipt, without hooks", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, "docs/future/plan.md"), "approved plan\n")
		writeFileSync(join(f.source, "src/a.ts"), "approved source\n")
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["docs/future/plan.md", "src/a.ts"] }])
		const repo = state.repositories[0]
		const file = join(f.directory, "state.json")
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => saveGraphWorkspaces(file, state))
		writeFileSync(join(f.source, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 91\n", { mode: 0o755 })
		assert.throws(() => importGraphInputs(repo, () => { saveGraphWorkspaces(file, state); if (repo.workspace!.phase === "capturing") throw new Error("crash after snapshot") }), /crash after snapshot/)
		assert.ok(repo.captureCommit)
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "approved source\n") // One copy finished before the crash.
		writeFileSync(join(f.source, "src/a.ts"), "later user edit\n")
		writeFileSync(join(f.source, "docs/future/plan.md"), "later user plan\n")
		const recovered = readGraphWorkspaces(file)
		assert.throws(() => importGraphInputs(recovered.repositories[0], () => {
			if (recovered.repositories[0].captureComplete) throw new Error("crash before completion receipt")
			saveGraphWorkspaces(file, recovered)
		}), /completion receipt/)
		const replayed = readGraphWorkspaces(file)
		importGraphInputs(replayed.repositories[0], () => saveGraphWorkspaces(file, replayed))
		assert.equal(replayed.repositories[0].captureComplete, true)
		assert.equal(readFileSync(join(repo.workspace!.path!, "docs/future/plan.md"), "utf8"), "approved plan\n")
		assert.equal(readFileSync(join(repo.workspace!.path!, "src/a.ts"), "utf8"), "approved source\n")
		assert.equal(readFileSync(join(f.source, "src/a.ts"), "utf8"), "later user edit\n")
		assert.deepEqual(graphDirtyPaths(repo.workspace!.path!), [])
	} finally { f.cleanup() }
})

test("capture recovery refuses a third destination version and preserves executable/deleted inputs", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, "src/a.ts"), "approved\n")
		chmodSync(join(f.source, "src/a.ts"), 0o755)
		rmSync(join(f.source, "src/b.ts"))
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["src/a.ts", "src/b.ts"] }])
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		assert.throws(() => importGraphInputs(repo, () => { if (repo.workspace!.phase === "capturing") throw new Error("crash") }), /crash/)
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "someone else's work\n")
		assert.throws(() => importGraphInputs(repo, () => {}), /changed destination/)
		assert.equal(readFileSync(join(repo.workspace!.path!, "src/a.ts"), "utf8"), "someone else's work\n")
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "a\n") // Explicit fixture reconciliation, never automatic rollback.
		importGraphInputs(repo, () => {})
		assert.equal(graphInput(repo.workspace!.path!, "src/a.ts").executable, true)
		assert.equal(existsSync(join(repo.workspace!.path!, "src/b.ts")), false)
	} finally { f.cleanup() }
})

test("capture preserves a third staged version even when the working file matches approval", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, "src/a.ts"), "approved\n")
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["src/a.ts"] }])
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		assert.throws(() => importGraphInputs(repo, () => { if (repo.workspace!.phase === "capturing") throw new Error("crash") }), /crash/)
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "third staged version\n")
		graphGit(repo.workspace!.path!, "add", "--", "src/a.ts")
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "approved\n")
		assert.throws(() => importGraphInputs(repo, () => {}), /changed index/)
		assert.equal(graphGit(repo.workspace!.path!, "show", ":src/a.ts"), "third staged version")
	} finally { f.cleanup() }
})

test("CRLF capture resumes exact approved working bytes with a clean normalized Git checkpoint", () => {
	const f = fixture()
	try {
		writeFileSync(join(f.source, ".gitattributes"), "docs/future/plan.md text eol=crlf\n")
		graphGit(f.source, "add", "--", ".gitattributes")
		graphGit(f.source, "commit", "-m", "Declare CRLF checkout", "--", ".gitattributes")
		const approved = Buffer.from("approved draft\r\nsecond line\r\n")
		writeFileSync(join(f.source, "docs/future/plan.md"), approved)
		const state = captureGraphWorkspaces(f.source, plan, [{ paths: ["docs/future/plan.md"] }])
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		assert.match(readFileSync(join(repo.workspace!.path!, "docs/future/plan.md"), "utf8"), /\r\n/)
		assert.throws(() => importGraphInputs(repo, () => { if (!repo.captureCheckpoint) throw new Error("capture interrupted") }), /interrupted/)
		writeFileSync(join(f.source, "docs/future/plan.md"), "later user bytes\r\n")
		importGraphInputs(repo, () => {})
		assert.deepEqual(readFileSync(join(repo.workspace!.path!, "docs/future/plan.md")), approved)
		assert.deepEqual(execFileSync("git", ["-C", repo.workspace!.path!, "show", `${repo.captureCommit}:docs/future/plan.md`]), approved)
		assert.notEqual(repo.captureCheckpoint, repo.captureCommit)
		assert.deepEqual(graphDirtyPaths(repo.workspace!.path!), [])
		assert.equal(graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), repo.captureCheckpoint)
	} finally { f.cleanup() }
})

test("integration rejects out-of-scope history even when the final tree hides it", () => {
	const f = fixture()
	try {
		const state = captureGraphWorkspaces(f.source, plan)
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		importGraphInputs(repo, () => {})
		const worker: GraphWorkerWorkspace = { task: "task_a", approvedTask: "a", source: f.source, owns: ["src/a.ts"], name: "worker-history", base: graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), phase: "creating" }
		state.workers.push(worker)
		createGraphWorkspace(repo, worker, f.orca, () => {})
		for (const text of ["out of scope\n", "b\n"]) {
			writeFileSync(join(worker.path!, "src/b.ts"), text)
			graphGit(worker.path!, "add", "--", "src/b.ts")
			graphGit(worker.path!, "commit", "-m", "history fixture", "--", "src/b.ts")
		}
		assert.equal(graphGit(worker.path!, "diff", worker.base, "HEAD"), "")
		assert.throws(() => integrateGraphWorker(state, worker, () => {}), /outside approved ownership/)
		assert.equal(graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), worker.base)
	} finally { f.cleanup() }
})

test("conflicting integration can stage explicit resolutions and finish the same recorded merge", () => {
	const f = fixture()
	try {
		const state = captureGraphWorkspaces(f.source, plan)
		const repo = state.repositories[0]
		createGraphWorkspace(repo, repo.workspace!, f.orca, () => {})
		importGraphInputs(repo, () => {})
		const worker: GraphWorkerWorkspace = { task: "task_a", approvedTask: "a", source: f.source, owns: ["src/a.ts"], name: "worker-conflict", base: graphGit(repo.workspace!.path!, "rev-parse", "HEAD"), phase: "creating" }
		state.workers.push(worker)
		createGraphWorkspace(repo, worker, f.orca, () => {})
		writeFileSync(join(worker.path!, "src/a.ts"), "worker\n")
		checkpointGraphChanges(repo, worker, worker.owns, state.mode, ["src/a.ts"], "Worker change")
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "coordinator\n")
		checkpointGraphChanges(repo, repo.workspace!, worker.owns, state.mode, ["src/a.ts"], "Coordinator change")
		assert.throws(() => integrateGraphWorker(state, worker, () => {}))
		const attempt = structuredClone(worker.integration)
		writeFileSync(join(repo.workspace!.path!, "src/a.ts"), "resolved\n")
		checkpointGraphChanges(repo, repo.workspace!, worker.owns, state.mode, ["src/a.ts"], "Stage resolution")
		integrateGraphWorker(state, worker, () => {})
		assert.deepEqual(worker.integration, attempt)
		assert.equal(worker.integrated, graphGit(worker.path!, "rev-parse", "HEAD"))
		assert.deepEqual(graphDirtyPaths(repo.workspace!.path!), [])
		assert.equal(readFileSync(join(repo.workspace!.path!, "src/a.ts"), "utf8"), "resolved\n")
	} finally { f.cleanup() }
})
