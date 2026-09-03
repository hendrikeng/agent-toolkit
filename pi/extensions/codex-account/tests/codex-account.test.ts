import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
	activateCodexProfile,
	codexProfileEmail,
	codexProfileHome,
	defaultPiAccount,
	fetchCodexUsage,
	formatCodexUsage,
	mergeCodexUsage,
	reserveAccountProfile,
	parseCodexResetCreditsPayload,
	parseCodexUsage,
	parseCodexUsagePayload,
	persistDefaultPiAccount,
	persistPiAccount,
	piAccountEmail,
	piAccounts,
	prepareCodexRuntime,
	switchPiAccount,
} from "../index.ts"

test("formats Codex response limits and reset times compactly", () => {
	const now = 1_700_000_000_000
	const usage = parseCodexUsage({
		"x-codex-primary-used-percent": "28.4",
		"x-codex-primary-window-minutes": "300",
		"x-codex-primary-reset-after-seconds": "5400",
		"x-codex-secondary-used-percent": "61",
		"x-codex-secondary-window-minutes": "10080",
		"x-codex-secondary-reset-at": String(now / 1000 + 259_200),
	}, now)
	assert.deepEqual(usage, {
		primary: { remainingPercent: 72, windowMinutes: 300, resetsAt: now + 5_400_000 },
		secondary: { remainingPercent: 39, windowMinutes: 10080, resetsAt: now + 259_200_000 },
	})
	assert.equal(formatCodexUsage(usage, now), "5h 72% ↻ 2h · 7d 39% ↻ 3d")
	assert.equal(formatCodexUsage({ ...usage, availableResets: 3 }, now), "5h 72% ↻ 2h · 7d 39% ↻ 3d · ↻ 3")
	assert.equal(formatCodexUsage({ ...usage, availableResets: 3, resetExpiresAt: now + 22 * 86_400_000 }, now), "5h 72% ↻ 2h · 7d 39% ↻ 3d · ↻ 3 · 22d")
	assert.equal(formatCodexUsage({ ...usage, secondary: { remainingPercent: 100, resetsAt: now } }, now), "5h 72% ↻ 2h")
	assert.equal(formatCodexUsage({ primary: { remainingPercent: 100, windowMinutes: 300, resetsAt: now }, availableResets: 0 }, now), "5h 100% ↻ now · ↻ 0")
	assert.deepEqual(mergeCodexUsage({ ...usage, availableResets: 3, resetExpiresAt: now + 1 }, { primary: { remainingPercent: 70 } }), {
		primary: { ...usage.primary, remainingPercent: 70 },
		secondary: usage.secondary,
		availableResets: 3,
		resetExpiresAt: now + 1,
	})
	assert.equal(parseCodexUsage({}), undefined)
	assert.deepEqual(
		parseCodexUsagePayload({
			rate_limits: {
				rate_limit: {
					primary_window: { used_percent: 28.4, limit_window_seconds: 18_000, reset_after_seconds: 5400 },
					secondary_window: { used_percent: 61, limit_window_seconds: 604_800, reset_at: now / 1000 + 259_200 },
				},
				rate_limit_reset_credits: { available_count: 3 },
			},
		}, now),
		{ ...usage, availableResets: 3 },
	)
	assert.deepEqual(parseCodexResetCreditsPayload({
		available_count: 3,
		credits: [
			{ status: "redeemed", expires_at: "2023-01-01T00:00:00Z" },
			{ status: "available", expires_at: "2024-01-03T00:00:00Z" },
			{ status: "available", expires_at: "2024-01-02T00:00:00Z" },
		],
	}), { availableResets: 3, resetExpiresAt: Date.parse("2024-01-02T00:00:00Z") })
})

