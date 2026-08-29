# Agent Toolkit

Agent Toolkit provides version-controlled tools and shared configuration for Claude Code, Codex, and Pi.

## Included

- `codex/skills/autoreview` provides structured, multi-engine code reviews. Codex uses `gpt-5.6-sol` with high reasoning by default.
- `codex/skills/handoff` creates portable context for another agent. Pi exposes it as `/skill:handoff`.
- `pi/AGENTS.md` defines the risk-gated Pi review policy. Normal task completion uses focused checks only.
- `pi/extensions/ask-user-question` lets the model ask structured questions through native Pi dialogs.
- `pi/extensions/codex-account` switches future Codex processes between the `personal` and `business` account homes.
- `pi/extensions/codex-fast` provides persistent `/fast` service-tier control for OpenAI Codex.
- `pi/extensions/codex-goal` provides the persisted `/goal` workflow for Pi.
- `pi/extensions/figma-mcp` provides lazy access to the local Figma Desktop MCP server.
- `pi/extensions/git-push` provides the interactive `/push` command. Unattended agent pushes remain blocked.
- `pi/extensions/orca-permission-bell` sends Pi permission notifications to Orca.
- `pi/extensions/review-mode` provides the persistent `/reviews auto|off` session control.
- `pi/extensions/simple-english` provides the `/simple-english` documentation command.
- `pi/extensions/side-question` provides isolated `/side` questions and small explicit fixes without changes to the main conversation.
- `pi/extensions/skills-update` provides the interactive `/skills-update` command.
- `pi/extensions/task-graph` provides the `/graph` planner for supervised Orca task graphs.
- `pi/extensions/web-access-gate` loads web tools only for necessary tasks.
- `@ff-labs/pi-fff` adds FFF-backed fuzzy file search, content search, and file autocomplete to Pi.
- `pi/skills/deepsec` provides manual access to pinned `deepsec@2.3.5` with explicit AI and cost gates.
- `pi/skills/react-doctor` provides manual, telemetry-free React diagnostics with pinned `react-doctor@0.7.8`.
- `pi/skills/fastapi` provides shared FastAPI guidance from the official FastAPI skill.
- `pi/skills/fastify` provides shared Fastify guidance from Fastify maintainer Matteo Collina.
- `pi/skills/python` provides pragmatic, version-aware Python guidance.
- `pi/skills/vue` provides shared Vue 3 guidance from Anthony Fu.
- `shared/update-global-skills` runs the pinned Skills CLI from the trusted toolkit checkout.
- `shared/ponytail` contains the Ponytail mode configuration and tested Pi package version.
- `shared/pi-web-access` contains safe defaults for pinned `pi-web-access@0.13.0`.
- `shared/agent-safety` contains sandbox configuration, command blocks, and the `*-yolo` launchers.

## Install

Clone the toolkit once and keep the checkout. Installed resources are symlinks to this checkout.

```bash
git clone https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
./install.sh
```

The installer installs pinned dependencies, including `@ff-labs/pi-fff@0.10.3`, and configures agent safety. It does not replace user-owned configuration.

The installer creates these symlinks:

```text
~/.codex/skills/autoreview             -> codex/skills/autoreview
~/.codex/skills/handoff                -> codex/skills/handoff
~/.codex/skills/fastapi                -> pi/skills/fastapi
~/.codex/skills/fastify                -> pi/skills/fastify
~/.codex/skills/python                 -> pi/skills/python
~/.codex/skills/simple-english         -> pi/extensions/simple-english
~/.codex/skills/vue                    -> pi/skills/vue
~/.claude/skills/fastapi               -> pi/skills/fastapi
~/.claude/skills/fastify               -> pi/skills/fastify
~/.claude/skills/python                -> pi/skills/python
~/.claude/skills/simple-english        -> pi/extensions/simple-english
~/.claude/skills/vue                   -> pi/skills/vue
~/.pi/agent/AGENTS.md                  -> pi/AGENTS.md
~/.pi/agent/skills/autoreview          -> codex/skills/autoreview
~/.pi/agent/skills/handoff             -> codex/skills/handoff
~/.pi/agent/extensions/ask-user-question -> pi/extensions/ask-user-question
~/.pi/agent/extensions/codex-account   -> pi/extensions/codex-account
~/.pi/agent/extensions/codex-fast      -> pi/extensions/codex-fast
~/.pi/agent/extensions/codex-goal      -> pi/extensions/codex-goal
~/.pi/agent/extensions/figma-mcp       -> pi/extensions/figma-mcp
~/.pi/agent/extensions/git-push        -> pi/extensions/git-push
~/.pi/agent/extensions/orca-permission-bell -> pi/extensions/orca-permission-bell
~/.pi/agent/extensions/review-mode     -> pi/extensions/review-mode
~/.pi/agent/extensions/simple-english  -> pi/extensions/simple-english
~/.pi/agent/extensions/side-question   -> pi/extensions/side-question
~/.pi/agent/extensions/skills-update   -> pi/extensions/skills-update
~/.pi/agent/extensions/task-graph      -> pi/extensions/task-graph
~/.pi/agent/extensions/web-access-gate -> pi/extensions/web-access-gate
~/.pi/agent/skills/deepsec             -> pi/skills/deepsec
~/.pi/agent/skills/react-doctor        -> pi/skills/react-doctor
~/.pi/agent/skills/fastapi             -> pi/skills/fastapi
~/.pi/agent/skills/fastify             -> pi/skills/fastify
~/.pi/agent/skills/python              -> pi/skills/python
~/.pi/agent/skills/vue                 -> pi/skills/vue
<config-dir>/ponytail/config.json       -> shared/ponytail/config.json
```

