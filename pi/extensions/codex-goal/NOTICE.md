# Attribution

This extension is an independent TypeScript port of the OpenAI Codex `/goal`
feature for the Pi coding agent.

The prompt templates in `prompts/` are copied from OpenAI Codex CLI
`rust-v0.144.1` (commit `44918ea10c0f99151c6710411b4322c2f5c96bea`):

- `codex-rs/ext/goal/templates/goals/continuation.md`
- `codex-rs/ext/goal/templates/goals/objective_updated.md`
- `codex-rs/ext/goal/templates/goals/budget_limit.md`

The command grammar, tool contracts, status model, persistence behavior, and
continuation lifecycle are adapted from the same release. Changes include using
Pi session custom entries instead of Codex SQLite state and Pi extension APIs
instead of Codex's Rust extension/runtime APIs.

OpenAI Codex is licensed under the Apache License 2.0. A copy is included in
`LICENSE`. This extension is not affiliated with or endorsed by OpenAI.
