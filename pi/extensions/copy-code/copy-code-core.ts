export type CopyableBlock = { language: string; text: string }

type Fence = { containers: ("quote" | number)[]; indent: number; language: string; closing: RegExp }

function openingFence(line: string): Fence | undefined {
	const containers: ("quote" | number)[] = []
	let source = line
	while (true) {
		const quote = /^ {0,3}>[ \t]?/.exec(source)
		if (quote) {
			containers.push("quote")
			source = source.slice(quote[0].length)
			continue
		}
		const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(source)
		if (!list) break
		containers.push(list[0].length)
		source = source.slice(list[0].length)
	}
	const opening = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(source)
	if (!opening) return
	const indent = opening[1].length, maxClosingIndent = Math.max(0, indent - 3) + 3
	return {
		containers,
		indent,
		language: opening[3].trim().split(/\s+/, 1)[0].toLowerCase(),
		closing: new RegExp(`^[ \\t]{0,${maxClosingIndent}}${opening[2][0]}{${opening[2].length},}[ \\t]*$`),
	}
}

function unwrapContainers(line: string, containers: Fence["containers"]): string | undefined {
	let text = line
	for (const container of containers) {
		if (container === "quote") {
			const quote = /^ {0,3}>[ \t]?/.exec(text)
			if (!quote) return
			text = text.slice(quote[0].length)
		} else {
			const leading = text.match(/^[ \t]*/)![0].length
			text = text.slice(Math.min(container, leading))
		}
	}
	return text
}

export function copyableBlocks(markdown: string): CopyableBlock[] {
	const blocks: CopyableBlock[] = [], lines = markdown.split(/\r?\n/)
	for (let index = 0; index < lines.length; index++) {
		const fence = openingFence(lines[index])
		if (!fence) continue
		const content: string[] = []
		for (index++; index < lines.length; index++) {
			const text = unwrapContainers(lines[index], fence.containers)
			if (text === undefined) {
				index--
				break
			}
			if (fence.closing.test(text)) break
			content.push(text.replace(new RegExp(`^[ \\t]{0,${fence.indent}}`), ""))
		}
		blocks.push({ language: fence.language, text: content.join("\n") })
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
