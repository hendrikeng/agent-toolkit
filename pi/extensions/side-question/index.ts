import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { UserMessage } from "@earendil-works/pi-ai"
import {
	type AgentSession,
	BorderedLoader,
	buildSessionContext,
	convertToLlm,
	createAgentSession,
	DefaultPackageManager,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
	serializeConversation,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { SIDE_BOUNDARY_PROMPT, SIDE_SYSTEM_PROMPT } from "./side-core.ts"

const SIDE_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"]

function finalAnswer(messages: AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message.role !== "assistant") continue
		return message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
	}
	return ""
}

export default function sideQuestionExtension(pi: ExtensionAPI): void {
	let sideSession: AgentSession | null = null

	async function startSideSession(ctx: ExtensionCommandContext): Promise<AgentSession> {
		const agentDir = getAgentDir()
		const settingsManager = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted: ctx.isProjectTrusted() })
		const resources = await new DefaultPackageManager({ cwd: ctx.cwd, agentDir, settingsManager }).resolve(async () => "skip")
		const permissionExtensions = resources.extensions.filter(
			(resource) => resource.enabled && resource.metadata.source.includes("pi-permission-system"),
		)
		if (permissionExtensions.length === 0) throw new Error("The Pi permission extension is required for side conversations")

		const extensionPaths = resources.extensions
			.filter(
				(resource) =>
					resource.enabled
					&& (resource.metadata.source.includes("pi-permission-system") || resource.path.includes("codex-fast")),
			)
			.map((resource) => resource.path)
		const resourceLoader = new DefaultResourceLoader({
			cwd: ctx.cwd,
			agentDir,
			settingsManager,
			additionalExtensionPaths: [...new Set(extensionPaths)],
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPrompt: [SIDE_SYSTEM_PROMPT],
		})
		await resourceLoader.reload()

		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			agentDir,
			model: ctx.model,
			thinkingLevel: ctx.thinkingLevel,
			tools: SIDE_TOOLS,
			resourceLoader,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			settingsManager,
		})
		const main = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())
		const reference: UserMessage = {
			role: "user",
			content: [
				{
					type: "text",
					text: `${SIDE_BOUNDARY_PROMPT}\n\n${serializeConversation(convertToLlm(main.messages))}`,
				},
			],
			timestamp: Date.now(),
		}
		session.agent.state.messages = [reference]
		return session
	}

	async function closeSideSession(): Promise<void> {
		if (!sideSession) return
		if (sideSession.isStreaming) await sideSession.abort()
		sideSession.dispose()
		sideSession = null
	}

	pi.registerCommand("side", {
		description: "Ask questions or make small explicit fixes in an ephemeral side conversation",
		getArgumentCompletions: (prefix) =>
			"close".startsWith(prefix.trim()) ? [{ value: "close", label: "close", description: "Discard the side conversation" }] : null,
		handler: async (rawArgs, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/side requires interactive mode", "error")
				return
			}
			if (rawArgs.trim() === "close") {
				if (!sideSession) {
					ctx.ui.notify("No side conversation is open", "info")
					return
				}
				await closeSideSession()
				ctx.ui.setStatus("side-question", undefined)
				ctx.ui.notify("Side conversation closed", "info")
				return
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error")
				return
			}

			const question = rawArgs.trim() || (await ctx.ui.input("Side conversation", sideSession ? "Ask a follow-up" : "Ask or request a small fix"))?.trim()
			if (!question) return

			try {
				if (!sideSession) {
					sideSession = await startSideSession(ctx)
					ctx.ui.setStatus("side-question", "side")
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
				return
			}

			let failure: string | undefined
			let aborted = false
			const answer = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
				const loader = new BorderedLoader(tui, theme, `Side agent using ${sideSession!.model?.id ?? ctx.model!.id}...`)
				loader.onAbort = () => {
					aborted = true
					void sideSession!.abort()
				}
				sideSession!
					.prompt(question)
					.then(() => done(aborted ? null : finalAnswer(sideSession!.messages)))
					.catch((error) => {
						failure = error instanceof Error ? error.message : String(error)
						done(null)
					})
				return loader
			})

			if (answer === null) {
				ctx.ui.notify(failure ?? "Side request cancelled", failure ? "error" : "info")
				return
			}
			if (!answer.trim()) {
				ctx.ui.notify("The side agent returned no answer", "warning")
				return
			}
			await ctx.ui.editor("Side answer (close when done)", answer)
		},
	})

	pi.on("session_shutdown", async (_event, ctx) => {
		await closeSideSession()
		ctx.ui.setStatus("side-question", undefined)
	})
}
