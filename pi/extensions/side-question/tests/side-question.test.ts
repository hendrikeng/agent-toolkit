import assert from "node:assert/strict"
import test from "node:test"
import {
	nextSideAnswerScrollTop,
	sideAnswerWheelDirection,
	SIDE_BOUNDARY_PROMPT,
	SIDE_SYSTEM_PROMPT,
} from "../side-core.ts"

test("keeps inherited work separate while permitting explicit small fixes", () => {
	assert.match(SIDE_BOUNDARY_PROMPT, /context only/)
	assert.match(SIDE_SYSTEM_PROMPT, /Only later user messages are active instructions/)
	assert.match(SIDE_SYSTEM_PROMPT, /unless the user explicitly requests that mutation/)
	assert.match(SIDE_SYSTEM_PROMPT, /keep it minimal and local/)
})

test("scrolls side answers with SGR mouse-wheel input", () => {
	assert.equal(sideAnswerWheelDirection("\x1b[<64;10;5M"), -1)
	assert.equal(sideAnswerWheelDirection("\x1b[<65;10;5M"), 1)
	assert.equal(sideAnswerWheelDirection("\x1b[A"), 0)
	assert.equal(nextSideAnswerScrollTop(5, 3, 20, 10), 8)
	assert.equal(nextSideAnswerScrollTop(8, 5, 20, 10), 10)
	assert.equal(nextSideAnswerScrollTop(2, -5, 20, 10), 0)
})