test("fetches current Codex limits for the active Pi credential", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-usage-test-"))
	try {
		const token = `header.${Buffer.from(JSON.stringify({})).toString("base64url")}.signature`
		await writeFile(join(root, "auth.json"), JSON.stringify({
			"openai-codex": { type: "oauth", access: token, accountId: "account-123" },
		}))
		const expiresAt = Date.now() + 22 * 86_400_000
		const usage = await fetchCodexUsage(root, async (input, init) => {
			assert.equal((init?.headers as Record<string, string>)["ChatGPT-Account-Id"], "account-123")
			if (input.toString().endsWith("rate-limit-reset-credits")) {
				return new Response(JSON.stringify({
					available_count: 1,
					credits: [{ status: "available", expires_at: new Date(expiresAt).toISOString() }],
				}))
			}
			assert.equal(input, "https://chatgpt.com/backend-api/wham/usage")
			return new Response(JSON.stringify({
				rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18_000 } },
				rate_limit_reset_credits: { available_count: 1 },
			}))
		})
		assert.equal(formatCodexUsage(usage, expiresAt - 22 * 86_400_000), "5h 88% · ↻ 1 · 22d")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("reserves OAuth account profiles without collisions", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-account-name-test-"))
	try {
		assert.equal(reserveAccountProfile(root), "account-1")
		assert.equal(reserveAccountProfile(root), "account-2")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("discovers account profiles by email", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-account-list-test-"))
	try {
		const profile = join(root, "auth-profiles", "account-10")
		const codexRoot = join(root, "codex-accounts")
		await mkdir(profile, { recursive: true })
		await mkdir(join(codexRoot, "account-11"), { recursive: true })
		const token = `header.${Buffer.from(JSON.stringify({ email: "ten@example.com" })).toString("base64url")}.signature`
		const codexToken = `header.${Buffer.from(JSON.stringify({ email: "eleven@example.com" })).toString("base64url")}.signature`
		await writeFile(join(profile, "auth.json"), JSON.stringify({ "openai-codex": { access: token } }))
		await writeFile(join(codexRoot, "account-11", "auth.json"), JSON.stringify({ tokens: { id_token: codexToken } }))
		assert.deepEqual(piAccounts(root, codexRoot), [
			{ profile: "account-11", email: "eleven@example.com" },
			{ profile: "account-10", email: "ten@example.com" },
		])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("imports a Codex login when Pi switches the active profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-account-import-test-"))
	const agentDir = join(root, "agent")
	const runtimeDir = join(root, "runtime")
	const codexRoot = join(root, "codex-accounts")
	const originalProfile = process.env.AGENT_TOOLKIT_CODEX_ACCOUNT
	const originalCodexHome = process.env.CODEX_HOME
	const originalProfileHome = process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME
	try {
		await mkdir(agentDir, { recursive: true })
		await mkdir(runtimeDir)
		await mkdir(join(codexRoot, "personal"), { recursive: true })
		await writeFile(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "keep" } }))
		await writeFile(join(runtimeDir, "auth.json"), "{}")
		const access = `header.${Buffer.from(JSON.stringify({
			email: "jhw@envest.vc",
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		})).toString("base64url")}.signature`
		const idToken = `header.${Buffer.from(JSON.stringify({ email: "jhw@envest.vc" })).toString("base64url")}.signature`
		await writeFile(join(codexRoot, "personal", "auth.json"), JSON.stringify({
			tokens: { access_token: access, refresh_token: "refresh-123", id_token: idToken, account_id: "account-123" },
		}))
		process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = "personal"

		assert.deepEqual(switchPiAccount("personal", agentDir, runtimeDir, codexRoot), { profile: "personal", defaultPersisted: true })
		const runtime = JSON.parse(await readFile(join(runtimeDir, "auth.json"), "utf8"))
		assert.equal(runtime["openai-codex"].access, access)
		assert.equal(runtime["openai-codex"].refresh, "refresh-123")
		assert.equal(runtime["openai-codex"].accountId, "account-123")

		const replacementAccess = `header.${Buffer.from(JSON.stringify({
			email: "jhw@envest.vc",
			exp: Math.floor(Date.now() / 1000) + 7200,
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		})).toString("base64url")}.signature`
		await writeFile(join(codexRoot, "personal", "auth.json"), JSON.stringify({
			tokens: { access_token: replacementAccess, refresh_token: "replacement-refresh", id_token: idToken, account_id: "account-123" },
		}))
		assert.deepEqual(switchPiAccount("personal", agentDir, runtimeDir, codexRoot), { profile: "personal", defaultPersisted: true })
		assert.equal(JSON.parse(await readFile(join(runtimeDir, "auth.json"), "utf8"))["openai-codex"].access, replacementAccess)

		runtime["openai-codex"].access = "refreshed-access"
		runtime["openai-codex"].refresh = "refreshed-refresh"
		await writeFile(join(runtimeDir, "auth.json"), JSON.stringify(runtime))
		assert.equal(persistPiAccount("personal", agentDir, runtimeDir), true)

		const laterAccess = `header.${Buffer.from(JSON.stringify({
			email: "jhw@envest.vc",
			exp: Math.floor(Date.now() / 1000) + 10_800,
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		})).toString("base64url")}.signature`
		const later = JSON.parse(await readFile(join(runtimeDir, "auth.json"), "utf8"))
		later["openai-codex"] = { ...later["openai-codex"], access: laterAccess, expires: Date.now() + 10_800_000 }
		await writeFile(join(runtimeDir, "auth.json"), JSON.stringify(later))
		assert.equal(persistPiAccount("personal", agentDir, runtimeDir), true)
		assert.deepEqual(switchPiAccount("personal", agentDir, runtimeDir, codexRoot), { profile: "personal", defaultPersisted: true })
		assert.equal(JSON.parse(await readFile(join(runtimeDir, "auth.json"), "utf8"))["openai-codex"].access, laterAccess)

		const codex = JSON.parse(await readFile(join(codexRoot, "personal", "auth.json"), "utf8"))
		assert.equal(codex.tokens.access_token, undefined)
		assert.equal(codex.tokens.refresh_token, undefined)
		assert.equal(codex.tokens.id_token, idToken)
		const codexRuntime = prepareCodexRuntime("personal", agentDir, runtimeDir, codexRoot)
		assert.ok(codexRuntime)
		const subprocessAuth = JSON.parse(await readFile(join(codexRuntime, "auth.json"), "utf8"))
		assert.equal(subprocessAuth.tokens.access_token, laterAccess)
		assert.equal(subprocessAuth.tokens.refresh_token, "replacement-refresh")
		assert.equal(process.env.CODEX_HOME, codexRuntime)
	} finally {
		if (originalProfile === undefined) delete process.env.AGENT_TOOLKIT_CODEX_ACCOUNT
		else process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = originalProfile
		if (originalCodexHome === undefined) delete process.env.CODEX_HOME
		else process.env.CODEX_HOME = originalCodexHome
		if (originalProfileHome === undefined) delete process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME
		else process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME = originalProfileHome
		await rm(root, { recursive: true, force: true })
	}
})

