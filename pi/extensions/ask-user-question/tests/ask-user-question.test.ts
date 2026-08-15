import assert from "node:assert/strict"
import test from "node:test"
import { collectAnswers } from "../ask-user-question-core.ts"

test("collects valid answers and stops on cancellation", async () => {
	const selections = ["2. No — Keep the current behavior", "Type something."]
	const signal = new AbortController().signal
	const result = await collectAnswers(
		[
			{
				id: "change",
				question: "Change it?",
				options: [
					{ label: "Yes" },
					{ label: "No", description: "Keep the current behavior" },
				],
			},
			{
				id: "name",
				question: "Which name?",
				options: [{ label: "Alpha" }, { label: "Beta" }],
			},
		],
		{
			select: async (_title, _choices, options) => {
				assert.equal(options?.signal, signal)
				return selections.shift()
			},
			input: async (_title, _placeholder, options) => {
				assert.equal(options?.signal, signal)
				return " Gamma "
			},
		},
		signal,
	)

	assert.deepEqual(result, {
		answers: [
			{ id: "change", answer: "No", custom: false },
			{ id: "name", answer: "Gamma", custom: true },
		],
		cancelled: false,
	})

	const question = [{ id: "x", question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] }]
	assert.deepEqual(
		await collectAnswers(question, { select: async () => undefined, input: async () => undefined }),
		{ answers: [], cancelled: true },
	)
	assert.deepEqual(
		await collectAnswers(question, { select: async () => "Type something.", input: async () => "  " }),
		{ answers: [], cancelled: true },
	)
})
