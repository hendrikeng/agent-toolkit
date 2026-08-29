import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const MODES = new Set(["lite", "full", "ultra", "review", "off"])

type SessionEntry = { type?: string; customType?: string; data?: { mode?: unknown } }

export function resolvePonytailMode(
	entries: SessionEntry[],
	envMode = process.env.PONYTAIL_DEFAULT_MODE,
	configRoot = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
): string {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]
		const mode = entry?.type === "custom" && entry.customType === "ponytail-mode" ? entry.data?.mode : undefined
		if (typeof mode === "string" && MODES.has(mode.toLowerCase())) return mode.toLowerCase()
	}
	if (envMode && MODES.has(envMode.toLowerCase())) return envMode.toLowerCase()
	try {
		const mode = JSON.parse(readFileSync(join(configRoot, "ponytail", "config.json"), "utf8"))?.defaultMode
		if (typeof mode === "string" && MODES.has(mode.toLowerCase())) return mode.toLowerCase()
	} catch {}
	return "full"
}

function sessionEntries(ctx: ExtensionContext): SessionEntry[] {
	const manager = ctx.sessionManager as typeof ctx.sessionManager & { getEntries?(): unknown[] }
	return (manager.getBranch?.() ?? manager.getEntries?.() ?? []) as SessionEntry[]
}

function syncStatuses(ctx: ExtensionContext, mode: string): string {
	ctx.ui.setStatus("pi-permission-system", undefined)
	ctx.ui.setStatus("ponytail", undefined)
	ctx.ui.setStatus("03-yolo", process.env.AGENT_TOOLKIT_PI_AGENT_DIR ? ctx.ui.theme.fg("muted", "| YOLO") : undefined)
	ctx.ui.setStatus("04-ponytail", mode === "off" ? undefined : ctx.ui.theme.fg("muted", `| PONYTAIL ${mode.toUpperCase()}`))
	return mode
}

export default function statusFormatExtension(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined
	let mode: string | undefined
	let fallbackMode: string | undefined
	const sync = (ctx: ExtensionContext, force = false) => {
		const next = resolvePonytailMode(sessionEntries(ctx), fallbackMode)
		if (force || next !== mode) mode = syncStatuses(ctx, next)
	}
	pi.on("session_start", (_event, ctx) => {
		fallbackMode = resolvePonytailMode([])
		setTimeout(() => sync(ctx, true), 0)
		if (ctx.mode !== "tui") return
		if (timer) clearInterval(timer)
		// ponytail: poll session state until Pi exposes status formatting or entry-change events.
		timer = setInterval(() => sync(ctx), 250)
	})
	for (const event of ["agent_start", "agent_end", "agent_settled"] as const) {
		pi.on(event, (_event, ctx) => setTimeout(() => sync(ctx, true), 0))
	}
	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer)
		timer = undefined
	})
}