test("switches one Pi runtime without changing another instance", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-account-switch-test-"))
	const agentDir = join(root, "agent")
	const firstRuntime = join(root, "runtime-one")
	const secondRuntime = join(root, "runtime-two")
	const original = {
		agentDir: process.env.AGENT_TOOLKIT_PI_AGENT_DIR,
		runtimeDir: process.env.PI_CODING_AGENT_DIR,
		profile: process.env.AGENT_TOOLKIT_CODEX_ACCOUNT,
		codexHome: process.env.CODEX_HOME,
		profileHome: process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME,
	}

	try {
		await mkdir(join(agentDir, "auth-profiles", "personal"), { recursive: true })
		await mkdir(join(agentDir, "auth-profiles", "business"), { recursive: true })
		await mkdir(firstRuntime)
		await mkdir(secondRuntime)
		const personalToken = `header.${Buffer.from(JSON.stringify({ email: "personal@example.com" })).toString("base64url")}.signature`
		const businessToken = `header.${Buffer.from(JSON.stringify({ email: "business@example.com" })).toString("base64url")}.signature`
		const personal = { "openai-codex": { type: "oauth", access: personalToken, refresh: "p", expires: 1 } }
		const personalCurrent = { "openai-codex": { type: "oauth", access: personalToken, refresh: "p2", expires: 2 } }
		const business = { "openai-codex": { type: "oauth", access: businessToken, refresh: "b", expires: 3 } }
		await writeFile(join(agentDir, "auth-profiles", "personal", "auth.json"), JSON.stringify(personal))
		await writeFile(join(agentDir, "auth-profiles", "business", "auth.json"), JSON.stringify(business))
		await writeFile(join(firstRuntime, "auth.json"), JSON.stringify(personalCurrent))
		await writeFile(join(secondRuntime, "auth.json"), JSON.stringify(personal))
		process.env.AGENT_TOOLKIT_PI_AGENT_DIR = agentDir
		process.env.PI_CODING_AGENT_DIR = firstRuntime
		process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = "personal"

		assert.deepEqual(switchPiAccount("business", agentDir, firstRuntime, join(root, "codex-accounts")), { profile: "business", defaultPersisted: true })
		assert.equal(defaultPiAccount(agentDir), "business")
		assert.equal(persistDefaultPiAccount("../invalid", agentDir), false)
		assert.deepEqual(JSON.parse(await readFile(join(firstRuntime, "auth.json"), "utf8")), business)
		assert.deepEqual(JSON.parse(await readFile(join(secondRuntime, "auth.json"), "utf8")), personal)
		assert.deepEqual(
			JSON.parse(await readFile(join(agentDir, "auth-profiles", "personal", "auth.json"), "utf8")),
			personalCurrent,
		)
		assert.equal(process.env.AGENT_TOOLKIT_CODEX_ACCOUNT, "business")
		const newerBusiness = { "openai-codex": { ...business["openai-codex"], access: businessToken, refresh: "new-b", expires: 100 } }
		await writeFile(join(agentDir, "auth-profiles", "business", "auth.json"), JSON.stringify(newerBusiness))
		await writeFile(join(firstRuntime, "auth.json"), JSON.stringify({ ...business, anthropic: { type: "api_key", key: "keep" } }))
		assert.equal(persistPiAccount("business"), true)
		const merged = { ...newerBusiness, anthropic: { type: "api_key", key: "keep" } }
		assert.deepEqual(JSON.parse(await readFile(join(firstRuntime, "auth.json"), "utf8")), merged)
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth-profiles", "business", "auth.json"), "utf8")), merged)
		delete (merged as Record<string, unknown>).anthropic
		await writeFile(join(firstRuntime, "auth.json"), JSON.stringify(merged))
		assert.equal(persistPiAccount("business"), true)
		assert.deepEqual(JSON.parse(await readFile(join(agentDir, "auth-profiles", "business", "auth.json"), "utf8")), merged)
	} finally {
		for (const [name, value] of Object.entries(original)) {
			const key = name === "agentDir" ? "AGENT_TOOLKIT_PI_AGENT_DIR" : name === "runtimeDir" ? "PI_CODING_AGENT_DIR" : name === "profile" ? "AGENT_TOOLKIT_CODEX_ACCOUNT" : name === "profileHome" ? "AGENT_TOOLKIT_CODEX_PROFILE_HOME" : "CODEX_HOME"
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
		await rm(root, { recursive: true, force: true })
	}
})

