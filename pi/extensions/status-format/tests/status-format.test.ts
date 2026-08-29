import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { resolvePonytailMode } from "../index.ts"

test("uses the latest persisted Ponytail mode", () => {
	assert.equal(resolvePonytailMode([
		{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
		{ type: "custom", customType: "ponytail-mode", data: { mode: "ULTRA" } },
	], "full"), "ultra")
})

test("falls back to the configured Ponytail mode", async () => {
	const root = await mkdtemp(join(tmpdir(), "status-format-test-"))
	try {
		await mkdir(join(root, "ponytail"))
		await writeFile(join(root, "ponytail", "config.json"), JSON.stringify({ defaultMode: "lite" }))
		assert.equal(resolvePonytailMode([], "", root), "lite")
		assert.equal(resolvePonytailMode([], "full", root), "full")
		assert.equal(resolvePonytailMode([], "review", root), "review")
		await writeFile(join(root, "ponytail", "config.json"), JSON.stringify({ defaultMode: "ultra" }))
		assert.equal(resolvePonytailMode([], "lite", root), "lite")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
