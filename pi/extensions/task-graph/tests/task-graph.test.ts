import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import test from "node:test"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	formatTaskGraph,
	isTaskGraphQueueEdit,
	normalizeTaskGraphOwnership,
	planIsReadyForPromotion,
	planningDocumentRequiresPlanOnly,
	planRequiresPlanOnly,
	reviewTaskGraph,
	taskGraphPromotionDestination,
	taskGraphPromotionSource,
	taskGraphPrompt,
	type TaskGraphPlan,
	validateTaskGraph,
	validateTaskGraphRepositories,
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
			thinking: "medium",
			done_when: ["The endpoint returns results"],
			validation: "npm test -- search-api",
		},
		{
			id: "web",
			goal: "Add the search interface",
			depends_on: ["api"],
			owns: ["src/web"],
			specialty: "frontend",
			thinking: "high",
			done_when: ["Search results are accessible"],
			validation: "npm test -- search-web",
		},
	],
}

test("validates and formats a bounded task graph", () => {
	assert.doesNotThrow(() => validateTaskGraph(plan))
	assert.match(formatTaskGraph(plan), /mode: execute/)
	assert.match(formatTaskGraph(plan), /api \[backend, medium\]/)
	assert.match(formatTaskGraph(plan), /web \[frontend, high\] ← api/)
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

test("normalizes ownership relative to each repository", () => {
	const root = resolve("tmp/repo")
	const absolute = join(root, "src/api")
	const siblingRoot = resolve(root, "../other")
	const normalized = normalizeTaskGraphOwnership({
		...plan,
		tasks: [
			{ ...plan.tasks[0], owns: [absolute] },
			{ ...plan.tasks[1], repository: "../other", owns: [join(siblingRoot, "src/web")] },
		],
	}, root)

	assert.equal(normalized.tasks[0].repository, ".")
	assert.equal(normalized.tasks[0].owns[0], "src/api")
	assert.equal(normalized.tasks[1].repository, "../other")
	assert.equal(normalized.tasks[1].owns[0], "src/web")
	assert.doesNotThrow(() => validateTaskGraph(normalized))
	assert.throws(
		() => validateTaskGraph(normalizeTaskGraphOwnership({
			...plan,
			tasks: [{ ...plan.tasks[0], owns: [resolve("tmp/outside")] }, plan.tasks[1]],
		}, root)),
		/repository-relative/,
	)
})

test("allows disjoint ownership across local Git repositories", () => {
	const workspace = mkdtempSync(join(tmpdir(), "task-graph-"))
	const root = join(workspace, "app")
	const sibling = join(workspace, "api")
	mkdirSync(join(root, ".git"), { recursive: true })
	mkdirSync(join(root, "packages/api/.git"), { recursive: true })
	mkdirSync(join(sibling, ".git"), { recursive: true })
	try {
		const multiRepo = normalizeTaskGraphOwnership({
			...plan,
			tasks: [
				{ ...plan.tasks[0], repository: ".", owns: ["src"] },
				{ ...plan.tasks[1], repository: "../api", owns: ["src"] },
			],
		}, root)
		assert.doesNotThrow(() => validateTaskGraph(multiRepo))
		assert.doesNotThrow(() => validateTaskGraphRepositories(multiRepo, root))
		assert.throws(
			() => validateTaskGraph(normalizeTaskGraphOwnership({
				...plan,
				tasks: [
					{ ...plan.tasks[0], repository: ".", owns: ["packages/api"] },
					{ ...plan.tasks[1], repository: "packages/api", owns: ["src"] },
				],
			}, root)),
			/ownership.*disjoint/,
		)
		assert.throws(
			() => validateTaskGraphRepositories({ ...multiRepo, tasks: [multiRepo.tasks[0], { ...multiRepo.tasks[1], repository: "../missing" }] }, root),
			/not a Git repository root/,
		)
	} finally {
		rmSync(workspace, { recursive: true, force: true })
	}
})

test("allows only one safe promotion move and status edit before approval", () => {
	assert.equal(taskGraphPromotionSource("mv docs/future/workspace-planner-provider-adapter.md docs/exec-plans/active/"), "docs/future/workspace-planner-provider-adapter.md")
	assert.equal(taskGraphPromotionSource("mv ../product/docs/future/plan.md ../product/docs/exec-plans/active/"), "../product/docs/future/plan.md")
	assert.equal(taskGraphPromotionSource("mv ../product/docs/future/plan.md ../api/docs/exec-plans/active/"), undefined)
	assert.equal(taskGraphPromotionSource("mv '../product name/docs/future/plan.md' '../product name/docs/exec-plans/active/'"), undefined)
	assert.equal(taskGraphPromotionSource("mv ../product/;touch-pwn/docs/future/plan.md ../product/;touch-pwn/docs/exec-plans/active/"), undefined)
	assert.equal(taskGraphPromotionDestination("../product/docs/future/plan.md"), "../product/docs/exec-plans/active/plan.md")
	assert.equal(taskGraphPromotionDestination("docs/future/plan.md"), "docs/exec-plans/active/plan.md")
	assert.equal(taskGraphPromotionDestination("docs/other/plan.md"), undefined)
	assert.equal(taskGraphPromotionSource("pnpm run plans:verify"), undefined)
	assert.equal(taskGraphPromotionSource("mv docs/future/plan.md docs/exec-plans/active/ && echo moved"), undefined)
	assert.equal(taskGraphPromotionSource("mv other/plan.md docs/exec-plans/active/"), undefined)

	const queueEdit = [{ oldText: "- Status: ready-for-promotion", newText: "- Status: queued" }]
	assert.equal(isTaskGraphQueueEdit("docs/exec-plans/active/plan.md", queueEdit), true)
	assert.equal(isTaskGraphQueueEdit("docs/future/plan.md", queueEdit), false)
	assert.equal(isTaskGraphQueueEdit("docs/exec-plans/active/plan.md", [{ ...queueEdit[0], newText: "- Status: in-progress" }]), false)
	assert.equal(isTaskGraphQueueEdit("docs/exec-plans/active/plan.md", [...queueEdit, ...queueEdit]), false)
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
	assert.equal(planIsReadyForPromotion("## Metadata\n\n- Status: ready-for-promotion\n"), true)
	assert.equal(planIsReadyForPromotion("##  Metadata\n\n  - Status: ready-for-promotion\n"), true)
	assert.equal(planIsReadyForPromotion("## Metadata\n\n- Status: draft\n"), false)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: paused\n"), true)
	assert.equal(planRequiresPlanOnly("No metadata"), true)
	assert.equal(planRequiresPlanOnly("- Status: queued\n\n## Metadata\n\n- Status: blocked\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: in-progress\n\n## Scope\n\n- Status: blocked\n"), false)
	assert.equal(planningDocumentRequiresPlanOnly("decisions/decision.md", "No metadata"), false)
	assert.equal(planningDocumentRequiresPlanOnly("docs/future/plan.md", "## Metadata\n\n- Status: queued\n"), true)
	assert.equal(planningDocumentRequiresPlanOnly("docs/exec-plans/active/plan.md", "## Metadata\n\n- Status: queued\n"), false)
	assert.equal(planningDocumentRequiresPlanOnly("docs/exec-plans/completed/plan.md", "## Metadata\n\n- Status: completed\n"), true)
})

test("builds the interactive Orca planning prompt", () => {
	const prompt = taskGraphPrompt("Build search")
	assert.match(prompt, /Build search/)
	assert.match(prompt, /moving the objective's ready-for-promotion Markdown plan/)
	assert.match(prompt, /change only that plan's `Status` from `ready-for-promotion` to `queued`/)
	assert.match(prompt, /executable only on a new `\/graph` run/)
	assert.match(prompt, /propose_task_graph/)
	assert.match(prompt, /draft or blocked plan permits planning.*only/)
	assert.match(prompt, /one future file per executable slice/)
	assert.match(prompt, /plan-only or execute mode/)
	assert.match(prompt, /graph may span local Git repositories/)
	assert.match(prompt, /set its repository to that Git root/)
	assert.match(prompt, /in the task's repository/)
	assert.match(prompt, /Use medium thinking for bounded implementation work/)
	assert.match(prompt, /Use high thinking for architecture/)
	assert.match(prompt, /approve, revise, or cancel/)
	assert.match(prompt, /Do not dispatch workers until an execute-mode graph is approved/)
	assert.match(prompt, /orca skills get orchestration/)
	assert.match(prompt, /Every graph worker must run `pi-yolo`, not plain `pi`/)
	assert.match(prompt, /Do not use Orca's generic `--agent pi` launcher/)
	assert.match(prompt, /pi-yolo --thinking <task-thinking>/)
	assert.match(prompt, /coordinator owns plan lifecycle updates/)
	assert.match(prompt, /focused task checks do not replace plan closeout/)
	assert.match(prompt, /run the exact validation lanes and required full verification/)
	assert.match(prompt, /move the plan from active to completed/)
	assert.match(prompt, /run the repository's plan-closeout check/)
	assert.match(prompt, /Never close or edit dependent future plans/)
	assert.match(prompt, /medium worker fails or requests escalation/)
	assert.match(prompt, /at most one replacement attempt/)
})
