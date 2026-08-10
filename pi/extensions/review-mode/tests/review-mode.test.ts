import assert from "node:assert/strict"
import test from "node:test"
import { restoreReviewMode, reviewModeInstructions } from "../index.ts"

test("restores the latest valid review mode in the session", () => {
	assert.equal(restoreReviewMode([]), "auto")
	assert.equal(
		restoreReviewMode([
			{ type: "custom", customType: "review-mode-state", data: { mode: "off" } },
			{ type: "custom", customType: "other", data: { mode: "auto" } },
		]),
		"off",
	)
	assert.equal(
		restoreReviewMode([
			{ type: "custom", customType: "review-mode-state", data: { mode: "off" } },
			{ type: "custom", customType: "review-mode-state", data: { mode: "auto" } },
		]),
		"auto",
	)
	assert.match(reviewModeInstructions("off"), /Do not automatically run autoreview/)
	assert.match(reviewModeInstructions("auto"), /Do not run autoreview.*for questions/)
})
