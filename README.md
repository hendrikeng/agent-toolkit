# Agent Toolkit

One shared skill collection for Codex and Claude Code, in native Paseo or a terminal. Start with normal provider commands.

The Toolkit has three parts: task skills in `skills/`, a small shared instruction block in `shared/AGENTS.md`, and host guidance in `shared/hosts/`.
It supplies no custom permission engine, provider sandbox, Git wrapper, or executable coding-guidance hook.

Replies addressed directly to the human user use the pinned [Caveman skill](skills/caveman/SKILL.md) by default. Agent communication and tool arguments use normal English. Use `normal mode` to stop it.
Tool arguments, delegation briefs, agent messages, worker reports, and handoffs always use normal English.

## Install and start

Use Node.js 24, npm, Git, Python 3.11+, and your chosen provider CLIs. The Toolkit does not install or upgrade provider CLIs. Install the official Paseo skills through Paseo.

From a trusted human terminal:

```sh
git clone https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
npm ci --prefix shared --ignore-scripts --no-audit --no-fund
./verify.sh
./install.sh
```

To keep your current provider permissions, use:

```sh
./install.sh --preserve-permissions
```

The installer refuses noninteractive invocation. Do not run it from an agent to repair that agent's security boundary. The former `--review-network` option is the same as normal installation.

Normal installation changes the selected `CODEX_HOME` and `CLAUDE_CONFIG_DIR` (normal defaults when not set):

- It copies Git-tracked `skills/` files and the helpers to `~/.local/share/agent-toolkit/resources/`. Discovery symlinks point to these copies, never to the checkout.
- It appends one marked instruction block to each provider instruction file, with review authorization from `shared/review-authorization.md`. Human text stays unchanged.
- Codex keeps workspace file restrictions and gets command network access with automatic approval review.
- If Claude `settings.json` has a `sandbox` object, it adds `api.openai.com`, `chatgpt.com`, `auth.openai.com`, and `api.anthropic.com` to `sandbox.network.allowedDomains`. It never turns the sandbox on.
- It backs up each Claude `settings.json` or Codex `config.toml` before it changes it, and restores them if deployment fails.

`--preserve-permissions` skips the permission and network changes. Existing Claude domain denies, `WebFetch(domain:...)` deny rules, Codex named permission profiles, or other Codex filesystem modes stop normal installation. Use `--preserve-permissions` or reconcile them first.

Source edits do not deploy until a human installs again. Add `~/.local/bin` to `PATH` for the helpers. Restart old sessions, then use:

```sh
codex
claude
```

### Provider discovery

| Provider | Task skill discovery | Small global guidance |
|---|---|---|
| Codex | `~/.agents/skills/<name>` | `$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md` |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/<name>`, default `~/.claude/skills` | `$CLAUDE_CONFIG_DIR/CLAUDE.md`, default `~/.claude/CLAUDE.md` |

The installer honors `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `PASEO_HOME`, and also adds guidance to existing `~/.codex-accounts/*/` homes.
It stops if `AGENTS.override.md` would hide the Codex block. Install with the same overrides that you use to start a provider. Each home keeps its own links and records.

Codex CLI account selection is independent:

```sh
CODEX_HOME="$HOME/.codex-accounts/work" codex
```

Run installation again after you create a new account home.

### Startup instructions and full skills

The [shared block](shared/AGENTS.md) loads through the native instruction files.
It tells the agent to load Ponytail full for coding, Test Audit for test work, and Simple English (pragmatic) before Markdown documentation work. It also sets review gates, database-test precautions, and host guidance.
The agent reads a full `SKILL.md` only when the task needs it. Instructions guide the model. They do not enforce permissions.

| Provider | Ponytail | Test Audit |
|---|---|---|
| Codex | `$ponytail full` | `$test-audit` |
| Claude Code | `/ponytail full` | `/test-audit` |

## Skills and review policy

| Skill | When to use it |
|---|---|
| Caveman | Always on for replies to the human user; agent communication and tool arguments use normal English |
| Ponytail | Coding tasks; full mode prefers the smallest correct solution |
| Test Audit | Writing, changing, reviewing, or auditing tests |
| Python, FastAPI, Fastify, Vue, React | Work in that language or framework. React covers Next.js. |
| Simple English | Automatic for Markdown documentation; explicit checks of other technical text |
| Ponytail Review | Explicit request only (`/ponytail-review`); quality review of a change |
| Ponytail Audit | Explicit request only (`/ponytail-audit`); quality audit of the whole repository, findings only |
| Ponytail Debt | Explicit report of `shortcut:` and older `ponytail:` markers |
| Security Audit | Explicit request only (`/security-audit`); Cloudflare's security guidance |
| React Doctor | Explicit request only; pinned deterministic React scan |

