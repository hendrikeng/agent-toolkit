import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

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

function credentialExpires(credential: PiCredential | undefined): number {
	const expires = Number(credential?.expires)
	return Number.isFinite(expires) && expires > 0 ? expires : tokenExpires(credential?.access)
}

export function codexProfileEmail(profile: string, root?: string): string | undefined {
	try {
		const auth = JSON.parse(readFileSync(join(codexProfileHome(profile, root), "auth.json"), "utf8"))
		return jwtEmail(auth?.tokens?.id_token)
	} catch {
		return undefined
	}
}

export function piProfileAccountId(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): string | undefined {
	try {
		const credential = readPiAuth(piProfileAuthPath(profile, agentDir))["openai-codex"]
		const id = credential?.accountId ?? jwtClaims(credential?.access)?.["https://api.openai.com/auth"]?.chatgpt_account_id
		return typeof id === "string" && id ? id : undefined
	} catch {
		return undefined
	}
}

type PiCredential = {
	type?: string
	access?: string
	refresh?: string
	expires?: number
	accountId?: string
	[key: string]: unknown
}
type PiAuth = Record<string, PiCredential>

function readPiAuth(path: string): PiAuth {
	return JSON.parse(readFileSync(path, "utf8")) as PiAuth
}

function writePrivateJson(path: string, value: unknown): void {
	const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
		renameSync(temporary, path)
		chmodSync(path, 0o600)
	} finally {
		try {
			unlinkSync(temporary)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	}
}

function writePiAuth(path: string, auth: PiAuth): void {
	writePrivateJson(path, auth)
}

function withAuthLock<T>(authPath: string, action: () => T): T {
	const lock = `${authPath}.lock`
	mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 })
	for (let attempt = 0; ; attempt++) {
		try {
			mkdirSync(lock, { mode: 0o700 })
			writeFileSync(join(lock, "pid"), String(process.pid), { mode: 0o600 })
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) throw error
			let stale = false
			try {
				const pid = Number(readFileSync(join(lock, "pid"), "utf8"))
				if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 0)
				else stale = Date.now() - statSync(lock).mtimeMs > 5_000
			} catch (lockError) {
				stale = (lockError as NodeJS.ErrnoException).code === "ESRCH"
				if (!stale && existsSync(lock)) stale = Date.now() - statSync(lock).mtimeMs > 5_000
			}
			if (stale) rmSync(lock, { recursive: true, force: true })
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
		}
	}
	try {
		return action()
	} finally {
		rmSync(lock, { recursive: true, force: true })
	}
}

export function piAccountEmail(agentDir = process.env.PI_CODING_AGENT_DIR): string | undefined {
	if (!agentDir) return undefined
	try {
		return jwtEmail(readPiAuth(join(agentDir, "auth.json"))?.["openai-codex"]?.access)
	} catch {
		return undefined
	}
}

