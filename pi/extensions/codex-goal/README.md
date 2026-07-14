# Codex Goal for Pi

A lean Pi extension port of Codex CLI's `/goal` workflow.

## Commands

```text
/goal <objective>  Set and immediately pursue a goal
/goal              Show status and usage
/goal edit         Edit the current objective
/goal pause        Pause an active goal
/goal resume       Resume a paused, blocked, or usage-limited goal
/goal clear        Clear the current goal
```

## Agent tools

- `get_goal`
- `create_goal`
- `update_goal` (`complete` or strict `blocked` only)

## Behavior

- Goal state is branch-aware and persisted in the current Pi session.
- Active goals automatically continue after Pi settles.
- Escape/abort pauses an active goal.
- Optional token budgets are available through `create_goal` when explicitly
  requested.
- The footer shows live status and usage.
- There is deliberately no separate auditor agent, task system, Sisyphus mode,
  or project-wide goal pool.

Run `/reload` after editing the extension. See `NOTICE.md` and `LICENSE` for
Codex attribution and license terms.
