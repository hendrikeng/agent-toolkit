# Agent Toolkit

Personal, version-controlled tooling for Codex and Pi.

## Included

- `codex/skills/autoreview` — structured multi-engine code review helper. Codex defaults to `gpt-5.6-sol` with high reasoning and an access-only fallback to `gpt-5.6-terra`.
- `pi/extensions/codex-goal` — lean Codex-style `/goal` workflow for Pi with persisted state, continuation, pause/resume/edit/clear, and optional token budgets.
- `pi/extensions/figma-mcp` — token-efficient, opt-in access to Figma's local and remote MCP endpoints through one compact Pi tool.

## Install

```bash
./install.sh
```

The installer installs pinned npm dependencies for `figma-mcp` and creates these symlinks:

```text
~/.codex/skills/autoreview             -> codex/skills/autoreview
~/.pi/agent/extensions/codex-goal      -> pi/extensions/codex-goal
~/.pi/agent/extensions/figma-mcp       -> pi/extensions/figma-mcp
```

Existing non-symlink installations are moved to timestamped backups under `~/.local/share/agent-toolkit/backups/`. Run `/reload` in an already-running Pi session after installation or updates.

## Verification

```bash
./verify.sh
```

This runs the autoreview self-tests, goal unit tests, checks that Pi loads the extension, and verifies automatic `/goal` discovery through Pi RPC.

## Updating

Edit the repository copies directly. The installed paths are symlinks, so changes are immediately reflected on disk; use `/reload` in Pi when needed.

## Licensing and attribution

The goal extension carries its own `LICENSE` and `NOTICE.md`, including attribution for prompt templates ported from OpenAI Codex. The Figma integration has a component `NOTICE.md`; its npm dependencies are not vendored and retain their upstream licenses. See component files for applicable notices.