The installer writes managed safety policies as `0600` files. It writes managed launchers and the Codex Git guard as `0700` files.

The installer refuses to replace modified or user-managed policy files. Configure unsupported Codex permission profiles manually.

Pi stores `web-search.json` as a user-owned `0600` file. Installation merges safe defaults and preserves existing API keys.

A custom `PI_CODING_AGENT_DIR` must be an absolute path. The web package does not expand a literal `~`.

The installer skips unavailable agent CLIs. If `XDG_CONFIG_HOME` is set, the Ponytail configuration follows it.

The installer moves existing non-symlink installations to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

After installation, run `/reload` in an active Pi session. If `pi-yolo` receives a new resource, restart that session.

On the first Codex start, review the Ponytail lifecycle hooks. Use `/hooks` to manage hook trust.

## Usage

Skills load for tasks that match their descriptions. Extensions load at host startup.

Use the commands below to force a skill, change a mode, or enable an optional integration.

### Skill index

| Skill | Loading | Purpose |
|---|---|---|
| `autoreview` | Manual or risk-gated | Review a change bundle with a second model. |
| `handoff` | Manual | Create a portable prompt for another agent. |
| `deepsec` | Manual only | Run guarded security scans and reports. |
| `fastapi` | Automatic for matching tasks | Apply version-aware FastAPI guidance. |
| `fastify` | Automatic for matching tasks | Apply Fastify backend guidance. |
| `python` | Automatic for matching tasks | Apply pragmatic Python guidance. |
| `react-doctor` | Manual only | Scan React or Next.js code. |
| `simple-english` | Manual only | Check or rewrite technical documentation. |
| `vue` | Automatic for matching tasks | Apply Vue 3 guidance. |
| Ponytail skills | Automatic or manual by mode | Reduce unnecessary code and review complexity. |

Use `/skill:<name>` in Pi to force a listed skill. Use the host-specific commands in the sections below.

Skills installed separately through the Skills CLI remain external to this toolkit. Run `npx skills list -g` to list them.

### Agent safety

Claude Code and Codex use their native workspace sandboxes. Pi uses `pi-permission-system` as a command and path gate.

The safety rules block common irreversible commands. These commands include `rm`, `git clean`, and `git reset --hard`.

Trusted development roots include `~/Code` and `~/orca/workspaces`. Credential, private-key, and environment-file paths remain denied or gated.

For an unattended session, start `pi-yolo`, `codex-yolo`, or `claude-yolo`. These launchers suppress normal approval prompts but keep safety blocks.

`claude-yolo` disables Claude filesystem isolation. Its network sandbox and full-escape block remain active.

`codex-yolo` keeps the Codex workspace sandbox. It does not use danger-full-access mode.

`pi-yolo` uses a temporary resource tree. It keeps access to managed resources and pasted clipboard images.

The yolo launchers preserve persistent Pi configuration paths. Installer changes remain after a restart.

Make sure that `~/.local/bin` is on `PATH`.

In interactive Pi, `/push` is the only yolo-safe push path. The command accepts no arguments.

The command runs required closeout checks. It then shows the branch, target, URL, commit, and outgoing commits for approval.

The command refuses dirty, detached, behind, or untracked repositories. It performs one non-force push of the current branch.

Inside Orca, Pi permission dialogs send terminal-bell notifications. Keep Orca Terminal Bell notifications enabled.

Project-local Pi permission configuration can override global policy. Use only trusted projects, or add an operating-system or container sandbox.

Keep irreplaceable untracked data in versioned backups. These controls reduce accidents but do not replace backups.

