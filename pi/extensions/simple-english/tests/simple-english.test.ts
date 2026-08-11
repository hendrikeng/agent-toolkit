import assert from "node:assert/strict"
import test from "node:test"
import { parseSimpleEnglishArgs, SIMPLE_ENGLISH_USAGE, simpleEnglishPrompt } from "../index.ts"

test("parses check and rewrite commands", () => {
	assert.deepEqual(parseSimpleEnglishArgs("check docs/setup.md"), {
		action: "check",
		target: "docs/setup.md",
		mode: "pragmatic",
	})
	assert.deepEqual(parseSimpleEnglishArgs("rewrite docs/setup.md strict"), {
		action: "rewrite",
		target: "docs/setup.md",
		mode: "strict",
	})
	assert.deepEqual(parseSimpleEnglishArgs("rewrite strict"), {
		action: "rewrite",
		target: "strict",
		mode: "pragmatic",
	})
	assert.equal(parseSimpleEnglishArgs(""), null)
})

test("rejects incomplete commands and keeps checks read-only", () => {
	assert.throws(() => parseSimpleEnglishArgs("rewrite"), { message: SIMPLE_ENGLISH_USAGE })
	const request = parseSimpleEnglishArgs("check README.md")!
	assert.match(simpleEnglishPrompt(request), /Do not edit files\.$/)
})
