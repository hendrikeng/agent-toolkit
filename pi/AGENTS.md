# Pi defaults

## Browser control

When Pi runs in Orca, use the Orca CLI and its embedded browser for browser interaction. Load the version-matched `orca-cli` guide first. Do not use Computer Use for browser interaction unless the user explicitly requests a browser outside Orca or the Orca browser is unavailable. Use web search and fetch tools for non-interactive research.

## Agent delegation

Use `pi-yolo` for all spawned task workers and full handoffs, including ordinary tasks outside `/graph`. Use the current Pi provider/model with an explicit `--model provider/model` and `--thinking medium`; use high only when the user explicitly requests it, never automatically on retries.

In Orca, launch workers through `terminal create --command 'pi-yolo --model provider/model --thinking medium'` in the target worktree, then deliver the task using the version-matched handoff or orchestration guide. Preserve any account-pinning requirements from the active workflow. Do not copy Codex launcher examples from generic guides, launch plain `pi`, or use generic `--agent`/`worker-start` launchers that do not guarantee `pi-yolo`. If the wrapper cannot launch, report the blocker rather than falling back to another agent.

Review exception: `autoreview` continues to use its Codex CLI engine with Astra at medium thinking and its documented access-only fallback. This exception is for review, not implementation workers, and does not change the risk-gated review rules below.

## Review artifacts

In `pi-yolo`, put review and Security handoff results in a unique subdirectory of `AGENT_TOOLKIT_REVIEW_ROOT`, not an arbitrary temporary directory. Before starting a reviewer, use the native `read` tool on that root's `.read-probe.txt`. If the variable is missing or the read is denied, stop before spending review quota and request a restart through the updated launcher. Do not substitute shell reads or widen permissions. `/reload` does not regenerate the runtime policy.

The `autoreview` helper provides unique default report and status paths under this root. Prefer those defaults. Keep additional wrapper logs under the same root using normally authorized operations. Verify the final status and report; a process ID is not completion evidence. Existing temporary reports still require explicit access approval.

## Copyable output

Put text the user needs to copy (prompts, handoffs, commands, or instructions for another agent) in a fenced code block, never a Markdown blockquote (`>`). Keep explanations outside the block so the user can copy its contents unchanged.

## Documentation prose

When you create or edit documentation prose in Markdown files, read the installed Simple English skill at `$PI_CODING_AGENT_DIR/extensions/simple-english/SKILL.md` (default `~/.pi/agent/extensions/simple-english/SKILL.md`) completely and follow it in pragmatic mode. Apply it whether people or agents use the documentation. Do not apply it to code blocks, inline code, commands, identifiers, paths, quoted output, source code, `AGENTS.md`, `SKILL.md`, or prompt files.

## Risk-gated review closeout

Do not run `autoreview` or `ponytail-review` merely because code was edited or a task is ending.

When the user asks Pi to commit, push, open or update a PR, merge, or ship, evaluate the current change bundle once:

1. Inspect the relevant staged, unstaged, or branch diff and run the smallest focused deterministic checks.
2. Run `ponytail-review` only when the diff adds a dependency, abstraction or layer, configurable surface, or at least 150 changed non-test, non-doc lines.
3. Run `autoreview` only when the diff affects authentication, security or secret handling, money or persisted data, schemas or migrations, concurrency, a public API or protocol, installation or upgrades, release machinery, or at least 200 changed non-test, non-doc lines.
4. Skip both reviews when no trigger applies. Do not rerun a review for an unchanged change bundle at later commit, push, or PR steps.
5. Treat findings as advisory, verify them in the real code, and keep fixes inside the original task scope. If a review changes code, rerun the affected checks and that review.

A session-level `reviews:off` instruction is an explicit user override: skip automatic AI reviews at every boundary until that session returns to `reviews:auto`. Do not replace skipped reviews with broader tests.

Load and follow the named skill when a review is triggered. If it is unavailable, report that briefly instead of substituting another reviewer. Git hooks should remain limited to fast deterministic checks; never install an AI review as a commit or push hook.
