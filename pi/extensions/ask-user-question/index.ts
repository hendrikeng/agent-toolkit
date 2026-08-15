import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { collectAnswers } from "./ask-user-question-core.ts"

const optionSchema = Type.Object({
	label: Type.String({ description: "Short option label" }),
	description: Type.Optional(Type.String({ description: "Tradeoff or consequence" })),
})

const parameters = Type.Object({
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "Stable identifier for the answer" }),
			question: Type.String({ description: "Question shown to the user" }),
			options: Type.Array(optionSchema, { minItems: 2, maxItems: 4 }),
		}),
		{ minItems: 1, maxItems: 4 },
	),
})

export default function askUserQuestionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: "Ask the user up to four questions with two to four options each. The user can also type a custom answer.",
		promptSnippet: "Ask structured questions when a required user decision cannot be inferred",
		promptGuidelines: [
			"Use ask_user_question only when a required user decision cannot be inferred from the request or repository; otherwise choose a reasonable default.",
		],
		parameters,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("User questions require an interactive or RPC session")

			// ponytail: native dialogs cover the core need; add a custom TUI only if previews or multi-select become necessary.
			const result = await collectAnswers(params.questions, ctx.ui, signal)
			return {
				content: [
					{
						type: "text",
						text: result.cancelled
							? "The user cancelled the questions."
							: result.answers.map((answer) => `${answer.id}: ${answer.answer}`).join("\n"),
					},
				],
				details: result,
			}
		},
	})

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "ask_user_question"))
	})
}
