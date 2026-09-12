# Pi defaults

## Browser control

When Pi runs in Orca, use the Orca CLI and its embedded browser for browser interaction. Load the version-matched `orca-cli` guide first. Do not use Computer Use for browser interaction unless the user explicitly requests a browser outside Orca or the Orca browser is unavailable. Use web search and fetch tools for non-interactive research.
Pass static browser values as direct quoted arguments. Never hide them behind shell variables, command substitution, or `printf` escapes; the permission parser correctly treats those wrappers as opaque. For example, use `orca fill ... --value '/runtime'` directly.

## Task graphs

`/graph` runs independent ready tasks through `pi-yolo` workers. It creates one integration worktree per writing repository, then assigns writing tasks to a bounded set of exclusive lanes. It reuses a lane only after its previous commit is integrated and the lane is clean. Read-only workers use an existing checkout.
Planning permits documentation only and ends without implementation. Execution requires a separate `/graph execute` approval with explicit foundation commits and a worktree budget. That approval covers worker launches, declared setup in worker and integration worktrees, worker and combined integration validation, in-scope repair retries, task progression, bounded test resources, internal integration, and verified clean-lane removal at closeout.
Use the graph's scoped tools for task starts, checkpoints, integration, and closeout. Never let two writing workers use one worktree at the same time. Complete and integrate dependencies before starting dependent tasks. Keep source checkouts, indexes, dirty lanes, and interrupted work unchanged. Remove only clean integrated lanes.
Repeat the exact graph command to resume its version-4 record without duplicate workers or worktrees. Older approvals remain unchanged evidence and receive no expanded authority. Never recapture later source edits or recreate a missing resource without its recorded identity.
Legacy graph records are evidence, not an execution path. Do not migrate, retire, delete, complete, or restart them. Completed and unrelated historical records do not block admission; an unfinished record blocks only repositories it identifies as owned. State retirement needs separate scope, verification, and authorization.

## Agent delegation

Use `pi-yolo` for all spawned task workers and full handoffs, including ordinary tasks outside `/graph`. Use the current Pi provider/model with an explicit `--model provider/model` and `--thinking medium`; use high only when the user explicitly requests it, never automatically on retries.

In Orca, launch workers through `terminal create --command 'pi-yolo --model provider/model --thinking medium'` in the target worktree, then deliver the task using the version-matched handoff or orchestration guide. Preserve any account-pinning requirements from the active workflow. Do not copy Codex launcher examples from generic guides, launch plain `pi`, or use generic `--agent`/`worker-start` launchers that do not guarantee `pi-yolo`. If the wrapper cannot launch, report the blocker rather than falling back to another agent.

Review exception: `autoreview` uses its Codex CLI engine with `gpt-5.6-sol` at high thinking and retries `gpt-5.6-terra` only for an account-access failure. This exception is for review, not implementation workers, and does not change the risk-gated review rules below.

## Permission denials

A hard permission denial is not an approval prompt. Chat approval does not update the runtime policy. Do not retry an unchanged denied command, ask for ineffective chat approval, or claim that restarting the same launcher will fix it. For ordinary scratch work, use the authorized scratch directory. If the task requires the denied location itself, report the exact missing permission; do not change policy from inside the session or work around the restriction with another tool.

## Development-root execution

These instructions describe the explicitly installed `development-roots-v1` bundle. Source edits and `/reload` do not activate it. Earlier sessions retain their existing permissions. Never infer active authority from these instructions alone.

After human acceptance, ordinary local builds, tests, lint, scripts, interpreters, and dependencies can run within physical `~/Code` and `~/orca/workspaces` roots. This includes future non-Git directories and sibling worktrees. Do not create repository-trust approvals or per-script exceptions. Symlink aliases do not grant authority outside the roots.
Graph approval adds active-task ownership without replacing native shell policy. Use absolute workspace paths and select the exact repository for shell calls. Keep native asks and denials authoritative.
Dependencies and hooks run as the local account. These workflow guards are not an OS sandbox. Root acceptance does not authorize secrets, production access, publication, deployment, destructive operations, global installation, or administration of existing databases.
Use the declared local-resource tools for new task-owned resources. Resume by recorded identity. Only an authoritative loss permits a linked replacement. Uncertain state requires inspection, not recreation. Do not delete retained resources. Older PostgreSQL and Git helper notes below describe separately bounded legacy capabilities, not an expansion of root authority.
Before service or database tests, inspect target selection, credentials, resource ownership, and cleanup. Stop if those boundaries are unclear. Git-history or database-administration fixtures need a separately bounded capability over newly created, identity-checked disposable resources. Do not weaken database guards to pass a test.

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

## Disposable Git-history tests

After full reviewed installation, use `git-test create` to obtain a fresh fixture ID and repository path. Only `git-test run <id> <operation> <arguments>` can provide its bounded checkout, lightweight tag, commit-tree, and update-ref operations. Existing repositories, publishing, signing, and cleanup are not supported. Ordinary Git remains guarded.
The helper checks exact directory identities, unchanged configuration, and unshared Git metadata before each operation. Do not forge fixture records, adapt it to an existing checkout, or use system Git after an ordinary guard denial. Keep all fixture files for diagnostics.

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
