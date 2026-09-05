export type ProjectMode = "audit" | "adopt" | "update" | "new"

export interface QuestionnaireQuestion {
	id: string
	prompt: string
	placeholders: string[]
	inferFrom?: string[]
	default?: string
}

export interface BootstrapQuestionnaire {
	schemaVersion: number
	compatibility: {
		mutationRuntime: string
		existingProjectRequirement: string
		unsupportedProjectMode: string
		newProjectPackageManagers?: string[]
	}
	sections: Array<{
		id: string
		title: string
		questions: QuestionnaireQuestion[]
	}>
}

export const PROJECT_USAGE = "Usage: /project <audit|adopt|update|new> <target-path>"

export function parseProjectArgs(raw: string): { mode: ProjectMode; target: string } | null {
	const match = raw.trim().match(/^(audit|adopt|update|new)(?:\s+(.+))?$/)
	if (!match) return null
	return { mode: match[1] as ProjectMode, target: match[2]?.trim() ?? "" }
}

export function questionnaireQuestions(questionnaire: BootstrapQuestionnaire): QuestionnaireQuestion[] {
	return questionnaire.sections.flatMap((section) => section.questions)
}

export function questionnairePlaceholders(questionnaire: BootstrapQuestionnaire): string[] {
	return questionnaireQuestions(questionnaire).flatMap((question) => question.placeholders)
}

export function missingDecisionValues(questionnaire: BootstrapQuestionnaire, values: Record<string, string>): string[] {
	return questionnairePlaceholders(questionnaire).filter((placeholder) => !values[placeholder]?.trim())
}

function isValidIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const [year, month, day] = value.split("-").map(Number)
	return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
}

export function validateDecisionValues(questionnaire: BootstrapQuestionnaire, values: Record<string, string>, validateMutation = true): void {
	const required = new Set(questionnairePlaceholders(questionnaire))
	const unknown = Object.keys(values).filter((key) => !required.has(key))
	if (unknown.length) throw new Error(`Unknown placeholder decision(s): ${unknown.join(", ")}`)
	const missing = missingDecisionValues(questionnaire, values)
	if (missing.length) throw new Error(`Missing placeholder decision(s): ${missing.join(", ")}`)
	const invalid = Object.entries(values).filter(([, value]) => /[\r\n\0]/.test(value) || /\{\{[A-Z0-9_]+\}\}/.test(value))
	if (invalid.length) throw new Error(`Decision values must be single-line strings without placeholder tokens: ${invalid.map(([key]) => key).join(", ")}`)
	for (const key of ["LAST_UPDATED_ISO_DATE", "CURRENT_STATE_DATE"]) {
		if (!isValidIsoDate(values[key])) throw new Error(`${key} must be a valid YYYY-MM-DD calendar date.`)
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(values.GENERATED_AT_UTC_ISO) || !isValidIsoDate(values.GENERATED_AT_UTC_ISO.slice(0, 10)) || Number.isNaN(Date.parse(values.GENERATED_AT_UTC_ISO))) {
		throw new Error("GENERATED_AT_UTC_ISO must be a valid UTC ISO timestamp.")
	}
	for (const key of [...required].filter((placeholder) => placeholder.startsWith("SCORE_"))) {
		if (!/^[1-5]$/.test(values[key])) throw new Error(`${key} must be an integer from 1 to 5.`)
	}
	if (validateMutation && required.has("NODE_VERSION") && values.NODE_VERSION !== "24") throw new Error("NODE_VERSION must be 24.")
	if (validateMutation && required.has("PACKAGE_MANAGER_CACHE")) {
		const lockfilesByCache: Record<string, Set<string>> = {
			npm: new Set(["package-lock.json", "npm-shrinkwrap.json"]),
			pnpm: new Set(["pnpm-lock.yaml"]),
			yarn: new Set(["yarn.lock"]),
		}
		if (!lockfilesByCache[values.PACKAGE_MANAGER_CACHE]?.has(values.PACKAGE_MANAGER_LOCKFILE)) {
			throw new Error("PACKAGE_MANAGER_CACHE and PACKAGE_MANAGER_LOCKFILE must describe the same npm, pnpm, or yarn toolchain.")
		}
		if (!values.CI_INSTALL_COMMAND.startsWith(`${values.PACKAGE_MANAGER_CACHE} `)) {
			throw new Error("CI_INSTALL_COMMAND must start with the selected package-manager command.")
		}
	}
	const outOfScope = ["OUT_OF_SCOPE_ITEM_1", "OUT_OF_SCOPE_ITEM_2", "OUT_OF_SCOPE_ITEM_3"]
	for (const key of [...outOfScope, "REPOSITORY_PROFILE_SNAKE_CASE"]) {
		if (required.has(key) && !/^[a-z0-9_]+$/.test(values[key])) throw new Error(`${key} must use snake_case.`)
	}
	if (outOfScope.every((key) => required.has(key)) && new Set(outOfScope.map((key) => values[key])).size !== outOfScope.length) {
		throw new Error("OUT_OF_SCOPE_ITEM values must be unique.")
	}
	for (const key of ["CODEOWNERS_DEFAULT_TEAM", "CODEOWNERS_SECURITY_TEAM"]) {
		if (validateMutation && required.has(key) && !/^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values[key])) throw new Error(`${key} must use @org/team format.`)
	}
	assertNoLikelySecrets(values)
}

