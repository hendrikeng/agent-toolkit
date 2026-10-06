# Upstream source

Source: [openclaw/agent-skills](https://github.com/openclaw/agent-skills/tree/711711b86294673feced9d1cb636b539daf3c218/skills/autoreview).

Pinned revision: `711711b86294673feced9d1cb636b539daf3c218`.

The helper, test harness, regression tests, and fixtures come from this revision.
The upstream maintenance instructions are not included. Toolkit maintains this adapted copy.

## Local differences

- Codex defaults to `gpt-6.1-sol` with high reasoning. Account-access failures can retry once with `gpt-5.6-sol` only without a model override.
- Explicit CLI and environment model choices disable that retry, including an explicit selection of the default model. The existing override regression covers these choices.
- The default threshold is P2, not P0. P3 findings remain in the audit output.
- The skill retains Toolkit's risk gates and scope limits.
- Default-value tests cover these settings.
- Output arguments use the expanded, resolved paths checked before review. A regression check covers `~` paths for all three reports.
- Recursive submodule snapshots keep the original checkout as the executable/environment trust anchor. Native `git -C` selects the child directory; a regression check rejects parent-checkout Git execution.

Other explicit CLI arguments and environment overrides retain their upstream behavior.

## Compatibility

This version supports Codex, Claude, Amp, Pi, and Kimi. Upstream removed Droid,
Copilot, Cursor, OpenCode, panels, and the `--self-test` entry point.

AutoReview does not invoke TruffleHog. Secret findings occur after the review
bundle reaches the provider. Python 3.11 or `tomli` is required for optional
inference-route projection and Kimi configuration.

The Toolkit verification script runs deterministic tests instead of `--self-test`.
A live model call is not part of those tests.
