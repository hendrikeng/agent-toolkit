import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { calculateCost } from "@earendil-works/pi-ai"
import { applyFastMode, fastModeCostMultiplier, readFastMode, supportsFastMode, writeFastMode } from "./fast-core.ts"

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	ctx.ui.setStatus("codex-fast", enabled ? "fast" : undefined)
}

export default function codexFastExtension(pi: ExtensionAPI) {
	let enabled = readFastMode()

	pi.registerCommand("fast", {
		description: "Enable or disable OpenAI Codex Fast mode",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const action = args.trim() || "status"
			if (action === "status") {
				ctx.ui.notify(`Codex Fast mode is ${enabled ? "on" : "off"}`, "info")
				return
			}
			if (action !== "on" && action !== "off") {
				ctx.ui.notify("Use /fast on, /fast off, or /fast status", "error")
				return
			}

			const next = action === "on"
			writeFastMode(next)
			enabled = next
			updateStatus(ctx, enabled)
			ctx.ui.notify(`Codex Fast mode is ${action}`, enabled ? "warning" : "info")
		},
	})

	pi.on("before_provider_request", (event, ctx) => applyFastMode(ctx.model?.provider, enabled, event.payload))
	pi.on("message_end", (event, ctx) => {
		if (!enabled || event.message.role !== "assistant" || event.message.provider !== "openai-codex" || !supportsFastMode(event.message.model)) return
		const model = ctx.modelRegistry.find(event.message.provider, event.message.model)
		if (!model) return
		const standard = calculateCost(model, event.message.usage)
		if (event.message.usage.cost.total !== standard.total) return
		const multiplier = fastModeCostMultiplier(model.id)
		const cost = {
			input: standard.input * multiplier,
			output: standard.output * multiplier,
			cacheRead: standard.cacheRead * multiplier,
			cacheWrite: standard.cacheWrite * multiplier,
			total: standard.total * multiplier,
		}
		return { message: { ...event.message, usage: { ...event.message.usage, cost } } }
	})
	pi.on("session_start", (_event, ctx) => updateStatus(ctx, enabled))
}
