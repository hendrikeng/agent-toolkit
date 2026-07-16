# Agent Toolkit

Personal, version-controlled tooling and shared configuration for Claude Code, Codex, and Pi.

## Included

- `codex/skills/autoreview` — structured multi-engine code review helper. Codex defaults to `gpt-5.6-sol` with high reasoning and an access-only fallback to `gpt-5.6-terra`.
- `codex/skills/handoff` — portable, clipboard-ready context transfer for another agent; also loaded by Pi as `/skill:handoff`.
- `pi/extensions/codex-goal` — lean Codex-style `/goal` workflow for Pi with persisted state, continuation, pause/resume/edit/clear, and optional token budgets.
- `pi/extensions/figma-mcp` — token-efficient, opt-in access to Figma's local and remote MCP endpoints through one compact Pi tool.
- `pi/extensions/web-access-gate` — keeps `pi-web-access` behind one compact loader; full search/fetch schemas load only when the model or `/web on` enables them.
- `pi/skills/react-doctor` — manual-only, telemetry-free React diagnostics using pinned `react-doctor@0.7.8`.
- `pi/skills/vue` — on-demand Vue 3 guidance vendored from Anthony Fu's MIT-licensed skill at a recorded revision.
- `shared/ponytail` — shared `full`-mode configuration plus the tested Pi package version for [Ponytail](https://github.com/DietrichGebert/ponytail). Ponytail remains an upstream dependency and is not vendored here.
- `shared/pi-web-access` — safe defaults for a raw-result workflow with browser-cookie access disabled for pinned `pi-web-access@0.13.0`.

## Install

```bash
./install.sh
```

The installer installs pinned toolkit dependencies, installs Ponytail through each available host's native package manager, installs `pi-web-access` with its bundled skill filtered out, and creates these symlinks:

```text
~/.codex/skills/autoreview             -> codex/skills/autoreview
~/.codex/skills/handoff                -> codex/skills/handoff
~/.pi/agent/skills/handoff             -> codex/skills/handoff
~/.pi/agent/extensions/codex-goal      -> pi/extensions/codex-goal
~/.pi/agent/extensions/figma-mcp       -> pi/extensions/figma-mcp
~/.pi/agent/extensions/web-access-gate -> pi/extensions/web-access-gate
~/.pi/agent/skills/react-doctor        -> pi/skills/react-doctor
~/.pi/agent/skills/vue                 -> pi/skills/vue
<config-dir>/ponytail/config.json       -> shared/ponytail/config.json
```

Pi's `web-search.json` is a user-owned `0600` file rather than a symlink: installation merges the managed safe defaults while preserving existing API keys. A custom `PI_CODING_AGENT_DIR` must be an absolute path because the web package does not expand a literal `~`. Unavailable agent CLIs are skipped. The Ponytail config follows `XDG_CONFIG_HOME` when set. Pi's Ponytail package is pinned to the version in `shared/ponytail/VERSION`; Claude and Codex use their native Ponytail marketplaces. Existing non-symlink installations are moved to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

Run `/reload` in an already-running Pi session after installation or updates. Codex asks you to review and trust Ponytail's lifecycle hooks on first start; use `/hooks` if needed. New sessions start in `full` mode.

## Pi usage

- Web access starts schema-light. The model can call `enable_web_access`, or use `/web on`; `/web off` removes the full schemas again.
- Run React Doctor manually with `/skill:react-doctor`, then follow its changed/full scan instructions.
- Vue guidance loads only for matching Vue tasks and does not execute a scanner.
- DeepSec remains project-local and is not installed globally.

## Verification

```bash
./verify.sh
```

This runs the autoreview self-tests, extension and skill checks, verifies automatic command discovery through Pi RPC, and confirms pinned Ponytail and web-access package configuration.

## Updating

Edit the repository copies directly. The installed paths are symlinks, so changes are immediately reflected on disk; use `/reload` in Pi when needed. To update Pi's Ponytail pin, change `shared/ponytail/VERSION` to a reviewed upstream release and rerun `./install.sh`.

## Licensing and attribution

The goal extension carries its own `LICENSE` and `NOTICE.md`, including attribution for prompt templates ported from OpenAI Codex. The handoff and Vue skills include their upstream licenses and revision attribution. The Figma integration has a component `NOTICE.md`; npm dependencies, including React Doctor and Pi Web Access, are not vendored and retain their upstream licenses. See component files for applicable notices.
