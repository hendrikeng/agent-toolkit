import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export type SimpleEnglishRequest = {
	action: "check" | "rewrite"
	target: string
	mode: "pragmatic" | "strict"
}

export const SIMPLE_ENGLISH_USAGE =
	"Usage: /simple-english check <file-or-directory> | rewrite <file-or-directory> [pragmatic|strict]"

export function parseSimpleEnglishArgs(rawArgs: string): SimpleEnglishRequest | null {
	const parts = rawArgs.trim().split(/\s+/).filter(Boolean)
	if (parts.length === 0) return null

	const action = parts.shift()?.toLowerCase()
	if (action !== "check" && action !== "rewrite") throw new Error(SIMPLE_ENGLISH_USAGE)

	let mode: SimpleEnglishRequest["mode"] = "pragmatic"
	if (action === "rewrite" && parts.length > 1 && (parts.at(-1) === "pragmatic" || parts.at(-1) === "strict")) {
		mode = parts.pop() as SimpleEnglishRequest["mode"]
	}
	if (parts.length === 0) throw new Error(SIMPLE_ENGLISH_USAGE)

	return { action, target: parts.join(" "), mode }
}

export function simpleEnglishPrompt(request: SimpleEnglishRequest): string {
	const target = JSON.stringify(request.target)
	return request.action === "check"
		? `Check ${target} with Simple English. Report each violation and a suggested rewrite. Do not edit files.`
		: `Rewrite ${target} with Simple English in ${request.mode} mode. Read each file before you edit it.`
}

export default function simpleEnglishExtension(pi: ExtensionAPI): void {
	pi.registerCommand("simple-english", {
		description: "Check or rewrite technical documentation with Simple English",
		getArgumentCompletions(prefix) {
			const value = prefix.trimStart()
			if (value.includes(" ")) return null
			const matches = ["check", "rewrite"].filter((action) => action.startsWith(value))
			return matches.length ? matches.map((action) => ({ value: action, label: action })) : null
		},
		handler: async (rawArgs, ctx) => {
			let request: SimpleEnglishRequest | null
			try {
				request = parseSimpleEnglishArgs(rawArgs)
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : SIMPLE_ENGLISH_USAGE, "warning")
				return
			}

			if (!request) {
				if (!ctx.hasUI) {
					ctx.ui.notify(SIMPLE_ENGLISH_USAGE, "warning")
					return
				}
				const selected = await ctx.ui.select("Simple English", [
					"Check a document",
					"Rewrite in pragmatic mode",
					"Rewrite in strict mode",
				])
				if (!selected) return
				const target = (await ctx.ui.input("File or directory", "README.md"))?.trim()
				if (!target) return
				request = {
					action: selected === "Check a document" ? "check" : "rewrite",
					target,
					mode: selected === "Rewrite in strict mode" ? "strict" : "pragmatic",
				}
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish, then run /simple-english again.", "warning")
				return
			}

			const taskRule = request.action === "check"
				? "This is a check only. Do not modify files."
				: `Rewrite only the requested documentation in ${request.mode} mode.`
			pi.sendUserMessage(`/skill:simple-english ${taskRule}\n\n${simpleEnglishPrompt(request)}`, { expandPromptTemplates: true })
		},
	})
}