### Shared tools

#### Ponytail

Ponytail is active for coding tasks in `full` mode.

| Action | Claude Code / Pi | Codex |
|---|---|---|
| Change mode | `/ponytail lite`, `/ponytail full`, `/ponytail ultra` | `@ponytail lite`, `@ponytail full`, `@ponytail ultra` |
| Disable | `/ponytail off` or say “normal mode” | `@ponytail off` or say “normal mode” |
| Review changed code | `/ponytail-review` | `@ponytail-review` |
| Audit the repository | `/ponytail-audit` | `@ponytail-audit` |
| List deferred work | `/ponytail-debt` | `@ponytail-debt` |
| Show the scoreboard | `/ponytail-gain` | `@ponytail-gain` |
| Show help | `/ponytail-help` | `@ponytail-help` |

`PONYTAIL_DEFAULT_MODE` can set `lite`, `full`, `ultra`, or `off`.

Pi runs `ponytail-review` automatically only for a matching risk-gated closeout.

#### Autoreview

Ask for “autoreview” or use `@autoreview` for an explicit second-model review.

Pi runs autoreview automatically only at a requested commit, push, pull-request, merge, or ship boundary. The risk policy must also require it.

Autoreview uses Codex by default. It can also use Claude, Pi, Droid, Copilot, Cursor, or OpenCode.

Direct helper examples:

```bash
~/.codex/skills/autoreview/scripts/autoreview --mode local
~/.codex/skills/autoreview/scripts/autoreview --mode branch --base origin/main
~/.codex/skills/autoreview/scripts/autoreview --mode commit --commit HEAD
```

Use `--engine claude` for one alternate reviewer. Use `--reviewers codex,claude` for an optional panel.

Treat findings as advisory. Inspect each finding in the real code before you make a change.

See [`codex/skills/autoreview/SKILL.md`](codex/skills/autoreview/SKILL.md) for all options.

#### Handoff

Use `@handoff <task>` in Codex. Use `/skill:handoff <task>` in Pi.

The skill creates a portable prompt and copies it to the clipboard. If necessary, ask it to print the prompt.

### Pi tools

Pi skills load for tasks that match their descriptions. Use `/skill:<name>` to force a skill.

Web and Figma expose only small loader schemas until you enable their full tools.

#### Skill updates

Run `/skills-update` in interactive Pi. This command does not add content to the normal model prompt.

If you do not use Pi, run the standalone updater from the toolkit checkout:

```bash
./update.sh
```

`update.sh` requires an interactive terminal. It shows the configured upstream and branch, then asks for approval.

Both update commands do these steps:

1. They refuse a dirty agent-toolkit checkout.
2. They show the configured upstream, branch, and URL for approval.
3. They fast-forward pull the approved upstream.
4. They update global skills with pinned `skills@1.5.22`.
5. They run `install.sh` last to initialize the pinned blueprint submodule and restore all reviewed toolkit links.

The Pi command reloads Pi. The standalone command tells you to restart active sessions after resource changes.

Toolkit-owned skills remain reviewed and pinned in this repository. The commands update them through toolkit releases.

Both commands pull the toolkit before they update globally tracked skills. The installer also runs after a failed external skill update.

The commands do not overwrite local safety changes with direct skills.sh copies. Nothing updates automatically at startup.

#### Project blueprints

The reviewed `agent-project-blueprint` revision is pinned at `vendor/agent-project-blueprint` as a Git submodule. Clone this toolkit with `--recurse-submodules`, or initialize an existing checkout with:

```bash
git submodule update --init --recursive
```

Set `AGENT_PROJECT_BLUEPRINT_DIR` only when testing a different reviewed blueprint checkout. Run `./install.sh`, then restart Pi.

Use the interactive project workflow:

```text
/project audit /path/to/existing-project
/project adopt /path/to/existing-project
/project new /path/to/empty-project
```

Choose the mode by project state:

- `audit`: inspect any existing project without changing it. Use this first when unsure, for non-Node projects, and for projects that already have a blueprint harness manifest.
- `adopt`: add the blueprint to an existing project that has not been adopted. It preserves existing files and conflicting package scripts. It currently requires Node.js 24, `package.json`, and an npm, pnpm, or yarn lockfile.
- `new`: initialize an empty project directory. New-project package initialization currently creates an npm `package-lock.json` or `npm-shrinkwrap.json`.

The workflow reads the blueprint's machine-readable questionnaire, inspects the target, infers answers from repository evidence, and asks only for missing values. It then shows the blueprint comparison and complete decision packet. Choose Approve, Revise, Save Draft, or Cancel. Run the same command later to resume a saved draft.

