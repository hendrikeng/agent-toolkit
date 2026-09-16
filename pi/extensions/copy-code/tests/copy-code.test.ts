import assert from "node:assert/strict"
import test from "node:test"
import { copyableBlocks, lastAssistantText, styleCodeBlocks } from "../copy-code-core.ts"

test("copyable blocks remove Markdown fence indentation and preserve source text", () => {
	assert.deepEqual(copyableBlocks("Before\n ```sh\n cd /tmp/example\n ./install.sh\n ```\nAfter"), [{ language: "sh", text: "cd /tmp/example\n./install.sh" }])
	assert.deepEqual(copyableBlocks("```text\nRun the acceptance test without display wrapping.\n```"), [{ language: "text", text: "Run the acceptance test without display wrapping." }])
	assert.deepEqual(copyableBlocks("```python\n    if ready:\n        run()\n```"), [{ language: "python", text: "    if ready:\n        run()" }])
	assert.deepEqual(copyableBlocks("> ```sh\n> echo quoted\n> ```"), [{ language: "sh", text: "echo quoted" }])
	assert.deepEqual(copyableBlocks("- ```sh\n  echo direct\n  ```"), [{ language: "sh", text: "echo direct" }])
	assert.deepEqual(copyableBlocks("- item\n    ```sh\n    echo nested\n    ```"), [{ language: "sh", text: "echo nested" }])
	assert.deepEqual(copyableBlocks("- > ```sh\n  > echo mixed\n  > ```"), [{ language: "sh", text: "echo mixed" }])
	assert.deepEqual(copyableBlocks("````md\n    ````\nafter\n````"), [{ language: "md", text: "    ````\nafter" }])
})

test("code block styling hides fences, strips containers, and escapes code for Markdown rendering", () => {
	assert.equal(
		styleCodeBlocks("Before\n```bash\necho '$*'\n```\nAfter"),
		"Before\n\n\x1b[2;3mecho \\'\\$\\*\\'\x1b[22;23m\n\nAfter",
	)
	assert.equal(
		styleCodeBlocks("> ```sh\n> echo '**literal**'\n> ```"),
		"\n\x1b[2;3mecho \\'\\*\\*literal\\*\\*\\'\x1b[22;23m\n",
	)
	assert.equal(
		styleCodeBlocks("- ```sh\n  find .\n  ```"),
		"\n\x1b[2;3mfind \\.\x1b[22;23m\n",
	)
	assert.equal(
		styleCodeBlocks("- > ```sh\n  > echo mixed\n  > ```"),
		"\n\x1b[2;3mecho mixed\x1b[22;23m\n",
	)
})

test("last assistant text ignores user messages and thinking blocks", () => {
	const entries = [
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } },
		{ type: "message", message: { role: "user", content: "newer" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "```sh\necho ok\n```" }] } },
	]
	assert.equal(lastAssistantText(entries), "```sh\necho ok\n```")
})
