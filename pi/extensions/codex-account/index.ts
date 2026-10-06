import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Provider } from "@earendil-works/pi-ai"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const agentDirectory = () => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const ACCOUNT_PROVIDER = "toolkit-openai-codex"

export interface CodexAccount {
	profile: string
	email: string
}

export interface CodexUsageWindow {
	remainingPercent: number
	windowMinutes?: number
	resetsAt?: number
}

export interface CodexUsage {
	primary?: CodexUsageWindow
	secondary?: CodexUsageWindow
	availableResets?: number
	resetExpiresAt?: number
}

function resetTimestamp(value: unknown, afterSeconds: unknown, now = Date.now()): number | undefined {
	const timestamp = Number(value)
	if (Number.isFinite(timestamp) && timestamp > 0) return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
	const after = Number(afterSeconds)
	return Number.isFinite(after) && after >= 0 ? now + after * 1000 : undefined
}

export function parseCodexUsage(headers: Readonly<Record<string, string | undefined>>, now = Date.now()): CodexUsage | undefined {
	const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]))
	const window = (name: "primary" | "secondary"): CodexUsageWindow | undefined => {
		const used = Number(normalized[`x-codex-${name}-used-percent`])
		if (!Number.isFinite(used)) return undefined
		const minutes = Number(normalized[`x-codex-${name}-window-minutes`])
		const reset = resetTimestamp(normalized[`x-codex-${name}-reset-at`], normalized[`x-codex-${name}-reset-after-seconds`], now)
		return {
			remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - used))),
			...(Number.isFinite(minutes) && minutes > 0 ? { windowMinutes: minutes } : {}),
			...(reset ? { resetsAt: reset } : {}),
		}
	}
	const usage = { primary: window("primary"), secondary: window("secondary") }
	return usage.primary || usage.secondary ? usage : undefined
}

export function parseCodexUsagePayload(payload: unknown, now = Date.now()): CodexUsage | undefined {
	if (!payload || typeof payload !== "object") return undefined
	const wrapped = (payload as { rate_limits?: unknown }).rate_limits
	const root = wrapped && typeof wrapped === "object" ? wrapped : payload
	const rateLimit = (root as { rate_limit?: unknown }).rate_limit
	if (!rateLimit || typeof rateLimit !== "object") return undefined
	const window = (name: "primary_window" | "secondary_window"): CodexUsageWindow | undefined => {
		const value = (rateLimit as Record<string, unknown>)[name]
		if (!value || typeof value !== "object") return undefined
		const used = Number((value as Record<string, unknown>).used_percent)
		if (!Number.isFinite(used)) return undefined
		const seconds = Number((value as Record<string, unknown>).limit_window_seconds)
		const reset = resetTimestamp((value as Record<string, unknown>).reset_at, (value as Record<string, unknown>).reset_after_seconds, now)
		return {
			remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - used))),
			...(Number.isFinite(seconds) && seconds > 0 ? { windowMinutes: Math.ceil(seconds / 60) } : {}),
			...(reset ? { resetsAt: reset } : {}),
		}
	}
	const availableCount = Number((root as { rate_limit_reset_credits?: { available_count?: unknown } }).rate_limit_reset_credits?.available_count)
	const availableResets = Number.isSafeInteger(availableCount) && availableCount >= 0 ? availableCount : undefined
	const usage = { primary: window("primary_window"), secondary: window("secondary_window"), availableResets }
	return usage.primary || usage.secondary || availableResets !== undefined ? usage : undefined
}

export function parseCodexResetCreditsPayload(payload: unknown): Pick<CodexUsage, "availableResets" | "resetExpiresAt"> | undefined {
	if (!payload || typeof payload !== "object") return undefined
	const root = payload as { available_count?: unknown; credits?: unknown }
	const availableResets = Number(root.available_count)
	if (!Number.isSafeInteger(availableResets) || availableResets < 0) return undefined
	const expirations = Array.isArray(root.credits)
		? root.credits.flatMap((credit) => {
			if (!credit || typeof credit !== "object" || (credit as { status?: unknown }).status !== "available") return []
			const expiresAt = Date.parse(String((credit as { expires_at?: unknown }).expires_at ?? ""))
			return Number.isFinite(expiresAt) ? [expiresAt] : []
		})
		: []
	return { availableResets, ...(expirations.length ? { resetExpiresAt: Math.min(...expirations) } : {}) }
}

