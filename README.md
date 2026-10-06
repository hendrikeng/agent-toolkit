# Agent Toolkit

One shared skill collection for Codex, Claude Code, and Pi, in Orca, native Paseo, or a terminal. Start with normal provider commands. Orca workspaces do not require special launchers.

The architecture is three parts: task skills in `skills/`, a small shared instruction block in `shared/AGENTS.md`, and host guidance in `shared/hosts/`. Pi has its own command interfaces in `pi/extensions/`. Toolkit supplies no custom permission engine, provider sandbox, Git wrapper, runtime mirror, or executable coding-guidance hook.

## Install and start

Use Node.js 24, npm, Git, Python 3.11+, and your chosen provider CLIs. Pi is optional: when its CLI is absent, installation supplies shared skills and Codex/Claude guidance, leaving Pi settings and interfaces untouched. When present, Pi interfaces require `@earendil-works/pi-coding-agent` 0.99.2; an unsupported version stops installation. Install the supported Pi CLI and rerun the same installer when you want those interfaces. Verification skips unavailable native Pi checks and reports them as unverified. Codex 0.160.0 and Claude Code 2.1.289 were inspected during the rebuild. Toolkit does not install or upgrade provider CLIs, choose models, or change accounts. Install the official Orca or Paseo skills through those hosts when using their operations.

From a trusted human terminal:

```sh
git clone --recurse-submodules https://github.com/hendrikeng/agent-toolkit.git
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

An existing checkout needs `git submodule update --init --recursive`. Add `~/.local/bin` to `PATH` for PostgreSQL helpers. Restart old sessions, then use:

```sh
codex
claude
pi
```

For optional native Paseo profiles, run this command after installation from a trusted human terminal on the daemon machine:

```sh
./setup-paseo.sh
```

Use the intended local `PASEO_HOME`. A host selected in a phone or desktop client does not select this command's daemon.
See the [profile setup and instructions](docs/paseo-profiles.md).

The installer refuses noninteractive invocation. Do not run it to repair an agent session's security boundary. Source edits and Pi `/reload` do not deploy changes. Normal installation configures reviewer networking from a trusted human terminal. The `--preserve-permissions` option leaves provider permissions unchanged. Start fresh sessions after setup. In Paseo, select Codex Auto-review mode to retain automatic approval review.

The installer prepares its locked TOML and JSONC parsers in the checkout with `npm ci --ignore-scripts`. It then copies resources to `~/.local/share/agent-toolkit/resources/`. Discovery symlinks point to those copies, never to the editable checkout. It appends a marked instruction block without replacing human instructions. It adds missing, pinned Pi packages and web defaults while retaining other settings. Pi's native resolver downloads missing packages on its next startup. React Doctor's locked dependencies are installed with `npm ci --ignore-scripts`.

Copies include skill-local scripts and PostgreSQL helpers. A Pi installation also copies its extensions and pinned blueprint. When Pi is skipped, existing installed extension and blueprint contents stay at their previous versions. Shared skills still update for all providers. Installation does not make the checkout read-only. Editing a source script cannot change an installed executable until a human installs it again.

### Provider discovery

| Provider | Task skill discovery | Small global guidance |
|---|---|---|
| Codex | `~/.agents/skills/<name>` | `$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md` |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/<name>`, default `~/.claude/skills` | `$CLAUDE_CONFIG_DIR/CLAUDE.md`, default `~/.claude/CLAUDE.md` |
| Pi | `~/.agents/skills/<name>` | `$PI_CODING_AGENT_DIR/AGENTS.md`, default `~/.pi/agent/AGENTS.md` |

