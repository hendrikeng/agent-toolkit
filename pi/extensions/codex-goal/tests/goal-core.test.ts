import assert from "node:assert/strict";
import test from "node:test";
import {
	canResumeGoal,
	classifyTerminalError,
	escapeXmlText,
	formatElapsed,
	formatTokens,
	goalSummary,
	goalTokensForUsage,
	goalUsage,
	isGoalState,
	normalizeObjective,
	normalizeTokenBudget,
	renderPromptTemplate,
	statusAfterEdit,
	statusAfterGoalUpdate,
	statusAfterTurn,
	type GoalState,
} from "../goal-core.ts";

function activeGoal(overrides: Partial<GoalState> = {}): GoalState {
	return {
		id: "goal-1",
		objective: "Ship the feature",
		status: "active",
		tokenBudget: null,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

test("objective validation matches Codex's 4,000 character contract", () => {
	assert.equal(normalizeObjective("  ship it  "), "ship it");
	assert.throws(() => normalizeObjective("   "), /must not be empty/);
	assert.equal(normalizeObjective("x".repeat(4_000)).length, 4_000);
	assert.throws(() => normalizeObjective("x".repeat(4_001)), /at most 4000/);
});

test("token budgets must be positive safe integers", () => {
	assert.equal(normalizeTokenBudget(undefined), null);
	assert.equal(normalizeTokenBudget(50_000), 50_000);
	for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100"]) {
		assert.throws(() => normalizeTokenBudget(value), /positive integer/);
	}
});

test("prompt rendering escapes an untrusted objective", () => {
	const objective = escapeXmlText("Fix <script> & finish");
	assert.equal(objective, "Fix &lt;script&gt; &amp; finish");
	assert.equal(
		renderPromptTemplate("<objective>{{ objective }}</objective> {{ missing }}", { objective }),
		"<objective>Fix &lt;script&gt; &amp; finish</objective> ",
	);
});

test("usage formatting is compact and deterministic", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(12_500), "12.5K");
	assert.equal(formatTokens(1_250_000), "1.3M");
	assert.equal(formatElapsed(61), "1m 1s");
	assert.equal(formatElapsed(36_720), "10h 12m");
	assert.equal(goalUsage(activeGoal({ tokenBudget: 50_000, tokensUsed: 12_500 })), "12.5K / 50K");
	assert.equal(goalUsage(activeGoal({ timeUsedSeconds: 60 }), 5), "1m 5s");
});

test("goal state and resumable statuses are validated", () => {
	assert.equal(isGoalState(activeGoal()), true);
	assert.equal(isGoalState({ ...activeGoal(), status: "unknown" }), false);
	assert.equal(canResumeGoal(activeGoal({ status: "paused" })), true);
	assert.equal(canResumeGoal(activeGoal({ status: "blocked" })), true);
	assert.equal(canResumeGoal(activeGoal({ status: "budget_limited" })), false);
});

test("goal summary mirrors the Codex command affordances", () => {
	assert.match(goalSummary(activeGoal()), /Commands: \/goal edit, \/goal pause, \/goal clear/);
	assert.match(goalSummary(activeGoal({ status: "paused" })), /\/goal resume/);
	assert.doesNotMatch(goalSummary(activeGoal({ status: "complete" })), /\/goal resume/);
});

test("editing cannot reactivate an exhausted budget", () => {
	assert.equal(statusAfterEdit(activeGoal({ status: "budget_limited", tokenBudget: 100, tokensUsed: 100 })), "budget_limited");
	assert.equal(statusAfterEdit(activeGoal({ status: "complete", tokenBudget: 100, tokensUsed: 100 })), "budget_limited");
	assert.equal(statusAfterEdit(activeGoal({ status: "complete", tokenBudget: 100, tokensUsed: 99 })), "active");
	assert.equal(statusAfterEdit(activeGoal({ status: "paused", tokenBudget: 100, tokensUsed: 99 }), true), "active");
	assert.equal(statusAfterEdit(activeGoal({ status: "paused", tokenBudget: 100, tokensUsed: 100 }), true), "budget_limited");
	assert.equal(statusAfterEdit(activeGoal({ status: "complete" })), "active");
});

test("blocking cannot override an exhausted budget", () => {
	assert.equal(statusAfterGoalUpdate(activeGoal({ tokenBudget: 100, tokensUsed: 100 }), "blocked"), "budget_limited");
	assert.equal(statusAfterGoalUpdate(activeGoal({ tokenBudget: 100, tokensUsed: 99 }), "blocked"), "blocked");
	assert.equal(statusAfterGoalUpdate(activeGoal({ tokenBudget: 100, tokensUsed: 100 }), "complete"), "complete");
});

test("goal token usage excludes cache reads like Codex", () => {
	assert.equal(goalTokensForUsage({ input: 20, output: 8, cacheRead: 100, cacheWrite: 5, totalTokens: 133 }), 33);
	assert.equal(goalTokensForUsage({ input: 20, output: 8, cacheWrite: 0 }), 28);
	assert.equal(goalTokensForUsage({ input: 20, output: 8 }), 0);
});

test("budget limiting takes precedence over stopped statuses", () => {
	assert.equal(statusAfterTurn(activeGoal({ tokenBudget: 100, tokensUsed: 100 }), true), "budget_limited");
	assert.equal(statusAfterTurn(activeGoal({ tokenBudget: 100, tokensUsed: 99 }), true), "paused");
	assert.equal(statusAfterTurn(activeGoal({ status: "paused", tokenBudget: 100, tokensUsed: 100 }), true), "budget_limited");
	assert.equal(statusAfterTurn(activeGoal({ status: "blocked", tokenBudget: 100, tokensUsed: 100 }), false), "budget_limited");
	assert.equal(statusAfterTurn(activeGoal({ status: "complete", tokenBudget: 100, tokensUsed: 100 }), false), "complete");
});

test("terminal provider errors stop continuation with a useful status", () => {
	assert.equal(classifyTerminalError("rate limit exceeded"), "usage_limited");
	assert.equal(classifyTerminalError("insufficient_quota"), "usage_limited");
	assert.equal(classifyTerminalError("provider returned malformed output"), "paused");
});
