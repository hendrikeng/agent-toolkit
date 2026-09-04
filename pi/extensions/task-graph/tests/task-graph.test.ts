import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import test from "node:test"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	abandonTaskGraphLock,
	acquireTaskGraphLock,
	bindTaskGraphLockToOrcaRun,
	bindTaskGraphLockToPlanContract,
	formatTaskGraph,
	isTaskGraphRecoveryCommand,
	isTaskGraphWorkerLaunch,
	normalizeTaskGraphOwnership,
	planDependencies,
	planId,
	planPriority,
	planSecurityApproved,
	planningDocumentIsExecutable,
	planningDocumentNeedsRecovery,
	planningDocumentRequiresPlanOnly,
	planRequiresPlanOnly,
	releaseTaskGraphLock,
	resolvePlanLifecyclePath,
	replacePlanStatus,
	reviewTaskGraph,
	taskGraphLockKeysForRun,
	taskGraphOrcaArgv,
	taskGraphOrcaInvocations,
	taskGraphOrcaOperations,
	taskGraphOrcaRunIdsForLockRun,
	taskGraphPlanContractsForLockRun,
	taskGraphPrompt,
	taskGraphQuotaPauseReason,
	taskGraphWorkerAccount,
	taskGraphWorkerModel,
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

test("pauses new graph workers at the subscription quota reserve", () => {
	assert.match(taskGraphQuotaPauseReason({
		primary: { remainingPercent: 40, windowMinutes: 300 },
		secondary: { remainingPercent: 15, windowMinutes: 10_080 },
	}, 15, 5) ?? "", /long-window quota is 15%/)
	assert.match(taskGraphQuotaPauseReason({
		primary: { remainingPercent: 5, windowMinutes: 300 },
		secondary: { remainingPercent: 40, windowMinutes: 10_080 },
	}, 15, 5) ?? "", /short-window quota is 5%/)
	assert.equal(taskGraphQuotaPauseReason({
		primary: { remainingPercent: 6, windowMinutes: 300 },
		secondary: { remainingPercent: 16, windowMinutes: 10_080 },
	}, 15, 5), undefined)
	assert.match(taskGraphQuotaPauseReason(undefined, 15, 5) ?? "", /long-window quota is unavailable/)
	assert.match(taskGraphQuotaPauseReason({ primary: { remainingPercent: 0, windowMinutes: 300 } }, 15, 5) ?? "", /long-window quota is unavailable/)
	assert.match(taskGraphQuotaPauseReason({ secondary: { remainingPercent: 15, windowMinutes: 10_080 } }, 15, 5) ?? "", /long-window quota is 15%/)
	assert.equal(taskGraphQuotaPauseReason({ secondary: { remainingPercent: 36, windowMinutes: 10_080 } }, 15, 5), undefined)
	assert.equal(isTaskGraphWorkerLaunch("orca orchestration worker-start --task task_1 --worktree current --agent pi"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal create --worktree active --command 'pi-yolo --thinking high'"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal create --worktree active --command 'codex'"), true)
	assert.equal(isTaskGraphWorkerLaunch("Orca terminal create --worktree active --command 'codex'"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca orchestration worker-start --task task_1 --terminal term_1"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal wait --terminal term_1 && orca orchestration worker-start --task task_1 --agent pi"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal create \\\n  --worktree active \\\n  --command 'pi-yolo --model openai-codex/gpt-5'"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal \\\n  create --command 'pi-yolo --model openai-codex/gpt-5'"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca terminal list --json"), false)
	assert.equal(isTaskGraphWorkerLaunch("grep -R 'worker-start' ."), false)
	assert.equal(isTaskGraphWorkerLaunch("orca orchestration run-create --objective 'Fix pi-yolo startup' --json"), false)
	assert.equal(isTaskGraphWorkerLaunch("orca status --json\norca terminal create --command 'codex'"), true)
	assert.equal(isTaskGraphWorkerLaunch(`bash -c 'orca terminal create --command "codex"'`), true)
	assert.equal(isTaskGraphWorkerLaunch("/opt/bin/pi-yolo --model other/provider"), true)
	assert.equal(isTaskGraphWorkerLaunch("orca worktree create --name isolated --no-parent --json"), false)
	assert.equal(isTaskGraphWorkerLaunch("orca worktree create --name isolated --agent codex --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration run-list --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration task-create --spec 'Recovered ledger task' --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration task-update --id task_1 --status completed --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration check --wait --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration worker-release --dispatch dispatch_1 --json"), true)
	assert.equal(isTaskGraphRecoveryCommand("orca terminal close --terminal term_1 --json"), true)
	assert.deepEqual(taskGraphOrcaOperations("orca orchestration \\\n task-create --spec x"), ["task-create"])
	assert.deepEqual(taskGraphOrcaArgv("orca orchestration task\\-create --r\\un run_other"), ["orchestration", "task-create", "--run", "run_other"])
	assert.equal(taskGraphOrcaArgv("printf 'unterminated"), undefined)
	assert.equal(taskGraphOrcaInvocations("orca orchestration worker-release --dispatch dispatch_1 && orca terminal close --terminal term_2").length, 2)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration dispatch --task task_1 --to term_1 --inject --json"), false)
	assert.equal(isTaskGraphRecoveryCommand("orca orchestration run-list --json; sed -i '' plan.md"), false)
	assert.equal(isTaskGraphRecoveryCommand("orca status (Remove-Item plan.md)"), false)
	assert.equal(isTaskGraphRecoveryCommand("orca status > docs/exec-plans/completed/plan.md"), false)
	const configured = process.env.ORCA_CLI_COMMAND
	try {
		process.env.ORCA_CLI_COMMAND = "/opt/orca-custom"
		assert.equal(isTaskGraphWorkerLaunch("/opt/orca-custom terminal create --command 'pi-yolo --model openai-codex/gpt-5'"), true)
		assert.equal(taskGraphWorkerModel("/opt/orca-custom terminal create --command 'pi-yolo --model openai-codex/gpt-5'"), "openai-codex/gpt-5")
		assert.equal(isTaskGraphRecoveryCommand("/opt/orca-custom orchestration run-list --json"), true)
	} finally {
		if (configured === undefined) delete process.env.ORCA_CLI_COMMAND
		else process.env.ORCA_CLI_COMMAND = configured
	}
})

test("locks one graph objective and recovers a stale lock", () => {
	const root = mkdtempSync(join(tmpdir(), "task-graph-lock-"))
	try {
		const first = acquireTaskGraphLock(root, "repo::plan")
		assert.throws(() => acquireTaskGraphLock(root, "repo::plan"), /Another \/graph run is active/)
		releaseTaskGraphLock(first)

		const stale = acquireTaskGraphLock(root, "repo::stale", 99_999_999)
		const recovered = acquireTaskGraphLock(root, "repo::stale")
		releaseTaskGraphLock(stale)
		assert.throws(() => acquireTaskGraphLock(root, "repo::stale"), /Another \/graph run is active/)
		releaseTaskGraphLock(recovered)

		const foreign = acquireTaskGraphLock(root, "repo::shared-plan", process.pid, "repo::plan:target-a")
		bindTaskGraphLockToOrcaRun(foreign, "run_1")
		bindTaskGraphLockToPlanContract(foreign, "approved-contract")
		assert.deepEqual(taskGraphPlanContractsForLockRun(root, "repo::plan:target-a"), ["approved-contract"])
		abandonTaskGraphLock(foreign)
		assert.deepEqual(taskGraphLockKeysForRun(root, "repo::plan:target-a"), ["repo::shared-plan"])
		assert.throws(() => acquireTaskGraphLock(root, "repo::shared-plan", process.pid, "repo::plan:target-b"), /Resume that target/)
		const resumed = acquireTaskGraphLock(root, "repo::shared-plan", process.pid, "repo::plan:target-a")
		assert.deepEqual(taskGraphOrcaRunIdsForLockRun(root, "repo::plan:target-a"), ["run_1"])
		assert.deepEqual(taskGraphPlanContractsForLockRun(root, "repo::plan:target-a"), ["approved-contract"])
		releaseTaskGraphLock(foreign)
		releaseTaskGraphLock(resumed)

		const orphan = acquireTaskGraphLock(root, "repo::orphan")
		rmSync(join(orphan.path, "owner.json"))
		utimesSync(orphan.path, new Date(0), new Date(0))
		const orphanRecovery = acquireTaskGraphLock(root, "repo::orphan")
		releaseTaskGraphLock(orphanRecovery)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("keeps the plan Run identity after lifecycle moves", () => {
	const root = mkdtempSync(join(tmpdir(), "task-graph-plan-move-"))
	const future = join(root, "docs/future/target.md")
	const active = join(root, "docs/exec-plans/active/target.md")
	const completed = join(root, "docs/exec-plans/completed/target.md")
	try {
		mkdirSync(join(root, ".git"))
		mkdirSync(join(root, "docs/future"), { recursive: true })
		mkdirSync(join(root, "docs/exec-plans/active"), { recursive: true })
		mkdirSync(join(root, "docs/exec-plans/completed"), { recursive: true })
		writeFileSync(future, "## Metadata\n\n- Plan-ID: target-plan\n- Status: ready-for-promotion\n")
		writeFileSync(completed, "## Metadata\n\n- Plan-ID: older-target-plan\n- Status: completed\n")
		assert.throws(() => resolvePlanLifecyclePath(root, "docs/future/target.md"), /later lifecycle path already exists/)
		rmSync(completed)
		const before = resolvePlanLifecyclePath(root, "docs/future/target.md")
		assert.equal(before, realpathSync(future))
		const id = planId(readFileSync(before, "utf8"))
		writeFileSync(active, "## Metadata\n\n- Plan-ID: conflicting-plan\n- Status: queued\n")
		assert.throws(() => resolvePlanLifecyclePath(root, "docs/future/target.md"), /later lifecycle path already exists/)
		rmSync(active)
		renameSync(future, active)
		const after = resolvePlanLifecyclePath(root, "docs/future/target.md")
		assert.equal(after, realpathSync(active))
		assert.equal(planId(readFileSync(after, "utf8")), id)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})

test("validates and formats a bounded task graph", () => {
	assert.doesNotThrow(() => validateTaskGraph(plan))
	assert.doesNotThrow(() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0]] }, true))
	assert.throws(() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0]] }), /two to six tasks/)
	assert.match(formatTaskGraph(plan), /mode: execute/)
	assert.match(formatTaskGraph(plan), /api \[backend, medium\]/)
	assert.match(formatTaskGraph(plan), /web \[frontend, high\] ← api/)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], depends_on: [], owns: ["src/api"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], depends_on: [], owns: ["src/api/routes.ts"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["src/**/*"] }, { ...plan.tasks[1], depends_on: [], owns: ["src/web"] }] }),
		/ownership.*disjoint/,
	)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["src/foo*.ts"] }, { ...plan.tasks[1], depends_on: [], owns: ["src/foobar.ts"] }] }),
		/ownership.*disjoint/,
	)
	assert.doesNotThrow(() => validateTaskGraph({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], owns: ["src/api"] }] }))
	assert.doesNotThrow(() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["src/api", "src/api/routes.ts"] }] }, true))
	assert.throws(() => validateTaskGraph({ ...plan, tasks: [plan.tasks[1], plan.tasks[0]] }, true), /dependency before its dependent/)
	assert.throws(
		() => validateTaskGraph({ ...plan, tasks: [{ ...plan.tasks[0], owns: ["."] }, { ...plan.tasks[1], depends_on: [] }] }),
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
					{ ...plan.tasks[1], depends_on: [], repository: "packages/api", owns: ["src"] },
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

test("handles interactive graph review and plan status", async () => {
	const signal = new AbortController().signal
	const review = (selection: string, feedback?: string, candidate = plan, planChain = false) => reviewTaskGraph(candidate, {
		select: async (title, _options, options) => {
			assert.equal(options?.signal, signal)
			assert.match(title, planChain ? /top to bottom execution order/ : /Review task graph/)
			return selection
		},
		input: async (_title, _placeholder, options) => {
			assert.equal(options?.signal, signal)
			return feedback
		},
	}, signal, planChain)

	assert.deepEqual(await review("Approve and execute"), { status: "approved" })
	assert.deepEqual(await review("Approve and execute", undefined, plan, true), { status: "approved" })
	assert.deepEqual(await review("Approve plan only", undefined, { ...plan, mode: "plan-only" }), { status: "plan-approved" })
	assert.deepEqual(await review("Revise the plan", "  split API and Web  "), { status: "revise", feedback: "split API and Web" })
	assert.deepEqual(await review("Cancel"), { status: "cancelled" })
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: blocked\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: ready-for-promotion\n"), true)
	assert.equal(planId("## Metadata\n\n- Plan-ID: search-v2\n- Status: ready-for-promotion\n"), "search-v2")
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: paused\n"), true)
	assert.equal(planRequiresPlanOnly("No metadata"), true)
	assert.equal(planRequiresPlanOnly("- Status: queued\n\n## Metadata\n\n- Status: blocked\n"), true)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: in-progress\n\n## Scope\n\n- Status: blocked\n"), false)
	assert.equal(planRequiresPlanOnly("## Metadata\n\n- Status: budget-exhausted\n"), false)
	assert.deepEqual(planDependencies("## Metadata\n\n- Dependencies: auth-core, api-base\n"), ["auth-core", "api-base"])
	assert.deepEqual(planDependencies("## Metadata\n\n- Dependencies: none\n"), [])
	assert.throws(() => planDependencies("## Metadata\n\n- Status: queued\n"), /must declare Dependencies/)
	assert.equal(planPriority("## Metadata\n\n- Priority: p0\n"), 0)
	assert.equal(planPriority("## Metadata\n\n- Priority: p3\n"), 3)
	assert.equal(planPriority("## Metadata\n\n- Priority: urgent\n"), undefined)
	assert.equal(planSecurityApproved("## Metadata\n\n- Security-Approval: pending\n"), false)
	assert.equal(planSecurityApproved("## Metadata\n\n- Security-Approval: approved\n"), true)
	assert.equal(replacePlanStatus("Status: queued\n\n## Metadata\n\n- Status: queued\n\n## Notes\n\n- Status: keep\n", "completed"), "Status: completed\n\n## Metadata\n\n- Status: completed\n\n## Notes\n\n- Status: keep\n")
	assert.equal(planningDocumentIsExecutable("docs/future/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n"), false)
	assert.equal(planningDocumentIsExecutable("docs/future/team/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n- Security-Approval: not-required\n"), true)
	assert.equal(planningDocumentIsExecutable("docs/future/plan.md", "## Metadata\n\n- Status: draft\n"), false)
	assert.equal(planningDocumentIsExecutable("docs/future/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n- Security-Approval: pending\n"), false)
	assert.equal(planningDocumentIsExecutable("docs/future/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n- Security-Approval: approved\n"), true)
	assert.equal(planningDocumentIsExecutable("docs/exec-plans/active/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n- Security-Approval: not-required\n"), true)
	assert.equal(planningDocumentIsExecutable("docs/exec-plans/active/plan.md", "## Metadata\n\n- Status: blocked\n"), false)
	assert.equal(planningDocumentIsExecutable("docs/exec-plans/completed/plan.md", "## Metadata\n\n- Status: completed\n"), false)
	assert.equal(planningDocumentNeedsRecovery("docs/exec-plans/active/plan.md", "## Metadata\n\n- Status: completed\n"), true)
	assert.equal(planningDocumentNeedsRecovery("docs/exec-plans/completed/plan.md", "## Metadata\n\n- Status: validation\n"), true)
	assert.equal(planningDocumentRequiresPlanOnly("decisions/decision.md", "No metadata"), false)
	assert.equal(planningDocumentRequiresPlanOnly("docs/future/plan.md", "## Metadata\n\n- Status: queued\n"), true)
	assert.equal(planningDocumentRequiresPlanOnly("docs/future/plan.md", "## Metadata\n\n- Status: ready-for-promotion\n- Security-Approval: not-required\n"), false)
	assert.equal(planningDocumentRequiresPlanOnly("docs/exec-plans/active/plan.md", "## Metadata\n\n- Status: queued\n"), false)
	assert.equal(planningDocumentRequiresPlanOnly("docs/exec-plans/completed/plan.md", "## Metadata\n\n- Status: completed\n"), true)
})

test("builds the interactive Orca planning prompt", () => {
	const prompt = taskGraphPrompt("Build search")
	assert.match(prompt, /Build search/)
	assert.match(prompt, /Pi task graph: Build search/)
	assert.match(prompt, /Bind and reconcile one unfinished match/)
	assert.match(prompt, /\[graph-task:<task-id>\]/)
	assert.match(prompt, /Do not move a ready future plan before approval/)
	assert.match(prompt, /change only that plan's `Status` from `ready-for-promotion` to `queued`/)
	assert.match(prompt, /start the workers/)
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
	assert.match(prompt, /Every graph worker must run `pi-yolo --model provider\/model --thinking <task-thinking>`, not plain `pi`/)
	assert.match(prompt, /Do not use `worker-start` or Orca's generic `--agent pi` launcher/)
	assert.match(prompt, /pi-yolo --model provider\/model --thinking <task-thinking>/)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --model openai-codex/gpt-5 --thinking high'"), "openai-codex/gpt-5")
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --model openrouter/anthropic/claude-sonnet-4'"), "openrouter/anthropic/claude-sonnet-4")
	assert.deepEqual(taskGraphWorkerAccount(`orca terminal create --command 'AGENT_TOOLKIT_CODEX_ACCOUNT=work AGENT_TOOLKIT_CODEX_PROFILE_HOME=/accounts/work AGENT_TOOLKIT_PI_AGENT_DIR=/agent pi-yolo --model openai-codex/gpt-5'`), {
		profile: "work",
		profileHome: "/accounts/work",
		agentDir: "/agent",
	})
	assert.equal(taskGraphWorkerAccount(`orca terminal create --command 'pi-yolo --model openai-codex/gpt-5 AGENT_TOOLKIT_CODEX_ACCOUNT=work AGENT_TOOLKIT_CODEX_PROFILE_HOME=/accounts/work AGENT_TOOLKIT_PI_AGENT_DIR=/agent'`), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --title '--model openai-codex/approved' --command 'pi-yolo --model other/provider'"), "other/provider")
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --model openai-codex/gpt-5' --command 'codex'"), undefined)
	assert.equal(taskGraphWorkerModel("orca orchestration worker-start --task task_1 --worktree current --agent pi --model openai-codex/gpt-5"), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --model openai-codex/gpt-5'; orca terminal split --command 'pi-yolo --model other/provider'"), undefined)
	assert.equal(taskGraphWorkerModel(`orca terminal create --command 'pi-yolo --model openai-codex/gpt-5' && sh -c 'pi-yolo --model other/provider'`), undefined)
	assert.equal(taskGraphWorkerModel(`orca terminal create --title '$(pi-yolo --model other/provider)' --command 'pi-yolo --model openai-codex/gpt-5'`), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --thinking high'"), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo -- --model openai-codex/gpt-5'"), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --thinking high # --model openai-codex/gpt-5'"), undefined)
	assert.equal(taskGraphWorkerModel(`orca terminal create --command "sh -c 'codex --model evil' pi-yolo --model openai-codex/gpt-5"`), undefined)
	assert.equal(taskGraphWorkerModel(`orca terminal create --command 'pi-yolo --name "--model openai-codex/gpt-5" --provider anthropic'`), undefined)
	assert.equal(taskGraphWorkerModel("orca terminal create --command 'pi-yolo --model openai-codex/gpt-5 & codex --model other/provider'"), undefined)
	assert.match(prompt, /coordinator owns plan lifecycle updates/)
	assert.match(prompt, /focused task checks do not replace plan closeout/)
	assert.match(prompt, /run the exact validation lanes and required full verification/)
	assert.match(prompt, /move the plan from active to completed/)
	assert.match(prompt, /run the repository's plan-closeout check/)
	assert.match(prompt, /Never close or edit dependent future plans/)
	assert.match(prompt, /medium worker fails or requests escalation/)
	assert.match(prompt, /at most one replacement attempt/)
	assert.match(prompt, /Call finish_task_graph.*only after every dispatch is settled and released/)

	const chain = taskGraphPrompt("docs/future/final-plan.md", true, "/repo::/repo/docs/future/final-plan.md")
	assert.match(chain, /unattended plan chain/)
	assert.match(chain, /full unfinished dependency chain/)
	assert.match(chain, /local sibling Git repositories/)
	assert.match(chain, /exactly one matching plan for each Plan-ID/)
	assert.match(chain, /one approval for the full plan chain/)
	assert.match(chain, /one to twelve plan tasks/)
	assert.match(chain, /deterministic topological order/)
	assert.match(chain, /Priority p0 before p1, p2, and p3, then order by Plan-ID/)
	assert.match(chain, /Pi plan chain: \/repo::\/repo\/docs\/future\/final-plan\.md/)
	assert.match(chain, /one unfinished Run exists, bind it and resume/)
	assert.match(chain, /more than one unfinished Run exists/)
	assert.match(chain, /continue supervising it instead of starting a duplicate worker/)
	assert.match(chain, /durable execution ledger/)
	assert.match(chain, /\[plan:<Plan-ID>\]/)
	assert.match(chain, /first unfinished ready plan in the approved order/)
	assert.match(chain, /children of the plan task/)
	assert.match(chain, /plan repository's current worktree/)
	assert.match(chain, /exact Orca selector/)
	assert.match(chain, /fresh worker terminal/)
	assert.match(chain, /never reuse a completed worker/)
	assert.match(chain, /Never promote later plans early/)
	assert.match(chain, /Reserve 15% of the long window and 5% of the short window/)
	assert.match(chain, /Long-window data is required/)
	assert.match(chain, /short-window reserve only when Codex reports that window/)
	assert.match(chain, /same \/graph command resumes after quota resets/)
	assert.match(chain, /continue automatically/)
	assert.match(chain, /approval authorizes required local commits/)
	assert.match(chain, /Do not bypass trusted push/)

	const recovery = taskGraphPrompt("docs/exec-plans/completed/final-plan.md", true, "/repo::plan:final", "openai-codex/gpt-5", true)
	assert.match(recovery, /already completed locally/)
	assert.match(recovery, /must not create a Run, directly edit files, or dispatch workers/)
})
