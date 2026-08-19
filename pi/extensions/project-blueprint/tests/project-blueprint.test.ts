import assert from "node:assert/strict"
import test from "node:test"
import {
	missingDecisionValues,
	parseProjectArgs,
	validateDecisionValues,
	type BootstrapQuestionnaire,
} from "../project-blueprint-core.ts"

const questionnaire: BootstrapQuestionnaire = {
	schemaVersion: 1,
	compatibility: {
		mutationRuntime: "Node.js 24",
		existingProjectRequirement: "package.json",
		unsupportedProjectMode: "audit-only",
	},
	sections: [{
		id: "test",
		title: "Test",
		questions: [
			{ id: "dates", prompt: "Dates", placeholders: ["LAST_UPDATED_ISO_DATE", "CURRENT_STATE_DATE", "GENERATED_AT_UTC_ISO"] },
			{ id: "score", prompt: "Score", placeholders: ["SCORE_TEST"] },
			{ id: "product", prompt: "Product", placeholders: ["PRODUCT"] },
		],
	}],
}

const validValues = {
	LAST_UPDATED_ISO_DATE: "2026-03-22",
	CURRENT_STATE_DATE: "2026-03-22",
	GENERATED_AT_UTC_ISO: "2026-03-22T12:00:00.000Z",
	SCORE_TEST: "4",
	PRODUCT: "Example",
}

test("parses project modes and paths", () => {
	assert.deepEqual(parseProjectArgs("adopt ../existing project"), { mode: "adopt", target: "../existing project" })
	assert.deepEqual(parseProjectArgs("audit /tmp/repo"), { mode: "audit", target: "/tmp/repo" })
	assert.equal(parseProjectArgs("update /tmp/repo"), null)
})

test("allows non-Node toolchain decisions for read-only audits", () => {
	const auditQuestionnaire: BootstrapQuestionnaire = {
		...questionnaire,
		sections: [...questionnaire.sections, {
			id: "tooling",
			title: "Tooling",
			questions: [
				{
					id: "node",
					prompt: "Node tooling",
					placeholders: ["NODE_VERSION", "PACKAGE_MANAGER_CACHE", "PACKAGE_MANAGER_LOCKFILE", "CI_INSTALL_COMMAND"],
				},
				{
					id: "owners",
					prompt: "Owners",
					placeholders: ["CODEOWNERS_DEFAULT_TEAM", "CODEOWNERS_SECURITY_TEAM"],
				},
			],
		}],
	}
	const values = {
		...validValues,
		NODE_VERSION: "not applicable",
		PACKAGE_MANAGER_CACHE: "not applicable",
		PACKAGE_MANAGER_LOCKFILE: "not applicable",
		CI_INSTALL_COMMAND: "not applicable",
		CODEOWNERS_DEFAULT_TEAM: "not applicable: no GitHub organization",
		CODEOWNERS_SECURITY_TEAM: "not applicable: no GitHub organization",
	}
	assert.doesNotThrow(() => validateDecisionValues(auditQuestionnaire, values, false))
	assert.throws(() => validateDecisionValues(auditQuestionnaire, values), /NODE_VERSION must be 24/)
})

test("finds and validates missing decision values", () => {
	assert.deepEqual(missingDecisionValues(questionnaire, { PRODUCT: "Example" }), [
		"LAST_UPDATED_ISO_DATE",
		"CURRENT_STATE_DATE",
		"GENERATED_AT_UTC_ISO",
		"SCORE_TEST",
	])
	assert.doesNotThrow(() => validateDecisionValues(questionnaire, validValues))
	assert.throws(() => validateDecisionValues(questionnaire, { ...validValues, SCORE_TEST: "6" }), /integer from 1 to 5/)
	assert.throws(() => validateDecisionValues(questionnaire, { ...validValues, EXTRA: "x" }), /Unknown placeholder/)
	assert.throws(() => validateDecisionValues(questionnaire, { ...validValues, CURRENT_STATE_DATE: "2026-02-31" }), /valid YYYY-MM-DD calendar date/)
	assert.throws(() => validateDecisionValues(questionnaire, { ...validValues, PRODUCT: "{{UNKNOWN_VALUE}}" }), /without placeholder tokens/)
	assert.throws(
		() => validateDecisionValues(questionnaire, { ...validValues, PRODUCT: `${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}${"x".repeat(30)}` }),
		/appears to contain a secret/,
	)
})
