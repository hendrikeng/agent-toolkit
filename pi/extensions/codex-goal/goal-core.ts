export const MAX_GOAL_OBJECTIVE_CHARS = 4_000;

export const GOAL_STATUSES = [
	"active",
	"paused",
	"blocked",
	"usage_limited",
	"budget_limited",
	"complete",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalState {
	id: string;
	objective: string;
	status: GoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

export interface PersistedGoalState {
	goal: GoalState | null;
}

export function normalizeObjective(value: string): string {
	const objective = value.trim();
	if (!objective) throw new Error("Goal objective must not be empty.");
	if ([...objective].length > MAX_GOAL_OBJECTIVE_CHARS) {
		throw new Error(`Goal objective must be at most ${MAX_GOAL_OBJECTIVE_CHARS} characters.`);
	}
	return objective;
}

export function normalizeTokenBudget(value: unknown): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error("Goal token budget must be a positive integer.");
	}
	return value;
}

export function isGoalState(value: unknown): value is GoalState {
	if (!value || typeof value !== "object") return false;
	const goal = value as Record<string, unknown>;
	return (
		typeof goal.id === "string" && goal.id.length > 0 &&
		typeof goal.objective === "string" && goal.objective.trim().length > 0 &&
		typeof goal.status === "string" && (GOAL_STATUSES as readonly string[]).includes(goal.status) &&
		(goal.tokenBudget === null || (typeof goal.tokenBudget === "number" && Number.isSafeInteger(goal.tokenBudget) && goal.tokenBudget > 0)) &&
		typeof goal.tokensUsed === "number" && Number.isFinite(goal.tokensUsed) && goal.tokensUsed >= 0 &&
		typeof goal.timeUsedSeconds === "number" && Number.isFinite(goal.timeUsedSeconds) && goal.timeUsedSeconds >= 0 &&
		typeof goal.createdAt === "number" && Number.isFinite(goal.createdAt) &&
		typeof goal.updatedAt === "number" && Number.isFinite(goal.updatedAt)
	);
}

export function isUnfinishedGoal(goal: GoalState | null): boolean {
	return goal !== null && goal.status !== "complete";
}

export function canResumeGoal(goal: GoalState): boolean {
	return goal.status === "paused" || goal.status === "blocked" || goal.status === "usage_limited";
}

export function statusAfterEdit(goal: GoalState, reactivate = false): GoalStatus {
	if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) return "budget_limited";
	return goal.status === "complete" || reactivate ? "active" : goal.status;
}

export function statusAfterGoalUpdate(goal: GoalState, requested: "complete" | "blocked"): GoalStatus {
	if (requested === "blocked" && goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
		return "budget_limited";
	}
	return requested;
}

export function goalTokensForUsage(usage: unknown): number {
	if (!usage || typeof usage !== "object") return 0;
	const candidate = usage as { input?: unknown; output?: unknown; cacheWrite?: unknown };
	const tokenFields = [candidate.input, candidate.output, candidate.cacheWrite];
	if (!tokenFields.every((value) => typeof value === "number" && Number.isFinite(value))) return 0;
	return Math.floor(tokenFields.reduce<number>((sum, value) => sum + Math.max(0, value as number), 0));
}

export function statusAfterTurn(goal: GoalState, aborted: boolean): GoalStatus {
	if (goal.status === "complete" || goal.status === "budget_limited") return goal.status;
	if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) return "budget_limited";
	if (goal.status !== "active") return goal.status;
	return aborted ? "paused" : "active";
}

export function classifyTerminalError(errorMessage: string | undefined): GoalStatus {
	const message = (errorMessage ?? "").toLowerCase();
	return /(usage|quota|rate)[ _-]?limit|insufficient[_ -]?quota|billing|credits? exhausted/.test(message)
		? "usage_limited"
		: "paused";
}

export function escapeXmlText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderPromptTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key: string) => values[key] ?? "");
}

export function formatTokens(value: number): string {
	const tokens = Math.max(0, Math.floor(value));
	if (tokens < 1_000) return String(tokens);
	if (tokens < 1_000_000) {
		const compact = tokens >= 100_000 ? Math.round(tokens / 1_000) : Math.round(tokens / 100) / 10;
		return `${compact}K`;
	}
	const compact = tokens >= 100_000_000 ? Math.round(tokens / 1_000_000) : Math.round(tokens / 100_000) / 10;
	return `${compact}M`;
}

export function formatElapsed(totalSeconds: number): string {
	let seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86_400);
	seconds %= 86_400;
	const hours = Math.floor(seconds / 3_600);
	seconds %= 3_600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	if (days > 0) return `${days}d ${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function goalUsage(goal: GoalState, liveSeconds = 0): string {
	if (goal.tokenBudget !== null) {
		return `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`;
	}
	return formatElapsed(goal.timeUsedSeconds + Math.max(0, liveSeconds));
}

export function goalStatusLabel(status: GoalStatus): string {
	switch (status) {
		case "active": return "active";
		case "paused": return "paused";
		case "blocked": return "blocked";
		case "usage_limited": return "usage limited";
		case "budget_limited": return "limited by budget";
		case "complete": return "complete";
	}
}

export function goalSummary(goal: GoalState): string {
	const lines = [
		"Goal",
		`Status: ${goalStatusLabel(goal.status)}`,
		`Objective: ${goal.objective}`,
		`Time used: ${formatElapsed(goal.timeUsedSeconds)}`,
		`Tokens used: ${formatTokens(goal.tokensUsed)}`,
	];
	if (goal.tokenBudget !== null) lines.push(`Token budget: ${formatTokens(goal.tokenBudget)}`);
	lines.push("");
	if (goal.status === "active") lines.push("Commands: /goal edit, /goal pause, /goal clear");
	else if (canResumeGoal(goal)) lines.push("Commands: /goal edit, /goal resume, /goal clear");
	else lines.push("Commands: /goal edit, /goal clear");
	return lines.join("\n");
}
