import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { UserMessage } from "@earendil-works/pi-ai"
import {
	type AgentSession,
	BorderedLoader,
	buildSessionContext,
	convertToLlm,
	copyToClipboard,
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
	type Focusable,
	Input,
	Key,
	Markdown,
	matchesKey,
	sliceByColumn,
	stripTerminalSequences,
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
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

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

type SideViewResult = { type: "follow-up"; question: string } | { type: "close" }
type SelectionPoint = { row: number; col: number }

class SideAnswerView implements Component, Focusable {
	private readonly tui: TUI
	private readonly markdown: Markdown
	private readonly title: (text: string) => string
	private readonly hint: (text: string) => string
	private readonly input = new Input()
	private readonly footerHeight: number
	private mouseTrackingActive: boolean
	private _focused = false
	private scrollTop = 0
	private contentHeight = 0
	private viewportHeight = 1
	private panelTop = 0
	private contentLines: string[] = []
	private selectionAnchor?: SelectionPoint
	private selectionFocus?: SelectionPoint
	private selecting = false
	private copyStatus?: "copied" | "copy failed"

	constructor(
		tui: TUI,
		answer: string,
		styles: { title: (text: string) => string; hint: (text: string) => string },
		footerHeight: number,
		onSubmit: (result: SideViewResult) => void,
	) {
		this.tui = tui
		this.markdown = new Markdown(answer, 0, 0, getMarkdownTheme())
		this.title = styles.title
		this.hint = styles.hint
		this.footerHeight = footerHeight
		this.input.onSubmit = (question) => {
			if (question.trim()) onSubmit({ type: "follow-up", question: question.trim() })
		}
		this.input.onEscape = () => onSubmit({ type: "close" })
		this.scrollTop = Number.MAX_SAFE_INTEGER
		this.mouseTrackingActive = tui.mode === "regular"
		if (this.mouseTrackingActive) tui.terminal.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h")
	}

	get focused(): boolean {
		return this._focused
	}

	set focused(value: boolean) {
		this._focused = value
		this.input.focused = value
	}

	private styledLine(text: string, width: number, style: (value: string) => string): string {
		const clipped = truncateToWidth(text, width, "")
		return style(`${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`)
	}

	private scrollBy(lines: number): void {
		const next = nextSideAnswerScrollTop(this.scrollTop, lines, this.contentHeight, this.viewportHeight)
		if (next === this.scrollTop) return
		this.scrollTop = next
		this.tui.requestRender()
	}

	private selectionPoint(x: number, y: number, clamp: boolean): SelectionPoint | undefined {
		if (this.viewportHeight <= 0) return undefined
		const pointerRow = y - this.panelTop - 1
		if (!clamp && (pointerRow < 0 || pointerRow >= this.viewportHeight)) return undefined
		const localRow = Math.max(0, Math.min(this.viewportHeight - 1, pointerRow))
		const row = this.scrollTop + localRow
		const width = visibleWidth(stripTerminalSequences(this.contentLines[row] ?? ""))
		return { row, col: Math.max(0, Math.min(width, x)) }
	}

	private graphemeRange(point: SelectionPoint): { start: number; end: number } | undefined {
		const line = stripTerminalSequences(this.contentLines[point.row] ?? "")
		let start = 0
		for (const { segment } of graphemeSegmenter.segment(line)) {
			const end = start + visibleWidth(segment)
			if (point.col < end) return { start, end }
			start = end
		}
		return undefined
	}

	private selectionBounds(): { start: SelectionPoint; end: SelectionPoint } | undefined {
		const anchor = this.selectionAnchor
		const focus = this.selectionFocus
		if (!anchor || !focus || (anchor.row === focus.row && anchor.col === focus.col)) return undefined
		const ordered = anchor.row < focus.row || (anchor.row === focus.row && anchor.col < focus.col)
			? { start: anchor, end: focus }
			: { start: focus, end: anchor }
		const startRange = this.graphemeRange(ordered.start)
		const endRange = this.graphemeRange(ordered.end)
		return {
			start: { ...ordered.start, col: startRange?.start ?? ordered.start.col },
			end: { ...ordered.end, col: endRange ? endRange.end - 1 : ordered.end.col },
		}
	}

	private async copySelection(): Promise<void> {
		const selection = this.selectionBounds()
		if (!selection) return
		const lines: string[] = []
		for (let row = selection.start.row; row <= selection.end.row; row++) {
			const line = stripTerminalSequences(this.contentLines[row] ?? "")
			const start = row === selection.start.row ? selection.start.col : 0
			const end = row === selection.end.row ? Math.min(visibleWidth(line), selection.end.col + 1) : visibleWidth(line)
			lines.push(sliceByColumn(line, start, Math.max(0, end - start), true).trimEnd())
		}
		const text = lines.join("\n")
		if (!text) return
		await copyToClipboard(text)
		this.copyStatus = "copied"
		this.tui.requestRender()
	}

	private handleMouse(data: string): boolean {
		if (!this.mouseTrackingActive) return false
		const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data)
		if (!match || (Number(match[1]) & 64) !== 0) return false
		const button = Number(match[1])
		const x = Number(match[2]) - 1
		const y = Number(match[3]) - 1
		if (match[4] === "m") {
			if (this.selecting) {
				this.selecting = false
				this.selectionFocus = this.selectionPoint(x, y, true)
				void this.copySelection().catch(() => {
					this.copyStatus = "copy failed"
					this.tui.requestRender()
				})
				this.tui.requestRender()
			}
			return true
		}
		if ((button & 32) !== 0) {
			if (this.selecting) {
				this.selectionFocus = this.selectionPoint(x, y, true)
				this.tui.requestRender()
			}
			return true
		}
		if ((button & 3) === 0) {
			const point = this.selectionPoint(x, y, false)
			if (!point) return true
			this.selecting = true
			this.selectionAnchor = point
			this.selectionFocus = point
			this.copyStatus = undefined
			this.tui.requestRender()
			return true
		}
		return false
	}

	private highlightSelection(line: string, row: number): string {
		const selection = this.selectionBounds()
		if (!selection || row < selection.start.row || row > selection.end.row) return line
		const lineWidth = visibleWidth(line)
		const start = row === selection.start.row ? selection.start.col : 0
		const end = row === selection.end.row ? Math.min(lineWidth, selection.end.col + 1) : lineWidth
		if (end <= start) return line
		const before = sliceByColumn(line, 0, start, true)
		const selected = sliceByColumn(line, start, end - start, true).replace(/\x1b\[[0-?]*[ -/]*m/g, "$&\x1b[7m")
		const after = sliceByColumn(line, end, Math.max(0, lineWidth - end), true)
		return `${before}\x1b[7m${selected}\x1b[27m${after}`
	}

	handleInput(data: string): void {
		if (this.handleMouse(data)) return
		const wheel = sideAnswerWheelDirection(data)
		if (wheel !== 0) {
			this.scrollBy(wheel * 3)
			return
		}
		if (matchesKey(data, Key.up)) this.scrollBy(-1)
		else if (matchesKey(data, Key.down)) this.scrollBy(1)
		else if (matchesKey(data, Key.pageUp)) this.scrollBy(-this.viewportHeight)
		else if (matchesKey(data, Key.pageDown)) this.scrollBy(this.viewportHeight)
		else if (matchesKey(data, Key.ctrl("c"))) this.input.onEscape?.()
		else this.input.handleInput(data)
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width)
		const content = this.markdown.render(contentWidth)
		this.contentLines = content
		this.contentHeight = content.length
		const availableHeight = Math.max(5, this.tui.terminal.rows - this.footerHeight - 1)
		this.viewportHeight = Math.max(1, Math.min(content.length, availableHeight - 4))
		this.scrollTop = nextSideAnswerScrollTop(this.scrollTop, 0, this.contentHeight, this.viewportHeight)
		const visible = content.slice(this.scrollTop, this.scrollTop + this.viewportHeight).map((line, index) => {
			const clipped = truncateToWidth(this.highlightSelection(line, this.scrollTop + index), contentWidth, "")
			return `${clipped}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))}`
		})
		const position = this.contentHeight > this.viewportHeight
			? `${this.scrollTop + 1}–${Math.min(this.contentHeight, this.scrollTop + this.viewportHeight)}/${this.contentHeight} · `
			: ""
		const lines = [
			this.styledLine("↗ Side", width, this.title),
			...visible,
			this.hint("─".repeat(width)),
			...this.input.render(contentWidth),
			this.styledLine(`${this.copyStatus ? `${this.copyStatus} · ` : ""}${position}enter ask · esc close · drag copy · wheel/↑↓ scroll`, width, this.hint),
		]
		this.panelTop = Math.max(0, this.tui.terminal.rows - this.footerHeight - lines.length)
		return lines
	}

	invalidate(): void {
		this.markdown.invalidate()
		this.input.invalidate()
	}

	dispose(): void {
		if (!this.mouseTrackingActive) return
		this.mouseTrackingActive = false
		this.tui.terminal.write("\x1b[?1006l\x1b[?1002l\x1b[?1000l")
	}
}