export function mergeCodexUsage(current: CodexUsage | undefined, latest: CodexUsage | undefined): CodexUsage | undefined {
	if (!latest) return current
	return {
		...current,
		...latest,
		primary: latest.primary ? { ...current?.primary, ...latest.primary } : current?.primary,
		secondary: latest.secondary ? { ...current?.secondary, ...latest.secondary } : current?.secondary,
		...(latest.availableResets === 0 ? { resetExpiresAt: undefined } : {}),
	}
}

function formatRemainingTime(timestamp: number | undefined, now: number): string {
	if (!timestamp) return ""
	const minutes = Math.ceil((timestamp - now) / 60_000)
	return minutes <= 0 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 2880 ? `${Math.ceil(minutes / 60)}h` : `${Math.ceil(minutes / 1440)}d`
}

export function formatCodexUsage(usage: CodexUsage | undefined, now = Date.now()): string | undefined {
	if (!usage) return undefined
	const parts = [usage.primary, usage.secondary]
		.filter((window): window is CodexUsageWindow & { windowMinutes: number } => Boolean(window?.windowMinutes))
		.map((window) => {
			const minutes = window.windowMinutes
			const duration = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
			const reset = formatRemainingTime(window.resetsAt, now)
			return `${duration} ${window.remainingPercent}%${reset ? ` ↻ ${reset}` : ""}`
		})
	if (usage.availableResets !== undefined) parts.push(`↻ ${usage.availableResets}`)
	if (usage.availableResets && usage.resetExpiresAt) parts.push(formatRemainingTime(usage.resetExpiresAt, now))
	return parts.join(" · ") || undefined
}

export function codexProfileHome(profile: string, root = join(homedir(), ".codex-accounts")): string {
	return join(root, profile)
}

function jwtClaims(token: unknown): Record<string, any> | undefined {
	if (typeof token !== "string") return undefined
	try {
		return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))
	} catch {
		return undefined
	}
}

function jwtEmail(token: unknown): string | undefined {
	const claims = jwtClaims(token)
	const email = claims?.email ?? claims?.["https://api.openai.com/profile"]?.email
	return typeof email === "string" && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined
}

function tokenExpires(token: unknown): number {
	const expires = Number(jwtClaims(token)?.exp) * 1000
	return Number.isFinite(expires) && expires > 0 ? expires : 0
}

export function codexProfileEmail(profile: string, root?: string): string | undefined {
	try {
		const auth = JSON.parse(readFileSync(join(codexProfileHome(profile, root), "auth.json"), "utf8"))
		return jwtEmail(auth?.tokens?.id_token)
	} catch {
		return undefined
	}
}


function readPiAuth(file: string): Record<string, any> {
	if (lstatSync(file).isSymbolicLink()) throw new Error("Account credentials must be regular files")
	return JSON.parse(readFileSync(file, "utf8"))
}

function writePrivateJson(file: string, value: unknown, exclusive = false): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
	if (lstatSync(dirname(file)).isSymbolicLink() || lstatSync(dirname(dirname(file))).isSymbolicLink()) throw new Error("Refusing a credential directory symlink")
	if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("Refusing a credential symlink")
	const temporary = file + ".tmp-" + process.pid
	let created = false
	try {
		writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 })
		created = true
		if (exclusive) {
			try { linkSync(temporary, file) }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
		} else renameSync(temporary, file)
		if (!exclusive) chmodSync(file, 0o600)
	} finally { if (created && existsSync(temporary)) unlinkSync(temporary) }
}

export function piAccountEmail(directory = agentDirectory()): string | undefined {
	try { return jwtEmail(readPiAuth(join(directory, "auth.json"))["openai-codex"]?.access) } catch { return undefined }
}

