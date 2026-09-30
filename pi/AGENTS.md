# Agent Toolkit defaults

## Orca CLI

Resolve the Orca executable without a shell wrapper. On macOS, use `orca` directly. If the platform or executable is unclear, run each required probe as a separate Bash call: `uname -s`, `printenv ORCA_CLI_COMMAND`, or `printenv ORCA_DEV_REPO_ROOT`. Never use `if`, `case`, loops, shell variables, command substitution, or `printf` to select the executable. Write the selected executable directly in every Orca command.

## Browser control

When an agent runs in Orca, use the Orca CLI and its embedded browser for browser interaction. Load the version-matched `orca-cli` guide first. Do not use Computer Use for browser interaction unless the user explicitly requests a browser outside Orca or the Orca browser is unavailable. Use web search and fetch tools for non-interactive research.
Use the GitHub CLI inspection commands and the bounded pull-request tools for GitHub pull requests and Actions. Do not open a browser for these tasks unless the user explicitly asks for it.
Pass static browser values as direct quoted arguments. Never hide them behind shell variables, command substitution, or `printf` escapes; the permission parser correctly treats those wrappers as opaque. For example, use `orca fill ... --value '/runtime'` directly.

## Agent delegation

Use managed yolo launchers for spawned task workers and full handoffs. Pi workers use `pi-yolo` and default to `openai-codex/gpt-6.1-sol` with high thinking. When the user explicitly requests Claude, use `claude-yolo`; it defaults to Claude Opus with medium effort. An explicit user-selected worker model or reasoning level overrides these defaults. The coordinator's model and reasoning level do not propagate to workers unless the user requests that behavior.

Never invoke `pi-yolo` or `claude-yolo` directly through Bash from a running agent session. The runtime policy may deny recursive agent launches. In Orca, execute `orca` and pass the selected wrapper as the command for `terminal create` in the target worktree. Use `pi-yolo --model provider/model --thinking level` for Pi or `claude-yolo --model model --effort level` for Claude. Then deliver the task with the version-matched handoff or orchestration guide. For supervised work, use the guide's custom-argv topology so Orca owns the external terminal and lifecycle. Preserve any account-pinning requirements from the active workflow. Do not copy launcher examples from generic guides, launch plain `pi` or `claude`, or use generic `--agent` launchers that bypass the managed wrappers. If Orca or the selected wrapper cannot launch, report the blocker rather than falling back to another agent.

Review exception: `autoreview` uses its Codex CLI engine with `gpt-6.1-sol` at high thinking and retries `gpt-5.6-sol` only for an account-access failure. This exception is for review, not implementation workers, and does not change the risk-gated review rules below.

## Permission denials

A hard permission denial is not an approval prompt. Chat approval does not update the runtime policy. Do not retry an unchanged denied command, ask for ineffective chat approval, or claim that restarting the same launcher will fix it. For ordinary scratch work, use the authorized scratch directory. If the task requires the denied location itself, report the exact missing permission; do not change policy from inside the session or work around the restriction with another tool.

## Prompt-free shell commands

Permission prompts block unattended orchestration. Never put programs in opaque inline interpreter arguments such as `python -c`, `python3 -c`, `node -e`, `node -p`, `bash -c`, `sh -c`, or `eval`. Do not use command-running indirection such as `xargs`, `find -exec`, or `env` when a direct command works. Use the native read, search, and edit tools first. For multi-line local analysis, write a short script under the authorized scratch directory with the native write tool, then run the interpreter on that script path.

## Development access

The managed launchers combine host-native sandboxing with the toolkit Git guard and policy. Source edits and reload commands do not update that installation. Run `./install.sh` from a trusted human terminal, then start a fresh session.

Ordinary development is allowed under `~/Code` and `~/orca/workspaces`. Start each Orca worker in the worktree it owns instead of routing shell commands across repositories. Native permission denials remain authoritative.
Dependencies and hooks run as the local account. The permission extension is a decision layer, not an operating-system sandbox. It does not authorize secrets, production access, publication, deployment, destructive operations, global installation, or administration of existing databases.
Before service or database tests, inspect the target, credentials, ownership, and cleanup. Stop if those boundaries are unclear. Do not weaken guards to pass a test.
For reviewed, unchanged tracked files in an owned worktree, use `repo-delete -- path/to/file` after a full installation and fresh session. It rejects directories, symlinks, hidden paths, untracked or modified files, and paths outside the worktree. It requires raw worktree bytes to match the committed blob, so clean CRLF or filtered files may need human deletion. Do not use it on files with concurrent writers: a write through an already-open descriptor can race with deletion. Do not use it as a workaround for a denial in the current session.

## Disposable PostgreSQL tests

After a full toolkit installation and a fresh managed agent session, use the `pg-test` helper for disposable PostgreSQL 17 or 18 tests:

```sh
pg-test start
pg-test start-migration
pg-test start-admin
pg-test start-admin --postgres-version 18
pg-test status <id>
pg-test stop <id>
pg-test gc
```

