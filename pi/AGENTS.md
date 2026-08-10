# Pi defaults

## Risk-gated review closeout

Do not run `autoreview` or `ponytail-review` merely because code was edited or a task is ending.

When the user asks Pi to commit, push, open or update a PR, merge, or ship, evaluate the current change bundle once:

1. Inspect the relevant staged, unstaged, or branch diff and run the smallest focused deterministic checks.
2. Run `ponytail-review` only when the diff adds a dependency, abstraction or layer, configurable surface, or at least 150 changed non-test, non-doc lines.
3. Run `autoreview` only when the diff affects authentication, security or secret handling, money or persisted data, schemas or migrations, concurrency, a public API or protocol, installation or upgrades, release machinery, or at least 200 changed non-test, non-doc lines.
4. Skip both reviews when no trigger applies. Do not rerun a review for an unchanged change bundle at later commit, push, or PR steps.
5. Treat findings as advisory, verify them in the real code, and keep fixes inside the original task scope. If a review changes code, rerun the affected checks and that review.

A session-level `reviews:off` instruction is an explicit user override: skip automatic AI reviews at every boundary until that session returns to `reviews:auto`. Do not replace skipped reviews with broader tests.

Load and follow the named skill when a review is triggered. If it is unavailable, report that briefly instead of substituting another reviewer. Git hooks should remain limited to fast deterministic checks; never install an AI review as a commit or push hook.
