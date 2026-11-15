# Agent Toolkit

Read repository instructions before work. Preserve unrelated edits and user choices for accounts, providers, models, reasoning, and permissions.
Load `caveman` for concise replies addressed directly to the human user. Honor requests for normal mode or detailed explanations.
Use complete sentences, not Caveman, for tool arguments, delegation briefs, agent messages, worker reports, and handoffs.
Keep technical facts, uncertainty, commands, paths, numbers, and required progress updates. Apply Simple English to persisted documentation.
For coding tasks, load `ponytail` and use full mode unless the user selects another mode. For test work, load `test-audit`.
Load the full Python, FastAPI, Fastify, Vue, or React skill when the task uses that language or framework.
Use skill descriptions to select other installed skills. Load their full instructions on demand, regardless of the assigned role.
Before creating, editing, reviewing, or auditing Markdown documentation, read the full `simple-english` skill.
This includes README.md, AGENTS.md, CLAUDE.md, SKILL.md, and Markdown prompt files. Use pragmatic mode unless the user requests strict mode.
Apply it to prose. Preserve code blocks, inline code, commands, identifiers, paths, and quoted output.
Security Audit and React Doctor are explicit-request only. Full skills load on demand. Instructions do not grant permissions.
Ponytail Review, Audit, and Debt run only on explicit requests. They do not change the active mode.
Use blockquotes only for quotations or an explicit user request.

If the user asks to turn off the displays on macOS, run `agent-display-off`.
It waits three seconds and does not change the `agent-awake` hold or system sleep settings.

Before service or database tests, inspect the target, credentials, ownership, and cleanup. Stop if these boundaries are unclear.
Register cleanup immediately after each temporary test directory is created, before fixture setup.
Remove each temporary directory when its owning test or helper finishes, including failed setup and assertions.
Create temporary directories only with `mktemp -d` and a template in `$TMPDIR`. macOS ignores `TMPDIR` without a template.
Never create or reuse a fixed name in a shared temporary directory.
Delete only your own exact path, written as `"${d:?}"`: `d=$(mktemp -d "${TMPDIR:?}/tmp.XXXXXX") || exit 1; ...; rm -rf -- "${d:?}"`.
Never run `rm -rf` on an existing shared name or a computed path, such as `$(dirname "$L")`.
Keep requested evidence in an explicit output directory, separate from disposable fixtures.
Keep repository evidence as text: exact commands, observed outcomes, commit references, and unresolved risks.
Do not commit screenshots, images, videos, or binary evidence, including embedded or base64-encoded media.
Use temporary captures for visual checks. Record the inspected behavior and result in text.
If retained media is necessary, link an artifact in an existing approved external store.
Do not create storage only for evidence. Product assets and required test fixtures remain allowed.
For disposable PostgreSQL 18 tests, use `pg-test` with the least-privileged role profile.
Use only its returned fixture URL, keep credentials out of committed files, and run `pg-test stop <id>` when finished.
Never run `pg-test gc`. Stop only your own fixtures with `pg-test stop <id>`.

CI runners bill by the minute on every provider. Treat each CI run as a cost.
If the repository skips CI for draft pull requests, keep a pull request as a draft while you iterate. Mark it ready once, when the work is complete.
Run focused local checks before each push, and batch fixes into one push. Add full-CI labels only when the change needs that coverage.
Rerun a failed job only after you find the cause. Fix flaky tests instead of rerunning them.
Group related small changes into one pull request. Each pull request and each push to it pays for a full CI run.
Repository CI rules take precedence. Never weaken required gates to save cost.
A repository with working CI keeps its pull request flow: draft, one CI run, green checks, then merge with `--match-head-commit`.
If hosted CI cannot run, for example when billing blocks GitHub Actions, do not use `gh pr merge` without checks.
Instead, the orchestrator runs the repository's full local gate on the exact head commit. Then it pushes that commit to the integration branch as a fast-forward.
Do not force push, and do not rebase over the work of others. If the branch moved, cherry-pick or merge locally, run the full gate again, and then push.
Record the gate commands, the result, and the head SHA in the plan evidence or the commit message.
Production deploys, destructive actions, and other publication still need explicit authorization.

