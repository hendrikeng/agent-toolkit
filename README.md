# Agent Toolkit

One shared skill collection for Codex and Claude Code, in native Paseo or a terminal. Start with normal provider commands.

The architecture is three parts: task skills in `skills/`, a small shared instruction block in `shared/AGENTS.md`, and host guidance in `shared/hosts/`. Toolkit supplies no custom permission engine, provider sandbox, Git wrapper, runtime mirror, or executable coding-guidance hook.

Replies addressed directly to the human user use the adapted, pinned [Caveman skill](skills/caveman/SKILL.md) across Codex and Claude Code.
It removes filler and keeps technical meaning. Use `normal mode` or request more detail when needed.
Tool arguments, delegation briefs, agent messages, worker reports, and handoffs use normal English with complete sentences and normal spacing.
This exclusion also applies to worker reports addressed to a coordinator and agent messages visible in the user timeline.
Documentation uses Simple English. Toolkit installs only Caveman skill text, without its proxy, runtime, or hooks.
Shorter replies can reduce output tokens. This does not guarantee a reduction in reasoning tokens or total subscription usage.

## Install and start

Use Node.js 24, npm, Git, Python 3.11+, and your chosen provider CLIs. Toolkit does not install or upgrade provider CLIs.
It preserves selected models and accounts. Install the official Paseo skills through Paseo for host operations.

From a trusted human terminal:

```sh
git clone https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
npm ci --prefix shared --ignore-scripts --no-audit --no-fund
./verify.sh
./install.sh
```

Normal installation configures reviewer networking and standing authorization for reviews and scoped advisers.
To retain your current provider permissions, use:

```sh
./install.sh --preserve-permissions
```

Run installation from a trusted human terminal. Normal installation updates the selected `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, using their normal defaults when absent.
Codex retains workspace file restrictions and enables command network access with automatic approval review.
Claude enables sandbox auto-allow and adds `api.openai.com`, `chatgpt.com`, `auth.openai.com`, and `api.anthropic.com` to its allowed domains.
Claude also enables `sandbox.network.allowLocalBinding` for local PostgreSQL/API/restart tests on macOS.
This permits local port binding and connections to localhost services. Tests must still use inspected, disposable fixtures and returned credentials.
Existing Claude domain denies stop setup for reconciliation. Models, accounts, file boundaries, and unrelated settings remain intact.
Claude `WebFetch(domain:...)` deny rules also stop conflicting setup.
Existing Codex named permission profiles or other filesystem modes require `--preserve-permissions` or reconciliation from a trusted human terminal.
The selected provider instructions record authorization for normal review and scoped adviser model requests. Adviser investigations still require task authorization.
Repeat installs retain this authorization. No persistent provider-config backups are created. Failed deployment restores original configs from memory.
Other installed Toolkit resources retain the installer's normal backups.
The former `--review-network` option remains accepted, with the same behavior as normal installation.

Add `~/.local/bin` to `PATH` for PostgreSQL helpers. Restart old sessions, then use:

```sh
codex
claude
```

For optional native Paseo profiles, run this command after installation from a trusted human terminal on the daemon machine:

```sh
./setup-paseo.sh
```

Use the intended local `PASEO_HOME`. A host selected in a phone or desktop client does not select this command's daemon.
See the [profile setup and instructions](docs/paseo-profiles.md).

The installer refuses noninteractive invocation. Do not run it to repair an agent session's security boundary. Source edits do not deploy changes. Normal installation configures reviewer networking from a trusted human terminal. The `--preserve-permissions` option leaves provider permissions unchanged. Start fresh sessions after setup. In Paseo, select Codex Auto-review mode to retain automatic approval review.

The installer prepares its locked TOML and JSONC parsers in the checkout with `npm ci --ignore-scripts`. It then copies resources to `~/.local/share/agent-toolkit/resources/`. Discovery symlinks point to those copies, never to the editable checkout. It appends a marked instruction block without replacing human instructions. React Doctor's locked dependencies are installed with `npm ci --ignore-scripts`.

Copies include skill-local scripts and PostgreSQL helpers. Installation does not make the checkout read-only.
Editing a source script cannot change an installed executable until a human installs it again.

### Provider discovery

| Provider | Task skill discovery | Small global guidance |
|---|---|---|
| Codex | `~/.agents/skills/<name>` | `$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md` |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/<name>`, default `~/.claude/skills` | `$CLAUDE_CONFIG_DIR/CLAUDE.md`, default `~/.claude/CLAUDE.md` |

