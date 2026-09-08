import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import statusFormatExtension, { resolvePonytailMode } from "../index.ts"

function lifecycle() {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>()
	statusFormatExtension({ on: (event, handler) => handlers.set(event, handler) } as ExtensionAPI)
	return (event: string, ctx: ExtensionContext) => handlers.get(event)!({}, ctx)
}

function context(mode: ExtensionContext["mode"] = "tui") {
	let stale = false
	let reads = 0
	const entries = [{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } }]
	const writes: [string, string | undefined][] = []
	const ctx = {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		get sessionManager() {
			assert.equal(stale, false, "accessed stale session manager")
			reads++
			return { getBranch: () => entries }
		},
		get ui() {
			assert.equal(stale, false, "accessed stale UI")
			return {
				setStatus: (key: string, value: string | undefined) => writes.push([key, value]),
				theme: { fg: (_color: string, text: string) => text },
			}
		},
	} as unknown as ExtensionContext
	return { ctx, entries, writes, reads: () => reads, revoke: () => { stale = true } }
}

for (const mode of ["print", "json", "rpc"] as const) {
	test(`skips status work in ${mode} mode`, (t) => {
		t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
		const emit = lifecycle()
		const state = context(mode)
		state.revoke()
		for (const event of ["session_start", "agent_start", "agent_end", "agent_settled"]) emit(event, state.ctx)
		t.mock.timers.tick(1000)
		emit("session_shutdown", state.ctx)
		assert.equal(state.reads(), 0)
		assert.deepEqual(state.writes, [])
	})
}

for (const event of ["session_start", "agent_start", "agent_end", "agent_settled"]) {
	test(`shutdown cancels pending ${event} sync and polling`, (t) => {
		t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
		const emit = lifecycle()
		const state = context()
		emit("session_start", state.ctx)
		if (event !== "session_start") {
			t.mock.timers.tick(1)
			emit(event, state.ctx)
		}
		const writes = state.writes.length
		emit("session_shutdown", state.ctx)
		state.revoke()
		emit("session_shutdown", state.ctx)
		emit("agent_settled", state.ctx)
		t.mock.timers.tick(1000)
		assert.equal(state.writes.length, writes)
	})
}

for (const mode of ["tui", "print"] as const) {
	test(`session replacement cancels old timers before starting ${mode}`, (t) => {
		t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
		const emit = lifecycle()
		const old = context()
		emit("session_start", old.ctx)
		emit("agent_end", old.ctx)
		emit("agent_settled", old.ctx)
		old.revoke()
		const current = context(mode)
		emit("session_start", current.ctx)
		t.mock.timers.tick(1000)
		assert.deepEqual(old.writes, [])
		assert.equal(current.writes.length, mode === "tui" ? 4 : 0)
		emit("session_shutdown", current.ctx)
	})
}

test("TUI keeps deferred footer ordering, event refreshes and polled mode changes", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
	const emit = lifecycle()
	const state = context()
	emit("session_start", state.ctx)
	assert.deepEqual(state.writes, [])
	t.mock.timers.tick(1)
	assert.deepEqual(state.writes.map(([key]) => key), ["pi-permission-system", "ponytail", "03-yolo", "04-ponytail"])
	assert.deepEqual(state.writes.slice(0, 2), [["pi-permission-system", undefined], ["ponytail", undefined]])
	assert.deepEqual(state.writes.at(-1), ["04-ponytail", "| PONYTAIL LITE"])
	for (const event of ["agent_start", "agent_end", "agent_settled"]) {
		const count = state.writes.length
		emit(event, state.ctx)
		assert.equal(state.writes.length, count)
		t.mock.timers.tick(1)
		assert.equal(state.writes.length, count + 4)
	}
	state.entries[0].data.mode = "ultra"
	t.mock.timers.tick(250)
	assert.deepEqual(state.writes.at(-1), ["04-ponytail", "| PONYTAIL ULTRA"])
	const count = state.writes.length
	t.mock.timers.tick(250)
	assert.equal(state.writes.length, count)
	state.entries[0].data.mode = "off"
	t.mock.timers.tick(250)
	assert.deepEqual(state.writes.at(-1), ["04-ponytail", undefined])
	emit("session_shutdown", state.ctx)
})

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
