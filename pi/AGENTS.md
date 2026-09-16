# Pi defaults

## Browser control

When Pi runs in Orca, use the Orca CLI and its embedded browser for browser interaction. Load the version-matched `orca-cli` guide first. Do not use Computer Use for browser interaction unless the user explicitly requests a browser outside Orca or the Orca browser is unavailable. Use web search and fetch tools for non-interactive research.
Use the GitHub CLI inspection commands and the bounded pull-request tools for GitHub pull requests and Actions. Do not open a browser for these tasks unless the user explicitly asks for it.
Pass static browser values as direct quoted arguments. Never hide them behind shell variables, command substitution, or `printf` escapes; the permission parser correctly treats those wrappers as opaque. For example, use `orca fill ... --value '/runtime'` directly.

## Agent delegation

Use `pi-yolo` for all spawned task workers and full handoffs. Use the current Pi provider/model with an explicit `--model provider/model` and `--thinking medium`; use high only when the user explicitly requests it, never automatically on retries.

In Orca, launch workers through `terminal create --command 'pi-yolo --model provider/model --thinking medium'` in the target worktree, then deliver the task using the version-matched handoff or orchestration guide. Preserve any account-pinning requirements from the active workflow. Do not copy Codex launcher examples from generic guides, launch plain `pi`, or use generic `--agent`/`worker-start` launchers that do not guarantee `pi-yolo`. If the wrapper cannot launch, report the blocker rather than falling back to another agent.

Review exception: `autoreview` uses its Codex CLI engine with `gpt-5.6-sol` at high thinking and retries `gpt-5.6-terra` only for an account-access failure. This exception is for review, not implementation workers, and does not change the risk-gated review rules below.

## Permission denials

A hard permission denial is not an approval prompt. Chat approval does not update the runtime policy. Do not retry an unchanged denied command, ask for ineffective chat approval, or claim that restarting the same launcher will fix it. For ordinary scratch work, use the authorized scratch directory. If the task requires the denied location itself, report the exact missing permission; do not change policy from inside the session or work around the restriction with another tool.

## Development access

Pi uses the pinned stock permission extension and one managed global policy. Source edits and `/reload` do not update that installation. Run `./install.sh` from a trusted human terminal, then start a fresh session.

Ordinary development is allowed under `~/Code` and `~/orca/workspaces`. Start each Orca worker in the worktree it owns instead of routing shell commands across repositories. Native permission denials remain authoritative.
Dependencies and hooks run as the local account. The permission extension is a decision layer, not an operating-system sandbox. It does not authorize secrets, production access, publication, deployment, destructive operations, global installation, or administration of existing databases.
Before service or database tests, inspect the target, credentials, ownership, and cleanup. Stop if those boundaries are unclear. Do not weaken guards to pass a test.

## Disposable PostgreSQL tests

After a full toolkit installation and a fresh `pi-yolo` session, use the managed `pg-test` helper for disposable PostgreSQL 17 tests:

```sh
pg-test start
pg-test start-admin
pg-test status <id>
pg-test stop <id>
```

Use the returned test connection URL, not an existing database. Keep the URL out of committed files.
The default helper uses private scratch and an unprivileged database role. `start-admin` creates a separate new cluster with a non-superuser role that can create test databases and roles. It cannot upgrade or target an existing database. Neither profile grants superuser, replication, RLS bypass, or server-file/program privileges.
The helper retains files after stop or failure and accepts no arbitrary SQL, paths, or server options.
Do not replace it with raw PostgreSQL commands, Homebrew writes, or deletion commands. Do not install or repair live permissions from a restricted session.
A missing helper requires the reviewed toolkit installation from a trusted human shell, then a new session. `/reload` does not install it.

## Review artifacts

In `pi-yolo`, put review and Security handoff results in a unique subdirectory of `AGENT_TOOLKIT_REVIEW_ROOT`, not an arbitrary temporary directory. Before starting a reviewer, use the native `read` tool on that root's `.read-probe.txt`. If the variable is missing or the read is denied, stop before spending review quota and request a restart through the updated launcher. Do not substitute shell reads or widen permissions. `/reload` does not regenerate the runtime policy.

The `autoreview` helper provides unique default report and status paths under this root. Prefer those defaults. Keep additional wrapper logs under the same root using normally authorized operations. Verify the final status and report; a process ID is not completion evidence. Existing temporary reports still require explicit access approval.

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
