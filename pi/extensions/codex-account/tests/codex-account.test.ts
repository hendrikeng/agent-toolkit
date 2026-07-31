import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { activateCodexProfile, codexProfileHome } from "../index.ts"

test("activates only a logged-in Codex profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-account-test-"))
	const original = process.env.CODEX_HOME

	try {
		assert.equal(activateCodexProfile("tracn", root), undefined)

		const profileHome = codexProfileHome("tracn", root)
		await mkdir(profileHome, { recursive: true })
		await writeFile(join(profileHome, "auth.json"), "{}", { mode: 0o600 })

		assert.equal(activateCodexProfile("tracn", root), profileHome)
		assert.equal(process.env.CODEX_HOME, profileHome)
	} finally {
		if (original === undefined) delete process.env.CODEX_HOME
		else process.env.CODEX_HOME = original
		await rm(root, { recursive: true, force: true })
	}
})
