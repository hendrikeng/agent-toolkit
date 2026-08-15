export interface Question {
	id: string
	question: string
	options: Array<{ label: string; description?: string }>
}

export interface Answer {
	id: string
	answer: string
	custom: boolean
}

interface QuestionUi {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>
	input(title: string, placeholder?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>
}

export async function collectAnswers(
	questions: readonly Question[],
	ui: QuestionUi,
	signal?: AbortSignal,
): Promise<{ answers: Answer[]; cancelled: boolean }> {
	const answers: Answer[] = []
	const dialogOptions = signal ? { signal } : undefined

	for (const question of questions) {
		const choices = question.options.map(
			(option, index) =>
				`${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`,
		)
		const customChoice = "Type something."
		const selected = await ui.select(question.question, [...choices, customChoice], dialogOptions)
		if (!selected) return { answers, cancelled: true }

		const selectedIndex = choices.indexOf(selected)
		if (selectedIndex >= 0) {
			answers.push({ id: question.id, answer: question.options[selectedIndex].label, custom: false })
			continue
		}

		const custom = (await ui.input(question.question, "Type your answer", dialogOptions))?.trim()
		if (!custom) return { answers, cancelled: true }
		answers.push({ id: question.id, answer: custom, custom: true })
	}

	return { answers, cancelled: false }
}
