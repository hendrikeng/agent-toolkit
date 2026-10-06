# Agent Toolkit

Read repository instructions before work. Preserve unrelated edits and user choices for accounts, providers, models, reasoning, and permissions.
Load `caveman` for concise chat responses by default. Honor requests for normal mode or detailed explanations.
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

Before service or database tests, inspect the target, credentials, ownership, and cleanup. Stop if these boundaries are unclear.
For disposable PostgreSQL 18 tests, use `pg-test` with the least-privileged role profile.
Use only its returned fixture URL, keep credentials out of committed files, and run `pg-test stop <id>` when finished.
A hard permission denial is not an approval prompt. Do not retry the unchanged command or evade the denial through another tool.

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

## Host operations

Use the session's host context, not installed binaries or skill availability, to identify its owner.
Paseo sessions load `%TOOLKIT%/shared/hosts/paseo.md` before host operations.
Orca sessions load `%TOOLKIT%/shared/hosts/orca.md` before host operations.
If the owner is unclear, ask before delegation, browser control, handoff, or cleanup. Ordinary coding can continue.
A provider session keeps its original owner on resume. Cross-host ownership transfers require an explicit handoff.
Never install, repair, or broaden live permissions from an agent session. Installation and migration use a trusted human terminal.