export async function fetchCodexUsage(
	agentDir = agentDirectory(),
	fetcher: typeof fetch = fetch,
): Promise<CodexUsage | undefined> {
	if (!agentDir) return undefined
	try {
		const credential = readPiAuth(join(agentDir, "auth.json"))["openai-codex"]
		if (!credential?.access) return undefined
		const claims = jwtClaims(credential.access)
		const accountId = credential.accountId ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
		if (typeof accountId !== "string" || !accountId) return undefined
		const headers = {
			Authorization: `Bearer ${credential.access}`,
			"ChatGPT-Account-Id": accountId,
			Accept: "application/json",
		}
		const response = await fetcher("https://chatgpt.com/backend-api/wham/usage", { headers, signal: AbortSignal.timeout(5_000) })
		if (!response.ok) return undefined
		const usage = parseCodexUsagePayload(await response.json())
		if (!usage?.availableResets) return usage
		try {
			const details = await fetcher("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", { headers, signal: AbortSignal.timeout(5_000) })
			const resets = details.ok ? parseCodexResetCreditsPayload(await details.json()) : undefined
			return resets ? { ...usage, ...resets } : usage
		} catch {
			return usage
		}
	} catch {
		return undefined
	}
}


export function piProfileAuthPath(profile: string, directory = agentDirectory()): string {
	if (!PROFILE_NAME.test(profile)) throw new Error("Invalid account profile")
	return join(directory, "auth-profiles", profile, "auth.json")
}

export function defaultPiAccount(directory = agentDirectory()): string | undefined {
	const file = join(directory, "active-codex-account.json")
	if (!existsSync(file)) return undefined
	const profile = readPiAuth(file).profile
	if (typeof profile !== "string" || !PROFILE_NAME.test(profile)) throw new Error("Invalid default account; restore active-codex-account.json from backup")
	return profile
}

export function piAccounts(directory = agentDirectory(), codexRoot = join(homedir(), ".codex-accounts")): CodexAccount[] {
	const profiles = new Set<string>()
	for (const root of [join(directory, "auth-profiles"), codexRoot]) {
		if (existsSync(root)) for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (entry.isDirectory() && PROFILE_NAME.test(entry.name)) profiles.add(entry.name)
		}
	}
	return [...profiles].flatMap(profile => {
		const email = piAccountEmail(dirname(piProfileAuthPath(profile, directory))) ?? codexProfileEmail(profile, codexRoot)
		return email ? [{ profile, email }] : []
	}).sort((a, b) => a.email.localeCompare(b.email))
}

export function reserveAccountProfile(codexRoot = join(homedir(), ".codex-accounts")): string {
	mkdirSync(codexRoot, { recursive: true, mode: 0o700 })
	for (let index = 1; ; index++) {
		const profile = "account-" + index
		try { mkdirSync(codexProfileHome(profile, codexRoot), { mode: 0o700 }); return profile }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
	}
}

export function importCodexAccount(profile: string, directory = agentDirectory(), codexRoot = join(homedir(), ".codex-accounts")): void {
	const target = piProfileAuthPath(profile, directory)
	if (existsSync(target)) return // Existing Pi credentials (including refreshed tokens) remain authoritative.
	const auth = readPiAuth(join(codexProfileHome(profile, codexRoot), "auth.json"))
	const tokens = auth.tokens, claims = jwtClaims(tokens?.access_token)
	const accountId = tokens?.account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
	if (typeof tokens?.access_token !== "string" || typeof tokens?.refresh_token !== "string" || typeof accountId !== "string") throw new Error("Complete /account add or restore this account's Pi profile from backup")
	writePrivateJson(target, { "openai-codex": { type: "oauth", access: tokens.access_token, refresh: tokens.refresh_token, expires: tokenExpires(tokens.access_token), accountId } }, true)
	// Do not erase or synchronize Codex credentials. Codex owns its own login/refresh lifecycle.
}

// Pi's normal CLI has one auth.json per agent directory. Bind only authentication
// to a selected profile; native Pi owns token refresh and locking. No runtime mirror.
export async function accountProvider(base: Provider, authPath: string): Promise<Provider> {
	if (!lstatSync(authPath).isFile() || lstatSync(authPath).isSymbolicLink() || lstatSync(dirname(authPath)).isSymbolicLink() || lstatSync(dirname(dirname(authPath))).isSymbolicLink()) throw new Error("Account credentials must be regular files")
	const { ModelRuntime } = await import("@earendil-works/pi-coding-agent")
	const models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false })
	models.registerNativeProvider(base)
	// A distinct native entry avoids the default auth.json credential taking
	// precedence. Requests still use the original transport and model identifiers.
	return { ...base, id: ACCOUNT_PROVIDER, name: "OpenAI Codex (selected Pi account)",
		getModels: () => base.getModels().map(model => ({ ...model, provider: ACCOUNT_PROVIDER })),
		...(base.getAllModels ? { getAllModels: () => base.getAllModels!().map(model => ({ ...model, provider: ACCOUNT_PROVIDER })) } : {}),
		stream: (model, context, options) => base.stream({ ...model, provider: base.id }, context, options),
		streamSimple: (model, context, options) => base.streamSimple({ ...model, provider: base.id }, context, options),
		auth: { apiKey: {
		name: "Selected Pi account",
		check: async () => (await models.listCredentials()).some(entry => entry.providerId === base.id) ? { type: "oauth", source: "Selected Pi account" } : undefined,
		resolve: ({ signal }) => models.getAuth(base.id, { signal }),
	} } }
}