export default function sideQuestionExtension(pi: ExtensionAPI): void {
	let sideSession: AgentSession | null = null
	let sideTurns: Array<{ question: string; answer: string }> = []
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
		if (sideSession?.isStreaming) await sideSession.abort()
		sideSession?.dispose()
		sideSession = null
		sideTurns = []
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
					sideTurns = []
					ctx.ui.setStatus("side-question", ctx.ui.theme.fg("accent", "| ↗ SIDE"))
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
				return
			}

			let nextQuestion = question
			while (true) {
				let failure: string | undefined
				let aborted = false
				const answer = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
					const loader = new BorderedLoader(tui, theme, `Side agent using ${sideSession!.model?.id ?? ctx.model!.id}...`)
					loader.onAbort = () => {
						aborted = true
						void sideSession!.abort()
					}
					sideSession!
						.prompt(nextQuestion)
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
				sideTurns.push({ question: nextQuestion, answer })
				const conversation = sideTurns
					.map((turn) => `> ${turn.question.replaceAll("\n", "\n> ")}\n\n${turn.answer}`)
					.join("\n\n---\n\n")
				let footerHeight = 1
				let result: SideViewResult
				try {
					result = await ctx.ui.custom<SideViewResult>((tui, theme, _keybindings, done) => {
						footerHeight = Math.max(1, tui.children.at(-1)?.render(tui.terminal.columns).length ?? 1)
						activeAnswerView = new SideAnswerView(
							tui,
							conversation,
							{
								title: (text) => theme.fg("accent", theme.bold(text)),
								hint: (text) => theme.fg("dim", text),
							},
							footerHeight,
							done,
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
				if (result.type === "close") {
					await closeSideSession()
					ctx.ui.setStatus("side-question", undefined)
					ctx.ui.notify("Side conversation closed", "info")
					return
				}
				nextQuestion = result.question
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
