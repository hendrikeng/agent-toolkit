# Graph permission validation

## Current contract

The source uses graph record version 3 with `development-roots-v1`.
Native shell policy and graph ownership remain separate checks.
Version-2 approvals do not gain new authority.

The focused source suite passed ten tests.
It covered separate planning and execution, retained snapshots, interrupted preparation, source preservation, enabled hooks, and validation evidence.
It also covered declared inspection checks, incremental scope expansion, directory escapes, leases, and pending Product and Security approvals.

These tests use real Git fixtures and scripts. Orca RPCs and native inspection routing are simulated.
They do not prove installed permissions, live Orca behavior, or fresh-session acceptance.

## Remaining work

Source checks passed. See [the current status](../../../docs/permission-rewrite-status.md) for the required installation and acceptance gates.
No installation or live graph acceptance occurred for this candidate.

Focused source commands:

```sh
node --experimental-strip-types --test pi/extensions/task-graph/tests/task-graph.test.ts pi/extensions/task-graph/tests/runtime-regressions.test.ts
node --test shared/agent-safety/git-operation-policy.test.cjs
```

The runtime fixture requires the separately bounded `git-test` capability.
All generated repositories and workspaces remain available for inspection.

## Historical evidence

The complete earlier report remains in [the historical archive](../../../docs/permission-rewrite-history/graph-validation-v2.md.txt).
Its trust-policy descriptions, twenty-run results, reviews, and installation procedures describe the earlier implementation.
They do not establish acceptance of this candidate.
