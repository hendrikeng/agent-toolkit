import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export const CODEX_ACCOUNT_PROFILES = ["tracn", "private"] as const
export type CodexAccountProfile = (typeof CODEX_ACCOUNT_PROFILES)[number]

export function codexProfileHome(profile: CodexAccountProfile, root = join(homedir(), ".codex-accounts")): string {
	return join(root, profile)
}

export function activateCodexProfile(profile: CodexAccountProfile, root?: string): string | undefined {
	const profileHome = codexProfileHome(profile, root)
	if (!existsSync(join(profileHome, "auth.json"))) return undefined
	process.env.CODEX_HOME = profileHome
	return profileHome
}

function currentProfile(root?: string): CodexAccountProfile | undefined {
	if (!process.env.CODEX_HOME) return undefined
	return CODEX_ACCOUNT_PROFILES.find(
		(profile) => resolve(process.env.CODEX_HOME!) === resolve(codexProfileHome(profile, root)),
	)
}

function updateStatus(ctx: ExtensionContext): void {
	const profile = currentProfile()
	ctx.ui.setStatus("codex-account", profile ? `codex:${profile}` : undefined)
}

export default function codexAccountExtension(pi: ExtensionAPI) {
	pi.registerCommand("codex-account", {
		description: "Switch the Codex account used by future Codex processes",
		getArgumentCompletions: (prefix) =>
			CODEX_ACCOUNT_PROFILES.filter((profile) => profile.startsWith(prefix)).map((profile) => ({
				value: profile,
				label: profile,
			})),
		handler: async (args, ctx) => {
			let profile = args.trim() as CodexAccountProfile | ""
			if (!profile) {
				const selected = await ctx.ui.select("Codex account", [...CODEX_ACCOUNT_PROFILES])
				profile = (selected ?? "") as CodexAccountProfile | ""
			}
			if (!CODEX_ACCOUNT_PROFILES.includes(profile as CodexAccountProfile)) {
				ctx.ui.notify(`Choose one of: ${CODEX_ACCOUNT_PROFILES.join(", ")}`, "error")
				return
			}

			const profileHome = activateCodexProfile(profile as CodexAccountProfile)
			if (!profileHome) {
				const home = codexProfileHome(profile as CodexAccountProfile)
				ctx.ui.notify(`Log in first: CODEX_HOME="${home}" codex login`, "warning")
				return
			}

			updateStatus(ctx)
			ctx.ui.notify(`Codex account switched to ${profile}`, "info")
		},
	})

	pi.on("session_start", (_event, ctx) => updateStatus(ctx))
}