Codex and Pi use the same global discovery directory. Claude symlinks resolve to the same installed collection. These are [Codex's supported skill paths](https://developers.openai.com/codex/skills/) and [Claude's personal skill mechanism](https://code.claude.com/docs/en/skills); Pi documents `.agents/skills` in its installed `docs/skills.md`. Full skill bodies load on demand.

Toolkit honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `PASEO_HOME` during installation. It also adds guidance to existing `~/.codex-accounts/*/` account homes. Install with the same directory overrides you use to start a provider. It stops if `AGENTS.override.md` would hide the Codex block. Web configuration follows Pi web access's `PI_CODING_AGENT_DIR`, then `XDG_CONFIG_HOME/pi`, then `~/.pi` convention.

Installing another provider home preserves the first home's discovery links, instruction files, and ownership records. Obsolete links retire only in the discovery folders being updated. Reinstall each home to refresh its startup guidance. All homes share the copied skill resources; installed Pi homes also share the copied extension resources.

### Startup instructions and full skills

The [small shared block](shared/AGENTS.md) supplies startup guidance through the native instruction files in the table. Each provider controls message roles and precedence. The block does not replace the provider's system prompt or the user's existing instructions.

The block tells the agent to load Ponytail full for coding tasks and Test Audit for test work. Before Markdown documentation work, it requires a full Simple English read. This includes creating, editing, reviewing, or auditing README.md, AGENTS.md, CLAUDE.md, SKILL.md, and Markdown prompt files. The default is pragmatic mode. Code, commands, identifiers, paths, and quoted output stay exact. No explicit Simple English command is required.

The block also defines review gates, database-test precautions, and the session owner's host guidance. Skill discovery supplies skill names and descriptions. The agent reads the full `SKILL.md` when the task requires it or you request it explicitly. Discovery alone does not load every skill body.

For explicit loading:

| Provider | Ponytail | Test Audit |
|---|---|---|
| Codex | `$ponytail full` | `$test-audit` |
| Claude Code | `/ponytail full` | `/test-audit` |
| Pi | `/skill:ponytail full` | `/skill:test-audit` |

Startup guidance replaces the old Ponytail coding hooks. Shared instructions are essential, but native instruction files already supply them. Paseo setup offers a separate, default-off compact System Prompt context that references installed guidance. Instructions guide the model. They do not enforce permissions or guarantee model behavior.
The extra Paseo prompt is not required for task-skill discovery or coding guidance.
Its purpose is to identify fresh Paseo ownership, default primary delivery sessions to Orchestrator, and reference shared role guidance.
Enable this compact context if you want orchestration as the primary default without repeating the role in each task prompt.
Explicit roles, native Plan mode, and delegated assignments take precedence. Small tasks still finish directly.
Official Paseo skills describe native tools. Tool injection and browser access still require deliberate host enablement.
If the existing host context already supplies these references, the extra prompt is optional.

## Shared skills and review policy

| Skill | When to use it |
|---|---|
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

Pi provides `/reviews auto`, `/reviews off`, and `/reviews` as a persisted session control. Codex and Claude use the text instructions above.

AutoReview uses its existing skill-local script on every host:

```sh
"<installed-autoreview-skill>/scripts/autoreview" --mode local
```

Read the skill first and choose the Git target explicitly when needed. The helper owns reviewer isolation, collection, structured reports, and output paths. There is no `autoreview-yolo`. Permission denials use native approval or a trusted human terminal; never disable permissions for a review. The helper does not scan for secrets before sending a review bundle to a provider. Its isolated reviewer can have stricter settings than the ordinary coding session.

The Codex engine runs local `codex exec`, rather than a Codex Cloud task. Its remote model receives the selected source and review context through normal Codex inference. Local execution does not mean offline inference.

Codex's automatic approval reviewer is separate from Toolkit AutoReview. It can reject network access even when the user requested code review. Toolkit instructions do not override native permissions. See [Codex automatic approval review](https://learn.chatgpt.com/docs/sandboxing/auto-review).

For recurring reviews, a human can place this explicit standing authorization in the applicable repository instructions:

```text
For explicitly requested reviews and Toolkit's required publication reviews, I authorize the local AutoReview helper to send the selected review source and context to OpenAI through the Codex engine's normal model requests. This does not authorize Codex Cloud tasks, another provider, unrelated files, credentials, or production data.
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
Pi:     /skill:deepsec plan
Claude: /deepsec plan
Codex:  $deepsec plan
```

Use the same syntax with `react-doctor changed`. DeepSec AI stages can incur substantial charges and run agents with shell access. Read its skill and obtain the requested scope and cost approval.

## Pi interfaces

These interfaces are Pi extensions. Codex and Claude retain their own supported commands; Toolkit does not invent matching commands for them.

| Command | Behavior |
|---|---|
| `/project audit .` | Read-only project audit against the blueprint |
| `/project adopt .` | Approved adoption of blueprint conventions |
| `/project update .` | Approved update; changed managed files stop the update |
| `/project new ../project` | Create and configure an approved new project |
| `/account`, `/account add`, `/account email@example.com` | Pick a session account, add an OpenAI login, or select a unique email |
| `/fast on`, `/fast off`, `/fast status` | Persist OpenAI Codex priority service selection; it uses more quota |
| `/side question`, `/side close` | Terminal UI only; separate side conversation; explicitly requested edits still affect the workspace |
| `/copy-code [number\|all]` | Copy one or all clean fenced code blocks |
| `/push` | Confirm one non-force push through a validated SSH target |
| `/pr` | Create a confirmed GitHub PR using the repository template |
| `/reviews auto`, `/reviews off`, `/reviews` | Control automatic AI review policy |
| `/web on`, `/web off`, `/web status` | Enable installed web tools on demand |
| `/simple-english check|rewrite …` | Load the shared writing skill for a check or rewrite |

The question interface supplies structured choices for `/project`. Blueprint decisions come from repository evidence, with questions only for missing choices. Mutating project operations require confirmation. Web tools start behind a compact loader; the default workflow is `none` and browser-cookie access is disabled. Existing user web preferences are preserved.

A side conversation reads main-conversation context without inserting side messages into it. It loads the user's normal trusted extensions and permissions and inherits the main review mode when opened. It has no private OS sandbox. Close and reopen it after switching accounts or review mode to adopt the new selection.

The `/side` interface requires Pi's terminal UI. It is unavailable in Paseo's chat interface. Other Pi interfaces need the native UI or RPC capabilities their operations require; live Paseo acceptance remains unverified. `/copy-code` also has the terminal shortcut `Ctrl+Shift+X`. Its clipboard targets the host running Pi; remote clipboard behavior remains unverified.

Pi exposes `inspect_pull_request` for PR status, inline comments, reviews, checks, and failed Actions logs. It also exposes `comment_on_pull_request` for explicitly requested, confirmed PR comments. These are model tools, not additional slash commands.

### Accounts

The account interface is retained because Pi's normal CLI has one authentication store per agent directory. Per-session account selection with shared settings and extensions requires a small interface. Pi's stored default OAuth login takes precedence over a replacement provider's API-key resolver. Its public extension API cannot replace the session's credential store.

The interface therefore registers one native provider entry, `toolkit-openai-codex`, for the selected account. It keeps the selected model ID, thinking level, original transport, and request identifiers. Native Pi handles credential refresh and locking in the selected profile store. The default `openai-codex` login remains separate. An existing user-configured `toolkit-openai-codex` entry requires reconciliation. No runtime copy, credential synchronization, or Paseo provider alias is created.

Each Pi account lives in `~/.pi/agent/auth-profiles/<profile>/auth.json` (or the selected agent directory). `/account add` uses normal `codex login` with a separate `CODEX_HOME=~/.codex-accounts/<profile>`, then imports that login once. Existing Pi credentials remain authoritative. Codex credentials are never erased or synchronized. Reauthenticate a profile when its independent login requires it.

Account choice is stored in the Pi session and as a default for future sessions. Selecting one account does not switch another running Pi process. Different profile stores refresh independently. Codex model changes in that session continue to use the selected account. A restored account or selected-account model that cannot load stops instead of silently falling back. Account/quota status shows the selected Pi account.

On resume, the session's recorded account and model remain selected. Explicit native model, provider, and thinking arguments take precedence.

Codex CLI account selection is independent:

```sh
CODEX_HOME="$HOME/.codex-accounts/work" codex
```

A newly created Codex account home receives its own native configuration choices; Toolkit does not mirror a previous account's settings. Run installation again to append shared guidance to new account homes. Preserve provider aliases, models, reasoning, and credentials in each home.

## Orca and native Paseo

The small shared block selects host guidance only from the current session's ownership context. Skill availability or an installed host binary does not establish ownership. If it is unclear, ask before delegation, browser control, handoff, or cleanup; ordinary coding can continue.

Orca owns workspaces and worker lifecycle. Its host guidance loads the version-matched official `orca-cli` and `orchestration` skills for delegation and handoffs. Use normal provider commands in the assigned worktree. Use Orca's embedded browser through `orca-cli`; use appropriate computer-use or page automation for external windows. Toolkit grants no socket or sandbox extensions.

Native Paseo uses normal providers, its native permission modes, and official Paseo skills. Toolkit never installs, overwrites, or duplicates those skills. Ordinary installation leaves Paseo configuration unchanged. The optional trusted-terminal setup adds missing profiles and offers a separate, default-off System Prompt context. It preserves existing profiles, human text, and provider security settings. It does not inject Orca worker instructions into Paseo sessions. Profile notes, account aliases, provider/model/reasoning choices, and asynchronous lifecycle rules come from the official skills. Paseo browser control uses Paseo's enabled browser host.

Paseo launches the installed providers with their configuration and skills. The same native discovery paths serve sessions in Paseo and ordinary terminals. Toolkit installation belongs on the machine and under the user account that runs the Paseo daemon. A phone or remote desktop client does not supply that daemon's skill files. See [Paseo providers](https://paseo.sh/docs/providers).

The startup block must reach the provider home that Paseo uses. An Orca terminal can select a separate account through `CODEX_HOME`. Installation then writes Codex guidance to that selected home and existing `~/.codex-accounts/*/` homes. It does not also write to the default `~/.codex` home unless that home is selected. An Orca account registry outside `~/.codex-accounts` requires its home as `CODEX_HOME`. The shared Codex skill directory remains `~/.agents/skills`.

Before installation, inspect the host's provider configuration and your terminal's directory overrides:

```sh
printenv CODEX_HOME CLAUDE_CONFIG_DIR PI_CODING_AGENT_DIR PASEO_HOME
```

If no override exists, the command prints no value for that variable. Use the same provider homes for installation and fresh sessions. For hosts with different homes, run the same installer for each intended configuration from a trusted terminal. Preserve each home's accounts, models, permissions, and human instructions. A successful install into one account does not prove startup guidance in another account.

Both hosts require explicit ownership for handoffs. A resumed session keeps its original owner. Collect results before integrating or archiving disposable work; keep unresolved and user-retained resources. Do not archive the active user workspace or a handoff recipient. No timer-based collector runs.

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
For an explicit review, read the AutoReview skill first. Choose one engine and pass its options to the helper:

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
The [0.11.0-beta.4 changelog](https://paseo.sh/changelog) includes Pi 0.99 MCP injection, mode persistence, and thinking-display fixes.
The installed adapter checks for `pi-mcp-adapter` before supplying Pi with MCP servers.
Pi's actual Paseo tool access therefore needs a fresh-session check. A model launch alone is insufficient.
Pi remains an explicitly selected alternative. Its provider modes, RPC limits, account selection, and permissions differ from Codex's.
No Pi copy of these profiles is required.

## Permissions and the security tradeoff

Toolkit preserves existing provider and host permissions. Approval policy controls whether a tool may run; an OS sandbox constrains what the process can access. They are different protections.

Retiring the old wrappers removes Toolkit's extra workspace scope, denied credential and `.env` paths, network allowlist, isolated Git settings, Pi Bash-through-Codex sandbox, publication rules, and legacy Git/process guards. Normal commands use only the protections configured in the provider and host. Existing native Codex/Claude sandboxes remain as configured; Toolkit neither enables nor disables them.

Pi's normal tools and trusted extensions are host processes. Project trust and a user-installed approval extension do not supply an OS sandbox. Without an approval extension, Pi can execute tools with the local account's access. Host terminal brokers, MCP servers, Docker, and frontend services also have their own privileges. Workspace selection alone cannot protect other projects or secrets. Keep appropriate native sandbox settings and backups.

`/push` and `/pr` confirm their own bounded operations. They do not prohibit direct Git or GitHub commands in other flows. Publication follows native permission settings and user authorization. PostgreSQL and reviewer helpers receive no automatic permission exception.

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

Run `stop` when done. Normal provider sessions do not create a Toolkit fixture owner or run exit cleanup. Garbage collection runs before a start and through `gc`. It stops a running ownerless fixture after two hours and removes a stopped fixture whose record is older than three days. It recognizes legacy owner records, stops dead owners, and retains live owners. Changed, invalid, or ambiguous identities are preserved and reported. Status/stop also find old temporary-directory roots, refusing duplicate IDs. A denied process inspection or loopback bind requires native approval or a trusted terminal.

`pg18-fresh` retains a distinct requirement: run an existing reviewed PostgreSQL 18 fresh-install inventory suite with Docker isolation. It accepts no arguments, requires the exact scripts, exact dependency versions, and `pnpm@11.22.0`, and runs from the target repository in either host or a terminal. Home and filesystem-root invocation are refused. It downloads dependencies from manifests in a separate networked container, then runs copied source without network access. The host checkout is mounted read-only; only the bounded JSON inventory is copied back. Invocation-owned containers and tmpfs volumes are cleaned up. It builds a local image from `postgres:18-bookworm` and `node:24-bookworm-slim`; these tags track patches rather than fixed digests. Docker is an explicit host capability, with no Toolkit approval bypass.

## Migration, backups, and update

Stop active providers before installation. Inspect current settings and historical backups in a trusted human terminal. Old installations can contain both native sandbox settings and Toolkit approval extensions. A generic setting such as `sandbox.enabled` or `approval_policy` is not proof of Toolkit ownership.

The installer completes a read-only preflight before deployment. It parses Ponytail registrations structurally in the selected Codex home and every existing account home that receives guidance. TOML table indentation, dotted keys, and inline tables do not bypass detection. Claude and Paseo configuration can contain comments and trailing commas. Preflight reads those files without changing their bytes. It stops for manual reconciliation when an existing resource, managed instruction block, active Ponytail plugin/package, or retired Pi reference has unclear ownership. Pi-specific checks and changes apply only when installing Pi interfaces. It preserves accounts, credentials, provider aliases, models, reasoning, hooks, official host skills, and unrelated settings. Do not clear a directory to resolve a conflict.

Use the [migration and acceptance runbook](docs/toolkit-acceptance.md) for a fresh checkout, safe retirement, and copyable test prompts.
There is no blanket uninstall command. Preserve provider homes and migrate proven Toolkit resources through the installer.

For complete removal before a fresh install, use the runbook's [legacy removal procedure](docs/toolkit-acceptance.md#completely-remove-the-legacy-toolkit).
It includes all selected provider homes, even if Pi is absent, and removes the old snapshot after human ownership classification.

The following steps are the alternative migration route, which retains historical snapshots until later inspection:

1. Back up the relevant configuration and compare it with the old Toolkit backups and ownership markers.
2. Reconcile proven old Ponytail plugin/package registrations so they cannot duplicate the shared skill or execute coding-guidance hooks. If a registration is user-owned and should stay, stop and resolve the conflict deliberately.
3. Remove only proven stale Pi explicit skill paths, status-formatter references, or Toolkit-specific provider prompt/rule references. Preserve unrelated packages and native permission choices.
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

Pi can retain an old Ponytail package, explicit skill paths, or a retired status extension. Reconcile the named entries individually. Keep unrelated packages, approval extensions, credentials, and preferences. After each deliberate change, rerun `./install.sh`. Another named conflict requires its own ownership check.

Replaced resources and instruction/configuration files are backed up under `~/.local/share/agent-toolkit/backups/`. The receipt records owned links, exact instruction blocks, and the copied source snapshot. Modified installed skill/script resources stop replacement; dependency caches are rebuilt from the lockfile. Repeat installation preserves human text outside the block. Installation re-reads settings under Pi's native settings lock, and restores replaced files if deployment fails. A crash or an existing lock requires manual inspection, not automatic lock theft. Backups can contain private settings: keep them private. Restore specific files after comparing them; do not blindly restore an entire global configuration.

To update from a trusted human terminal:

```sh
./update.sh
```

The script requires a clean checkout, confirms its actual upstream, fast-forwards, initializes the pinned submodule, runs checks, and installs copies. It does not blanket-update global skills, official host skills, provider CLIs, or user packages. Toolkit never updates itself or its skill pins at startup.

After an update, rerun `./setup-paseo.sh` to add missing presets. Select context refresh only if you use its owned block.
Existing profiles keep their aliases, models, thinking levels, modes, features, and notes. Setup does not reset them to new defaults.
Compare deliberate profile changes with the [canonical presets](shared/hosts/paseo-profiles.json), then edit through native Paseo settings.
Start fresh sessions to verify the updated installed guidance and effective launch settings.

### Pins

| Resource | Pin |
|---|---|
| Ponytail skill family (five skills) | Upstream v4.9.0, revision `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`, vendored without hooks |
| AutoReview | `711711b86294673feced9d1cb636b539daf3c218`; adaptations in its NOTICE |
| Project blueprint | Git submodule `0ef167cb37d6e8de2fc6370acc24a5f62c19aecf` |
| Pi web access | `npm:pi-web-access@0.13.0`, package skills disabled |
| Pi file finder | `npm:@ff-labs/pi-fff@0.10.3` |
| React Doctor | `0.9.13`, locked skill-local dependencies |
| DeepSec | `npx deepsec@2.3.9`, manual only |
| Installer configuration parsers | `smol-toml@1.9.0`, `jsonc-parser@3.3.1`, locked in `shared/` |

Python, framework, writing, and Test Audit guidance is vendored; revisions and licenses are kept beside the skill where supplied. Change pins deliberately in source, check, then reinstall. A conflicting user-selected Pi package version requires reconciliation instead of silent replacement.

## Verification and limits

```sh
./verify.sh
```

Checks cover installation and repetition, configuration/account preservation, host coexistence, migration refusal, backups and recovery, source/install separation, native Pi credential refresh with two stores, retained Pi interfaces, blueprint update preservation, PostgreSQL role/lifecycle behavior, and AutoReview's deterministic helper contract. External downloads and PostgreSQL processes are substituted in fixture tests. These tests do not prove a provider's security boundary, model adherence, a live reviewer run, or actual Docker/PostgreSQL startup.

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
7. For host operations, verify that only the session owner's guidance loads. Native Paseo uses official Paseo skills. Orca uses its official skills.
8. In Pi, exercise `/project audit`, side conversations, review-off inheritance, web toggling, and concurrent accounts.
9. After optional Paseo setup, inspect `list_profiles` on the selected daemon. Verify effective models, thinking, modes, and features. Inspect actual context and role-guidance reads in fresh sessions.

Passing `./verify.sh` proves the covered fixture and SDK behavior. It does not prove that your live installation or fresh Paseo sessions meet these acceptance checks.
The [acceptance runbook](docs/toolkit-acceptance.md#fresh-session-tests) covers all shared skills, host roles, Pi interfaces, and PostgreSQL helpers.

A fresh Pi SDK process verifies copied Ponytail, Test Audit, and Simple English bodies through native command expansion and review-off instructions in the outgoing request. It also verifies Simple English is visible for automatic model selection. The transport is stopped before a model call. No live installation was changed during this rebuild. Automatic skill use by a real model, fresh installed CLI use, Codex/Claude skill loading, and a live review remain unverified. The validation record, old-origin comparison, and current migration blockers are in [docs/rebuild-validation.md](docs/rebuild-validation.md).

## Layout

| Path | Contents |
|---|---|
| `skills/` | One shared collection, including skill-local scripts and upstream notices |
| `shared/AGENTS.md` | Small coding/review and host-selection guidance |
| `shared/hosts/` | Separate Orca and Paseo instructions |
| `shared/install.cjs` | Human-terminal installation and conservative migration |
| `setup-paseo.sh`, `shared/paseo-setup.cjs` | Optional native profile and compact System Prompt setup |
| `shared/postgres/` | Disposable PostgreSQL helpers |
| `shared/pi-web-access/defaults.json` | Missing web preferences only |
| `pi/extensions/` | Pi-only interfaces |
| `vendor/agent-project-blueprint/` | Pinned blueprint |
| `paseo/tool-approvals/` | Unrelated work preserved; not installed or managed by Toolkit |