Workers run focused tests and the repository's fast gate while they iterate.
Only the orchestrator runs the repository's full aggregate gate, once for each merged batch.
Never run the fast gate and then the full gate. The full gate already includes the fast gate.
Run long verification commands in the background. Time that waits for an `agent-heavy` slot counts against tool timeouts.
Wrap ad hoc heavy commands with `agent-heavy --`, for example a full typecheck, a full test suite, or a production build.

## Permission boundaries

Distinguish execution denials, native approval requests, approval-review rejections, and explicit task prohibitions.
In Codex, if the sandbox protects an authorized operation, request native escalation before execution. Protected Git metadata writes are an example.
A filesystem or sandbox denial is not itself an approval request.
If the active policy and task permit it, request native approval after an execution denial.
Do not repeat the command under unchanged sandbox conditions or bypass a denial through another tool, path, worker, or mode.
After an approval-review rejection, stop the rejected action and report the stated reason.
Obey explicit task prohibitions until the user lifts them. General publication approval does not lift a specific retry prohibition.
Report each denial with its command, target, originating agent, permission mode, and denial type.
Never change live permission settings or grant access that managed policy forbids.
If the Claude sandbox blocks a command, retry it once with `dangerouslyDisableSandbox` and give the reason. Never ask the user to turn off the sandbox.
The escape is allowed for the repository's own test, build, browser-test, database, and Docker commands, also when they run code you changed.
Run Playwright and other Chromium browser tests with the escape from the start: Chromium cannot start inside the macOS sandbox.
If a repository's own test or script starts `pg-test`, `initdb`, or Docker itself, run the whole command with the escape and give that reason.
Do not write a new script only to run it outside the sandbox. For helpers and background processes, see `%TOOLKIT%/docs/claude-sandbox.md`.

## Reviews

Do not run AI reviews merely because edits or tests are complete.
At a user-requested commit, push, PR, merge, or ship boundary, inspect the bundle and run focused deterministic checks.
Run a native code review only for authentication, security, secrets, money, persisted data, schemas, migrations, concurrency,
public APIs, installation, upgrades, release machinery, or 200 changed non-test, non-doc lines.
A plan step that names AutoReview or Codex AutoReview means the native review under this policy.
Explicit review requests run. `reviews:off` disables automatic reviews until `reviews:auto`; explicit reviews remain available.
Review an unchanged bundle once across boundaries. After a review changes code, rerun affected checks and that review.
Never install AI reviews as Git hooks.
Run the native review as a separate headless process from the repository or worktree root, at medium effort.
Match the reviewer to the provider family of the requesting agent. Other provider families use Codex.
Use the commands and tool limits in `%TOOLKIT%/docs/code-review.md`. Run the review in the background.
Findings are advice. Verify each finding against the code.
Fix confirmed correctness, security, and data-loss issues inside the task scope. Report other confirmed issues as follow-ups.
Skip style, duplication, and performance findings unless they are in scope.
If the native reviewer is unavailable or fails, report it. Do not switch provider without explicit user authorization.
Do not retry after permission denials, approval-review rejections, or explicit task prohibitions.
Before a push, run the secret scan in `%TOOLKIT%/docs/code-review.md` on the outgoing commits. Report hits without secret values.
Full-repository security audits, `/security-review`, and `/code-review ultra` run only on explicit user request. See `%TOOLKIT%/docs/code-review.md`.

## Host operations

Use the session's host context, not installed binaries or skill availability, to identify its owner.
Paseo sessions load `%TOOLKIT%/shared/hosts/paseo.md` before host operations.
If the owner is unclear, ask before delegation, browser control, handoff, or cleanup. Ordinary coding can continue.
A provider session keeps its original owner on resume. Cross-host ownership transfers require an explicit handoff.
Never install, repair, or broaden live permissions from an agent session. Installation and migration use a trusted human terminal.