Manual skills use the provider syntax:

```text
Claude: /react-doctor changed
Codex:  $react-doctor changed
```

A full Security Audit starts many agents and can cost much. Agree on the scope and budget with the user first.

Automatic reviews run only when the user requests a commit, push, PR, merge, or ship boundary. First inspect the change and run focused deterministic checks.

- Native code review: authentication, security, secrets, money, persisted data, schemas, migrations, concurrency, public APIs, installation, upgrades, release machinery, or at least 200 changed non-test, non-documentation lines.
- Review an unchanged bundle once. After an accepted review fix, run the affected checks and that review again.
- `reviews:off` stops automatic reviews and `reviews:auto` restores them. Explicit reviews stay available. There are no Git review hooks.

The reviewer matches the provider family of the requesting agent. Other families use Codex. Claude uses `/code-review medium` with `opus`, the newest Opus model. Codex uses `codex exec review` with `gpt-6.1-sol` at medium reasoning.
The [code review commands](docs/code-review.md) give the exact commands, tool limits, and the pre-push secret scan. A review takes about 1-4 minutes.
Native reviews replaced AutoReview on 2026-11-14 (8 of 14 known bugs found, against 1).

Findings are advice. Verify each one. Fix confirmed correctness, security, and data-loss problems in scope, and report the others as follow-ups.
If the reviewer fails, report it. A switch to another provider needs explicit user authorization. Do not retry after a permission denial or rejection.
Codex automatic approval review is separate and can reject reviewer network access.

For a repository-level standing authorization, a human can add this text to the repository instructions:

```text
For explicitly requested reviews and Toolkit's required publication reviews, I authorize the native reviewer of the requesting agent's provider to send the selected review source and context through its normal model requests. Claude agents use Claude, and Codex agents use Codex. Explicit reviewer choices take precedence. A switch to another provider needs my explicit authorization. This does not authorize permission bypasses, Cloud tasks, other providers, account changes, unrelated files, credentials, or production data.
```

This text does not grant network access. Earlier task-specific transmission blocks stay binding until the user revokes them.

## Native Paseo

Install the Toolkit on the machine and user account that run the Paseo daemon.
The startup block must reach the provider homes that Paseo uses. Inspect the overrides before installation:

```sh
printenv CODEX_HOME CLAUDE_CONFIG_DIR PASEO_HOME
```

Host guidance comes from the ownership context of the session, not from installed binaries. If the owner is unclear, ask before delegation, browser control, handoff, or cleanup. A resumed session keeps its owner.
The [Paseo worktree guide](docs/paseo-worktrees.md) covers project setup, cross-repository workers, previews, service pairs, and cleanup.

### Profiles and setup

After installation, run this command on the daemon machine with the intended local `PASEO_HOME`:

```sh
./setup-paseo.sh
```

It adds up to six missing presets for each provider family. Select an account alias and a permission mode, or enter `-` to skip a family. Customized profiles stay unchanged, and private backups protect recovery.
It also offers:

