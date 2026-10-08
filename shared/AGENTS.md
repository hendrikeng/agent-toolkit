# Agent Toolkit

Read repository instructions before work. Preserve unrelated edits and user choices for accounts, providers, models, reasoning, and permissions.
Load `caveman` for concise replies addressed directly to the human user. Honor requests for normal mode or detailed explanations.
Use normal English for tool arguments, delegation briefs, agent messages, worker reports, and handoffs.
Keep complete sentences, normal spacing, exact identifiers, scope, evidence, and uncertainty in agent communication.
Keep technical facts, uncertainty, commands, paths, numbers, and required progress updates. Apply Simple English to persisted documentation.
For coding tasks, load `ponytail` and use full mode unless the user selects another mode. For test work, load `test-audit`.
Load the full Python, FastAPI, Fastify, or Vue skill when the task uses that language or framework.
Use skill descriptions to select other installed skills. Load their full instructions on demand, regardless of the assigned role.
Before creating, editing, reviewing, or auditing Markdown documentation, read the full `simple-english` skill.
This includes README.md, AGENTS.md, CLAUDE.md, SKILL.md, and Markdown prompt files. Use pragmatic mode unless the user requests strict mode.
Apply it to prose. Preserve code blocks, inline code, commands, identifiers, paths, and quoted output.
DeepSec and React Doctor are explicit-request only. Full skills load on demand. Instructions do not grant permissions.
Ponytail Audit, Debt, and Help run on explicit requests. They do not trigger automatic reviews or change the active mode.
Use blockquotes only for quotations or an explicit user request.

If the user asks to turn off the displays on macOS, run `agent-display-off`.
It waits three seconds and does not change the `agent-awake` hold or system sleep settings.

Before service or database tests, inspect the target, credentials, ownership, and cleanup. Stop if these boundaries are unclear.
Register cleanup immediately after each temporary test directory is created, before fixture setup.
Remove each temporary directory when its owning test or helper finishes, including failed setup and assertions.
Use the session's temporary directory by default. Do not use `~/Code/.agent-toolkit-scratch` as a new persistent default.
Keep requested evidence in an explicit output directory, separate from disposable fixtures.
Keep repository evidence as text: exact commands, observed outcomes, commit references, and unresolved risks.
Do not commit screenshots, images, videos, or binary evidence, including embedded or base64-encoded media.
Use temporary captures for visual checks. Record the inspected behavior and result in text.
If retained media is necessary, link an artifact in an existing approved external store.
Do not create storage only for evidence. Product assets and required test fixtures remain allowed.
For disposable PostgreSQL 18 tests, use `pg-test` with the least-privileged role profile.
Use only its returned fixture URL, keep credentials out of committed files, and run `pg-test stop <id>` when finished.

## Permission boundaries

Distinguish execution denials, native approval requests, approval-review rejections, and explicit task prohibitions.
If the active sandbox protects an authorized operation, request supported native escalation before execution.
For example, protected Git metadata writes need this approval in Codex workspace-write mode.
A filesystem or sandbox denial is not itself an approval request.
If the active policy and task permit it, request native approval after an execution denial.
Do not repeat the command under unchanged sandbox conditions or bypass a denial through another tool, path, worker, or mode.
After an approval-review rejection, stop the rejected action and report the stated reason.
Obey explicit task prohibitions until the user lifts them. General publication approval does not lift a specific retry prohibition.
Record the command, target, agent, effective permission mode, and denial type. Attribute each denial to its originating agent.
Never change live permission settings or grant access that managed policy forbids.

## Reviews

Do not run AI reviews merely because edits or tests are complete.
At a user-requested commit, push, PR, merge, or ship boundary, inspect the bundle and run focused deterministic checks.
Run `ponytail-review` only for a new dependency, abstraction, layer, configurable surface, or 150 changed non-test, non-doc lines.
Run `autoreview` only for authentication, security, secrets, money, persisted data, schemas, migrations, concurrency, public APIs,
installation, upgrades, release machinery, or 200 changed non-test, non-doc lines.
Explicit review requests run. `reviews:off` disables automatic reviews until `reviews:auto`; explicit reviews remain available.
Review an unchanged bundle once across boundaries. Verify advisory findings and keep fixes in scope.
After a review changes code, rerun affected checks and that review. Never install AI reviews as Git hooks.
Use `scripts/autoreview` beside its skill. The helper owns reviewer isolation. Never bypass an isolation or permission denial.
Use Codex for AutoReview by default, including tasks implemented by Claude or another provider.
The task provider does not select the reviewer. Pass `--engine codex` unless the user explicitly selects another reviewer.
If Codex is unavailable or cannot complete the review, use the helper's Claude engine as the fallback.
This reviewer selection is authorized across provider families. Preserve the intended native account context for each engine.
Do not use fallback after permission denials, approval-review rejections, isolation failures, or explicit task prohibitions.
A completed review with findings is not a reviewer failure.

## Host operations

Use the session's host context, not installed binaries or skill availability, to identify its owner.
Paseo sessions load `%TOOLKIT%/shared/hosts/paseo.md` before host operations.
Orca sessions load `%TOOLKIT%/shared/hosts/orca.md` before host operations.
If the owner is unclear, ask before delegation, browser control, handoff, or cleanup. Ordinary coding can continue.
A provider session keeps its original owner on resume. Cross-host ownership transfers require an explicit handoff.
Never install, repair, or broaden live permissions from an agent session. Installation and migration use a trusted human terminal.
