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
	getMarkdownTheme,
	serializeConversation,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import {
	type Component,
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui"
import {
	nextSideAnswerScrollTop,
	sideAnswerWheelDirection,
	SIDE_BOUNDARY_PROMPT,
	SIDE_SYSTEM_PROMPT,
} from "./side-core.ts"

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

class SideAnswerView implements Component {
	private readonly tui: TUI
	private readonly markdown: Markdown
	private readonly title: (text: string) => string
	private readonly hint: (text: string) => string
	private readonly onClose: () => void
	private readonly footerHeight: number
	private mouseTrackingActive: boolean
	private scrollTop = 0
	private contentHeight = 0
	private viewportHeight = 1

	constructor(
		tui: TUI,
		answer: string,
		styles: { title: (text: string) => string; hint: (text: string) => string },
		footerHeight: number,
		onClose: () => void,
	) {
		this.tui = tui
		this.markdown = new Markdown(answer, 1, 0, getMarkdownTheme())
		this.title = styles.title
		this.hint = styles.hint
		this.footerHeight = footerHeight
		this.onClose = onClose
		this.mouseTrackingActive = tui.mode === "regular"
		if (this.mouseTrackingActive) tui.terminal.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h")
	}

	private frame(label: string, width: number, top: boolean): string {
		const text = truncateToWidth(`─ ${label} `, width, "")
		const line = `${text}${"─".repeat(Math.max(0, width - visibleWidth(text)))}`
		return top ? this.title(line) : this.hint(line)
	}

	private scrollBy(lines: number): void {
		const next = nextSideAnswerScrollTop(this.scrollTop, lines, this.contentHeight, this.viewportHeight)
		if (next === this.scrollTop) return
		this.scrollTop = next
		this.tui.requestRender()
	}

	handleInput(data: string): void {
		const wheel = sideAnswerWheelDirection(data)
		if (wheel !== 0) {
			this.scrollBy(wheel * 3)
			return
		}
		if (matchesKey(data, Key.up)) this.scrollBy(-1)
		else if (matchesKey(data, Key.down)) this.scrollBy(1)
		else if (matchesKey(data, Key.pageUp)) this.scrollBy(-this.viewportHeight)
		else if (matchesKey(data, Key.pageDown)) this.scrollBy(this.viewportHeight)
		else if (matchesKey(data, Key.home)) this.scrollBy(-this.contentHeight)
		else if (matchesKey(data, Key.end)) this.scrollBy(this.contentHeight)
		else if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.onClose()
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width)
		const content = this.markdown.render(contentWidth)
		this.contentHeight = content.length
		const availableHeight = Math.max(3, this.tui.terminal.rows - this.footerHeight - 1)
		this.viewportHeight = Math.max(1, Math.min(content.length, availableHeight - 2))
		this.scrollTop = nextSideAnswerScrollTop(this.scrollTop, 0, this.contentHeight, this.viewportHeight)
		const visible = content.slice(this.scrollTop, this.scrollTop + this.viewportHeight).map((line) => {
			const clipped = truncateToWidth(line, contentWidth, "")
			return `${clipped}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))}`
		})
		const position = this.contentHeight > this.viewportHeight
			? `${this.scrollTop + 1}–${Math.min(this.contentHeight, this.scrollTop + this.viewportHeight)}/${this.contentHeight} · `
			: ""
		return [
			this.frame("Side answer", width, true),
			...visible,
			this.frame(`${position}wheel/↑↓ scroll · enter/esc close`, width, false),
		]
	}

	invalidate(): void {
		this.markdown.invalidate()
	}

	dispose(): void {
		if (!this.mouseTrackingActive) return
		this.mouseTrackingActive = false
		this.tui.terminal.write("\x1b[?1006l\x1b[?1002l\x1b[?1000l")
	}
}

export default function sideQuestionExtension(pi: ExtensionAPI): void {
	let sideSession: AgentSession | null = null
	let activeAnswerView: SideAnswerView | null = null

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
					ctx.ui.setStatus("side-question", ctx.ui.theme.fg("accent", "| ↗ SIDE"))
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
			let footerHeight = 1
			try {
				await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
					footerHeight = Math.max(1, tui.children.at(-1)?.render(tui.terminal.columns).length ?? 1)
					activeAnswerView = new SideAnswerView(
						tui,
						answer,
						{
							title: (text) => theme.fg("accent", theme.bold(text)),
							hint: (text) => theme.fg("dim", text),
						},
						footerHeight,
						() => done(undefined),
					)
					return activeAnswerView
				}, {
					overlay: true,
					overlayOptions: () => ({
						width: "100%",
						maxHeight: "100%",
						anchor: "bottom-left",
						margin: { top: 1, bottom: footerHeight },
					}),
				})
			} finally {
				activeAnswerView?.dispose()
				activeAnswerView = null
			}
		},
	})

	pi.on("session_shutdown", async (_event, ctx) => {
		activeAnswerView?.dispose()
		activeAnswerView = null
		await closeSideSession()
		ctx.ui.setStatus("side-question", undefined)
	})
}
