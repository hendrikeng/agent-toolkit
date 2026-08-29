import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	canResumeGoal,
	classifyTerminalError,
	escapeXmlText,
	formatElapsed,
	formatTokens,
	goalStatusLabel,
	goalSummary,
	goalTokensForUsage,
	goalUsage,
	isGoalState,
	isUnfinishedGoal,
	normalizeObjective,
	normalizeTokenBudget,
	renderPromptTemplate,
	statusAfterEdit,
	statusAfterGoalUpdate,
	statusAfterTurn,
	type GoalState,
	type PersistedGoalState,
} from "./goal-core.ts";

const STATE_ENTRY = "codex-goal-state";
const CONTINUATION_MESSAGE = "codex-goal-continuation";
const STATUS_KEY = "codex-goal";
const CONTINUATION_RETRY_MS = 100;

const continuationTemplate = readFileSync(new URL("./prompts/continuation.md", import.meta.url), "utf8");
const objectiveUpdatedTemplate = readFileSync(new URL("./prompts/objective_updated.md", import.meta.url), "utf8");
const budgetLimitTemplate = readFileSync(new URL("./prompts/budget_limit.md", import.meta.url), "utf8");

const CreateGoalParams = Type.Object({
	objective: Type.String({ description: "Required. The concrete objective to start pursuing." }),
	token_budget: Type.Optional(Type.Integer({ minimum: 1, description: "Positive token budget. Omit unless explicitly requested." })),
}, { additionalProperties: false });

const UpdateGoalParams = Type.Object({
	status: StringEnum(["complete", "blocked"] as const, {
		description: "Mark complete only when achieved, or blocked only after the same blocker recurs for at least three consecutive goal turns.",
	}),
}, { additionalProperties: false });

function assistantUsage(message: unknown): number {
	if (!message || typeof message !== "object") return 0;
	const candidate = message as { role?: unknown; usage?: unknown };
	return candidate.role === "assistant" ? goalTokensForUsage(candidate.usage) : 0;
}

function assistantMessageKey(message: unknown): string | null {
	if (!message || typeof message !== "object") return null;
	const candidate = message as { role?: unknown; timestamp?: unknown; provider?: unknown; model?: unknown; usage?: { totalTokens?: unknown } };
	if (candidate.role !== "assistant" || typeof candidate.timestamp !== "number") return null;
	return `${candidate.timestamp}:${String(candidate.provider ?? "")}:${String(candidate.model ?? "")}:${String(candidate.usage?.totalTokens ?? "")}`;
}

function isAbortedMessage(message: unknown): boolean {
	return !!message && typeof message === "object" && (message as { role?: unknown; stopReason?: unknown }).role === "assistant"
		&& (message as { stopReason?: unknown }).stopReason === "aborted";
}

function terminalErrorStatus(message: unknown): GoalState["status"] | null {
	if (!message || typeof message !== "object") return null;
	const candidate = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
	if (candidate.role !== "assistant" || candidate.stopReason !== "error") return null;
	return classifyTerminalError(typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined);
}

function renderContinuation(goal: GoalState): string {
	const budget = goal.tokenBudget;
	return renderPromptTemplate(continuationTemplate, {
		objective: escapeXmlText(goal.objective),
		tokens_used: String(goal.tokensUsed),
		token_budget: budget === null ? "none" : String(budget),
		remaining_tokens: budget === null ? "unbounded" : String(Math.max(0, budget - goal.tokensUsed)),
	});
}

function renderObjectiveUpdated(goal: GoalState): string {
	const budget = goal.tokenBudget;
	return renderPromptTemplate(objectiveUpdatedTemplate, {
		objective: escapeXmlText(goal.objective),
		tokens_used: String(goal.tokensUsed),
		token_budget: budget === null ? "none" : String(budget),
		remaining_tokens: budget === null ? "unbounded" : String(Math.max(0, budget - goal.tokensUsed)),
	});
}

function renderBudgetLimit(goal: GoalState): string {
	return renderPromptTemplate(budgetLimitTemplate, {
		objective: escapeXmlText(goal.objective),
		time_used_seconds: String(goal.timeUsedSeconds),
		tokens_used: String(goal.tokensUsed),
		token_budget: goal.tokenBudget === null ? "none" : String(goal.tokenBudget),
	});
}

