import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { applyFastMode, readFastMode, writeFastMode } from "../fast-core.ts"

test("persists Fast mode", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-fast-test-"))
	const path = join(root, "codex-fast.json")

	try {
		assert.equal(readFastMode(path), false)
		writeFastMode(true, path)
		assert.equal(readFastMode(path), true)
		assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { enabled: true })

		const target = join(root, "target")
		await writeFile(target, "keep")
		await rm(path)
		await symlink(target, path)
		writeFastMode(false, path)
		assert.equal(await readFile(target, "utf8"), "keep")
		assert.equal(readFastMode(path), false)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("adds the priority tier only to enabled OpenAI Codex requests", () => {
	const fast: Record<string, unknown> = { model: "gpt-5.6-sol" }
	applyFastMode("openai-codex", true, fast)
	assert.equal(fast.service_tier, "priority")

	const normal: Record<string, unknown> = { model: "gpt-5.4-mini" }
	applyFastMode("openai-codex", true, normal)
	applyFastMode("openai-codex", false, normal)
	applyFastMode("anthropic", true, normal)
	assert.equal(normal.service_tier, undefined)
})
