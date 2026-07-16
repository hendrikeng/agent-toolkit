# Agent Toolkit

Personal, version-controlled tooling and shared configuration for Claude Code, Codex, and Pi.

## Included

- `codex/skills/autoreview` — structured multi-engine code review helper. Codex defaults to `gpt-5.6-sol` with high reasoning and an access-only fallback to `gpt-5.6-terra`.
- `codex/skills/handoff` — portable, clipboard-ready context transfer for another agent; also loaded by Pi as `/skill:handoff`.
- `pi/extensions/codex-goal` — lean Codex-style `/goal` workflow for Pi with persisted state, continuation, pause/resume/edit/clear, and optional token budgets.
- `pi/extensions/figma-mcp` — token-efficient, opt-in access to Figma's local and remote MCP endpoints through one compact Pi tool.
- `shared/ponytail` — shared `full`-mode configuration plus the tested Pi package version for [Ponytail](https://github.com/DietrichGebert/ponytail). Ponytail remains an upstream dependency and is not vendored here.

## Install

```bash
./install.sh
```

The installer installs pinned npm dependencies for `figma-mcp`, installs Ponytail through each available host's native package manager, and creates these symlinks:

```text
~/.codex/skills/autoreview             -> codex/skills/autoreview
~/.codex/skills/handoff                -> codex/skills/handoff
~/.pi/agent/skills/handoff             -> codex/skills/handoff
~/.pi/agent/extensions/codex-goal      -> pi/extensions/codex-goal
~/.pi/agent/extensions/figma-mcp       -> pi/extensions/figma-mcp
<config-dir>/ponytail/config.json        -> shared/ponytail/config.json
```

Unavailable agent CLIs are skipped. The Ponytail config follows `XDG_CONFIG_HOME` when set. Pi's Ponytail package is pinned to the version in `shared/ponytail/VERSION`; Claude and Codex use their native Ponytail marketplaces. Existing non-symlink installations are moved to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

Run `/reload` in an already-running Pi session after installation or updates. Codex asks you to review and trust Ponytail's lifecycle hooks on first start; use `/hooks` if needed. New sessions start in `full` mode.

## Verification

```bash
./verify.sh
```

This runs the autoreview self-tests, goal unit tests, checks that Pi loads the extensions, verifies automatic command discovery through Pi RPC, and confirms Ponytail is installed in each available host with the shared configuration.

## Updating

Edit the repository copies directly. The installed paths are symlinks, so changes are immediately reflected on disk; use `/reload` in Pi when needed. To update Pi's Ponytail pin, change `shared/ponytail/VERSION` to a reviewed upstream release and rerun `./install.sh`.

## Licensing and attribution

The goal extension carries its own `LICENSE` and `NOTICE.md`, including attribution for prompt templates ported from OpenAI Codex. The handoff skill includes its upstream MIT license and revision attribution. The Figma integration has a component `NOTICE.md`; its npm dependencies are not vendored and retain their upstream licenses. See component files for applicable notices.