export default function codexGoalExtension(pi: ExtensionAPI): void {
	let goal: GoalState | null = null;
	let currentCtx: ExtensionContext | null = null;
	let continuationTimer: ReturnType<typeof setTimeout> | null = null;
	let continuationQueuedFor: string | null = null;
	let statusTimer: ReturnType<typeof setInterval> | null = null;
	let runGoalId: string | null = null;
	let runStartedAt: number | null = null;
	let turnGoalId: string | null = null;
	let turnSequence = 0;
	let stoppedThisTurn: { goalId: string; turnSequence: number } | null = null;
	let stoppedRunGoalId: string | null = null;
	let terminalErrorPending: GoalState["status"] | null = null;
	let pendingBudgetWrapGoalId: string | null = null;
	const handledAssistantMessages = new Map<string, string>();

	function cloneGoal(value: GoalState): GoalState {
		return { ...value };
	}

	function persist(): void {
		pi.appendEntry(STATE_ENTRY, { goal: goal ? cloneGoal(goal) : null } satisfies PersistedGoalState);
	}

	function restore(ctx: ExtensionContext): void {
		goal = null;
		const entries = ctx.sessionManager.getBranch();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
			const data = entry.data as { goal?: unknown } | undefined;
			goal = isGoalState(data?.goal) ? cloneGoal(data.goal) : null;
			break;
		}
	}

	function liveRunSeconds(): number {
		if (!goal || goal.status !== "active" || runGoalId !== goal.id || runStartedAt === null) return 0;
		return Math.max(0, Math.floor((Date.now() - runStartedAt) / 1_000));
	}

	function reportedGoal(): GoalState | null {
		return goal ? { ...goal, timeUsedSeconds: goal.timeUsedSeconds + liveRunSeconds() } : null;
	}

	function storedResultGoal(result: unknown): GoalState | null | undefined {
		if (!result || typeof result !== "object") return undefined;
		const details = (result as { details?: unknown }).details;
		if (!details || typeof details !== "object" || !("goal" in details)) return undefined;
		const stored = (details as { goal?: unknown }).goal;
		return stored === null ? null : isGoalState(stored) ? stored : undefined;
	}

	function updateUi(ctx: ExtensionContext): void {
		currentCtx = ctx;
		if (!goal) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const theme = ctx.ui.theme;
		const usage = goalUsage(goal, liveRunSeconds());
		let text: string;
		switch (goal.status) {
			case "active": text = theme.fg("accent", `● Pursuing goal (${usage})`); break;
			case "paused": text = theme.fg("warning", "Goal paused (/goal resume)"); break;
			case "blocked": text = theme.fg("warning", "Goal blocked (/goal resume)"); break;
			case "usage_limited": text = theme.fg("warning", "Goal hit usage limits (/goal resume)"); break;
			case "budget_limited": text = theme.fg("warning", `Goal budget reached (${usage})`); break;
			case "complete": text = theme.fg("success", `Goal achieved (${usage})`); break;
		}
		ctx.ui.setStatus(STATUS_KEY, `${theme.fg("dim", "|")} ${text}`);
	}

	function clearContinuation(): void {
		if (continuationTimer) clearTimeout(continuationTimer);
		continuationTimer = null;
		continuationQueuedFor = null;
	}

	function setGoal(next: GoalState | null, ctx: ExtensionContext, save = true): void {
		goal = next ? cloneGoal(next) : null;
		if (!goal || goal.status !== "active") clearContinuation();
		if (!goal || goal.id !== pendingBudgetWrapGoalId || goal.status !== "budget_limited") pendingBudgetWrapGoalId = null;
		if (save) persist();
		updateUi(ctx);
	}

	function createGoal(objectiveValue: string, tokenBudgetValue: unknown, ctx: ExtensionContext): GoalState {
		const now = Date.now();
		const created: GoalState = {
			id: randomUUID(),
			objective: normalizeObjective(objectiveValue),
			status: "active",
			tokenBudget: normalizeTokenBudget(tokenBudgetValue),
			tokensUsed: 0,
			timeUsedSeconds: 0,
			createdAt: now,
			updatedAt: now,
		};
		setGoal(created, ctx);
		turnGoalId = created.id;
		if (runGoalId === null) {
			runGoalId = created.id;
			runStartedAt = now;
		}
		return created;
	}

	function pauseIfContinuationToolMissing(ctx: ExtensionContext): boolean {
		if (pi.getActiveTools().includes("update_goal")) return false;
		if (goal?.status === "active") {
			setGoal({ ...goal, status: "paused", updatedAt: Date.now() }, ctx);
			ctx.ui.notify("Goal paused because update_goal is disabled", "warning");
		}
		return true;
	}

	function sendGoalMessage(ctx: ExtensionContext, goalId: string, content?: string): void {
		continuationTimer = null;
		if (!goal || goal.id !== goalId || goal.status !== "active" || pauseIfContinuationToolMissing(ctx)) {
			continuationQueuedFor = null;
			return;
		}
		let ready = false;
		try {
			ready = ctx.isIdle() && !ctx.hasPendingMessages();
		} catch {
			continuationQueuedFor = null;
			return;
		}
		if (!ready) {
			continuationTimer = setTimeout(() => sendGoalMessage(ctx, goalId, content), CONTINUATION_RETRY_MS);
			continuationTimer.unref?.();
			return;
		}
		continuationQueuedFor = goalId;
		pi.sendMessage(
			{
				customType: CONTINUATION_MESSAGE,
				content: content ?? renderContinuation(goal),
				display: false,
				details: { goalId, status: goal.status, timestamp: Date.now() },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	function scheduleContinuation(ctx: ExtensionContext, content?: string): void {
		if (!goal || goal.status !== "active" || pauseIfContinuationToolMissing(ctx)) return;
		const goalId = goal.id;
		if (continuationQueuedFor === goalId || continuationTimer !== null) return;
		if (ctx.mode === "print") {
			sendGoalMessage(ctx, goalId, content);
			return;
		}
		continuationTimer = setTimeout(() => sendGoalMessage(ctx, goalId, content), 0);
		continuationTimer.unref?.();
	}

	function pauseActiveGoal(ctx: ExtensionContext): void {
		if (!goal || goal.status !== "active") return;
		setGoal({ ...goal, status: "paused", updatedAt: Date.now() }, ctx);
	}

	function recordCurrentAssistantMessage(ctx: ExtensionContext, toolCallId: string, accountUsage: boolean): void {
		if (!goal) return;
		const entries = ctx.sessionManager.getBranch();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type?: string; message?: unknown };
			if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
			const message = entry.message as { role?: unknown; content?: unknown };
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
			const ownsToolCall = message.content.some((part) => {
				if (!part || typeof part !== "object") return false;
				const block = part as { type?: unknown; id?: unknown };
				return block.type === "toolCall" && block.id === toolCallId;
			});
			if (!ownsToolCall) return;
			const key = assistantMessageKey(entry.message);
			if (!key || handledAssistantMessages.has(key)) return;
			const accountingGoalId = goal.id;
			const tokens = accountUsage ? assistantUsage(entry.message) : 0;
			if (tokens > 0) goal = { ...goal, tokensUsed: goal.tokensUsed + tokens, updatedAt: Date.now() };
			handledAssistantMessages.set(key, accountingGoalId);
			return;
		}
	}

	function goalToolResult(current: GoalState | null): string {
		if (!current) return JSON.stringify({ goal: null });
		const remainingTokens = current.tokenBudget === null ? null : Math.max(0, current.tokenBudget - current.tokensUsed);
		return JSON.stringify({ goal: current, remainingTokens }, null, 2);
	}

	pi.registerTool({
		name: "get_goal",
		label: "Get Goal",
		description: "Get the current goal for this session, including status, budget, token usage, elapsed time, and remaining token budget.",
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute() {
			const current = reportedGoal();
			return { content: [{ type: "text", text: goalToolResult(current) }], details: { goal: current } };
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", "get_goal"), 0, 0);
		},
		renderResult(result, _options, theme) {
			const stored = storedResultGoal(result);
			const text = stored === null
				? theme.fg("dim", "No goal")
				: stored ? theme.fg("muted", `${goalStatusLabel(stored.status)} · ${stored.objective}`) : theme.fg("dim", "Goal unavailable");
			return new Text(text, 0, 0);
		},
	});

	pi.registerTool({
		name: "create_goal",
		label: "Create Goal",
		description: "Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. Set token_budget only when explicitly requested. Fails while an unfinished goal exists.",
		parameters: CreateGoalParams,
		executionMode: "sequential",
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			if (isUnfinishedGoal(goal)) throw new Error("Cannot create a new goal because this session has an unfinished goal; complete or clear the existing goal first.");
			const created = createGoal(params.objective, params.token_budget, ctx);
			recordCurrentAssistantMessage(ctx, toolCallId, false);
			ctx.ui.notify("Goal active", "info");
			return { content: [{ type: "text", text: goalToolResult(created) }], details: { goal: cloneGoal(created) } };
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", "create_goal ") + theme.fg("muted", args.objective), 0, 0);
		},
		renderResult(_result, _options, theme) {
			return new Text(theme.fg("success", "Goal active"), 0, 0);
		},
	});

	pi.registerTool({
		name: "update_goal",
		label: "Update Goal",
		description: `Update the existing goal only to mark it achieved or genuinely blocked.
Set complete only when the objective is actually achieved and no required work remains.
Set blocked only when the same blocker has repeated for at least three consecutive goal turns and meaningful progress requires user input or an external-state change.
Do not use blocked merely because work is hard, slow, uncertain, or incomplete. Pause/resume/budget status changes are controlled by the user or system.`,
		parameters: UpdateGoalParams,
		executionMode: "sequential",
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			if (!goal) throw new Error("Cannot update goal because this session has no goal.");
			turnGoalId = goal.id;
			recordCurrentAssistantMessage(ctx, toolCallId, goal.status === "active");
			if (params.status === "blocked" && goal.status !== "active") throw new Error("Only an active goal can be marked blocked.");
			if (params.status === "complete" && goal.status === "complete") throw new Error("Goal is already complete.");
			const liveElapsed = runGoalId === goal.id && runStartedAt !== null ? Math.max(0, (Date.now() - runStartedAt) / 1_000) : 0;
			const status = statusAfterGoalUpdate(goal, params.status);
			const updated: GoalState = {
				...goal,
				status,
				timeUsedSeconds: goal.timeUsedSeconds + liveElapsed,
				updatedAt: Date.now(),
			};
			setGoal(updated, ctx);
			runStartedAt = null;
			const reported = cloneGoal(updated);
			stoppedThisTurn = { goalId: updated.id, turnSequence };
			stoppedRunGoalId = updated.id;
			const completionGuidance = status === "complete"
				? "\nGoal achieved. Report the completion summary to the user."
				: status === "budget_limited" ? `\n${renderBudgetLimit(reported)}` : "";
			ctx.ui.notify(
				status === "complete" ? "Goal achieved" : status === "budget_limited" ? "Goal budget reached" : "Goal blocked",
				status === "complete" ? "info" : "warning",
			);
			return {
				content: [{ type: "text", text: `${goalToolResult(reported)}${completionGuidance}` }],
				details: { goal: cloneGoal(reported) },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", "update_goal ") + theme.fg(args.status === "complete" ? "success" : "warning", args.status), 0, 0);
		},
		renderResult(result, _options, theme) {
			const stored = storedResultGoal(result);
			const status = stored?.status;
			return new Text(theme.fg(status === "complete" ? "success" : "warning", status ? `Goal ${goalStatusLabel(status)}` : "Goal unavailable"), 0, 0);
		},
	});

	pi.registerCommand("goal", {
		description: "Set or view a Codex-style goal: /goal [<objective>|clear|edit|pause|resume]",
		getArgumentCompletions(prefix) {
			const commands = ["clear", "edit", "pause", "resume"];
			const matches = commands.filter((command) => command.startsWith(prefix.trim().toLowerCase()));
			return matches.length ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (rawArgs, ctx) => {
			currentCtx = ctx;
			const args = rawArgs.trim();
			if (!args) {
				const current = reportedGoal();
				ctx.ui.notify(current ? goalSummary(current) : "No goal is currently set.\nUsage: /goal [<objective>|clear|edit|pause|resume]", "info");
				return;
			}
			const command = args.toLowerCase();
			if (command === "clear") {
				if (!goal) {
					ctx.ui.notify("No goal to clear", "info");
					return;
				}
				const abortGoalRun = goal.status === "active" && runGoalId === goal.id && !ctx.isIdle();
				setGoal(null, ctx);
				if (abortGoalRun) ctx.abort();
				ctx.ui.notify("Goal cleared", "info");
				return;
			}
			if (command === "pause") {
				if (!goal || goal.status !== "active") {
					ctx.ui.notify("Only an active goal can be paused.", "warning");
					return;
				}
				pauseActiveGoal(ctx);
				if (!ctx.isIdle()) ctx.abort();
				ctx.ui.notify("Goal paused", "info");
				return;
			}
			if (command === "resume") {
				if (!goal || !canResumeGoal(goal)) {
					ctx.ui.notify("This goal cannot be resumed. Budget-limited and completed goals must be edited or cleared.", "warning");
					return;
				}
				setGoal({ ...goal, status: "active", updatedAt: Date.now() }, ctx);
				ctx.ui.notify("Goal active", "info");
				scheduleContinuation(ctx);
				return;
			}
			if (command === "edit") {
				if (!goal) {
					ctx.ui.notify("No goal is currently set.", "warning");
					return;
				}
				if (!ctx.hasUI) {
					ctx.ui.notify("/goal edit requires interactive mode.", "warning");
					return;
				}
				const edited = await ctx.ui.editor("Edit goal", goal.objective);
				if (edited === undefined || edited.trim() === goal.objective) return;
				let objective: string;
				try { objective = normalizeObjective(edited); }
				catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); return; }
				const editedGoalId = goal.id;
				const wasActive = goal.status === "active";
				if (wasActive && !ctx.isIdle()) {
					ctx.abort();
					await ctx.waitForIdle();
					if (!goal || goal.id !== editedGoalId) {
						ctx.ui.notify("Goal changed while the active run was stopping; edit was not applied.", "warning");
						return;
					}
				}
				const status = statusAfterEdit(goal, wasActive);
				setGoal({ ...goal, objective, status, updatedAt: Date.now() }, ctx);
				ctx.ui.notify(`Goal ${goalStatusLabel(status)}`, "info");
				if (status === "active") scheduleContinuation(ctx, renderObjectiveUpdated(goal!));
				return;
			}

			let objective: string;
			try { objective = normalizeObjective(args); }
			catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); return; }
			if (isUnfinishedGoal(goal)) {
				if (!ctx.hasUI) {
					ctx.ui.notify("An unfinished goal exists; use /goal clear first.", "warning");
					return;
				}
				const replace = await ctx.ui.confirm("Replace goal?", `New objective: ${objective}`);
				if (!replace) return;
			}
			if (!ctx.isIdle()) {
				ctx.abort();
				await ctx.waitForIdle();
			}
			const created = createGoal(objective, null, ctx);
			ctx.ui.notify("Goal active", "info");
			scheduleContinuation(ctx, `[CODEX GOAL START goalId=${created.id}]\n\n${renderContinuation(created)}`);
		},
	});

	pi.on("tool_call", async (event) => {
		const allowedAfterStop = event.toolName === "get_goal" || (goal?.status === "budget_limited" && event.toolName === "update_goal");
		if (stoppedRunGoalId && !allowedAfterStop) {
			return { block: true, reason: `Goal ${stoppedRunGoalId} was stopped in this agent run. End the run and report the result.` };
		}
		if (stoppedThisTurn && stoppedThisTurn.turnSequence === turnSequence && !allowedAfterStop) {
			return { block: true, reason: `Goal ${stoppedThisTurn.goalId} was stopped earlier in this turn. End the turn and report the result.` };
		}
	});

	pi.on("context", async (event) => {
		let latest = -1;
		for (let index = 0; index < event.messages.length; index++) {
			const message = event.messages[index] as { customType?: string; details?: { goalId?: string; status?: string } };
			if (
				message.customType === CONTINUATION_MESSAGE
				&& goal
				&& message.details?.goalId === goal.id
				&& message.details.status === goal.status
			) latest = index;
		}
		const messages = event.messages.filter((message, index) => {
			const candidate = message as { customType?: string };
			return candidate.customType !== CONTINUATION_MESSAGE || index === latest;
		});
		return messages.length === event.messages.length ? undefined : { messages };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		currentCtx = ctx;
		if (!goal || goal.status === "complete") return;
		let content: string;
		if (goal.status === "active") content = renderContinuation(goal);
		else if (goal.status === "budget_limited") content = renderBudgetLimit(goal);
		else if (canResumeGoal(goal)) {
			content = `[CODEX GOAL ${goal.status.toUpperCase()}]\nObjective: ${escapeXmlText(goal.objective)}\nThe goal is stopped. Do not continue substantive goal work unless the user runs /goal resume. You may call update_goal with complete only if current evidence already proves the objective is achieved.`;
		} else return;
		return {
			message: {
				customType: CONTINUATION_MESSAGE,
				content,
				display: false,
				details: { goalId: goal.id, status: goal.status, timestamp: Date.now() },
			},
		};
	});

	pi.on("agent_start", async (_event, ctx) => {
		currentCtx = ctx;
		continuationQueuedFor = null;
		if (continuationTimer) clearTimeout(continuationTimer);
		continuationTimer = null;
		if (goal?.status === "active") {
			runGoalId = goal.id;
			runStartedAt = Date.now();
			stoppedRunGoalId = null;
		} else {
			runStartedAt = null;
		}
		updateUi(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		turnSequence += 1;
		stoppedThisTurn = null;
		turnGoalId = goal?.status === "active" ? goal.id : null;
		updateUi(ctx);
	});

	pi.on("turn_end", async (event, ctx) => {
		const messageKey = assistantMessageKey(event.message);
		const handledGoalId = messageKey ? handledAssistantMessages.get(messageKey) : undefined;
		if (messageKey) handledAssistantMessages.delete(messageKey);
		if (!goal || !turnGoalId || goal.id !== turnGoalId) return;
		const tokens = handledGoalId === goal.id ? 0 : assistantUsage(event.message);
		if (tokens > 0) goal = { ...goal, tokensUsed: goal.tokensUsed + tokens, updatedAt: Date.now() };
		const aborted = isAbortedMessage(event.message);
		terminalErrorPending = terminalErrorStatus(event.message);
		const nextStatus = statusAfterTurn(goal, aborted);
		if (nextStatus !== goal.status) {
			goal = { ...goal, status: nextStatus, updatedAt: Date.now() };
			clearContinuation();
			if (nextStatus === "budget_limited") {
				terminalErrorPending = null;
				stoppedRunGoalId = goal.id;
				pendingBudgetWrapGoalId = goal.id;
				ctx.abort();
			}
		}
		persist();
		updateUi(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (goal && runGoalId === goal.id && runStartedAt !== null) {
			const elapsed = Math.max(0, (Date.now() - runStartedAt) / 1_000);
			if (elapsed > 0) goal = { ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsed, updatedAt: Date.now() };
			if ((ctx.signal?.aborted || event.messages.some(isAbortedMessage)) && goal.status === "active") {
				goal = { ...goal, status: "paused", updatedAt: Date.now() };
				clearContinuation();
			}
			persist();
		}
		runStartedAt = null;
		updateUi(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const budgetWrapGoalId = pendingBudgetWrapGoalId;
		pendingBudgetWrapGoalId = null;
		runGoalId = null;
		runStartedAt = null;
		stoppedRunGoalId = null;
		if (budgetWrapGoalId && goal?.id === budgetWrapGoalId && goal.status === "budget_limited") {
			terminalErrorPending = null;
			stoppedRunGoalId = budgetWrapGoalId;
			pi.sendMessage(
				{ customType: CONTINUATION_MESSAGE, content: renderBudgetLimit(goal), display: false, details: { goalId: goal.id, status: goal.status, timestamp: Date.now() } },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
			return;
		}
		if (goal?.status !== "active") {
			terminalErrorPending = null;
			return;
		}
		if (terminalErrorPending) {
			setGoal({ ...goal, status: terminalErrorPending, updatedAt: Date.now() }, ctx);
			ctx.ui.notify(terminalErrorPending === "usage_limited" ? "Goal hit usage limits" : "Goal paused after provider error", "warning");
			terminalErrorPending = null;
			return;
		}
		scheduleContinuation(ctx);
	});

	pi.on("session_start", async (event, ctx) => {
		currentCtx = ctx;
		clearContinuation();
		restore(ctx);
		updateUi(ctx);
		if (event.reason === "resume" && goal && canResumeGoal(goal) && ctx.hasUI) {
			const resume = await ctx.ui.confirm("Resume paused goal?", `Goal: ${goal.objective}`);
			if (resume) setGoal({ ...goal, status: "active", updatedAt: Date.now() }, ctx);
		}
		if (goal?.status === "active" && ctx.mode !== "print") scheduleContinuation(ctx);
		if (ctx.mode === "tui" && !statusTimer) {
			statusTimer = setInterval(() => { if (currentCtx) updateUi(currentCtx); }, 1_000);
			statusTimer.unref?.();
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		clearContinuation();
		restore(ctx);
		updateUi(ctx);
		if (goal?.status === "active") scheduleContinuation(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (goal && runGoalId === goal.id && runStartedAt !== null) {
			const elapsed = Math.max(0, (Date.now() - runStartedAt) / 1_000);
			if (elapsed > 0) goal = { ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsed, updatedAt: Date.now() };
			persist();
		}
		clearContinuation();
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = null;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		currentCtx = null;
	});
}