export async function fetchCodexUsage(
	agentDir = process.env.PI_CODING_AGENT_DIR,
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

export function piProfileAuthPath(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): string {
	return join(agentDir, "auth-profiles", profile, "auth.json")
}

export function defaultPiAccount(
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): string | undefined {
	try {
		const profile = JSON.parse(readFileSync(join(agentDir, "active-codex-account.json"), "utf8"))?.profile
		return typeof profile === "string" && PROFILE_NAME.test(profile) ? profile : undefined
	} catch {
		return undefined
	}
}

export function persistDefaultPiAccount(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
): boolean {
	if (!PROFILE_NAME.test(profile)) return false
	try {
		writePrivateJson(join(agentDir, "active-codex-account.json"), { profile })
		return true
	} catch {
		return false
	}
}

function retireCodexAccount(profile: string, codexRoot = join(homedir(), ".codex-accounts")): boolean {
	const path = join(codexProfileHome(profile, codexRoot), "auth.json")
	try {
		const auth = JSON.parse(readFileSync(path, "utf8"))
		if (!auth.tokens) return false
		delete auth.tokens.access_token
		delete auth.tokens.refresh_token
		writePrivateJson(path, auth)
		return true
	} catch {
		return false
	}
}

export function importCodexAccount(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	codexRoot = join(homedir(), ".codex-accounts"),
): boolean {
	try {
		const codexAuth = JSON.parse(readFileSync(join(codexProfileHome(profile, codexRoot), "auth.json"), "utf8"))
		const access = codexAuth?.tokens?.access_token
		const refresh = codexAuth?.tokens?.refresh_token
		const claims = jwtClaims(access)
		const accountId = codexAuth?.tokens?.account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
		if (typeof access !== "string" || typeof refresh !== "string" || typeof accountId !== "string") return false
		const expires = Number(claims?.exp) * 1000
		const target = piProfileAuthPath(profile, agentDir)
		withAuthLock(target, () => {
			let auth: PiAuth = {}
			try {
				auth = readPiAuth(target)
			} catch {
				try {
					auth = Object.fromEntries(
						Object.entries(readPiAuth(join(agentDir, "auth.json"))).filter(([, credential]) => credential.type !== "oauth"),
					)
				} catch {}
			}
			const imported: PiCredential = {
				type: "oauth",
				access,
				refresh,
				expires: Number.isFinite(expires) && expires > 0 ? expires : Date.now() + 300_000,
				accountId,
			}
			if (!auth["openai-codex"]?.access || credentialExpires(imported) > credentialExpires(auth["openai-codex"])) {
				auth["openai-codex"] = imported
				writePiAuth(target, auth)
			}
		})
		return retireCodexAccount(profile, codexRoot)
	} catch {
		return false
	}
}

export function prepareCodexRuntime(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	runtimeDir = process.env.PI_CODING_AGENT_DIR,
	codexRoot = join(homedir(), ".codex-accounts"),
): string | undefined {
	if (!runtimeDir) return undefined
	try {
		const credential = readPiAuth(piProfileAuthPath(profile, agentDir))["openai-codex"]
		if (!credential?.access || !credential.refresh || !credential.accountId) return undefined
		const source = codexProfileHome(profile, codexRoot)
		const home = join(runtimeDir, "codex-runtimes", profile)
		mkdirSync(home, { recursive: true, mode: 0o700 })
		for (const entry of readdirSync(source, { withFileTypes: true })) {
			if (entry.name === "auth.json" || existsSync(join(home, entry.name))) continue
			symlinkSync(join(source, entry.name), join(home, entry.name), entry.isDirectory() ? "dir" : "file")
		}
		let auth: any = {}
		try { auth = JSON.parse(readFileSync(join(source, "auth.json"), "utf8")) } catch {}
		auth.auth_mode = auth.auth_mode ?? "chatgpt"
		auth.tokens = {
			...(auth.tokens ?? {}),
			id_token: auth.tokens?.id_token ?? credential.access,
			access_token: credential.access,
			refresh_token: credential.refresh,
			account_id: credential.accountId,
		}
		auth.last_refresh = new Date().toISOString()
		writePrivateJson(join(home, "auth.json"), auth)
		process.env.CODEX_HOME = home
		process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME = source
		return home
	} catch {
		return undefined
	}
}

function importCodexRuntime(profile: string, agentDir: string, runtimeDir: string, codexHome: string): boolean {
	try {
		const tokens = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8"))?.tokens
		if (typeof tokens?.access_token !== "string" || typeof tokens?.refresh_token !== "string") return false
		const runtimePath = join(runtimeDir, "auth.json")
		const auth = readPiAuth(runtimePath)
		const current = auth["openai-codex"]
		if (tokenExpires(tokens.access_token) <= credentialExpires(current)) return true
		const claims = jwtClaims(tokens.access_token)
		const accountId = tokens.account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
		if (typeof accountId !== "string") return false
		auth["openai-codex"] = {
			type: "oauth",
			access: tokens.access_token,
			refresh: tokens.refresh_token,
			expires: tokenExpires(tokens.access_token),
			accountId,
		}
		writePiAuth(runtimePath, auth)
		return persistPiAccount(profile, agentDir, runtimeDir)
	} catch {
		return false
	}
}

function ensurePiAccount(profile: string, agentDir: string, codexRoot: string): boolean {
	const target = piProfileAuthPath(profile, agentDir)
	let codexAccess: unknown
	try {
		codexAccess = JSON.parse(readFileSync(join(codexProfileHome(profile, codexRoot), "auth.json"), "utf8"))?.tokens?.access_token
	} catch {}
	if (typeof codexAccess === "string") {
		try {
			const credential = readPiAuth(target)["openai-codex"]
			if (codexAccess === credential?.access || credential?.access && credentialExpires(credential) >= tokenExpires(codexAccess)) {
				return retireCodexAccount(profile, codexRoot)
			}
		} catch {}
		return importCodexAccount(profile, agentDir, codexRoot)
	}
	return existsSync(target) && Boolean(piAccountEmail(dirname(target)))
}

export function persistPiAccount(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	runtimeDir = process.env.PI_CODING_AGENT_DIR,
): boolean {
	if (!runtimeDir) return false
	try {
		const runtimePath = join(runtimeDir, "auth.json")
		const target = piProfileAuthPath(profile, agentDir)
		withAuthLock(target, () => {
			const runtime = readPiAuth(runtimePath)
			let stored: PiAuth = {}
			try { stored = readPiAuth(target) } catch {}
			const current = runtime["openai-codex"]
			const latest = stored["openai-codex"]
			if (latest?.access && credentialExpires(latest) >= credentialExpires(current)) {
				runtime["openai-codex"] = latest
				writePiAuth(runtimePath, runtime)
			}
			writePiAuth(target, runtime)
		})
		return true
	} catch {
		return false
	}
}

export function switchPiAccount(
	profile: string,
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	runtimeDir = process.env.PI_CODING_AGENT_DIR,
	codexRoot = join(homedir(), ".codex-accounts"),
): { profile: string; defaultPersisted: boolean } | { error: "codex-login-required" | "runtime-unavailable" | "persist-failed" } {
	if (!runtimeDir) return { error: "runtime-unavailable" }
	if (!ensurePiAccount(profile, agentDir, codexRoot)) return { error: "codex-login-required" }
	const active = piProfile()
	const target = piProfileAuthPath(profile, agentDir)

	if (active && !persistPiAccount(active, agentDir, runtimeDir)) {
		return { error: "persist-failed" }
	}
	try {
		writePiAuth(join(runtimeDir, "auth.json"), readPiAuth(target))
	} catch {
		return { error: "runtime-unavailable" }
	}
	process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = profile
	process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME = codexProfileHome(profile, codexRoot)
	return { profile, defaultPersisted: persistDefaultPiAccount(profile, agentDir) }
}

export function activateCodexProfile(
	profile: string,
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

function currentProfile(root = join(homedir(), ".codex-accounts")): string | undefined {
	const configuredHome = process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME ?? process.env.CODEX_HOME
	if (!configuredHome) return undefined
	const home = resolve(configuredHome)
	const profile = basename(home)
	return dirname(home) === resolve(root) && PROFILE_NAME.test(profile) ? profile : undefined
}

function piProfile(): string | undefined {
	const profile = process.env.AGENT_TOOLKIT_CODEX_ACCOUNT
	return profile && PROFILE_NAME.test(profile) ? profile : undefined
}

export function reserveAccountProfile(codexRoot = join(homedir(), ".codex-accounts")): string {
	mkdirSync(codexRoot, { recursive: true, mode: 0o700 })
	for (let index = 1; ; index++) {
		const profile = `account-${index}`
		try {
			mkdirSync(codexProfileHome(profile, codexRoot), { mode: 0o700 })
			return profile
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		}
	}
}

export function piAccounts(
	agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	codexRoot = join(homedir(), ".codex-accounts"),
): CodexAccount[] {
	const profiles = new Set<string>()
	for (const directory of [join(agentDir, "auth-profiles"), codexRoot]) {
		try {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (entry.isDirectory() && PROFILE_NAME.test(entry.name)) profiles.add(entry.name)
			}
		} catch {}
	}
	return [...profiles]
		.flatMap((profile) => {
			const email = codexProfileEmail(profile, codexRoot) ?? piAccountEmail(join(agentDir, "auth-profiles", profile))
			return email ? [{ profile, email }] : []
		})
		.sort((a, b) => a.email.localeCompare(b.email))
}

function updateStatus(ctx: ExtensionContext, usage?: CodexUsage): void {
	const codex = currentProfile()
	const pi = piProfile()
	const yolo = Boolean(process.env.AGENT_TOOLKIT_PI_AGENT_DIR)
	const piEmail = piAccountEmail()
	const codexEmail = codex ? codexProfileEmail(codex) : undefined
	const mismatch = Boolean(
		piEmail && codexEmail ? piEmail !== codexEmail : pi && codex && pi !== codex,
	)
	const account = mismatch
		? `PI ${piEmail ?? "EMAIL?"} ↔ CODEX ${codexEmail ?? "EMAIL?"}`
		: piEmail ?? (codexEmail ? `CODEX ${codexEmail}` : yolo || pi || codex ? "EMAIL?" : undefined)
	ctx.ui.setStatus("yolo-mode", undefined)
	ctx.ui.setStatus("00-account", account ? ctx.ui.theme.fg(mismatch || !piEmail ? "warning" : "accent", account) : undefined)
	const quota = formatCodexUsage(usage)
	ctx.ui.setStatus("01-usage", quota ? ctx.ui.theme.fg("muted", `| ${quota}`) : undefined)
}

export default function codexAccountExtension(pi: ExtensionAPI) {
	let usage: CodexUsage | undefined
	let usageFetchedAt = 0
	let usageTimer: ReturnType<typeof setInterval> | undefined
	const refreshUsage = async (ctx: ExtensionContext, force = false) => {
		if (!force && Date.now() - usageFetchedAt < 60_000) return
		usageFetchedAt = Date.now()
		const profile = piProfile()
		const fetched = await fetchCodexUsage()
		if (profile !== piProfile()) return
		if (fetched) {
			usage = fetched
			updateStatus(ctx, usage)
		}
	}
	const switchTo = async (profile: string, ctx: ExtensionContext) => {
		const previousHome = process.env.CODEX_HOME
		const activated = activateCodexProfile(profile)
		if ("error" in activated) {
			ctx.ui.notify(
				activated.error === "login-required"
					? "The Codex login is incomplete. Run /account add to authenticate."
					: "The Codex safety policy is missing. Run agent-toolkit/install.sh.",
				"warning",
			)
			return
		}
		const switched = switchPiAccount(profile)
		if ("error" in switched) {
			if (previousHome === undefined) delete process.env.CODEX_HOME
			else process.env.CODEX_HOME = previousHome
			ctx.ui.notify(
				switched.error === "codex-login-required"
					? "The Codex login is incomplete. Run /account add to authenticate."
					: switched.error === "persist-failed"
						? "The current account could not be saved. The account did not change."
						: "Pi account switching is available through pi-yolo.",
				"warning",
			)
			return
		}

		usage = undefined
		if (!prepareCodexRuntime(profile)) {
			ctx.ui.notify("The Codex subprocess credential could not be prepared.", "warning")
		}
		const refreshed = await ctx.modelRegistry.refresh({ allowNetwork: false, providers: ["openai-codex"] })
		const refreshError = refreshed.errors.get("openai-codex")
		updateStatus(ctx, usage)
		await refreshUsage(ctx, true)
		const activeEmail = piAccountEmail()
		ctx.ui.notify(
			refreshError
				? `Switched to ${activeEmail ?? profile}. Model refresh failed: ${refreshError.message}`
				: !switched.defaultPersisted
					? `Switched to ${activeEmail ?? profile}, but the default for new Pi sessions could not be saved.`
					: `Account is now ${activeEmail ?? profile}`,
			refreshError || !switched.defaultPersisted ? "warning" : "info",
		)
	}
	const addAccount = async (ctx: ExtensionContext) => {
		const profile = reserveAccountProfile()
		const home = codexProfileHome(profile)
		const previousHome = process.env.CODEX_HOME
		process.env.CODEX_HOME = home
		ctx.ui.notify("Complete the OpenAI login in the browser. Pi will continue when OAuth finishes.", "info")
		ctx.ui.setWorkingMessage("Waiting for OpenAI OAuth…")
		try {
			const result = await pi.exec("codex", ["login"], { timeout: 15 * 60_000 })
			if (result.code !== 0) {
				ctx.ui.notify(result.stderr.trim() || "OpenAI login did not complete.", "error")
				return
			}
			const email = codexProfileEmail(profile)
			if (!email) {
				ctx.ui.notify("OpenAI login completed without a readable account email.", "error")
				return
			}
			await switchTo(profile, ctx)
		} finally {
			ctx.ui.setWorkingMessage()
			if (process.env.AGENT_TOOLKIT_CODEX_ACCOUNT !== profile) {
				if (previousHome === undefined) delete process.env.CODEX_HOME
				else process.env.CODEX_HOME = previousHome
			}
		}
	}

	pi.registerCommand("account", {
		description: "Switch accounts by email or add an account with OAuth",
		getArgumentCompletions: (prefix) =>
			[{ value: "add", label: "add", description: "Add an account with OpenAI OAuth" }, ...piAccounts().map(({ email }) => ({ value: email, label: email }))]
				.filter(({ value }) => value.toLowerCase().startsWith(prefix.toLowerCase())),
		handler: async (args, ctx) => {
			const accounts = piAccounts()
			let email = args.trim()
			if (email.toLowerCase() === "add") {
				await addAccount(ctx)
				return
			}
			let selectedProfile: string | undefined
			if (!email) {
				const add = "Add account with OpenAI OAuth…"
				const enter = "Enter email…"
				const labels = new Map(accounts.map((account) => {
					const duplicate = accounts.some((other) => other !== account && other.email.toLowerCase() === account.email.toLowerCase())
					return [duplicate ? `${account.email} (${account.profile})` : account.email, account.profile]
				}))
				const selected = await ctx.ui.select("Account", [...labels.keys(), add, enter])
				if (!selected) return
				if (selected === add) {
					await addAccount(ctx)
					return
				}
				selectedProfile = labels.get(selected)
				email = selected === enter ? await ctx.ui.input("Account email", "name@example.com") ?? "" : selected
			}
			if (selectedProfile) {
				await switchTo(selectedProfile, ctx)
				return
			}
			if (!email) return
			const matches = accounts.filter((account) => account.email.toLowerCase() === email.toLowerCase())
			if (matches.length !== 1) {
				if (matches.length > 1) ctx.ui.notify(`More than one account uses ${email}. Select it from /account.`, "warning")
				else ctx.ui.notify(`No login found for ${email}. Run /account add first.`, "warning")
				return
			}
			await switchTo(matches[0].profile, ctx)
		},
	})

	const persistActiveAccount = (ctx?: ExtensionContext) => {
		const profile = piProfile()
		if (profile && !persistPiAccount(profile)) ctx?.ui.notify("The active account could not be saved.", "warning")
	}
	pi.on("message_start", (event, ctx) => {
		if (event.message.role === "assistant") persistActiveAccount(ctx)
	})
	pi.on("tool_call", (_event, ctx) => {
		const profile = piProfile()
		if (profile && persistPiAccount(profile)) prepareCodexRuntime(profile)
	})
	pi.on("tool_result", (_event, ctx) => {
		const profile = piProfile()
		const runtimeDir = process.env.PI_CODING_AGENT_DIR
		if (profile && runtimeDir && process.env.CODEX_HOME) {
			if (!importCodexRuntime(profile, process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), runtimeDir, process.env.CODEX_HOME)) {
				ctx.ui.notify("The Codex subprocess credential could not be saved.", "warning")
			}
		}
	})
	pi.on("turn_end", (_event, ctx) => persistActiveAccount(ctx))
	pi.on("after_provider_response", async (event, ctx) => {
		if (ctx.model?.provider !== "openai-codex") return
		usage = mergeCodexUsage(usage, parseCodexUsage(event.headers))
		updateStatus(ctx, usage)
		void refreshUsage(ctx)
	})
	pi.on("session_shutdown", () => {
		if (usageTimer) clearInterval(usageTimer)
		usageTimer = undefined
		persistActiveAccount()
	})
	pi.on("agent_settled", (_event, ctx) => updateStatus(ctx, usage))
	pi.on("session_start", (_event, ctx) => {
		const profile = piProfile()
		if (profile) prepareCodexRuntime(profile)
		updateStatus(ctx, usage)
		setTimeout(() => updateStatus(ctx, usage), 0)
		if (usageTimer) clearInterval(usageTimer)
		if (ctx.mode === "tui") {
			void refreshUsage(ctx, true)
			usageTimer = setInterval(() => void refreshUsage(ctx, true), 60_000)
		}
	})
}
