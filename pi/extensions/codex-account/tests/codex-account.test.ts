import assert from "node:assert/strict"
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import codexAccountExtension, {
	codexProfileEmail, codexProfileHome, defaultPiAccount, fetchCodexUsage,
	formatCodexUsage, mergeCodexUsage, reserveAccountProfile, parseCodexResetCreditsPayload,
	parseCodexUsage, parseCodexUsagePayload, piAccountEmail, piAccounts,
	importCodexAccount, accountProvider,
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


// Use the installed SDK for credential refresh/locking; the provider's network
// exchange is the only substituted boundary. No live credentials or model calls.
test("native Pi account stores refresh independently without erasing Codex credentials", async t => {
	const { execFileSync } = await import("node:child_process")
	const { registerHooks } = await import("node:module")
	const { pathToFileURL } = await import("node:url")
	const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()
	const packageRoot = join(globalRoot, "@earendil-works/pi-coding-agent")
	try { await lstat(join(packageRoot, "dist/index.js")) }
	catch (error: any) { if (error.code !== "ENOENT") throw error; t.skip("Pi SDK absent; native credential behavior unverified"); return }
	const hooks = registerHooks({ resolve(specifier, context, next) {
		if (specifier === "@earendil-works/pi-coding-agent") return { url: pathToFileURL(join(packageRoot, "dist/index.js")).href, shortCircuit: true }
		if (specifier === "@earendil-works/pi-ai") return { url: pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")).href, shortCircuit: true }
		return next(specifier, context)
	} })
	const root = await mkdtemp(join(tmpdir(), "native-pi-accounts-"))
	try {
		const agent = join(root, "pi"), codex = join(root, "codex"), account = join(codex, "one")
		await mkdir(account, { recursive: true })
		const access = `header.${Buffer.from(JSON.stringify({ exp: 1, email: "one@example.com" })).toString("base64url")}.signature`
		const login = { tokens: { access_token: access, refresh_token: "one-refresh", account_id: "one-id" } }
		await writeFile(join(account, "auth.json"), JSON.stringify(login))
		importCodexAccount("one", agent, codex)
		assert.deepEqual(JSON.parse(await readFile(join(account, "auth.json"), "utf8")), login, "Codex's login must remain intact")
		const first = join(agent, "auth-profiles/one/auth.json"), second = join(agent, "auth-profiles/two/auth.json")
		await mkdir(join(agent, "auth-profiles/two"))
		await writeFile(second, JSON.stringify({ "openai-codex": { type: "oauth", access: `header.${Buffer.from(JSON.stringify({ email: "two@example.com" })).toString("base64url")}.signature`, refresh: "two-refresh", expires: 1 } }))
		const refreshedOne = `header.${Buffer.from(JSON.stringify({ email: "one@example.com", refreshed: true })).toString("base64url")}.signature`
		const refreshedTwo = `header.${Buffer.from(JSON.stringify({ email: "two@example.com", refreshed: true })).toString("base64url")}.signature`
		const base = {
			id: "openai-codex", name: "Test provider", getModels: () => [],
			auth: { oauth: {
				name: "Test OAuth", login: async () => { throw Error("No login in this check") },
				refresh: async (credential: any) => ({ ...credential, access: `header.${Buffer.from(JSON.stringify({ email: credential.refresh.startsWith("one") ? "one@example.com" : "two@example.com", refreshed: true })).toString("base64url")}.signature`, expires: Date.now() + 3_600_000 }),
				toAuth: async (credential: any) => ({ apiKey: credential.access }),
			} },
		}
		const { ModelRuntime, createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager } = await import("@earendil-works/pi-coding-agent")
		const mainPath = join(agent, "auth.json")
		const main = JSON.stringify({ "openai-codex": { type: "oauth", access: "default", refresh: "default-refresh", expires: 1 } })
		await writeFile(mainPath, main)
		const sessions = await Promise.all([1, 2].map(() => ModelRuntime.create({ authPath: mainPath, modelsPath: null, refreshOnCreate: false })))
		const nativeModels = sessions[0].getModels("openai-codex")
		base.getModels = () => nativeModels
		const [one, two] = await Promise.all([accountProvider(base, first), accountProvider(base, second)])
		sessions[0].registerNativeProvider(one)
		sessions[1].registerNativeProvider(two)
		const [oneAuth, twoAuth] = await Promise.all([sessions[0].getAuth(one.id), sessions[1].getAuth(two.id)])
		assert.equal(oneAuth?.auth.apiKey, refreshedOne)
		assert.equal(twoAuth?.auth.apiKey, refreshedTwo)
		assert.equal(await readFile(mainPath, "utf8"), main, "selecting accounts must not refresh or rewrite the default login")
		assert.equal(JSON.parse(await readFile(first, "utf8"))["openai-codex"].access, refreshedOne)
		assert.equal(JSON.parse(await readFile(second, "utf8"))["openai-codex"].access, refreshedTwo)
		importCodexAccount("one", agent, codex)
		assert.equal(JSON.parse(await readFile(first, "utf8"))["openai-codex"].access, refreshedOne, "a stale Codex login must not replace refreshed Pi credentials")
		// Exercise extension startup and model changes through the native session.
		const previousDirectory = process.env.PI_CODING_AGENT_DIR
		const previousAccount = process.env.AGENT_TOOLKIT_CODEX_ACCOUNT
		process.env.PI_CODING_AGENT_DIR = agent
		process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = "one"
		let session: any
		try {
			const runtime = await ModelRuntime.create({ authPath: mainPath, modelsPath: null, refreshOnCreate: false })
			runtime.registerNativeProvider(base)
			const settings = SettingsManager.inMemory({ packages: [], cacheWarming: { enabled: false } })
			const resources = new DefaultResourceLoader({ cwd: root, agentDir: agent, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [codexAccountExtension] })
			await resources.reload()
			const created = await createAgentSession({ cwd: root, agentDir: agent, modelRuntime: runtime, model: nativeModels[0], thinkingLevel: "medium", tools: [], resourceLoader: resources, settingsManager: settings, sessionManager: SessionManager.inMemory(root) })
			session = created.session
			const errors: string[] = []
			let stopped = false
			await session.bindExtensions({ mode: "rpc", uiContext: { theme: { fg: (_color: string, text: string) => text }, setStatus: () => {}, notify: (message: string, level: string) => { if (level === "error") errors.push(message) } } as any, onError: (error: any) => errors.push(error.error), shutdownHandler: () => { stopped = true } })
			assert.deepEqual(errors, [])
			assert.equal(session.model.provider, "toolkit-openai-codex")
			assert.equal(session.model.id, nativeModels[0].id)
			assert.equal(session.thinkingLevel, "medium")
			session.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "Fixture conversation" }], timestamp: Date.now() })
			const startupEntries = [session.sessionManager.getHeader(), ...session.sessionManager.getEntries()]
			assert.equal((await runtime.getAuth(session.model))?.auth.apiKey, refreshedOne)
			assert.equal(session.sessionManager.getBranch().some((entry: any) => entry.type === "custom" && entry.customType === "toolkit-account" && entry.data.profile === "one"), true, "startup selection must belong to this session")
			await session.prompt("/account two@example.com")
			assert.equal((await runtime.getAuth(session.model))?.auth.apiKey, refreshedTwo)
			await session.setModel(nativeModels[1])
			assert.equal(session.model.provider, "toolkit-openai-codex")
			assert.equal(session.model.id, nativeModels[1].id)
			assert.equal((await runtime.getAuth(session.model))?.auth.apiKey, refreshedTwo)
			const selectedEntries = [session.sessionManager.getHeader(), ...session.sessionManager.getEntries()]
			await session.reload()
			assert.equal(stopped, false, "reloading must retain the selected account without an ownership error")
			assert.deepEqual(errors, [])
			assert.equal((await runtime.getAuth(session.model))?.auth.apiKey, refreshedTwo)
			assert.equal(session.model.id, nativeModels[1].id)
			for (const explicitThinking of [undefined, "low"] as const) {
				const coldRuntime = await ModelRuntime.create({ authPath: join(root, "empty-auth.json"), modelsPath: null, refreshOnCreate: false })
				coldRuntime.registerNativeProvider(base)
				await coldRuntime.refresh({ allowNetwork: false })
				const coldSettings = SettingsManager.inMemory({ packages: [], defaultProvider: "openai-codex", defaultModel: nativeModels[2].id, defaultThinkingLevel: "low", modelThinkingLevels: { [`openai-codex/${nativeModels[2].id}`]: "high" }, cacheWarming: { enabled: false } })
				const coldResources = new DefaultResourceLoader({ cwd: root, agentDir: agent, settingsManager: coldSettings, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [codexAccountExtension] })
				await coldResources.reload()
				const cold = await createAgentSession({ cwd: root, agentDir: agent, modelRuntime: coldRuntime, tools: [], resourceLoader: coldResources, settingsManager: coldSettings, sessionManager: SessionManager.inMemory(root) })
				const previousArguments = process.argv
				try {
					if (explicitThinking) process.argv = [previousArguments[0], previousArguments[1], "--thinking", explicitThinking]
					await cold.session.bindExtensions({ mode: "rpc", shutdownHandler: () => { stopped = true } })
					assert.equal(cold.session.model?.provider, "toolkit-openai-codex", "profile-only login must initialize an authenticated model")
					assert.equal(cold.session.model?.id, nativeModels[2].id)
					assert.equal(cold.session.thinkingLevel, explicitThinking ?? "high", "cold startup must preserve explicit or saved per-model effort")
					assert.equal((await coldRuntime.getAuth(cold.session.model!))?.auth.apiKey, refreshedTwo)
				} finally { process.argv = previousArguments; cold.session.dispose() }
			}
			// Resume with a changed default and no provider entry registered yet.
			for (const [entries, expectedToken, expectedModel, explicit] of [[startupEntries, refreshedOne, nativeModels[0], false], [selectedEntries, refreshedTwo, nativeModels[1], false], [selectedEntries, refreshedTwo, nativeModels[2], true]] as const) {
				const resumedRuntime = await ModelRuntime.create({ authPath: mainPath, modelsPath: null, refreshOnCreate: false })
				resumedRuntime.registerNativeProvider(base)
				await resumedRuntime.refresh({ allowNetwork: false })
				const resumedSettings = SettingsManager.inMemory({ packages: [], defaultProvider: "openai-codex", defaultModel: nativeModels[2].id, defaultThinkingLevel: "medium", cacheWarming: { enabled: false } })
				const resumedResources = new DefaultResourceLoader({ cwd: root, agentDir: agent, settingsManager: resumedSettings, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [codexAccountExtension] })
				await resumedResources.reload()
				const resumed = await createAgentSession({ cwd: root, agentDir: agent, modelRuntime: resumedRuntime, ...(explicit ? { model: expectedModel, thinkingLevel: "high" as const } : {}), tools: [], resourceLoader: resumedResources, settingsManager: resumedSettings, sessionManager: SessionManager.inMemory(root, undefined, entries) })
				const previousArguments = process.argv
				try {
					if (explicit) process.argv = [previousArguments[0], previousArguments[1], "--model", expectedModel.id, "--thinking", "high"]
					await resumed.session.bindExtensions({ mode: "rpc", shutdownHandler: () => { stopped = true } })
					assert.equal(resumed.session.model?.id, expectedModel.id, "resume must restore the saved model instead of the changed default")
					assert.equal((await resumedRuntime.getAuth(resumed.session.model!))?.auth.apiKey, expectedToken, "another session's default account must not replace the resumed account")
					assert.equal(resumed.session.thinkingLevel, explicit ? "high" : "medium")
				} finally { process.argv = previousArguments; resumed.session.dispose() }
			}
			assert.equal(await readFile(mainPath, "utf8"), main)
			assert.equal(stopped, false)
			assert.deepEqual(errors, [])
		} finally {
			session?.dispose()
			if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDirectory
			if (previousAccount === undefined) delete process.env.AGENT_TOOLKIT_CODEX_ACCOUNT; else process.env.AGENT_TOOLKIT_CODEX_ACCOUNT = previousAccount
		}
		await symlink(first, join(root, "credential-link"))
		await assert.rejects(accountProvider(base, join(root, "credential-link")), /regular files/)
	} finally { hooks.deregister(); await rm(root, { recursive: true, force: true }) }
})
