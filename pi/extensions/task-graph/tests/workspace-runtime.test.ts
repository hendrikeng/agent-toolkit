import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("installer linkage loads only the new graph files and preserves old records", () => {
 const directory = mkdtempSync(join(tmpdir(), "graph-install-"))
 const repo = new URL("../../../../", import.meta.url).pathname
 const installer = readFileSync(join(repo, "install.sh"), "utf8")
 const link = installer.match(/install_link\(\) \{[\s\S]*?\n\}/)![0]
 const agent = join(directory, "agent")
 mkdirSync(join(agent, "task-graph-locks/legacy.lock"), { recursive: true })
 const evidence = join(agent, "task-graph-locks/legacy.lock/owner.json")
 writeFileSync(evidence, '{"run":"old-evidence"}')
 // The real installer primitive, isolated from package installation, accounts and live settings.
 execFileSync("bash", ["-c", `${link}\ninstall_link "$1" "$2"`, "fixture", join(repo, "pi/extensions/task-graph"), join(agent, "extensions/task-graph")], { env: { ...process.env, HOME: directory, backup_root: join(directory, "backup") } })
 assert.equal(realpathSync(join(agent, "extensions/task-graph")), realpathSync(join(repo, "pi/extensions/task-graph")))
 for (const file of ["index.ts", "task-graph-core.ts", "workspaces.ts"]) assert.equal(readFileSync(join(agent, "extensions/task-graph", file), "utf8"), readFileSync(join(repo, "pi/extensions/task-graph", file), "utf8"))
 for (const file of ["cleanup.ts", "run-recovery.ts"]) assert.equal(existsSync(join(agent, "extensions/task-graph", file)), false)
 assert.equal(readFileSync(evidence, "utf8"), '{"run":"old-evidence"}')
 const index = readFileSync(join(repo, "pi/extensions/task-graph/index.ts"), "utf8")
 for (const name of ["bind_task_graph_run", "recover_plan_lifecycle", "integrate_task_graph_worker", "cleanup_completed_task_graph"]) assert.ok(!index.includes(`name: "${name}"`))
 assert.match(index, /pi-yolo --model/)
 assert.match(index, /\["terminal", "create"/)
 assert.doesNotMatch(index, /worker-start|cleanup_completed_task_graph/)
 assert.doesNotMatch(installer, /core\.hooksPath=\/dev\/null/)
})