All three start commands accept only `--postgres-version 17` or `--postgres-version 18`. The default remains PostgreSQL 17. Select 18 explicitly when the repository requires it. The selected Homebrew version must already be installed; the helper never installs it or falls back to another version. Status and stop select the version from the `pg17-…` or `pg18-…` resource ID and need no version flag. Existing PG17 resource records remain supported.
Use the returned test connection URL, not an existing database. Keep the URL out of committed files.
The default helper uses private scratch and an unprivileged `toolkit_test` database owner. `start-migration` creates a separate new cluster whose owner has exactly `LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS`. `start-admin` creates a separate new cluster whose owner has `LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION BYPASSRLS`. Use `start-admin` for repositories whose test reset guard requires `BYPASSRLS`; `start-migration` will be rejected there. The helper does not create a separate maintenance role. It cannot upgrade or target an existing database.
The helper retains files until garbage collection removes an eligible fixture. It accepts no arbitrary SQL, paths, or server options.
Fixtures live in `~/Code/.agent-toolkit-scratch/agent-toolkit-fixtures`. PostgreSQL socket directories remain under the temporary directory to keep their paths short.
Managed sessions record the session process as the fixture owner. Fixtures started outside a managed session have no owner.
Garbage collection runs before each start and after a managed session ends. It stops a cluster when its recorded owner process is gone. It stops a running ownerless cluster only after two hours. It removes a stopped fixture only when its record is more than three days old. It preserves and reports records with changed, ambiguous, or invalid identities. Run `pg-test gc` to collect garbage at any time.
The `status` and `stop` commands also find clusters in the older temporary-directory roots. If an ID exists in more than one root, these commands refuse it.
When you finish with a cluster, run `pg-test stop <id>`. This command is important for clusters started outside a managed session. The `pg-test gc`, `pg-test stop <id>`, and `pg-test status <id>` commands run outside the sandbox in managed Claude sessions. Managed launchers also stop session-owned clusters when the session exits.
For a repository that exposes the exact `test:pg18-fresh` and `test:pg18-fresh:built` scripts, use `pg18-fresh-yolo` without arguments when the host test itself must launch PostgreSQL. It installs from only the manifest and lockfile with pnpm hooks and lifecycle scripts disabled, then runs the update and verification in an isolated Docker workspace with no test-time network. The source is mounted read-only for copying, and only the generated security inventory is copied back.
Do not replace these helpers with raw PostgreSQL commands, Homebrew writes, or deletion commands. Do not install or repair live permissions from a restricted session.
A missing helper requires the reviewed toolkit installation from a trusted human shell, then a new session. `/reload` does not install it.

## Review artifacts

When `AGENT_TOOLKIT_REVIEW_ROOT` is set, put review and Security handoff results in a unique subdirectory of that root, not an arbitrary temporary directory. Before starting a reviewer, use the native read tool on its `.read-probe.txt`. If the variable is set and the read is denied, stop before spending review quota and request a restart through the updated launcher. Do not substitute shell reads or widen permissions. Reload commands do not regenerate runtime policy.

In a managed Claude session, run `autoreview-yolo` without arguments. It validates the installed helper and provides unique report and status paths outside the reviewed repository. On other hosts, prefer the `autoreview` helper defaults. Verify the final status and report; a process ID is not completion evidence. Existing temporary reports still require explicit access approval.

## Response formatting

Do not wrap ordinary replies, drafts, or generated text in Markdown blockquotes. Use blockquotes only when the user explicitly requests them or when quoting source text.

## Documentation prose

Before you create or edit documentation prose in Markdown files other than `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, and prompt files, read the installed Simple English skill completely with the native read tool and follow it in pragmatic mode. Its file is `~/.claude/skills/simple-english/SKILL.md` in Claude, `~/.codex/skills/simple-english/SKILL.md` in Codex, and `~/.pi/agent/extensions/simple-english/SKILL.md` in Pi. The skill is manual-only, so do not wait for it to load automatically. Apply it whether people or agents use the documentation. Do not apply it to code blocks, inline code, commands, identifiers, paths, quoted output, or source code.

## Test quality

Load and follow the `test-audit` skill whenever you write, change, review, or audit tests. This guidance does not trigger an independent AI review.

## Risk-gated review closeout

Do not run `autoreview` or `ponytail-review` merely because code was edited or a task is ending.

When the user asks the agent to commit, push, open or update a PR, merge, or ship, evaluate the current change bundle once:

1. Inspect the relevant staged, unstaged, or branch diff and run the smallest focused deterministic checks.
2. Run `ponytail-review` only when the diff adds a dependency, abstraction or layer, configurable surface, or at least 150 changed non-test, non-doc lines.
3. Run `autoreview` only when the diff affects authentication, security or secret handling, money or persisted data, schemas or migrations, concurrency, a public API or protocol, installation or upgrades, release machinery, or at least 200 changed non-test, non-doc lines.
4. Skip both reviews when no trigger applies. Do not rerun a review for an unchanged change bundle at later commit, push, or PR steps.
5. Treat findings as advisory, verify them in the real code, and keep fixes inside the original task scope. If a review changes code, rerun the affected checks and that review.

A session-level `reviews:off` instruction is an explicit user override: skip automatic AI reviews at every boundary until that session returns to `reviews:auto`. Do not replace skipped reviews with broader tests.

Load and follow the named skill when a review is triggered. If it is unavailable, report that briefly instead of substituting another reviewer. Git hooks should remain limited to fast deterministic checks; never install an AI review as a commit or push hook.