Bash, edit, and write stay blocked until approval. The workflow rejects likely secrets and stores only approved non-secret decisions. After approval, the blueprint-owned tools add missing files, preserve existing project files, replace governed placeholders, and merge non-conflicting package scripts. The agent reports preserved files and conflicts, reconciles only the approved changes, and runs the focused bootstrap checks.

#### Task graphs

Run `./install.sh` before first use. Then restart Pi. Keep Orca running with its orchestration experimental feature enabled.

Use a plain objective for new work:

```text
/graph Add customer search to the API and Web app
```

Use a repository plan path for planned work:

```text
/graph docs/future/customer-search.md
/graph docs/exec-plans/active/customer-search.md
```

The planner first inspects the repository and the referenced plan. The plan status, dependencies, checklist, approvals, and targets remain authoritative.

The planner applies these modes:

- `plan-only`: draft, ready-for-promotion, blocked, budget-exhausted, or completed plans.
- `execute`: an active executable slice with satisfied dependencies and approvals.
- `direct`: a recommendation to stop graph planning and run small or tightly coupled work normally.

For local Markdown plans, the extension enforces statuses that cannot execute. If one future contains independent outcomes, create separate future files linked by `Dependencies`.

For suitable work, the planner validates a DAG of two to six tasks. Each task includes dependencies, exclusive ownership, a specialty, completion criteria, and validation.

Choose Approve, Revise, or Cancel in the interactive review. Plan-only approval and cancellation stop the agent run.

The extension blocks Pi's bash, edit, and write tools until an executable graph is approved. Before approval, the planner uses read and search tools only.

After approval, Orca stores task state, dispatches workers, routes messages, and tracks completion. The coordinator explicitly launches every graph worker with `pi-yolo`; it does not rely on Orca's generic `--agent pi` launcher unless the launch receipt confirms `pi-yolo` as the effective executable. The coordinator remains responsible for integration and final validation.

#### User questions

When a required decision is unclear, the model can call `ask_user_question` instead of guessing.

The tool supports one to four single-choice questions. Each question also accepts a custom text answer.

#### Codex accounts

Log in to each account home one time:

```bash
CODEX_HOME="$HOME/.codex-accounts/personal" codex login
CODEX_HOME="$HOME/.codex-accounts/business" codex login
```

After an upgrade from an earlier release, rename existing account directories to these public names. You can also log in again.

Select the Codex account in Orca before you start Pi. `pi-yolo` uses the matching Pi login for `personal` or `business`.

Each account profile keeps OAuth logins separate. In the first Pi session for each account, run `/login` for each subscription provider that you use.

Use these commands to select the account for future Codex subprocesses in the current Pi session:

```text
/codex-account personal
/codex-account business
```

Run `/codex-account` without an argument to open the selector. This command cannot change the account of the running Pi process. Select the same account in Orca and restart Pi.

#### Codex Fast mode

Enable Fast mode for supported OpenAI Codex models:

```text
/fast on
```

Use `/fast off` to return to the standard service tier. Use `/fast status` to show the current selection.

The selection persists for new Pi sessions. Fast mode reduces latency but uses more subscription quota.

#### Side conversations

Start an isolated side conversation with a question or small fix:

```text
/side Why did you choose this approach?
/side Fix the typo in README.md
```

The first command copies the current main context into an ephemeral agent. Later `/side` commands continue that side conversation.

The main agent continues its work. Side messages do not enter the main conversation.

Explicit side edits remain in the workspace. Do not ask both agents to edit the same file at the same time.

Press Escape to close the answer view. Run `/side close` to discard the side conversation.

#### Risk-gated review closeout

The global `AGENTS.md` policy controls reviews at requested commit, push, pull-request, merge, and ship boundaries.

The policy uses focused deterministic checks first. It adds a Ponytail review only for its configured complexity triggers.

The policy adds autoreview only for sensitive changes, release changes, or large changes. It does not install AI review as a Git hook.

Use `/reviews auto` for the default risk-gated behavior. Use `/reviews off` to disable automatic AI reviews for the current session.

Use `/reviews` to show the current mode. Explicit review requests always run.

#### FastAPI

Ask for FastAPI work normally. Claude Code, Codex, and Pi load the FastAPI guidance for matching tasks.

Force the skill with `/fastapi` in Claude Code, `@fastapi` in Codex, or `/skill:fastapi` in Pi.

#### Fastify

Ask for Fastify work normally. Claude Code, Codex, and Pi load the Fastify guidance for matching tasks.

Force the skill with `/fastify` in Claude Code, `@fastify` in Codex, or `/skill:fastify` in Pi.

