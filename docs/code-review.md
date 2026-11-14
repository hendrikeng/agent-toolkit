# Native code review commands

The review policy in `shared/AGENTS.md` sets when a review runs. This file gives the commands.

Run the review as a separate headless process from the repository or worktree root, at medium effort.
Match the reviewer to the provider family of the agent that requests the review. Other provider families use Codex.

## Claude

```sh
claude -p "/code-review medium [target]" --model claude-opus-5-5 --effort medium --safe-mode --setting-sources user --permission-mode dontAsk --strict-mcp-config --allowedTools "Read Grep Glob Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git status *) Bash(git rev-parse *) Bash(git merge-base *) Bash(git ls-files *)" --disallowedTools "Bash(*--output*) Bash(*--ext-diff*)" < /dev/null
```

## Codex

```sh
codex exec review (--uncommitted | --base <branch> | --commit <sha>) -m gpt-6.1-sol --ephemeral -c model_reasoning_effort="medium" -o <file outside the repository>
```

## Tool limits

The Claude reviewer gets only read tools and the listed Git commands. It does not load project settings, hooks, or MCP servers.
These are tool limits, not an OS sandbox. Git configuration in the repository can still start programs.

In a sandboxed session, a nested reviewer can fail to start. In Codex, request native escalation. In Claude, report the limitation.
Do not exclude `claude -p` or `codex` from the sandbox.

A review takes about 1-4 minutes. Run it in the background or with a long timeout.