Codex and Claude symlinks resolve to the same installed collection.
These are [Codex's supported skill paths](https://developers.openai.com/codex/skills/) and [Claude's personal skill mechanism](https://code.claude.com/docs/en/skills).
Full skill bodies load on demand.

Toolkit honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `PASEO_HOME` during installation. It also adds guidance to existing `~/.codex-accounts/*/` account homes. Install with the same directory overrides you use to start a provider. It stops if `AGENTS.override.md` would hide the Codex block.

Installing another provider home preserves the first home's discovery links, instruction files, and ownership records. Obsolete links retire only in the discovery folders being updated. Reinstall each home to refresh its startup guidance. All homes share the copied skill resources.

### Startup instructions and full skills

The [small shared block](shared/AGENTS.md) supplies startup guidance through the native instruction files in the table. Each provider controls message roles and precedence. The block does not replace the provider's system prompt or the user's existing instructions.

The block tells the agent to load Ponytail full for coding tasks and Test Audit for test work. Before Markdown documentation work, it requires a full Simple English read. This includes creating, editing, reviewing, or auditing README.md, AGENTS.md, CLAUDE.md, SKILL.md, and Markdown prompt files. The default is pragmatic mode. Code, commands, identifiers, paths, and quoted output stay exact. No explicit Simple English command is required.

The block also defines review gates, database-test precautions, and the session owner's host guidance. Skill discovery supplies skill names and descriptions. The agent reads the full `SKILL.md` when the task requires it or you request it explicitly. Discovery alone does not load every skill body.

For explicit loading:

| Provider | Ponytail | Test Audit |
|---|---|---|
| Codex | `$ponytail full` | `$test-audit` |
| Claude Code | `/ponytail full` | `/test-audit` |

Startup guidance replaces the old Ponytail coding hooks. Shared instructions are essential, but native instruction files already supply them. Paseo setup offers a separate, default-off compact System Prompt context that references installed guidance. Instructions guide the model. They do not enforce permissions or guarantee model behavior.
The extra Paseo prompt is not required for task-skill discovery or coding guidance.
Its purpose is to identify fresh Paseo ownership, default primary delivery sessions to Orchestrator, and reference shared role guidance.
Enable this compact context if you want orchestration as the primary default without repeating the role in each task prompt.
Explicit roles, native Plan mode, and delegated assignments take precedence. Small tasks still finish directly.
Official Paseo skills describe native tools. Tool injection and browser access still require deliberate host enablement.
If the existing host context already supplies these references, the extra prompt is optional.

## Shared skills and review policy

On macOS, run `agent-awake` before agent work and `agent-sleep` when finished.
The `paseo-awake` and `paseo-sleep` aliases control the same process.
These commands use the built-in `caffeinate -i` to prevent idle system sleep. The screen can still turn off.
The PID file is `${XDG_STATE_HOME:-~/.local/state}/agent-toolkit/caffeinate.pid`.
It also records the process start time to detect reused PIDs.
Repeated starts reuse the tracked process. Stop removes stale state and stops only the tracked caffeinate process, leaving Paseo running.
The commands use the built-in `lockf` to serialize simultaneous calls. The OS releases locks when a command exits.

Run `agent-display-off` to turn off the displays after a three-second delay. After you press Enter, stop keyboard and mouse input.
The command does not change the system sleep settings or the `agent-awake` hold.
Agents can run the command on request. A macOS Shortcut can run the same command for keyboard access.

| Skill | When to use it |
|---|---|
| Caveman | Concise replies directly to the human user. Agent communication and tool arguments use normal English. |
| Ponytail | Coding tasks; full mode prefers the smallest correct solution |
| Test Audit | Writing, changing, reviewing, or auditing tests |
| Python, FastAPI, Fastify, Vue | Work in the corresponding language or framework |
| Simple English | Automatic for Markdown documentation work; explicit checks or rewrites of other technical text |
| Ponytail Review | Explicit complexity review, or a qualifying publication boundary |
| Ponytail Audit | Explicit whole-repository complexity audit; findings only |
| Ponytail Debt | Explicit report of `ponytail:` shortcuts and revisit conditions |
| Ponytail Help | Requested modes, skill syntax, and update reference |
| AutoReview | Explicit independent review, or a qualifying publication boundary |
| DeepSec | Explicit request only; pinned scanner and bounded AI stages |
| React Doctor | Explicit request only; pinned deterministic React scan |

Ponytail Audit and Debt are optional maintenance tools. Help explains the modes and native commands.
The historical `ponytail-gain` scoreboard is intentionally omitted; it does not improve coding, review, or permission behavior.

Automatic reviews occur only when the user requests a commit, push, PR, merge, or ship boundary. Passing tests or finishing an edit never triggers one. First inspect the change and run focused deterministic checks.

- Ponytail Review applies to a new dependency, abstraction, layer, configurable surface, or at least 150 changed non-test, non-documentation lines.
- AutoReview applies to authentication, security, secrets, money, persisted data, schemas, migrations, concurrency, public APIs, installation, upgrades, release machinery, or at least 200 changed non-test, non-documentation lines.
- Review an unchanged bundle once across boundaries. Verify advisory findings. After an accepted review fix, rerun affected checks and that review.
- `reviews:off` disables automatic reviews; `reviews:auto` restores the gates. Explicit reviews remain available. There are no Git review hooks.

AutoReview uses its existing skill-local script on every host:

```sh
"<installed-autoreview-skill>/scripts/autoreview" --engine codex --mode local
```

Codex reviews tasks from every implementation provider, including Claude. The task provider does not select the reviewer.
If Codex is unavailable or cannot complete the review, use `--engine claude` with the same Git target.
Honor an explicit user choice of reviewer. Never use fallback to bypass permission denials, approval-review rejections, isolation failures, or task prohibitions.
The helper does not switch engines automatically. A completed review with findings does not trigger fallback.

Read the skill first and choose the Git target explicitly when needed. The helper owns reviewer isolation, collection, structured reports, and output paths. There is no `autoreview-yolo`. Permission denials use native approval or a trusted human terminal; never disable permissions for a review. The helper does not scan for secrets before sending a review bundle to a provider. Its isolated reviewer can have stricter settings than the ordinary coding session.

The Codex engine runs local `codex exec`, rather than a Codex Cloud task. Its remote model receives the selected source and review context through normal Codex inference. Local execution does not mean offline inference.

Codex's automatic approval reviewer is separate from Toolkit AutoReview. It can reject network access even when the user requested code review. Toolkit instructions do not override native permissions. See [Codex automatic approval review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

For recurring reviews, a human can place this explicit standing authorization in the applicable repository instructions:

```text
For explicitly requested reviews and Toolkit's required publication reviews, I authorize the local AutoReview helper to send the selected review source and context to OpenAI through the Codex engine's normal model requests. If Codex is unavailable or cannot complete the review, I authorize the helper's Claude engine as the fallback. This does not authorize permission or isolation bypasses, Cloud tasks, other providers, account changes, unrelated files, credentials, or production data.
```

This wording clarifies authorization. It does not guarantee approval or grant network access.
A human can configure a [permission profile](https://learn.chatgpt.com/docs/permissions) with workspace file restrictions and command network access.
Domain restrictions require the network proxy. Choose destinations for the actual Codex authentication route, not only `api.openai.com`.
Paseo launch settings can override provider defaults. Verify the effective permissions in a fresh session.
Normal `./install.sh` installs this authorization for selected provider homes and configures their reviewer networking.
The `--preserve-permissions` option skips these changes and retains any previously installed authorization.
Earlier task-specific transmission blocks remain binding until the user explicitly revokes them in that task's session.

For explicit manual skills:

```text
Claude: /deepsec plan
Codex:  $deepsec plan
```

Use the same syntax with `react-doctor changed`. DeepSec AI stages can incur substantial charges and run agents with shell access. Read its skill and obtain the requested scope and cost approval.

Codex CLI account selection is independent:

```sh
CODEX_HOME="$HOME/.codex-accounts/work" codex
```

A newly created Codex account home receives its own native configuration choices; Toolkit does not mirror a previous account's settings. Run installation again to append shared guidance to new account homes. Preserve provider aliases, models, reasoning, and credentials in each home.

## Native Paseo

The small shared block selects host guidance only from the current session's ownership context. Skill availability or an installed host binary does not establish ownership. If it is unclear, ask before delegation, browser control, handoff, or cleanup; ordinary coding can continue.

Native Paseo uses normal providers, its native permission modes, and official Paseo skills. Toolkit never installs, overwrites, or duplicates those skills. Ordinary installation leaves Paseo configuration unchanged. The optional trusted-terminal setup adds missing profiles and offers a separate, default-off System Prompt context. It preserves existing profiles, human text, and provider security settings. Profile notes, account aliases, provider/model/reasoning choices, and asynchronous lifecycle rules come from the official skills. Paseo browser control uses Paseo's enabled browser host.

Paseo launches the installed providers with their configuration and skills. The same native discovery paths serve sessions in Paseo and ordinary terminals. Toolkit installation belongs on the machine and under the user account that runs the Paseo daemon. A phone or remote desktop client does not supply that daemon's skill files. See [Paseo providers](https://paseo.sh/docs/providers).

The startup block must reach the provider home that Paseo uses. A terminal can select a separate account through `CODEX_HOME`.
Installation writes guidance to that home and existing `~/.codex-accounts/*/` homes.
It writes to `~/.codex` only when that home is selected. The shared Codex skill directory remains `~/.agents/skills`.

Before installation, inspect the host's provider configuration and your terminal's directory overrides:

```sh
printenv CODEX_HOME CLAUDE_CONFIG_DIR PASEO_HOME
```

If no override exists, the command prints no value for that variable. Use the same provider homes for installation and fresh sessions. For hosts with different homes, run the same installer for each intended configuration from a trusted terminal. Preserve each home's accounts, models, permissions, and human instructions. A successful install into one account does not prove startup guidance in another account.

Handoffs require explicit ownership. A resumed session keeps its original owner. Collect results before integrating or archiving disposable work; keep unresolved and user-retained resources. Do not archive the active user workspace or a handoff recipient. No timer-based collector runs.

The [central Paseo worktree guide](docs/paseo-worktrees.md) covers project setup, cross-repository workers, previews, and cleanup.
Each project keeps its native `paseo.json`. The shared workflow stays in this Toolkit guide.
The generic `paseo-service` command records explicit cross-workspace service pairs and resolves current ports at consumer startup.
See the guide for environment-loader ordering, small application integration, and required restarts.

### Recommended native Paseo profiles

Use four roles and a dedicated UI Worker specialization, each with a Codex and Claude choice: ten optional native profiles.
Create only the profiles that you use. These are presets, not ten running agents.
The [complete profile guide](docs/paseo-profiles.md) supplies exact fields, selection notes, instruction text, permission explanations, and acceptance steps.
After installation, create the profiles automatically from a trusted human terminal:

```sh
./setup-paseo.sh
```

The command uses installed resource copies and Paseo's native CLI. It honors `PASEO_HOME` for a running local daemon.
Select each intended account alias and permission mode once, or enter `-` to skip a provider family.
Choose whether to add the compact System Prompt context separately. The default leaves the prompt unchanged.
One save confirmation applies the selected changes. Existing profiles remain unchanged.
Private backups and ownership receipts protect deliberate recovery. This does not enable tool injection or launch workers.
Setup also offers the included Paseo tool-trust plugin. The default accepts it at the setup save confirmation.
This enables Paseo's global plugin switch and installs trusted, unsandboxed code through the native CLI.
The plugin approves Paseo MCP tool calls for Codex and Claude, including discovery, workers, terminals, and browser tools.
It handles Default mode too. Other MCP servers, shell commands, questions, and URL authorization requests keep their existing approvals.
Provider tool limits and browser enablement still apply. Trust does not authorize work outside the user's task.
Run `./install.sh`, then `./setup-paseo.sh` from a trusted human terminal to deploy and enable this change.
Verify `agent-toolkit-paseo-tool-trust` has `running` status with `paseo plugin ls`.
Disable this trust with `paseo plugin disable agent-toolkit-paseo-tool-trust`.
See [Paseo permission hooks](https://paseo.sh/docs/plugins/reference.md#lifecycle-hooks) and [tool configuration](https://paseo.sh/docs/mcp.md).
Setup adds up to five missing presets per selected provider family. Use the native editor to create only individual presets.
The [canonical presets](shared/hosts/paseo-profiles.json) supply new profile values.
The compact [context block](shared/hosts/paseo-context.md) points fresh sessions to installed [role guidance](shared/hosts/paseo-roles.md).
The actual task prompt still supplies the assigned role and task brief.
`./install.sh` installs shared startup instructions in each selected provider home and copies the Paseo guidance.
`./setup-paseo.sh` adds context to Paseo's native System Prompt (`daemon.appendSystemPrompt`) only when you select that option.
That context directs the agent to the shared guidance, role instructions, and official Paseo skill for native tools.
It does not replace human System Prompt text or install another copy of the official skills.

Skill rules apply across profiles. Coding Workers load Ponytail full, and test work loads Test Audit.
Every Markdown task requires Simple English, including documentation work assigned to a Worker, Planner, or Orchestrator.
A separate Document Worker preset is optional convenience, not a requirement for these instructions.
Use an ordinary Worker with a documentation objective and explicit file ownership.
Profile names and selection notes do not automatically deliver these instructions or prove that an agent obeys them.
These task-based defaults use your existing subscriptions:

| Profile | Model | Thinking | Planning control | When to use |
|---|---|---|---|---|
| Toolkit Codex Orchestrator | `gpt-6.1-sol` | Medium | `plan_mode: false` | Primary session: own task scope, delegation, integration, handoffs, and cleanup |
| Toolkit Claude Orchestrator | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Primary session: own task scope, delegation, integration, handoffs, and cleanup |
| Toolkit Codex Planner | `gpt-6.1-sol` | High | `plan_mode: true` | A substantial implementation plan for later approval. Use Medium for straightforward plans. |
| Toolkit Claude Planner | `claude-opus-5-5` | High | Native `plan` mode | A substantial implementation plan for later approval. Use Medium for straightforward plans. |
| Toolkit Codex Worker | `gpt-6.1-sol` | Medium | `plan_mode: false` | Bounded implementation, debugging, and verification after authorization |
| Toolkit Claude Worker | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Bounded implementation, debugging, and verification after authorization |
| Toolkit Codex UI Worker | `gpt-6.1-sol` | Medium | `plan_mode: false` | Frontend components, responsive layouts, accessibility, styling, and visual verification |
| Toolkit Claude UI Worker | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Frontend components, responsive layouts, accessibility, styling, and visual verification |
| Toolkit Codex Adviser | `gpt-6.1-sol` | High | `plan_mode: false` | A completed recommendation or second opinion on a bounded question |
| Toolkit Claude Adviser | `claude-opus-5-5` | Medium | Existing non-`plan` mode | A completed recommendation or second opinion on a bounded question |

These profiles are launch presets. Select them for the tasks that need their roles.
The Orchestrator can complete ordinary changes directly. Delegation needs useful scopes, explicit ownership, and sufficient task context.
The Planner adds a repeatable native planning workflow. The Adviser returns a judgment through an analysis-only task prompt.
Code review remains a separate role through AutoReview's existing helper and Ponytail Review.

Medium is the routine default for coordination, bounded implementation, simple planning, and Claude advice.
Codex Adviser defaults to Sol with High effort for bounded second opinions.
Planner defaults to High for substantial planning that resolves design choices, dependencies, risks, and acceptance criteria before handoff.
High also fits ambiguous architecture, difficult integration, security-sensitive work, concurrency, migrations, and difficult debugging.
A small change can still need High. Select it before a difficult assignment rather than waiting for a failed attempt.
Low is an optional adjustment for mechanical work with reliable checks and close supervision. It is not the saved Worker default.
Adjust effort for the assignment through native controls. Honor an explicit human effort choice and explain any proposed adjustment.
Keep the same profiles. No extra effort variants are required.

These defaults are provisional, not measured optima. Higher effort can increase latency and usage without a useful improvement on routine tasks.
Higher effort does not inherently cause overengineering. Scope, Ponytail guidance, and verification remain separate controls.
OpenAI documents Medium as Sol's API default and recommends task-based comparison of Medium and High.
API defaults do not establish Paseo defaults. Extra High and Max need evidence of a useful improvement.
See [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning).
Claude's current Opus 5.5 default is Medium. Anthropic recommends explicit Medium as the starting point for calibration.
High targets harder work where verification and edge cases matter. Effort labels do not represent equal reasoning budgets across models.
Sonnet 5.5 is an optional Worker choice after task-level comparison, without adding another profile.
Astra remains an optional task-specific choice rather than the Codex Adviser default.
See [Claude model and effort guidance](https://code.claude.com/docs/en/model-config) and [Opus 5.5 calibration](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5).

Use `./setup-paseo.sh` for automatic setup. The remaining steps describe the manual alternative:
Create the profiles through Settings → your daemon host → Agents → Agent profiles → New profile.
Use your intended existing provider/account alias for each family.
Select each model and the table's thinking level explicitly.
For the Codex Planner, select your intended native permission mode.
Enable the discovered Plan feature (`plan_mode`).
For the Claude Planner, select native Plan mode (`plan`). Do not copy Codex's feature into Claude settings.
For Codex Orchestrator, Worker, UI Worker, and Adviser, select your intended existing native permission mode. Set `plan_mode` explicitly to false.
For Claude Orchestrator, Worker, UI Worker, and Adviser, select your intended existing non-`plan` permission mode.
If the host does not expose the required restrictions, leave that profile unvalidated. Do not substitute a more permissive mode.
Keep Fast and other usage multipliers off where the host exposes them.
Verify other active native workflow settings. Selecting Medium or High does not necessarily disable an existing Claude Ultracode preference.
Save each profile's table description in **When to use**.
After you save, ask your Paseo agent to inspect `list_profiles`.
Verify explicit true and false values for the required features.
If a required Off value is absent, set it On in the profile editor.
Then set it Off. Save again. The inspected editor can display an unsaved default Off value.
Keep your other profiles and account settings. Ordinary installation and updates do not reset saved profiles.
The optional setup merges missing presets through native configuration commands. Profiles persist under `daemon.agentProfiles`.
The profile array is a whole-list replacement, so setup preserves existing entries and detects ambiguous collisions.
Keep other configuration writers idle during setup. Inspect reported backups after any partial save.
No custom Paseo plugin or new SDK dependency is required.
See the [supported automation route](docs/paseo-profiles.md#supported-automation-route) and [Paseo's profile setup](https://paseo.sh/docs/agent-profiles).

A profile name does not determine permissions. Native Plan controls guide the workflow. They do not establish an OS-enforced read-only sandbox.
Claude Plan mode also changes native tool permission handling. Leaving it changes those controls; verify the intended execution mode before authorized work.
Provider modes with the same name do not guarantee the same behavior. Native permissions remain a deliberate human selection.
For a planning-only assignment, collect the plan without approving its Implement action.
Before later implementation, select the intended Worker settings and verify the effective native permissions.
By default, the Orchestrator selects workers from the current session's provider family and exact account alias.
Use another provider or account only when explicitly requested or authorized.
For example, a Codex session can launch a requested Claude UI Worker. The primary session remains Codex.
If no matching profile exists, discover native settings for the current alias. Ask before launch if the alias is unknown.

Profile notes guide the coordinator's selection. They do not supply a worker system prompt or install skills.
With the compact context enabled, primary delivery sessions use Orchestrator by default.
Without it, request orchestration in the first prompt. The profile label alone does not assign this role.
For example:

```text
Act as Orchestrator for this task. Read the applicable shared and Paseo guidance. Use saved profiles for useful delegation.
Give each worker a bounded assignment. Collect evidence and check the integrated result. Preserve the active review policy and publication limits.
```

The actual task prompt supplies the objective, permitted actions, evidence paths, edit ownership, acceptance criteria, and expected result.
It also supplies the active review policy, publication authorization, and any delegation limits.
Name the assigned role in each task prompt.
The existing startup block and shared skills supply recurring guidance, including automatic Simple English for Markdown work.

The official Paseo skill maps the exact provider/model, mode, thinking, and features into a launch request.
Discover a model for the exact provider if an existing profile has none.
Absent optional settings stay absent, and explicit `false` feature values must remain present.
Saved changes affect future profile selections. They do not update running agents.
Authentication or quota errors stop the affected launch. They do not authorize another account or paid API fallback.

Code reviews remain with AutoReview's existing skill-local helper and Ponytail Review's existing gates.
A saved Reviewer profile does not replace the helper's isolation or configure its reviewer model.
For an explicit review, read the AutoReview skill first. Use Codex by default, including for Claude implementation tasks.
Use Claude only as the fallback if Codex cannot complete the review, or when the user explicitly selects Claude.
Pass the selected engine's options to the helper:

| Reviewer engine | Helper options |
|---|---|
| Codex | `--engine codex --model gpt-6.1-sol --thinking high` |
| Claude | `--engine claude --model claude-opus-5-5 --thinking high` |

These options retain the existing helper's isolation and report flow.
Reviewer effort is independent of profile effort. Keep High for risk-gated reviews and substantive explicit reviews.
For a deliberately lightweight explicit review, Medium is an optional helper adjustment. The worker's effort does not select reviewer effort.
They do not select a Paseo account alias. Run the helper in the intended native account context.
The Claude model is explicit because the helper's pinned Claude default differs from this profile recipe.
Codex's `auto-review` permission mode reviews approval requests. Toolkit's AutoReview reviews a change bundle.
Neither changes the other's policy, and `reviews:off` never changes native permissions.
See [Codex approval review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

Before relying on these profiles, verify a fresh session's exact account alias, model, thinking, native mode, Plan, and other features.
Then perform the skill-loading and review checks in [fresh-session acceptance](#installation-and-fresh-session-acceptance).
Verify an analysis assignment leaves files unchanged and a worker changes only its assigned files.
Verify idle resume and explicit cleanup through the official Paseo workflow.
For parallel edits, verify the intended base and required dirty files before launch, then check the integrated result.
A new worktree contains committed history. It does not automatically include staged, unstaged, or untracked source changes.

The inspected host runs Paseo 0.10.3. Current public documentation includes later features and fixes.

## Permissions and the security tradeoff

Toolkit preserves existing provider and host permissions. Approval policy controls whether a tool may run; an OS sandbox constrains what the process can access. They are different protections.

Retiring the old wrappers removes Toolkit's extra workspace scope, denied credential and `.env` paths, network allowlist, isolated Git settings, publication rules, and legacy Git/process guards. Normal commands use only the protections configured in the provider and host. Existing native Codex/Claude sandboxes remain as configured; Toolkit neither enables nor disables them.

Host terminal brokers, MCP servers, Docker, and frontend services have their own privileges.
Workspace selection alone cannot protect other projects or secrets. Keep appropriate native sandbox settings and backups.

## Disposable PostgreSQL

```sh
pg-test start
pg-test start-migration
pg-test start-admin
pg-test status <id>
pg-test stop <id>
pg-test gc
```

All start modes create PostgreSQL 18 fixtures. There is no version selector. Homebrew PostgreSQL 18 must already be installed. The helper never installs a server, falls back to another version, or targets an existing database. New IDs use `pg18-…`. Status, stop, and garbage collection still recognize old `pg17-…` fixtures; their original PostgreSQL binaries must remain available for safe management.

| Profile | Fixture role permissions |
|---|---|
| `start` | Restricted `toolkit_test` database owner; no role creation or RLS bypass |
| `start-migration` | Same owner with `CREATEROLE`, without `BYPASSRLS` |
| `start-admin` | Same owner with `CREATEROLE` and `BYPASSRLS` |

All roles are non-superusers without database-creation privilege. The bootstrap administrator is disabled after setup. Use the returned connection URL only in the test process. No raw SQL, database path, or server options are accepted. New files, logs, and sockets stay under the session's physical temporary directory. Fixture records use its `agent-toolkit-fixtures` subdirectory. The helper still locates old fixtures under `~/Code/.agent-toolkit-scratch/agent-toolkit-fixtures` and historical temporary roots. It never retries a denied write through another directory. Use the same temporary root for later status and stop commands.

Run `stop` when done. After a verified stop, the helper removes the fixture database files, socket, and server log. It keeps only the small lifecycle record. Repeated stop and status calls remain safe. Normal provider sessions do not create a Toolkit fixture owner or run exit cleanup. Garbage collection runs before a start and through `gc`. It stops a running ownerless fixture after two hours, releases its files, and removes stopped metadata older than three days. It protects recent ownerless setups for two hours so concurrent starts do not delete unfinished fixtures. It recognizes legacy owner records, stops dead owners, and retains live owners. Changed, invalid, or ambiguous identities are preserved and reported. Status/stop also find old temporary-directory roots, refusing duplicate IDs. A denied process inspection or loopback bind requires native approval or a trusted terminal.

Failed setup reports the operation, PostgreSQL command, exit status, and signal when available.
An `initdb` failure includes at most 2048 characters of stderr, with terminal controls removed.
The helper suppresses bootstrap stderr, SQL, command arguments, and raw exception messages to protect credentials.
Failed fixtures remain available for status and stop; explicit stop releases their files too. The helper does not retry initialization automatically.
If PostgreSQL reports denied shared-memory initialization, use the provider's native approval path or a trusted human terminal.
Do not retry through another tool or change server settings to bypass a hard denial.
Provider checks and current limits are recorded in [Toolkit acceptance](docs/toolkit-acceptance.md).
See [PostgreSQL shared-memory configuration](https://www.postgresql.org/docs/18/runtime-config-resource.html).

`pg18-fresh` retains a distinct requirement: run an existing reviewed PostgreSQL 18 fresh-install inventory suite with Docker isolation. It accepts no arguments, requires the exact scripts, exact dependency versions, and `pnpm@11.22.0`, and runs from the target repository in either host or a terminal. Home and filesystem-root invocation are refused. It downloads dependencies from manifests in a separate networked container, then runs copied source without network access. The host checkout is mounted read-only; only the bounded JSON inventory is copied back. Invocation-owned containers and tmpfs volumes are cleaned up. It builds a local image from `postgres:18-bookworm` and `node:24-bookworm-slim`; these tags track patches rather than fixed digests. Docker is an explicit host capability, with no Toolkit approval bypass.

## Migration, backups, and update

Stop active providers before installation. Inspect current settings and historical backups in a trusted human terminal. Old installations can contain both native sandbox settings and Toolkit approval extensions. A generic setting such as `sandbox.enabled` or `approval_policy` is not proof of Toolkit ownership.

The installer completes a read-only preflight before deployment. It parses Ponytail registrations structurally in the selected Codex home and every existing account home that receives guidance. TOML table indentation, dotted keys, and inline tables do not bypass detection. Claude and Paseo configuration can contain comments and trailing commas. Preflight reads those files without changing their bytes. It stops for manual reconciliation when an existing resource, managed instruction block, active Ponytail plugin/package has unclear ownership. It preserves accounts, credentials, provider aliases, models, reasoning, hooks, official host skills, and unrelated settings. Do not clear a directory to resolve a conflict.

Use the [migration and acceptance runbook](docs/toolkit-acceptance.md) for a fresh checkout, safe retirement, and copyable test prompts.
There is no blanket uninstall command. Preserve provider homes and migrate proven Toolkit resources through the installer.

For complete removal before a fresh install, use the runbook's [legacy removal procedure](docs/toolkit-acceptance.md#completely-remove-the-legacy-toolkit).
It includes all selected provider homes and removes the old snapshot after human ownership classification.

The following steps are the alternative migration route, which retains historical snapshots until later inspection:

1. Back up the relevant configuration and compare it with the old Toolkit backups and ownership markers.
2. Reconcile proven old Ponytail plugin/package registrations so they cannot duplicate the shared skill or execute coding-guidance hooks. If a registration is user-owned and should stay, stop and resolve the conflict deliberately.
3. Remove only proven stale Toolkit provider prompt/rule references. Preserve unrelated packages and native permission choices.
4. Run `./install.sh`. Only exact marked legacy files and recognized Toolkit symlink targets are retired. Modified or unmarked files stop installation. The installer leaves unmanifested legacy resource snapshots intact for manual inspection.
5. Restart normal providers and verify behavior before removing any remaining historical data.

### Resolving an active Ponytail registration

The reconciliation error names the exact configuration that blocks installation. No new Toolkit files deploy until preflight succeeds. Disabling an old plugin alone does not install the replacement skill or startup block.

Inspect that configuration and its historical backups. An enabled registration in an old backup does not prove Toolkit ownership. Choose whether to replace the plugin's coding hooks with the shared skill before you disable it.

For Claude's default user configuration, back up the file in your trusted terminal:

```sh
cp -p ~/.claude/settings.json \
  ~/.claude/settings.json.before-toolkit-$(date +%Y%m%d-%H%M%S)
claude plugin disable ponytail@ponytail --scope user
```

For a custom `CLAUDE_CONFIG_DIR`, back up that directory's configuration instead. Use the same directory override with Claude's command.

For Codex, back up the exact `config.toml` named in the error. Then change only the plugin's enabled value:

```toml
[plugins."ponytail@ponytail"]
enabled = false
```

Keep the hook trust records and native permission configuration. Start fresh sessions after migration. Disabling the plugin stops its hooks in those sessions. It does not disable an OS sandbox.

Replaced resources and instruction/configuration files are backed up under `~/.local/share/agent-toolkit/backups/`. The receipt records owned links, exact instruction blocks, and the copied source snapshot. Modified installed skill/script resources stop replacement; dependency caches are rebuilt from the lockfile. Repeat installation preserves human text outside the block. Installation re-reads configuration after staging and restores replaced files if deployment fails. A crash or an existing lock requires manual inspection, not automatic lock theft. Backups can contain private settings: keep them private. Restore specific files after comparing them; do not blindly restore an entire global configuration.

To update from a trusted human terminal:

```sh
./update.sh
```

The script requires a clean checkout, confirms its actual upstream, fast-forwards, runs checks, and installs copies. It does not blanket-update global skills, official host skills, provider CLIs, or user packages. Toolkit never updates itself or its skill pins at startup.

After an update, rerun `./setup-paseo.sh` to add missing presets. Select context refresh only if you use its owned block.
Existing profiles keep their aliases, models, thinking levels, modes, features, and notes. Setup does not reset them to new defaults.
Compare deliberate profile changes with the [canonical presets](shared/hosts/paseo-profiles.json), then edit through native Paseo settings.
Start fresh sessions to verify the updated installed guidance and effective launch settings.

### Pins

| Resource | Pin |
|---|---|
| Ponytail skill family (five skills) | Upstream v4.9.0, revision `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`, vendored without hooks |
| AutoReview | `711711b86294673feced9d1cb636b539daf3c218`; adaptations in its NOTICE |
| React Doctor | `0.9.13`, locked skill-local dependencies |
| DeepSec | `npx deepsec@2.3.9`, manual only |
| Installer configuration parsers | `smol-toml@1.9.0`, `jsonc-parser@3.3.1`, locked in `shared/` |

Python, framework, writing, and Test Audit guidance is vendored; revisions and licenses are kept beside the skill where supplied. Change pins deliberately in source, check, then reinstall.

## Verification and limits

```sh
./verify.sh
```

Checks cover installation and repetition, configuration/account preservation, Paseo preservation, migration refusal, backups and recovery, source/install separation, PostgreSQL role/lifecycle behavior, and AutoReview's deterministic helper contract. External downloads and PostgreSQL processes are substituted in fixture tests. These tests do not prove a provider's security boundary, model adherence, a live reviewer run, or actual Docker/PostgreSQL startup.

Tests must remove their temporary directories after the owning test or helper finishes, including failure paths.
They must register cleanup before fixture setup. Requested evidence uses an explicit output directory.
Repository evidence must use text: commands, observed outcomes, commit references, and unresolved risks.
Do not commit screenshots, images, videos, or binary evidence, including embedded or base64-encoded media.
Use temporary captures for visual checks. Record the inspected behavior and result in text.
If retained media is necessary, link an artifact in an existing approved external store.
Do not create storage only for evidence. Product assets and required test fixtures remain allowed.
`~/Code/.agent-toolkit-scratch` is a legacy location. Paseo workspaces do not require it.
Project scripts can still use that path until their owning repositories remove the old default.

Paseo setup checks cover profile merging, preserved choices, repeated setup, private backups, concurrent-edit refusal, and partial saves.
They substitute native CLI persistence. They do not prove live CLI compatibility or support for the saved feature IDs.
Setup checks advertised providers, models, thinking levels, and mode labels. Native feature discovery remains part of fresh-session acceptance.
The coordinator must inspect the exact provider and selected settings before launch. Unsupported required planning controls stop that profile's launch.

### Installation and fresh-session acceptance

1. After a successful installation, inspect `~/.local/share/agent-toolkit/installed.json`. The receipt records the owned skill links and each managed instruction block.
2. Inspect the native startup file for every provider home you use. It must contain exactly one `<!-- agent-toolkit -->` block. A receipt for another home is insufficient.
3. Resolve the Ponytail skill link. Its body must come from `~/.local/share/agent-toolkit/resources/skills/ponytail/SKILL.md`. A link to the old `~/.local/libexec/agent-toolkit` snapshot is not the rebuilt installation.
4. Start a fresh native Paseo session in a disposable repository for each provider you use. Explicitly load Ponytail and Test Audit with the syntax in the table. Inspect the skill expansion or file-read event for the full copied body.
5. Exercise small coding, test, and Markdown documentation tasks without explicit skill requests. Verify full Ponytail, Test Audit, and Simple English reads respectively. A skill listing or the model's unsupported claim is insufficient.
6. Explicitly request a small AutoReview through its skill-local script. Verify the isolated reviewer and report through normal approval. A permission denial leaves this check unverified.
7. For host operations, verify that Paseo guidance and official Paseo skills load.
8. After optional Paseo setup, inspect `list_profiles` on the selected daemon. Verify effective models, thinking, modes, and features. Inspect actual context and role-guidance reads in fresh sessions.

Passing `./verify.sh` proves the covered fixture behavior. It does not prove that your live installation or fresh Paseo sessions meet these acceptance checks.
The [acceptance runbook](docs/toolkit-acceptance.md#fresh-session-tests) covers all shared skills, host roles and PostgreSQL helpers.

Automatic skill use by a real model, fresh Codex/Claude skill loading, and a live review require fresh-session acceptance.

## Layout

| Path | Contents |
|---|---|
| `skills/` | One shared collection, including skill-local scripts and upstream notices |
| `shared/AGENTS.md` | Small coding/review and host-selection guidance |
| `shared/hosts/` | Paseo instructions |
| `shared/install.cjs` | Human-terminal installation and conservative migration |
| `setup-paseo.sh`, `shared/paseo-setup.cjs` | Native profile, compact System Prompt, and optional Paseo tool trust setup |
| `paseo/tool-trust/` | Native plugin for trusted Paseo MCP approvals in Codex and Claude |
| `shared/postgres/` | Disposable PostgreSQL helpers |
| `paseo/tool-approvals/` | Unrelated work preserved; not installed or managed by Toolkit |