#### Python

Ask for Python work normally. Claude Code, Codex, and Pi load the Python guidance for matching tasks.

The guidance follows the project Python version and existing tools. It does not force tool migrations.

Force the skill with `/python` in Claude Code, `@python` in Codex, or `/skill:python` in Pi.

#### Vue

Ask for Vue work normally. Claude Code, Codex, and Pi load the Vue 3 guidance for matching tasks.

Force the skill with `/vue` in Claude Code, `@vue` in Codex, or `/skill:vue` in Pi.

#### Simple English

Simple English is manual-only. It does not change normal responses.

In Pi, select an action and target:

```text
/simple-english check README.md
/simple-english rewrite README.md
/simple-english rewrite README.md strict
```

`check` reports findings without file changes. `rewrite` uses pragmatic mode by default.

Use strict mode only for ASD-STE100-style requirements. Use `@simple-english` in Codex and `/simple-english` in Claude Code.

#### DeepSec

DeepSec is an optional, manual-only vulnerability scanner. Automatic coding and review closeout never run it.

DeepSec AI stages run agents with shell access. Large scans can cost thousands of dollars.

Start with the local path:

```text
/skill:deepsec plan
/skill:deepsec scaffold
/skill:deepsec install
```

`plan` does not change the project. `scaffold` creates `.deepsec/` and configures local Codex authentication.

`install` downloads pinned workspace dependencies without package lifecycle scripts. This path does not require a Vercel account or API key.

Complete `.deepsec/data/<project>/INFO.md` with the instructions in `SETUP.md`.

Then run `/skill:deepsec scan` for free local pattern matching. Use `/skill:deepsec status|report|export` to read results.

Before an AI command, show the exact scope, model, limits, and credential route. Get explicit user approval for that command.

In `deepsec@2.3.5`, `triage` uses Claude instead of the configured Codex route. It requires separate AI and Claude approval.

A full `init` or `setup` requires Vercel Sandbox scope. It also requires `--max-cost-usd`, `--max-duration`, and explicit Vercel approval.

`sandbox` and `sandbox-all` upload source bundles to Vercel. These commands require separate AI and Vercel approval.

#### React Doctor

Use React Doctor for requested health checks or important pre-ship reviews. Do not run it after every small edit.

```text
/skill:react-doctor changed  # new issues versus the detected base
/skill:react-doctor lines    # issues touching changed lines only
/skill:react-doctor full     # complete project
```

#### Goals

```text
/goal <objective>  Start and immediately pursue a goal
/goal              Show status and usage
/goal edit         Edit the objective
/goal pause        Pause it
/goal resume       Resume it
/goal clear        Clear it
```

Goal state remains in the current Pi session. Active goals continue after Pi settles.

The model uses `get_goal`, `create_goal`, and `update_goal` for these commands.

#### Web access

The model can call `enable_web_access` for current information, external documentation, or URL content.

Manual controls:

```text
/web on
/web off
/web status
```

When enabled, Pi exposes `web_search`, `fetch_content`, and `get_search_content`.

Browser-cookie access stays disabled. `/web off` returns to the small loader schema.

#### Figma Desktop

For a Figma task, the model can call `enable_figma`. You can also use these commands:

```text
/figma on
/figma status
/figma tools
/figma off
```

Open Figma Desktop and enable its local MCP server first.

The `figma_mcp` tool supports common reads for inspection, screenshots, variables, metadata, and FigJam. It also supports catalog and resource access.

This integration supports local read workflows. If Figma requires remote or write access, use native Codex CLI.

After you edit an existing toolkit resource, run `/reload`. If installation adds a resource to `pi-yolo`, restart that session.

DeepSec workspaces remain project-local. The DeepSec package downloads only during an invocation.

## Checks

Run the toolkit checks:

```bash
./verify.sh
```

The script runs extension tests, skill checks, Pi command discovery, and safety-policy checks. It also checks pinned package configuration.

## Update development files

Edit repository files directly. Installed paths are symlinks, so file changes are immediately available on disk.

After an edit, run `/reload` in Pi. To update everything from outside Pi, run `./update.sh`.

To update the Ponytail pin, change `shared/ponytail/VERSION` and run `./install.sh`.

## Licensing and attribution

The goal extension contains its own `LICENSE` and `NOTICE.md`. These files include attribution for prompt templates from OpenAI Codex.

The FastAPI, Fastify, handoff, Simple English, and Vue skills include upstream licenses and revision information.

The Figma integration contains a component `NOTICE.md`.

External npm packages retain their upstream licenses. These packages include DeepSec, React Doctor, Pi FFF, and Pi Web Access.
