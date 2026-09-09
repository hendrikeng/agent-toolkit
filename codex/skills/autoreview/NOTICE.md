# Upstream source

Source: [openclaw/agent-skills](https://github.com/openclaw/agent-skills/tree/1a1b2c457857e01202da4d4b6a10890af2706aea/skills/autoreview).

Pinned revision: `1a1b2c457857e01202da4d4b6a10890af2706aea`.

The helper, test harness, regression tests, and fixtures come from this revision.
The upstream maintenance instructions are not included. Toolkit maintains this adapted copy.

## Local differences

- Codex defaults to `gpt-6-astra` with medium reasoning. Account-access failures can retry once with `gpt-5.6-sol`.
- The default threshold is P2, not P0. P3 findings remain in the audit output.
- The skill retains Toolkit's risk gates and scope limits.
- Repository discovery preserves Git errors, including guard denials, instead of reporting that the repository is missing.
- Default-value tests cover these settings. Inference-route tests use the selected model and fallback instead of fixed upstream model names.

- Pi sessions use a dedicated, read-authorized results directory. The helper supplies unique default output paths and checks policy and filesystem access before launch.
- In Pi, explicit output paths must stay inside `AGENT_TOOLKIT_REVIEW_ROOT`. Other launchers retain the upstream output behavior.

Other explicit CLI arguments and environment overrides retain their upstream behavior.

## Compatibility

This version supports Codex, Claude, Amp, Pi, and Kimi. Upstream removed Droid,
Copilot, Cursor, OpenCode, panels, and the `--self-test` entry point.

TruffleHog is required for real reviews. Missing or failed scanning blocks the
review. Python 3.11 or `tomli` is required for optional inference-route projection
and Kimi configuration. No extra dependency is needed for the default auth-only parser.

The Toolkit verification script runs deterministic tests instead of `--self-test`.
A live model call is not part of those tests.