export default function codexAccountExtension(pi: ExtensionAPI) {
	let active: string | undefined
	let base: Provider | undefined
	let registeredProvider: Provider | undefined
	let usage: CodexUsage | undefined
	let timer: ReturnType<typeof setInterval> | undefined
	const directory = agentDirectory()
	const update = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return
		const email = piAccountEmail(active ? dirname(piProfileAuthPath(active, directory)) : directory)
		ctx.ui.setStatus("00-account", email ? ctx.ui.theme.fg("accent", email) : undefined)
		const quota = formatCodexUsage(usage)
		ctx.ui.setStatus("01-usage", quota ? ctx.ui.theme.fg("muted", "| " + quota) : undefined)
	}
	const refreshUsage = async (ctx: ExtensionContext) => {
		const profile = active
		const result = await fetchCodexUsage(profile ? dirname(piProfileAuthPath(profile, directory)) : directory)
		if (active !== profile) return
		usage = result ?? usage
		update(ctx)
	}
	const bindModel = async (ctx: ExtensionContext) => {
		const cold = !ctx.model || ctx.model.provider === "unknown"
		if (!cold && ctx.model?.provider !== "openai-codex") return
		const settings = pi.getSettings()
		const launch = cold ? (await import("@earendil-works/pi-coding-agent")).parseArgs(process.argv.slice(2)) : undefined
		if (cold && (launch?.model || (launch?.provider && !["openai-codex", ACCOUNT_PROVIDER].includes(launch.provider)))) throw new Error("Requested native model is unavailable; choose a model explicitly")
		const model = cold
			? ((!settings.defaultProvider || ["openai-codex", ACCOUNT_PROVIDER].includes(settings.defaultProvider)) ? ctx.modelRegistry.find(ACCOUNT_PROVIDER, settings.defaultModel ?? "") : undefined) ?? ctx.modelRegistry.getAvailable().find(model => model.provider === ACCOUNT_PROVIDER)
			: ctx.modelRegistry.find(ACCOUNT_PROVIDER, ctx.model!.id)
		const thinking = cold && model
			? launch?.thinking ?? settings.modelThinkingLevels?.[`${ACCOUNT_PROVIDER}/${model.id}`] ?? settings.modelThinkingLevels?.[`openai-codex/${model.id}`] ?? settings.defaultThinkingLevel ?? "medium"
			: pi.getThinkingLevel()
		if (!model || !await pi.setModel(model)) throw new Error("Selected account model is unavailable")
		pi.setThinkingLevel(thinking)
	}
	const select = async (profile: string, ctx: ExtensionContext, persist: boolean) => {
		if (!ctx.isIdle()) throw new Error("Wait for the current response before switching accounts")
		const status = ctx.modelRegistry.getProviderAuthStatus(ACCOUNT_PROVIDER)
		if ((status.configured && status.source !== "environment") || (!active && ctx.modelRegistry.getProvider(ACCOUNT_PROVIDER))) throw new Error("Reconcile the existing toolkit-openai-codex provider before selecting an account")
		importCodexAccount(profile, directory)
		base ??= ctx.modelRegistry.getProvider("openai-codex")
		if (!base) throw new Error("The native openai-codex provider is unavailable")
		const provider = await accountProvider(base, piProfileAuthPath(profile, directory))
		pi.registerProvider(provider)
		registeredProvider = provider
		active = profile
		usage = undefined
		try {
			await ctx.modelRegistry.refresh({ allowNetwork: false })
			await bindModel(ctx)
		} catch (error) { ctx.shutdown(); throw error }
		process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = profile
		if (persist || !ctx.sessionManager.getBranch().some(e => e.type === "custom" && e.customType === "toolkit-account")) pi.appendEntry("toolkit-account", { profile })
		if (persist) {
			writePrivateJson(join(directory, "active-codex-account.json"), { profile })
		}
		update(ctx)
	}
	pi.registerCommand("account", {
		description: "Select a Pi account for this session, or add an OpenAI login",
		handler: async (args, ctx) => {
			try {
				if (!ctx.isIdle()) throw new Error("Wait for the current response before switching accounts")
				let value = args.trim()
				const accounts = piAccounts(directory)
				if (!value) value = await ctx.ui.select("Account", [...accounts.map(a => a.profile + " — " + a.email), "add"]) ?? ""
				if (!value) return
				if (value === "add") {
					const profile = reserveAccountProfile()
					const result = await pi.exec("/usr/bin/env", ["CODEX_HOME=" + codexProfileHome(profile), "codex", "login"], { timeout: 15 * 60_000 })
					if (result.code !== 0) throw new Error("OpenAI login did not complete")
					await select(profile, ctx, true)
				} else {
					const matches = accounts.filter(a => a.email.toLowerCase() === value.toLowerCase() || a.profile + " — " + a.email === value)
					if (matches.length !== 1) throw new Error("Select one account from /account, or use /account add")
					await select(matches[0].profile, ctx, true)
				}
				ctx.ui.notify("Account selected for this Pi session. Codex CLI accounts are selected independently with CODEX_HOME.", "info")
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error") }
		},
	})
	pi.on("session_start", async (_event, ctx) => {
		if (timer) clearInterval(timer)
		const entries = ctx.sessionManager.getBranch()
		const saved = [...entries].reverse().find(e => e.type === "custom" && e.customType === "toolkit-account") as { data?: { profile?: string } } | undefined
		try {
			const profile = saved?.data?.profile ?? process.env.AGENT_TOOLKIT_CODEX_ACCOUNT ?? defaultPiAccount(directory)
			if (profile) {
				await select(profile, ctx, false)
				// Pi chooses its initial model before this provider is registered.
				// Restore its recorded selection unless native launch arguments override it.
				const { parseArgs } = await import("@earendil-works/pi-coding-agent")
				const launch = parseArgs(process.argv.slice(2))
				const recorded = [...entries].reverse().find(e => e.type === "model_change")
				if (recorded?.type === "model_change" && recorded.provider === ACCOUNT_PROVIDER && !launch.model && !launch.provider) {
					const model = ctx.modelRegistry.find(ACCOUNT_PROVIDER, recorded.modelId)
					if (!model || !await pi.setModel(model)) throw new Error("Saved account model is unavailable; choose a model explicitly")
					const thinking = [...entries].reverse().find(e => e.type === "thinking_level_change")
					pi.setThinkingLevel(launch.thinking ?? thinking?.thinkingLevel ?? pi.getThinkingLevel())
				}
			}
		} catch (error) {
			ctx.ui.notify("Selected account is unavailable; refusing account fallback. " + String(error), "error")
			ctx.shutdown()
			return
		}
		update(ctx)
		if (ctx.mode === "tui") {
			void refreshUsage(ctx)
			timer = setInterval(() => void refreshUsage(ctx), 60_000)
		}
	})
	pi.on("model_select", async (_event, ctx) => {
		if (!active) return
		try { await bindModel(ctx) }
		catch (error) { ctx.ui.notify("Selected account model is unavailable; refusing account fallback. " + String(error), "error"); ctx.shutdown() }
	})
	pi.on("after_provider_response", (event, ctx) => {
		if (ctx.model?.provider !== "openai-codex" && ctx.model?.provider !== ACCOUNT_PROVIDER) return
		usage = mergeCodexUsage(usage, parseCodexUsage(event.headers))
		update(ctx)
	})
	pi.on("session_shutdown", (event, ctx) => {
		if (timer) clearInterval(timer)
		timer = undefined
		if (event.reason === "reload" && registeredProvider && ctx.modelRegistry.getRegisteredNativeProvider(ACCOUNT_PROVIDER) === registeredProvider) pi.unregisterProvider(ACCOUNT_PROVIDER)
	})
}
