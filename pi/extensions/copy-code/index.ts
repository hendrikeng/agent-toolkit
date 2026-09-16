import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent"
import { copyableBlocks, lastAssistantText, styleCodeBlocks, type CopyableBlock } from "./copy-code-core.ts"

function preview(block: CopyableBlock, index: number): string {
	const first = block.text.split("\n", 1)[0]
	return `${index + 1}. ${block.language || "code"}: ${first.slice(0, 80)}${first.length > 80 ? "…" : ""}`
}

async function copyBlock(ctx: ExtensionContext, argument = ""): Promise<void> {
	const text = lastAssistantText(ctx.sessionManager.getBranch())
	const blocks = text ? copyableBlocks(text) : []
	if (!blocks.length) return ctx.ui.notify("The last assistant message has no fenced block.", "warning")
	let selected: CopyableBlock | undefined
	if (argument.trim().toLowerCase() === "all") {
		await copyToClipboard(blocks.map(block => block.text).join("\n\n"))
		ctx.ui.notify(`Copied ${blocks.length} clean blocks.`, "info")
		return
	}
	if (argument.trim()) selected = blocks[Number(argument) - 1]
	else if (blocks.length === 1) selected = blocks[0]
	else {
		const options = blocks.map(preview), choice = await ctx.ui.select("Copy a clean block", options)
		selected = blocks[options.indexOf(choice ?? "")]
		if (!choice) return
	}
	if (!selected) return ctx.ui.notify(`No fenced block matches "${argument.trim()}".`, "warning")
	await copyToClipboard(selected.text)
	ctx.ui.notify("Copied without display indentation or line wrapping.", "info")
}

export default function copyCodeExtension(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, { messageType }) => messageType === "assistant" ? styleCodeBlocks(markdown) : markdown)
	pi.registerCommand("copy-code", {
		description: "Copy a fenced block without rendered padding or line wraps",
		handler: (args, ctx) => copyBlock(ctx, args),
	})
	pi.registerShortcut("ctrl+shift+x", {
		description: "Copy a clean fenced block from the last assistant message",
		handler: ctx => copyBlock(ctx),
	})
}
