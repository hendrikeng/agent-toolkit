# Native code review commands

The review policy in `shared/AGENTS.md` sets when a review runs. This file gives the commands.

Run the review as a separate headless process from the repository or worktree root, at medium effort.
Match the reviewer to the provider family of the agent that requests the review. Other provider families use Codex.

## Claude

```sh
claude -p "/code-review medium [target]" --model claude-opus-5-5 --effort medium --safe-mode --setting-sources user --permission-mode dontAsk --strict-mcp-config --allowedTools "Read Grep Glob Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git status *) Bash(git rev-parse *) Bash(git merge-base *) Bash(git ls-files *)" --disallowedTools "Bash(*--output*) Bash(*--ext-diff*)" < /dev/null
```

### Threat note

If the change touches code that runs outside a sandbox or with more rights than its caller (helpers, installers, CLIs, hooks), add a threat note after the target. The reviewer reads text after the level as extra instructions. Example:

```sh
claude -p "/code-review medium Threat model: helpers excluded from the sandbox run unsandboxed, so environment variables, argv, PATH, and cwd from the calling agent are attacker-controlled." ...
```

For Codex, put the same note in the `[PROMPT]` argument of `codex exec review`.

## Codex

```sh
codex exec review (--uncommitted | --base <branch> | --commit <sha>) -m gpt-6.1-sol --ephemeral -c model_reasoning_effort="medium" -o <file outside the repository>
```

## Tool limits

The Claude reviewer gets only read tools and the listed Git commands. It does not load project settings, hooks, or MCP servers.
These are tool limits, not an OS sandbox. Git configuration in the repository can still start programs.

In a sandboxed session, a nested reviewer can fail to start. In Codex, request native escalation.
In Claude, if the sandbox blocks the reviewer, retry the reviewer command once with `dangerouslyDisableSandbox` and give the reason. In auto mode, the classifier reviews that retry. This is not tested yet.
Do not exclude `claude -p` or `codex` from the sandbox.

A review takes about 1-4 minutes. Run it in the background or with a long timeout.

## Security

Before a push, scan the outgoing commits for secrets:

```sh
trufflehog git file://. --since-commit <upstream> --no-verification --no-update --fail
```

Use the upstream branch, for example `origin/main`, as `<upstream>`. If the branch has no upstream, use the merge base with the default branch. If `trufflehog` is not installed, report that and continue.

Always keep `--no-verification`. Without it, trufflehog sends each found credential to its provider API to test it. `--no-update` stops the update check. `--fail` exits with code 183 when it finds results. Report hits, but never repeat secret values.

The tools below run only on explicit user request:

- `/security-review` reviews the pending changes. It fits web and API repositories (SQL injection, XSS, authentication). Its rules treat environment variables and CLI flags as trusted and skip shell command injection. Thus it misses threats in helpers and CLIs, such as the ones in this Toolkit. Source: [claude-code-security-review](https://github.com/anthropics/claude-code-security-review).
- `/code-review ultra` is a multi-agent review in the cloud. The user starts it. A few runs are free, then each run costs about $5-25. Use it for large, high-risk changes. Source: [ultrareview](https://code.claude.com/docs/en/ultrareview.md).
- `/security-audit` (the vendored Cloudflare skill) is for periodic audits of a whole repository. Run a secret scan first. Per Cloudflare, one run finds only about half of the issues that repeated runs find. Its full audit writes to `~/security-audit-skill/<repo>/run-<N>`, outside the repository. It runs target code only in an OS sandbox without network. Otherwise it marks leads `needs_validation`. A sandboxed Claude session cannot write that output directory unless the sandbox allows it. Source: [Build your own vulnerability harness](https://blog.cloudflare.com/build-your-own-vulnerability-harness).
