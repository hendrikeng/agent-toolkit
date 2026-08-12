# Agent Toolkit

Personal, version-controlled tooling and shared configuration for Claude Code, Codex, and Pi.

## Included

- `codex/skills/autoreview` — structured multi-engine code review helper. Codex defaults to `gpt-5.6-sol` with high reasoning and an access-only fallback to `gpt-5.6-terra`.
- `codex/skills/handoff` — portable, clipboard-ready context transfer for another agent; also loaded by Pi as `/skill:handoff`.
- `pi/AGENTS.md` — automatic, risk-gated Pi review policy at commit/PR/ship boundaries; ordinary task closeout uses focused checks only.
- `pi/extensions/codex-account` — switches future Codex subprocesses between the `tracn` and `private` account homes without restarting Pi.
- `pi/extensions/codex-goal` — lean Codex-style `/goal` workflow for Pi with persisted state, continuation, pause/resume/edit/clear, and optional token budgets.
- `pi/extensions/figma-mcp` — lazy access to Figma Desktop's MCP server through one compact loader and one compact Pi tool; unsupported remote OAuth is not advertised.
- `pi/extensions/git-push` — provides an interactive user-only `/push` command while unattended agent-issued pushes remain blocked.
- `pi/extensions/orca-permission-bell` — bridges Pi permission dialogs to Orca's native terminal-bell notifications when Pi runs inside an Orca pane.
- `pi/extensions/review-mode` — provides a persistent per-session `/reviews auto|off` override with visible status and system-prompt enforcement.
- `pi/extensions/simple-english` — bundles the vendored SimpleEnglish skill and provides Pi's `/simple-english` check and rewrite options.
- `pi/extensions/web-access-gate` — keeps `pi-web-access` behind one compact loader; full search/fetch schemas load only when the model or `/web on` enables them.
- `pi/skills/react-doctor` — manual-only, telemetry-free React diagnostics using pinned `react-doctor@0.7.8`.
- `pi/skills/fastify` — shared Fastify guidance for Claude Code, Codex, and Pi, vendored from Fastify lead maintainer Matteo Collina's MIT-licensed skill at a recorded revision.
- `pi/skills/vue` — shared on-demand Vue 3 guidance for Claude Code, Codex, and Pi, vendored from Anthony Fu's MIT-licensed skill at a recorded revision.
- `shared/ponytail` — shared `full`-mode configuration plus the tested Pi package version for [Ponytail](https://github.com/DietrichGebert/ponytail). Ponytail remains an upstream dependency and is not vendored here.
- `shared/pi-web-access` — safe defaults for a raw-result workflow with browser-cookie access disabled for pinned `pi-web-access@0.13.0`.
- `shared/agent-safety` — workspace sandboxes, blocks for common irreversible commands, and opt-in `*-yolo` launchers across Claude Code, Codex, and Pi; Pi uses pinned `@gotgenes/pi-permission-system@20.7.3`.

## Install

```bash
./install.sh
```

The installer installs pinned toolkit dependencies, installs Ponytail through each available host's native package manager, installs `pi-web-access` with its bundled skill filtered out, configures agent safety without replacing user-owned settings, and creates these symlinks:

```text
~/.codex/skills/autoreview             -> codex/skills/autoreview
~/.codex/skills/handoff                -> codex/skills/handoff
~/.codex/skills/fastify                -> pi/skills/fastify
~/.codex/skills/simple-english         -> pi/extensions/simple-english
~/.codex/skills/vue                    -> pi/skills/vue
~/.claude/skills/fastify               -> pi/skills/fastify
~/.claude/skills/simple-english        -> pi/extensions/simple-english
~/.claude/skills/vue                   -> pi/skills/vue
~/.pi/agent/AGENTS.md                  -> pi/AGENTS.md
~/.pi/agent/skills/autoreview          -> codex/skills/autoreview
~/.pi/agent/skills/handoff             -> codex/skills/handoff
~/.pi/agent/extensions/codex-account   -> pi/extensions/codex-account
~/.pi/agent/extensions/codex-goal      -> pi/extensions/codex-goal
~/.pi/agent/extensions/figma-mcp       -> pi/extensions/figma-mcp
~/.pi/agent/extensions/git-push        -> pi/extensions/git-push
~/.pi/agent/extensions/orca-permission-bell -> pi/extensions/orca-permission-bell
~/.pi/agent/extensions/review-mode    -> pi/extensions/review-mode
~/.pi/agent/extensions/simple-english -> pi/extensions/simple-english
~/.pi/agent/extensions/web-access-gate -> pi/extensions/web-access-gate
~/.pi/agent/skills/react-doctor        -> pi/skills/react-doctor
~/.pi/agent/skills/fastify             -> pi/skills/fastify
~/.pi/agent/skills/vue                 -> pi/skills/vue
<config-dir>/ponytail/config.json       -> shared/ponytail/config.json
```

Safety policies are installed as managed `0600` copies under `~/.codex/rules/agent-safety.rules` and `~/.pi/agent/extensions/pi-permission-system/config.json`. The three `~/.local/bin/*-yolo` launchers and Codex's `~/.local/libexec/agent-toolkit/git` guard are managed `0700` copies. None are workspace-writable symlinks. The installer refuses to replace modified or user-managed policy files. Codex permission profiles and uncommon TOML forms are also refused rather than rewritten unsafely; configure those profiles directly.

Pi's `web-search.json` is a user-owned `0600` file rather than a symlink: installation merges the managed safe defaults while preserving existing API keys. A custom `PI_CODING_AGENT_DIR` must be an absolute path because the web package does not expand a literal `~`. Unavailable agent CLIs are skipped. The Ponytail config follows `XDG_CONFIG_HOME` when set. Pi's Ponytail package is pinned to the version in `shared/ponytail/VERSION`; Claude and Codex use their native Ponytail marketplaces. Existing non-symlink installations are moved to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

Run `/reload` in an already-running Pi session after installation or updates. If installation from inside `pi-yolo` adds a new resource, restart that session because its temporary resource tree was created at launch. Codex asks you to review and trust Ponytail's lifecycle hooks on first start; use `/hooks` if needed. New sessions start in `full` mode.

## Usage manual

After `./install.sh`, skills are discovered automatically when a task matches and extensions load when their host starts. Use the commands below only to force a skill, change a mode, or enable an opt-in integration.

### Agent safety

Claude Code and Codex use their native workspace sandboxes; Pi uses `pi-permission-system` as a best-effort command and path gate. Common irreversible command forms such as `rm`, `git clean`, and `git reset --hard` are denied rather than approval-gated. Trusted development roots (`~/Code`, `~/orca/workspaces`) are available without repeated cross-repository prompts, while configured credential, private-key, and environment-file paths remain denied or gated.

For an unattended session, launch `pi-yolo`, `codex-yolo`, or `claude-yolo`. These suppress ordinary approval prompts but keep the toolkit's blocks for destructive commands and unattended Git. `claude-yolo` disables Claude's filesystem isolation; its Bash network sandbox and full-escape block remain active. Use Claude's browser or computer-use tools instead of launching desktop apps from Bash. `codex-yolo` keeps Codex's workspace sandbox and does **not** use danger-full-access mode. Pi gets an ephemeral yolo config and retains read access to managed package resources and pasted clipboard images without opening the complete temp directory or managed agent tree. The launcher also preserves the persistent Pi configuration paths, so installer changes made inside `pi-yolo` survive a restart. Ensure `~/.local/bin` is on `PATH`.

In interactive Pi, `/push` is the only yolo-safe push path. It accepts no arguments and starts the normal risk-gated closeout; after that succeeds, a temporary tool previews the clean current branch's exact commit, single configured SSH push URL, outgoing commits, and upstream before requiring confirmation. It refuses detached, dirty, behind, or untracked branches and performs one non-force current-branch push with extra tags, submodules, and pre-push hooks disabled. The command refuses non-interactive Pi modes; ordinary agent-issued `git push` remains blocked.

Inside Orca, ordinary Pi permission dialogs emit a terminal bell so Orca can show its native attention notification; Orca's Terminal Bell notification setting must remain enabled. Pi project-local permission configuration is trusted and can override its global policy, so use trusted projects or an OS/container sandbox when Pi needs a hard boundary. Keep irreplaceable untracked data outside agent worktrees or in versioned backups: these controls reduce accidents but do not replace backups.

### Shared and cross-agent tools

#### Ponytail (Claude Code, Codex, Pi)

Ponytail is active for coding tasks in `full` mode in every new session.

| Action | Claude Code / Pi | Codex |
|---|---|---|
| Change mode | `/ponytail lite`, `/ponytail full`, `/ponytail ultra` | `@ponytail lite`, `@ponytail full`, `@ponytail ultra` |
| Disable | `/ponytail off` or say “normal mode” | `@ponytail off` or say “normal mode” |
| Diff over-engineering review | `/ponytail-review` | `@ponytail-review` |
| Whole-repo over-engineering audit | `/ponytail-audit` | `@ponytail-audit` |
| List deferred `ponytail:` shortcuts | `/ponytail-debt` | `@ponytail-debt` |
| Show the benchmark scoreboard | `/ponytail-gain` | `@ponytail-gain` |
| Show command help | `/ponytail-help` | `@ponytail-help` |

The shared config sets the default to `full`; `PONYTAIL_DEFAULT_MODE` can override it with `lite`, `full`, `ultra`, or `off`. Codex may require approving Ponytail's lifecycle hooks through `/hooks` after installation. In Pi, `ponytail-review` remains a separate one-shot review and is invoked automatically only by the risk-gated closeout policy described below.

#### Autoreview (Codex skill, multiple review engines)

Ask for “autoreview” or invoke `@autoreview` for an explicit second-model review. Pi also invokes it automatically at commit/PR/ship boundaries only for security-sensitive, data, migration, concurrency, public-contract, install/release, or large changes. It does not run merely because editing finished. Autoreview uses Codex by default and can use Claude, Pi, Droid, Copilot, Cursor, or OpenCode when requested.

Direct helper examples:

```bash
~/.codex/skills/autoreview/scripts/autoreview --mode local
~/.codex/skills/autoreview/scripts/autoreview --mode branch --base origin/main
~/.codex/skills/autoreview/scripts/autoreview --mode commit --commit HEAD
```

Add `--engine claude` for one alternate reviewer or `--reviewers codex,claude` for an opt-in panel. Treat findings as advisory, verify accepted findings in the real code, and rerun after review-driven edits. See [`codex/skills/autoreview/SKILL.md`](codex/skills/autoreview/SKILL.md) for all engines and options.

#### Handoff (Codex and Pi)

Use `@handoff <task>` in Codex or `/skill:handoff <task>` in Pi. The skill gathers portable context, writes a standalone prompt for another agent, and copies it to the clipboard. Ask it to print the full prompt when needed.

### Pi tools

Pi skills load on matching tasks; `/skill:<name>` forces one. Pi extensions below load automatically, but web and Figma keep their larger schemas disabled until needed.

#### Codex accounts

Log into each isolated Codex account home once:

```bash
CODEX_HOME="$HOME/.codex-accounts/tracn" codex login
CODEX_HOME="$HOME/.codex-accounts/private" codex login
```

Then switch the account inherited by future Codex subprocesses without leaving Pi:

```text
/codex-account tracn
/codex-account private
```

Running `/codex-account` without an argument opens a selector. Existing Codex processes keep their current account.

#### Risk-gated review closeout

When Pi is asked to commit, push, open or update a PR, merge, or ship, the global `AGENTS.md` policy inspects the current change bundle and runs focused deterministic checks. It adds `ponytail-review` only for dependency, abstraction, configurable-surface, or 150+ non-test/non-doc-line changes. It adds autoreview only for sensitive contracts and data paths, release/install work, or 200+ non-test/non-doc-line changes. Unchanged bundles are not reviewed again at each later Git step.

No AI review is installed as a Git hook. Hooks should stay fast and deterministic, and ordinary editing closeout should not trigger either review. Run `/ponytail-review` or `/skill:autoreview` manually whenever you want to override the automatic gate.

`/reviews auto` is the default. It actively prevents AI review on questions, investigation, ordinary edits, test success, or task completion, then considers one review only when the user explicitly asks to commit, push, open or update a PR, merge, or ship and the risk gate applies. Explicit review requests always run.

Use `/reviews off` to disable even those automatic boundary reviews for the current Pi session. The mode survives resume, reload, compaction, and branch navigation; `reviews:off` remains visible in the footer. Use `/reviews auto` to restore the risk-gated default, or `/reviews` to show the current mode. Review-off mode keeps the smallest directly relevant deterministic checks but must not compensate by running broad test suites.

#### Fastify

Ask for work normally in a repository that depends on Fastify; no activation is required. Claude Code, Codex, and Pi load the Fastify guidance when the repository or task matches. Force it with `/fastify` in Claude Code, `@fastify` in Codex, or `/skill:fastify` in Pi. This is guidance, not a scanner.

#### Vue

Ask for Vue work normally; no activation is required. Claude Code, Codex, and Pi load the Vue 3 guidance when the task matches. Force it with `/vue` in Claude Code, `@vue` in Codex, or `/skill:vue` in Pi. This is guidance, not a scanner.

#### Simple English

Simple English is manual-only, so it does not change normal responses. In Pi, run `/simple-english` to select an action and target, or provide them directly:

```text
/simple-english check README.md
/simple-english rewrite README.md
/simple-english rewrite README.md strict
```

`check` reports findings without editing files. `rewrite` uses pragmatic mode by default. Use strict mode only when you need ASD-STE100-style compliance. In Codex, use `@simple-english`; in Claude, use `/simple-english`.

#### React Doctor

Normal React work needs no toolkit activation. React Doctor is an optional scanner for health checks or meaningful pre-ship reviews:

```text
/skill:react-doctor changed  # new issues versus the detected base
/skill:react-doctor lines    # issues touching changed lines only
/skill:react-doctor full     # complete project
```

It is intentionally manual-only and should not run after every small edit.

#### Goals

```text
/goal <objective>  Start and immediately pursue a goal
/goal              Show status and usage
/goal edit         Edit the objective
/goal pause        Pause it
/goal resume       Resume it
/goal clear        Clear it
```

Goal state persists in the current Pi session and active goals continue automatically after Pi settles. The model uses `get_goal`, `create_goal`, and `update_goal` behind these commands.

#### Web access

The model can call the compact `enable_web_access` loader when current information, external docs, or URL content is needed. Manual controls:

```text
/web on
/web off
/web status
```

Enabling it exposes `web_search`, `fetch_content`, and `get_search_content`. Browser-cookie access stays disabled and `/web off` returns to the schema-light loader.

#### Figma Desktop

For a Figma task, the model can call `enable_figma`, or use:

```text
/figma on
/figma status
/figma tools
/figma off
```

Open Figma Desktop and enable its local MCP server first. Once enabled, the model uses `figma_mcp` for common `inspect`, `screenshot`, `variables`, `metadata`, and `figjam` reads, plus catalog/schema/call and resource access. This integration is for local read workflows; use native Codex CLI for remote/write access while Figma restricts remote OAuth to approved clients.

Run `/reload` after editing existing toolkit resources. Restart `pi-yolo` when installation adds a new resource. DeepSec remains project-local and is not installed globally.

## Verification

```bash
./verify.sh
```

This runs the autoreview self-tests, extension and skill checks, verifies automatic command discovery through Pi RPC, and confirms agent-safety policies plus pinned Ponytail and web-access package configuration.

## Updating

Edit the repository copies directly. The installed paths are symlinks, so changes are immediately reflected on disk; use `/reload` in Pi when needed. To update Pi's Ponytail pin, change `shared/ponytail/VERSION` to a reviewed upstream release and rerun `./install.sh`.

## Licensing and attribution

The goal extension carries its own `LICENSE` and `NOTICE.md`, including attribution for prompt templates ported from OpenAI Codex. The Fastify, handoff, Simple English, and Vue skills include their upstream licenses and revision attribution. The Figma integration has a component `NOTICE.md`; npm dependencies, including React Doctor and Pi Web Access, are not vendored and retain their upstream licenses. See component files for applicable notices.
