export type CopyableBlock = { language: string; text: string }

function unquote(line: string, limit = Infinity): { depth: number; text: string } {
	let depth = 0, text = line
	while (depth < limit) {
		const marker = /^ {0,3}>[ \t]?/.exec(text)
		if (!marker) break
		text = text.slice(marker[0].length)
		depth++
	}
	return { depth, text }
}

export function copyableBlocks(markdown: string): CopyableBlock[] {
	const blocks: CopyableBlock[] = [], lines = markdown.split(/\r?\n/)
	for (let index = 0; index < lines.length; index++) {
		const container = unquote(lines[index])
		let source = container.text, listIndent = 0, list
		while ((list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(source))) {
			listIndent += list[0].length
			source = source.slice(list[0].length)
		}
		const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(source)
		if (!opening) continue
		const indent = opening[1].length, marker = opening[2][0], length = opening[2].length
		const maxClosingIndent = Math.max(0, indent - 3) + 3
		const language = opening[3].trim().split(/\s+/, 1)[0].toLowerCase(), content: string[] = []
		for (index++; index < lines.length; index++) {
			const line = unquote(lines[index], container.depth)
			if (line.depth < container.depth) break
			const leading = line.text.match(/^[ \t]*/)![0].length, text = line.text.slice(Math.min(listIndent, leading))
			if (new RegExp(`^[ \\t]{0,${maxClosingIndent}}${marker}{${length},}[ \\t]*$`).test(text)) break
			content.push(text.replace(new RegExp(`^[ \\t]{0,${indent}}`), ""))
		}
		blocks.push({ language, text: content.join("\n") })
	}
	return blocks
}

export function lastAssistantText(entries: unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; message?: { role?: string; content?: unknown } }
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue
		if (typeof entry.message.content === "string") return entry.message.content
		if (Array.isArray(entry.message.content)) return entry.message.content.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string")).map(part => part.text).join("\n")
	}
}