- A default-off System Prompt context (`daemon.appendSystemPrompt`). It points to the [role guidance](shared/hosts/paseo-roles.md) and makes primary sessions Orchestrator by default. Without it, name the role in the first prompt.
- The [Paseo tool trust](#paseo-tool-trust) plugin, accepted by default.

Create only the profiles that you use. In Paseo, select Codex Auto-review mode to keep automatic approval review.

| Profile | Model | Thinking | Planning control | When to use |
|---|---|---|---|---|
| Toolkit Med - Codex Orchestrator | `gpt-6.1-sol` | Medium | `plan_mode: false` | Primary session |
| Toolkit High - Codex Orchestrator | `gpt-6.1-sol` | High | `plan_mode: false` | Hard primary work |
| Toolkit Med - Claude Orchestrator | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Primary session |
| Toolkit High - Claude Fable Orchestrator | `claude-fable-5-2` | High | Existing non-`plan` mode | Hard primary work |
| Toolkit High - Codex Planner | `gpt-6.1-sol` | High | `plan_mode: true` | Substantial plan for later approval |
| Toolkit High - Claude Fable Planner | `claude-fable-5-2` | High | Native `plan` mode | Substantial plan for later approval |
| Toolkit Med - Codex Worker | `gpt-6.1-sol` | Medium | `plan_mode: false` | Bounded implementation and verification |
| Toolkit Med - Claude Worker | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Bounded implementation and verification |
| Toolkit Med - Codex UI Worker | `gpt-6.1-sol` | Medium | `plan_mode: false` | Frontend, accessibility, and visual checks |
| Toolkit Med - Claude UI Worker | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Frontend, accessibility, and visual checks |
| Toolkit Med - Codex Adviser | `gpt-6.1-sol` | Medium | `plan_mode: false` | Second opinion on a bounded question |
| Toolkit Med - Claude Adviser | `claude-opus-5-5` | Medium | Existing non-`plan` mode | Second opinion on a bounded question |

Medium is the routine default. Select High before a difficult assignment. Fable 5.2 costs two times more per API token than Opus 5.5.
To make Opus the default for native subagents, set `CLAUDE_CODE_SUBAGENT_MODEL` to `claude-opus-5-5` in the `env` block of the Claude `settings.json`.
Setup does not remove the earlier Opus High Orchestrator or Planner. Remove them in the native editor if you do not use them.

Workers use the provider family and account alias of the Orchestrator unless the user requests another.
A profile name does not set permissions, and native Plan mode is not a read-only sandbox. Verify effective settings in a fresh session.
The [profile guide](docs/paseo-profiles.md) gives the profile table, the steps to create and update profiles, and notes on effort and Fable. The [role instructions](shared/hosts/paseo-roles.md) give the text for each role. The [canonical presets](shared/hosts/paseo-profiles.json) supply the values. The inspected host runs Paseo 0.10.3.

### Paseo tool trust

The `agent-toolkit-paseo-tool-trust` plugin is trusted, unsandboxed code. Setup installs it through the native CLI and enables the global Paseo plugin switch.
It approves only these Paseo MCP tools, for Codex and Claude:

- The `list_*` tools, `get_agent_status`, `get_agent_activity`, `inspect_provider`, `inspect_schedule`, and `schedule_logs`.
- `cancel_agent` and `archive_agent` (a soft delete).
- `create_workspace` and `rename_workspace`.

For Claude, it also approves `create_agent`, `update_agent`, and `set_agent_mode` when the call names a safe mode. No mode, `bypassPermissions`, `full-access`, or an unknown mode gets a prompt. For Codex, these three tools always prompt.
For Claude, it also approves `Edit`, `Write`, and `MultiEdit` on a Markdown auto-memory note of the agent's own project: `<root>/projects/<project>/memory/<note>.md`.
`<root>` is `~/.claude` or `~/.paseo/zerosub/homes/<home>`. `<project>` is the Claude Code name for the agent working directory, for example `-Users-me-Code-app` for `/Users/me/Code/app`.
For an agent in a Paseo worktree, `<project>` can also be the name for the project root in the Paseo project registry. Claude Code keeps worktree memory under the main checkout.
The agent must be in a mode that allows edits, not plan mode. The path must contain no symlink, except a Paseo home `projects` link to `~/.claude/projects`.
An existing note must be a regular file with one link.
All other tools and approvals stay unchanged, including `send_agent_prompt`, terminal and browser tools, `kill_agent`, and `archive_workspace`.

The plugin logs each request that it does not approve to `~/.local/share/agent-toolkit/permission-log.jsonl`. It sets the log to mode 0600 and its directory to mode 0700.
Each line has the time, agent ID, provider, tool name, kind, and a short summary.
For file tools, the summary is the directory and the file extension, for example `/repo/src/*.ts`, never the file name. For shell commands, it is the program name, plus the subcommand for known tools such as `git push` or `npx playwright`. A command that starts with a quoted assignment is logged as `(unparsed)`.
MCP tools have no summary. The log does not contain command arguments, file contents, or edit strings.
When the log is larger than 1 MB, the plugin moves it to `permission-log.1.jsonl` and starts a new log.
To count the prompts by tool and by directory or command name, use this command:

```bash
jq -r '"\(.tool)\t\(.summary // "-" | split(" ")[0] | sub("/[^/]*$"; "/*"))"' ~/.local/share/agent-toolkit/permission-log.jsonl | sort | uniq -c | sort -rn | head -20
```

Verify `running` status with `paseo plugin ls`. Disable it with `paseo plugin disable agent-toolkit-paseo-tool-trust`.

## Permissions and sandbox

The installer keeps existing provider and host permissions. It adds no workspace scope, credential denies, or Git guards. Approval prompts are not an OS sandbox.
The [Claude sandbox guide](docs/claude-sandbox.md) gives settings that keep Git, `gh`, package managers, and tests working with the sandbox on.
`scripts/apply-claude-sandbox.sh` applies them from a trusted human terminal. Use `--off` to turn the sandbox off, and `--restore <backup>` to restore a backup.
A blocked command can be retried once outside the sandbox, with classifier review in auto mode. Production servers ask before `ssh`, `scp`, and `rsync`.
The script also adds deny rules for force pushes and `denyWrite` entries for the helpers and shell startup files. No command is excluded from the sandbox, and Docker goes through the escape.
It registers a `git push` hook. The hook runs `trufflehog` on the outgoing commits and blocks the push if it finds a secret. If `trufflehog` is missing, the hook warns and allows the push.

## Helper commands

Agents call the helpers by full path, for example `/Users/<name>/.local/bin/pg-test start`, as a separate call. The Claude sandbox blocks `pg-test start`, `agent-stop`, and `agent-awake`. The agent then retries the call with the reviewed escape.

### Keep the Mac awake

Run `agent-awake` before agent work and `agent-sleep` when finished (aliases `paseo-awake` and `paseo-sleep`). `agent-awake --status` shows the hold.
`agent-awake` installs the LaunchAgent `~/Library/LaunchAgents/com.agent-toolkit.awake.plist`, which runs `caffeinate -i` until `agent-sleep` removes it, also across restarts. The screen can still turn off.
`agent-display-off` turns off the displays after three seconds. It does not change the sleep settings or the hold.

### Heavy local checks

`agent-heavy` is a machine-wide semaphore for typechecks, linters, test suites, and builds:

```sh
agent-heavy -- pnpm run typecheck
```

It waits for a free slot without a time limit, then returns the exit code of the command. While it waits, it prints the slot holders to stderr every 30 seconds. If it cannot lock a slot, it warns and runs the command directly.

| Variable | Effect |
|---|---|
| `AGENT_HEAVY=0` | Run the command directly, without a slot. |
| `AGENT_HEAVY_SLOTS` | Number of slots. Default: the smaller of memory / 20 GiB and CPU count / 6, minimum 1. |
| `AGENT_HEAVY_DIR` | Lock directory. Default `$(getconf DARWIN_USER_TEMP_DIR)agent-heavy` on macOS, `${XDG_RUNTIME_DIR:-/tmp}/agent-heavy-<uid>` on Linux. |
| `AGENT_HEAVY_HELD` | Set to `1` for the command, so nested calls run directly. |
| `AGENT_HEAVY_WORKERS` | Set to CPU count / slots, minimum 1, to limit test runner workers. |

Do not add `agent-heavy` to `excludedCommands`, because it runs any command.

### Stop background processes

The Claude sandbox blocks signals to processes from earlier calls. Use `agent-stop <pid>` or `agent-stop --port <port>` through the escape. See [the sandbox guide](docs/claude-sandbox.md#stop-background-processes).

### Disposable PostgreSQL

From a human terminal:

```sh
pg-test start
pg-test start-migration
pg-test start-admin
pg-test status <id>
pg-test stop <id>
pg-test gc
```

All start modes create PostgreSQL 18 fixtures with IDs `pg18-…`. Homebrew PostgreSQL 18 must be installed. The helper never installs a server or targets an existing database.

| Profile | Fixture role permissions |
|---|---|
| `start` | Restricted `toolkit_test` database owner; no role creation or RLS bypass |
| `start-migration` | Same owner with `CREATEROLE`, without `BYPASSRLS` |
| `start-admin` | Same owner with `CREATEROLE` and `BYPASSRLS` |

Roles are never superusers. Use the returned URL only in the test process. Files stay under the session's temporary directory, so use the same root for `status` and `stop`.
`stop` removes the database files, socket, and log, and is safe to repeat. Garbage collection stops ownerless fixtures after two hours. Only a human terminal runs `gc`.
If PostgreSQL reports denied shared-memory initialization, use the native approval path or a trusted human terminal.

`pg18-fresh` runs an existing reviewed PostgreSQL 18 fresh-install inventory suite with Docker isolation, from the target repository. It takes no arguments and needs `pnpm@11.22.0`.
It installs dependencies in a networked container, then runs the source read-only without network. It builds from `postgres:18-bookworm` and `node:24-bookworm-slim`, which are not pinned digests.

### Paseo services

`paseo-service` records cross-workspace service pairs and resolves current ports when the consumer starts. See [service pairs](docs/paseo-worktrees.md#pair-services-across-repositories).

## Backups and update

To update from a trusted human terminal:

```sh
cd /Users/hendrik/Code/wewereyoung/agent-toolkit
./update.sh
```

The script needs a clean checkout. It fast-forwards from its upstream, runs checks, and installs copies. It does not update official host skills, provider CLIs, or user packages. The Toolkit never updates itself at startup.

`update.sh` has no `--preserve-permissions` option. To keep current provider permissions, use:

```sh
cd /Users/hendrik/Code/wewereyoung/agent-toolkit
git pull --ff-only --no-tags
npm ci --prefix shared --ignore-scripts --no-audit --no-fund
./verify.sh
./install.sh --preserve-permissions
```

Then run `./setup-paseo.sh` for profile changes (see [profile updates](docs/paseo-profiles.md#updates-and-customization)) and start fresh sessions.

### Preflight and conflicts

Stop active providers before installation. A read-only preflight stops before deployment when a resource, instruction block, or active Ponytail plugin has unclear ownership.
Do not clear a directory or the receipt to resolve a conflict. There is no blanket uninstall command.

If preflight names an active Ponytail registration, back up the file and disable only that registration. For Claude's default configuration:

```sh
cp -p ~/.claude/settings.json \
  ~/.claude/settings.json.before-toolkit-$(date +%Y%m%d-%H%M%S)
claude plugin disable ponytail@ponytail --scope user
```

For a custom `CLAUDE_CONFIG_DIR`, use the same override. For Codex, back up the `config.toml` named in the error and change only the existing registration:

```toml
[plugins."ponytail@ponytail"]
enabled = false
```

### Backups

Replaced configuration and instruction files go to `~/.local/share/agent-toolkit/backups/`. Keep them private. Restore single compared files, not a whole global configuration.
A crash or an existing lock needs manual inspection.

Older installs also copied the full resources folder into each backup, which can use many gigabytes. To find these copies, run:

```sh
ls -d ~/.local/share/agent-toolkit/backups/*/.local/share/agent-toolkit/resources
```

Remove each listed folder that you do not need. Keep the other files in each backup folder, because they can hold your original settings.

### Remove AutoReview leftovers

Remove the former AutoReview output directory by hand:

1. Run `ls -ld ~/.claude/autoreview-out ~/.paseo/zerosub/homes/*/autoreview-out`.
2. Remove each Paseo home link that points to `~/.claude/autoreview-out`. Then remove `~/.claude/autoreview-out`.
3. Keep all other entries.

### Pins

| Resource | Pin |
|---|---|
| Ponytail skill family (four skills) | Upstream v5.3.3, revision `7801d061243d7b753bad0e0b3c057cd250b11755`, vendored without hooks |
| React | [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) `react-best-practices` at revision `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`, MIT, automatic for React and Next.js work. Local changes are in `skills/react/NOTICE.md`. |
| React Doctor | `npx react-doctor@0.9.23`, manual only |
| Security Audit | [`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill) revision `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, MIT, manual only |
| Installer configuration parsers | `smol-toml@1.9.0`, `jsonc-parser@3.3.1`, locked in `shared/` |

Other vendored skills keep their revisions and licenses beside the skill. Change pins in source, run the checks, then install again.

## Verification and limits

```sh
./verify.sh
```

Fixture checks cover installation, preservation of settings and accounts, Paseo setup, refusal of unclear ownership, backups, and PostgreSQL lifecycle. They substitute downloads, PostgreSQL processes, and Paseo persistence.
They do not prove a provider security boundary, model adherence, a live review, live Paseo CLI support, or real Docker and PostgreSQL startup. Use [Toolkit acceptance](docs/toolkit-acceptance.md) in fresh sessions for these.
`~/Code/.agent-toolkit-scratch` is a legacy location that some project scripts still use.

## Layout

| Path | Contents |
|---|---|
| `skills/` | Shared skill collection |
| `shared/AGENTS.md`, `shared/hosts/` | Startup guidance and Paseo instructions |
| `shared/install.cjs` | Installation |
| `setup-paseo.sh`, `shared/paseo-setup.cjs` | Paseo profile, System Prompt, and tool trust setup |
| `paseo/tool-trust/` | Paseo tool trust plugin |
| `shared/postgres/` | PostgreSQL helpers |
| `shared/agent-heavy.pl`, `shared/agent-stop.pl` | Heavy-check limit and background process stop |
| `docs/` | Sandbox, code review, Paseo profile, worktree, and acceptance guides |
| `paseo/tool-approvals/` | Unrelated work; not managed by Toolkit |
