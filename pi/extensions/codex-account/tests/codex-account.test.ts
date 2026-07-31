import assert from "node:assert/strict"
import { mkdtemp, mkdir, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { activateCodexProfile, codexProfileHome } from "../index.ts"

test("activates only a logged-in Codex profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-account-test-"))
	const original = process.env.CODEX_HOME

	try {
		const sharedHome = join(root, "shared")
		assert.deepEqual(activateCodexProfile("tracn", root, sharedHome), { error: "login-required" })

		const profileHome = codexProfileHome("tracn", root)
		await mkdir(profileHome, { recursive: true })
		await writeFile(join(profileHome, "auth.json"), "{}", { mode: 0o600 })
		assert.deepEqual(activateCodexProfile("tracn", root, sharedHome), { error: "safety-policy-missing" })

		const sharedPolicy = join(sharedHome, "rules", "agent-safety.rules")
		await mkdir(join(sharedHome, "rules"), { recursive: true })
		await writeFile(sharedPolicy, "policy")

		assert.deepEqual(activateCodexProfile("tracn", root, sharedHome), { home: profileHome })
		assert.equal(await readlink(join(profileHome, "rules", "agent-safety.rules")), sharedPolicy)
		assert.equal(process.env.CODEX_HOME, profileHome)
	} finally {
		if (original === undefined) delete process.env.CODEX_HOME
		else process.env.CODEX_HOME = original
		await rm(root, { recursive: true, force: true })
	}
})