test("activates only a logged-in Codex profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-account-test-"))
	const original = process.env.CODEX_HOME

	try {
		const sharedHome = join(root, "shared")
		assert.deepEqual(activateCodexProfile("personal", root, sharedHome), { error: "login-required" })

		const profileHome = codexProfileHome("personal", root)
		await mkdir(profileHome, { recursive: true })
		const idToken = `header.${Buffer.from(JSON.stringify({ email: "developer@example.com" })).toString("base64url")}.signature`
		await writeFile(join(profileHome, "auth.json"), JSON.stringify({ tokens: { id_token: idToken } }), { mode: 0o600 })
		assert.equal(codexProfileEmail("personal", root), "developer@example.com")
		const piHome = join(root, "pi")
		const piToken = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email: "developer@example.com" } })).toString("base64url")}.signature`
		await mkdir(piHome)
		await writeFile(join(piHome, "auth.json"), JSON.stringify({ "openai-codex": { access: piToken } }))
		assert.equal(piAccountEmail(piHome), "developer@example.com")
		assert.deepEqual(activateCodexProfile("personal", root, sharedHome), { error: "safety-policy-missing" })

		const sharedPolicy = join(sharedHome, "rules", "agent-safety.rules")
		await mkdir(join(sharedHome, "rules"), { recursive: true })
		await writeFile(sharedPolicy, "policy")

		assert.deepEqual(activateCodexProfile("personal", root, sharedHome), { home: profileHome })
		assert.equal(await readlink(join(profileHome, "rules", "agent-safety.rules")), sharedPolicy)
		assert.equal(process.env.CODEX_HOME, profileHome)
	} finally {
		if (original === undefined) delete process.env.CODEX_HOME
		else process.env.CODEX_HOME = original
		await rm(root, { recursive: true, force: true })
	}
})
