import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import retiredGoalCompatibility from "../index.ts";

type ContextHandler = (event: { messages: unknown[] }) => Promise<{ messages: unknown[] } | undefined>;

test("retired goal prompts do not re-enter session context", async () => {
	let handleContext: ContextHandler | undefined;
	retiredGoalCompatibility({
		on(event, handler) {
			if (event === "context") handleContext = handler as ContextHandler;
		},
	} as ExtensionAPI);
	assert.ok(handleContext);

	const regularMessage = { role: "user", content: "new task" };
	const retiredMessage = { role: "custom", customType: "codex-goal-continuation", content: "continue old goal" };
	assert.deepEqual(await handleContext({ messages: [retiredMessage, regularMessage] }), { messages: [regularMessage] });
	assert.equal(await handleContext({ messages: [regularMessage] }), undefined);
});
