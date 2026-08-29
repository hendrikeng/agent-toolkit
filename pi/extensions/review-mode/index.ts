import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export const REVIEW_MODES = ["auto", "off"] as const
export type ReviewMode = (typeof REVIEW_MODES)[number]

const STATE_TYPE = "review-mode-state"
const AUTO_INSTRUCTIONS = `SESSION REVIEW MODE IS AUTO (the default).
- Do not run autoreview, ponytail-review, reviewer panels, or any other AI/second-model review for questions, read-only investigation, ordinary edits, task completion, or because focused tests passed.
- Consider an automatic review only once when the current user request explicitly asks to commit, push, open or update a PR, merge, or ship.
- At that boundary, apply the risk triggers in AGENTS.md and skip AI review when none applies. An explicit user review request always runs.
- Ordinary edits use only the smallest directly relevant deterministic validation; never broaden tests to compensate for a skipped review.`
const OFF_INSTRUCTIONS = `SESSION REVIEW MODE IS OFF by explicit user choice.
- Do not automatically run autoreview, ponytail-review, reviewer panels, or any other AI/second-model review, including at commit, push, PR, merge, or ship boundaries.
- Run an AI review only when the user explicitly requests one after this mode was enabled.
- Continue only the smallest directly relevant deterministic validation. Do not substitute broad test suites or audits for the skipped review.`

type StateEntry = {
	type?: string
	customType?: string
	data?: { mode?: unknown }
}

export function restoreReviewMode(entries: readonly StateEntry[]): ReviewMode {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]
		if (entry.type === "custom" && entry.customType === STATE_TYPE && REVIEW_MODES.includes(entry.data?.mode as ReviewMode)) {
			return entry.data!.mode as ReviewMode
		}
	}
	return "auto"
}

export function reviewModeInstructions(mode: ReviewMode): string {
	return mode === "off" ? OFF_INSTRUCTIONS : AUTO_INSTRUCTIONS
}

function updateStatus(mode: ReviewMode, ctx: ExtensionContext): void {
	ctx.ui.setStatus("review-mode", ctx.ui.theme.fg(mode === "off" ? "warning" : "muted", `| REVIEWS ${mode.toUpperCase()}`))
}

export default function reviewModeExtension(pi: ExtensionAPI) {
	let mode: ReviewMode = "auto"

	pi.registerCommand("reviews", {
		description: "Set session AI review mode: auto or off",
		getArgumentCompletions: (prefix) =>
			REVIEW_MODES.filter((candidate) => candidate.startsWith(prefix)).map((candidate) => ({
				value: candidate,
				label: candidate,
			})),
		handler: async (args, ctx) => {
			const requested = args.trim()
			if (!requested) {
				ctx.ui.notify(`AI review mode: ${mode}`, "info")
				return
			}
			if (!REVIEW_MODES.includes(requested as ReviewMode)) {
				ctx.ui.notify(`Choose one of: ${REVIEW_MODES.join(", ")}`, "error")
				return
			}

			mode = requested as ReviewMode
			pi.appendEntry(STATE_TYPE, { mode })
			updateStatus(mode, ctx)
			ctx.ui.notify(mode === "off" ? "Automatic AI reviews disabled for this session" : "Risk-gated AI reviews restored", "info")
		},
	})

	pi.on("session_start", (_event, ctx) => {
		mode = restoreReviewMode(ctx.sessionManager.getEntries())
		updateStatus(mode, ctx)
	})

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${reviewModeInstructions(mode)}`,
	}))
}
