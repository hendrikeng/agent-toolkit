import assert from "node:assert/strict"
import test from "node:test"
import { taskGraphPrompt } from "../task-graph-core.ts"

test("builds a bounded Orca planning prompt", () => {
	const prompt = taskGraphPrompt("Build search")
	assert.match(prompt, /Build search/)
	assert.match(prompt, /two to six bounded tasks/)
	assert.match(prompt, /Ask for approval.*before dispatch/)
	assert.match(prompt, /orca skills get orchestration/)
	assert.match(prompt, /Do not recreate those features in Pi/)
	assert.match(prompt, /at most one replacement attempt/)
})
