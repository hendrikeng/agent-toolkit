import { existsSync, mkdirSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export const CODEX_ACCOUNT_PROFILES = ["personal", "business"] as const
export type CodexAccountProfile = (typeof CODEX_ACCOUNT_PROFILES)[number]

export function codexProfileHome(profile: CodexAccountProfile, root = join(homedir(), ".codex-accounts")): string {
	return join(root, profile)
}

export function activateCodexProfile(
	profile: CodexAccountProfile,
	root?: string,
	sharedHome = join(homedir(), ".codex"),
): { home: string } | { error: "login-required" | "safety-policy-missing" } {
	const profileHome = codexProfileHome(profile, root)
	if (!existsSync(join(profileHome, "auth.json"))) return { error: "login-required" }

	const sharedPolicy = join(sharedHome, "rules", "agent-safety.rules")
	if (!existsSync(sharedPolicy)) return { error: "safety-policy-missing" }

	const profileRules = join(profileHome, "rules")
	mkdirSync(profileRules, { recursive: true, mode: 0o700 })
	const profilePolicy = join(profileRules, "agent-safety.rules")
	if (!existsSync(profilePolicy)) symlinkSync(sharedPolicy, profilePolicy)

	process.env.CODEX_HOME = profileHome
	return { home: profileHome }
}

function currentProfile(root?: string): CodexAccountProfile | undefined {
	if (!process.env.CODEX_HOME) return undefined
	return CODEX_ACCOUNT_PROFILES.find(
		(profile) => resolve(process.env.CODEX_HOME!) === resolve(codexProfileHome(profile, root)),
	)
}

function piProfile(): CodexAccountProfile | undefined {
	const profile = process.env.AGENT_TOOLKIT_CODEX_ACCOUNT
	return CODEX_ACCOUNT_PROFILES.includes(profile as CodexAccountProfile) ? (profile as CodexAccountProfile) : undefined
}

function updateStatus(ctx: ExtensionContext): void {
	const codex = currentProfile()
	const pi = piProfile()
	const status = pi && codex && pi !== codex ? `pi:${pi} codex:${codex}` : pi || codex ? `account:${pi ?? codex}` : undefined
	ctx.ui.setStatus("codex-account", status)
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

			const result = activateCodexProfile(profile as CodexAccountProfile)
			if ("error" in result) {
				const message =
					result.error === "login-required"
						? `Log in first: CODEX_HOME="${codexProfileHome(profile as CodexAccountProfile)}" codex login`
						: "Codex safety policy is missing; rerun agent-toolkit/install.sh"
				ctx.ui.notify(message, "warning")
				return
			}

			updateStatus(ctx)
			const pi = piProfile()
			ctx.ui.notify(
				pi === profile
					? `Account is ${profile}`
					: `Codex subprocesses now use ${profile}. Pi ${pi ? `still uses ${pi}` : "does not switch while running"}; select ${profile} in Orca and restart Pi.`,
				pi === profile ? "info" : "warning",
			)
		},
	})

	pi.on("session_start", (_event, ctx) => updateStatus(ctx))
}
