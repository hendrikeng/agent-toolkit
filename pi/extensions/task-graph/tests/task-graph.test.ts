import assert from "node:assert/strict"
import test from "node:test"
import { join, resolve } from "node:path"
import {
	formatTaskGraph,
	normalizeTaskGraphOwnership,
	planRequiresPlanOnly,
	reviewTaskGraph,
	taskGraphPrompt,
	type TaskGraphPlan,
	validateTaskGraph,
} from "../task-graph-core.ts"

const plan: TaskGraphPlan = {
	objective: "Build search",
	mode: "execute",
	tasks: [
		{
			id: "api",
			goal: "Add the search endpoint",
			depends_on: [],
			owns: ["src/api"],
			specialty: "backend",
			done_when: ["The endpoint returns results"],
			validation: "npm test -- search-api",
		},
		{
			id: "web",
			goal: "Add the search interface",
			depends_on: ["api"],
			owns: ["src/web"],
			specialty: "frontend",
			done_when: ["Search results are accessible"],
			validation: "npm test -- search-web",
		},
	],
}

test("validates and formats a bounded task graph", () => {
	assert.doesNotThrow(() => validateTaskGraph(plan))
	assert.match(formatTaskGraph(plan), /mode: execute/)
	assert.match(formatTaskGraph(plan), /web \[frontend\] ← api/)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], owns: ["src/api"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], owns: ["src/api/routes.ts"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["src/**/*"] }, { ...plan.tasks[1], owns: ["src/web"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["src/foo*.ts"] }, { ...plan.tasks[1], owns: ["src/foobar.ts"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["."] }, plan.tasks[1]] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["/repo/src/api"] }, plan.tasks[1]] }),
		/repository-relative/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], done_when: ["  "] }] }),
		/non-empty completion criteria/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], depends_on: ["missing"] }] }),
		/unknown dependency/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], depends_on: ["web"] }, plan.tasks[1]] }),
		/cycle/,
	)
})

test("makes absolute ownership inside the repository relative", () => {
	const root = resolve("tmp/repo")
	const absolute = join(root, "src/api")
	const normalized = normalizeTaskGraphOwnership({
		...plan,
		tasks: [{ ...plan.tasks[0], owns: [absolute] }, plan.tasks[1]],
	}, root)

	assert.equal(normalized.tasks[0].owns[0], "src/api")
	assert.doesNotThrow(() => validateTaskGraph(normalized))
	assert.throws(
		() => validateTaskGraph(normalizeTaskGraphOwnership({
			...plan,
			tasks: [{ ...plan.tasks[0], owns: [resolve("tmp/outside")] }, plan.tasks[1]],
		}, root)),
		/repository-relative/,
	)
})

test("handles interactive graph review and plan status", async () => {
	const signal = new AbortController().signal
	const review = (selection: string, feedback?: string, candidate = plan) => reviewTaskGraph(candidate, {
		select: async (_title, _options, options) => {
			assert.equal(options?.signal, signal)
			return selection
		},
		input: async (_title, _placeholder, options) => {
			assert.equal(options?.signal, signal)
			return feedback
		},
	}, signal)

	assert.deepEqual(await review("Approve and execute"), { status: "approved" })
	assert.deepEqual(await review("Approve plan only", undefined, { ...plan, mode: "plan-only" }), { status: "plan-approved" })
	assert.deepEqual(await review("Revise the plan", "  split API and Web  "), { status: "revise", feedback: "split API and Web" })
	assert.deepEqual(await review("Cancel"), { status: "cancelled" })
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: blocked\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: ready-for-promotion\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: paused\n"), true)
	assert.equal(planRequiresPlanOnly("No metadata"), true)
	assert.equal(planRequiresPlanOnly("- Status: queued\n\n## Metadata\n\n- Status: blocked\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: in-progress\n\n## Scope\n\n- Status: blocked\n"), false)
})

test("builds the interactive Orca planning prompt", () => {
	const prompt = taskGraphPrompt("Build search")
	assert.match(prompt, /Build search/)
	assert.match(prompt, /propose_task_graph/)
	assert.match(prompt, /draft or blocked plan permits planning.*only/)
	assert.match(prompt, /one future file per executable slice/)
	assert.match(prompt, /plan-only or execute mode/)
	assert.match(prompt, /approve, revise, or cancel/)
	assert.match(prompt, /Do not dispatch workers until an execute-mode graph is approved/)
	assert.match(prompt, /orca skills get orchestration/)
	assert.match(prompt, /Every graph worker must run `pi-yolo`, not plain `pi`/)
	assert.match(prompt, /Do not use Orca's generic `--agent pi` launcher/)
	assert.match(prompt, /at most one replacement attempt/)
})
