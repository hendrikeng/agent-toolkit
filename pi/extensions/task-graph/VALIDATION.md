# Graph permission validation

## Current contract

The source uses graph record version 4 with `development-roots-v1`.
Older approvals do not get new authority.

The graph uses `pi-yolo` workers for independent ready tasks.
Each writing worker gets an exclusive lane.
The approved worktree budget includes integration worktrees and writing lanes.
A clean lane returns to the pool after its commit is integrated, integration setup runs, and the combined checkout passes validation.
A failed combined validation keeps the lane and receives an in-scope repair dispatch without another approval.
A dirty or interrupted lane stays intact.
Closeout removes only clean integrated lanes and keeps the integration worktree.
Read-only workers use an existing checkout.

## Source checks

The focused tests use real Git repositories in `AGENT_TOOLKIT_SCRATCH_ROOT`.
The tests simulate Orca RPCs and worker terminals.
They cover concurrent workers, lane reuse, dependency commits, lost creation receipts, selective cross-repository pins, integration setup, combined validation repair, cleanup, resume, and worktree budgets.
They also cover source preservation, input capture, hooks, protected paths, and old records.

```sh
node --experimental-strip-types --test pi/extensions/task-graph/tests/task-graph.test.ts pi/extensions/task-graph/tests/workspaces.test.ts pi/extensions/task-graph/tests/workspace-runtime.test.ts pi/extensions/task-graph/tests/runtime-regressions.test.ts
node --test shared/agent-safety/git-operation-policy.test.cjs
```

These tests do not prove installed permissions or live Orca behavior.
A new installed session must complete the acceptance checks.

## Historical evidence

The [historical archive](../../../docs/permission-rewrite-history/graph-validation-v2.md.txt) describes the old implementation.
It does not establish acceptance of this candidate.