export function assertNoLikelySecrets(values: Record<string, string>): void {
	const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/
	const hit = Object.entries(values).find(([, value]) => secretPattern.test(value))
	if (hit) throw new Error(`${hit[0]} appears to contain a secret. Store only a non-secret reference or description.`)
}

export function questionForPlaceholder(questionnaire: BootstrapQuestionnaire, placeholder: string): QuestionnaireQuestion {
	const question = questionnaireQuestions(questionnaire).find((candidate) => candidate.placeholders.includes(placeholder))
	if (!question) throw new Error(`No questionnaire entry owns ${placeholder}.`)
	return question
}

export function projectPlanningPrompt(
	mode: ProjectMode,
	target: string,
	questionnaire: BootstrapQuestionnaire,
	updateDecisionsPath = "docs/ops/automation/bootstrap-decisions.json",
): string {
	return `Prepare ${mode === "audit" || mode === "update" ? "an" : "a"} ${mode} workflow for the Agent Project Blueprint at ${JSON.stringify(target)}.

Inspect the target repository with read and search tools only. Do not edit files or run shell commands before approval. Read its README, package manifest, lockfile, agent instructions, architecture, CI, source layout, tests, and deployment files when present.

Infer every placeholder in the questionnaire below from real repository evidence. Use explicit \"not applicable: <reason>\" values where a domain does not apply. Do not invent commands, product behavior, owners, approvals, or deployed capability. Never include credentials, API keys, tokens, private keys, environment values, or other secrets.

Call review_project_blueprint_decisions with the inferred placeholder values and short evidence paths. The tool asks the user only for missing values, opens the complete decision packet for review, and requires approval before ${mode === "audit" ? "reporting the audit" : "changing the target repository"}.

For update mode, read only the extension-validated decision packet at ${JSON.stringify(updateDecisionsPath)}. Do not follow another \`decisionsPath\` from the repository. Reuse existing decisions only when current repository evidence still supports them. Review the locally installed blueprint revision, configured baseline status, and managed-file drift before approval. The guarded updater compares configured files with their recorded configured hashes and refuses genuine local edits. If it refuses, report the conflicts and stop. Never force overwrite, reset files, change recorded hashes, or delete the manifest to bypass a conflict. Updating the harness does not automatically update project-owned files or fetch upstream blueprint changes.

For audit mode, make no file changes. For adopt mode, preserve all existing target files and reconcile reported conflicts after approval. For new mode, initialize only the approved empty target. After an approved mutation, replace no product behavior beyond the decision packet, preserve existing scripts on conflicts, run the smallest blueprint checks, and report incomplete gates truthfully.

Questionnaire:
${JSON.stringify(questionnaire, null, 2)}`
}
