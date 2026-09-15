---
name: copyable-commands
description: "Format terminal commands for direct copy and paste. Use automatically whenever a response gives the user shell commands, CLI invocations, console input, or other command text to copy."
---

# Copyable Commands

Format every command for direct copy and paste.

- Put each command on one physical line in a fenced code block.
- Start every line at column one, including comments and later commands.
- Never use a shell line-continuation character such as `\`, a PowerShell backtick, or `^`.
- Never add leading indentation, trailing spaces, or trailing tabs.
- Keep long commands on one line instead of wrapping them for display.
- Put explanations outside the fenced block.
- If a block contains multiple commands, put one complete command on each unindented line.
- Never present multiline input as a copyable command. Use a one-line equivalent or create the file with a file-writing tool.

Before sending a response, inspect each copyable block for wrapped lines, indentation, continuation characters, and trailing whitespace.
