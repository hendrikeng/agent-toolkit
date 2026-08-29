import assert from "node:assert/strict"
import test from "node:test"
import { SIDE_BOUNDARY_PROMPT, SIDE_SYSTEM_PROMPT } from "../side-core.ts"

test("keeps inherited work separate while permitting explicit small fixes", () => {
	assert.match(SIDE_BOUNDARY_PROMPT, /context only/)
	assert.match(SIDE_SYSTEM_PROMPT, /Only later user messages are active instructions/)
	assert.match(SIDE_SYSTEM_PROMPT, /unless the user explicitly requests that mutation/)
	assert.match(SIDE_SYSTEM_PROMPT, /keep it minimal and local/)
})
