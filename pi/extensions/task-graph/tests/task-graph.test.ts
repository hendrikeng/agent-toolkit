import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { acquireLease, assertGraphMode, assertGraphShell, assertNoLegacyGraph, digest, LEGACY_GRAPH, literalPath, taskGraphPrompt } from "../task-graph-core.ts"

function scratch() {
 const root = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || join(homedir(), "Code/.agent-toolkit-scratch")
 mkdirSync(root, { recursive: true, mode: 0o700 })
 return mkdtempSync(join(root, "graph-core-"))
}
test("literal ownership and planning boundary", () => {
 for (const path of ["src/file.ts", "docs/future/plan.md", ".env.example"]) assert.doesNotThrow(() => literalPath(path))
 for (const path of [".", "../secret", "/etc/file", "src/../file", "src//file", "src/*.ts", "src/[file]", ".git/config", "docs/.git/config", ".env", ".env.local", "key.pem", "secret.key", ".netrc", "foo\0bar"]) assert.throws(() => literalPath(path), /literal/)
 assert.doesNotThrow(() => assertGraphMode("plan-only", "docs/future/plan.md"))
 for (const path of ["src/code.ts", "docs/code.ts", "docs/exec-plans/active/plan.md", "docs/EXEC-PLANS/active/plan.md", "docs/exec-plans/completed/plan.md"]) assert.throws(() => assertGraphMode("plan-only", path), /Planning-only/)
})
test("approved command grammar blocks adjacent shell, environment, selectors and publishing forms", () => {
 for (const command of ["node check.cjs", "node 'check file.cjs'", "npm 'run' 'verify:full'", "pnpm test", "npm run verify:full", "cargo test", "uv run pytest", "uv run --locked pytest -q", "uv sync --locked", "make check"]) assert.doesNotThrow(() => assertGraphShell(command))
 for (const command of ["node check.cjs; git push", "node check.cjs && node other.cjs", "node check.cjs\ngit push", "node $(git push)", "node `git push`", "node check.cjs > ../file", "node check.cjs | tee file", "NODE_OPTIONS=evil node check.cjs", "env node check.cjs", "command node check.cjs", "bash -c 'node check.cjs'", "node -e 'process.exit()'", "node --import=evil check.cjs", "node --require evil check.cjs", "pnpm --dir ../repo test", "pnpm --config=evil test", "npm --prefix=/elsewhere test", "npm publish", "uv run python -c 'print(1)'", "uv run sh -c 'gh pr create'", "uv run --locked sh script.sh", "uv --offline run sh script.sh", "uv tool run sh script.sh", "npm explore package -- sh script.sh", "npm 'publish'", "npm 'pub'", "node '--eval' 'process.exit(0)'", "node '-e0'", "node -e0", "node -rmodule check.cjs", "node '../source/check.cjs'", "npm '--prefix=/elsewhere' test", "pnpm 'exec' gh pr create", "pnpm exec gh pr create", "pnpm dlx tool", "git status", "git -C repo status", "git -c alias.x=push x", "gh repo view", "gh api -X POST /repo", "orca orchestration dispatch --task x", "/usr/bin/git push", "rm file", "node ../source/check.cjs", "node \"unterminated"]) assert.throws(() => assertGraphShell(command), undefined, command)
})
test("legacy evidence remains unchanged; unrelated known scope is neither resumed nor presumed settled", () => {
 const root = scratch(), locks = join(root, "task-graph-locks")
 const directory = join(locks, `${digest("legacy")}.lock`)
 mkdirSync(directory, { recursive: true })
 const file = join(directory, "workspaces.json")
 const bytes = JSON.stringify({ version: 1, repositories: [{ identity: "/other/repo/.git" }], workers: [{ terminal: "live-worker" }] })
 writeFileSync(file, bytes)
 assert.doesNotThrow(() => assertNoLegacyGraph(root, ["/selected/repo/.git"]))
 assert.throws(() => assertNoLegacyGraph(root, ["/other/repo/.git"]), error => String(error).includes(LEGACY_GRAPH))
 assert.equal(readFileSync(file, "utf8"), bytes)
 writeFileSync(file, "{}")
 assert.throws(() => assertNoLegacyGraph(root, ["/selected/repo/.git"]), /Unsupported legacy/)
 assert.equal(readFileSync(file, "utf8"), "{}")
})
test("coordinator lease excludes live writers and resumes an exited process without deleting records", () => {
 const root = scratch(), file = join(root, "record.json")
 writeFileSync(file, "preserved approval")
 const release = acquireLease(file)
 assert.throws(() => acquireLease(file), /live coordinator/)
 release()
 const module = new URL("../task-graph-core.ts", import.meta.url).href
 const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import { acquireLease } from ${JSON.stringify(module)}; acquireLease(${JSON.stringify(file)});`], { encoding: "utf8" })
 assert.equal(child.status, 0, child.stderr)
 acquireLease(file)()
 assert.equal(readFileSync(file, "utf8"), "preserved approval")
})
test("one prompt states separate approval, retention and no legacy execution", () => {
 const prompt = taskGraphPrompt("Build search", "plan-only")
 for (const rule of [/separate \/graph execute/, /sequentially/, /No dispatch/, /Legacy Runs are unsupported/, /never recapture/, /hooks enabled/, /plan-closeout/]) assert.match(prompt, rule)
 assert.doesNotMatch(prompt, /parallel_workers|cleanup_workers|current_checkout|integrate_task_graph_worker|worker-start/)
})
