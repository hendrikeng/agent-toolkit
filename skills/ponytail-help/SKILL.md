---
name: ponytail-help
description: >
  Show the Ponytail modes, shared skills, invocation syntax, and Toolkit update
  workflow. Use when the user asks for Ponytail help, commands, or how to use
  Ponytail. One-shot reference; does not change the active mode.
license: MIT
---

# Ponytail Help

Show this reference when requested. Do not change the active mode or write configuration files.

## Modes

| Mode | Behavior |
|---|---|
| Lite | Build the requested solution and name a simpler alternative. |
| Full | Prefer YAGNI, existing code, stdlib, native features, and the smallest correct implementation. Default for coding tasks. |
| Ultra | Prefer deletion and challenge unnecessary requirements. |

A selected mode stays active until the user changes it or the session ends.

## Shared skills

| Skill | Purpose |
|---|---|
| `ponytail` | Simplest correct coding solution. Accepts `lite`, `full`, or `ultra`. |
| `ponytail-review` | Over-engineering review of a diff. Reports findings without edits. |
| `ponytail-audit` | Whole-repository complexity audit. Ranks possible deletions without edits. |
| `ponytail-debt` | Report `ponytail:` shortcut markers and their revisit conditions. |
| `ponytail-help` | This reference. |

Only Ponytail Review participates in the Toolkit's automatic complexity-review gate.
Audit, Debt, and Help require an explicit request.
The shared review policy still applies; finishing an edit does not trigger a review.

## Native invocation

Use the provider's supported skill syntax:

| Provider | Mode selection | Help |
|---|---|---|
| Codex | `$ponytail full` | `$ponytail-help` |
| Claude Code | `/ponytail full` | `/ponytail-help` |
| Pi | `/skill:ponytail full` | `/skill:ponytail-help` |

Replace `ponytail-help` with another skill name for its explicit invocation.
Natural-language requests also work through skill descriptions and startup guidance.
Say "stop ponytail" or "normal mode" to deactivate the coding mode.
Select a mode through the native skill command to resume it.

## Defaults and updates

Toolkit startup guidance defaults to full mode for coding tasks.
Set a preferred mode in your own provider or repository instructions, or select it in the session.
There is no Toolkit dependency on `PONYTAIL_DEFAULT_MODE`, Ponytail plugin configuration, or executable hooks.

From a trusted human terminal, run `./update.sh` in the Toolkit checkout.
It requires a clean checkout, pulls Toolkit updates, verifies them, and installs copied resources.
For local source changes, run `./verify.sh` and `./install.sh` instead.
Then start fresh provider sessions.
Upstream skill versions change through reviewed Toolkit source updates, not plugin auto-updates.

These shared skills work through normal providers in Orca, native Paseo, or a terminal.
Pi's `/side` interface requires its terminal UI; shared Ponytail skills do not.

Upstream project: https://github.com/DietrichGebert/ponytail
