import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import permissionFloor from "../index.ts";

test("project permission overrides prevent trust", async () => {
	let handleTrust: Function | undefined;
	permissionFloor({ on(event, handler) { if (event === "project_trust") handleTrust = handler; } } as ExtensionAPI);
	assert.ok(handleTrust);
	const cwd = await mkdtemp(join(tmpdir(), "permission-floor-"));
	const notifications: string[] = [];
	const ctx = { ui: { notify(message: string) { notifications.push(message); } } };
	const previousAgentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR;
	process.env.AGENT_TOOLKIT_PI_AGENT_DIR = "/managed-agent";
	try {
		assert.deepEqual(await handleTrust({ cwd }, ctx), { trusted: "undecided" });
		const override = join(cwd, ".pi/extensions/pi-permission-system/config.json");
		await mkdir(dirname(override), { recursive: true });
		await symlink(join(cwd, "missing-policy.json"), override);
		assert.deepEqual(await handleTrust({ cwd }, ctx), { trusted: "no" });
		assert.match(notifications[0], /override the global permission policy/);
	} finally {
		if (previousAgentDir === undefined) delete process.env.AGENT_TOOLKIT_PI_AGENT_DIR;
		else process.env.AGENT_TOOLKIT_PI_AGENT_DIR = previousAgentDir;
	}
});
