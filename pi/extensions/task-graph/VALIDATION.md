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
A graph with resources must use execution mode and have a writing task and an integration workspace.
An active graph can resume with `/graph resume <run-id>` from a recorded source repository if its original command root is absent.

`/graph gc` inspects current-v4, completed, retired, archived, and legacy records without changing them.
A symlinked active-records directory stops garbage inspection and retirement before a lease or record move.
It reports a compact summary, exact blockers, and one next command for each actionable Run.
The report does not contain credentials or private resource values.

`/graph retire <run-id>` requires interactive approval for one eligible current-v4 Run.
The Run can be unstarted or started with no completed graph task or integrated worker.
A completed Orca ledger status can represent a terminal worker report. This status does not alone block retirement.
All recorded dispatches must be terminal, and each worker terminal must have verified exit evidence. All declared resources must have one verified, stopped identity.
Retirement verifies each existing recorded worktree. Complete Orca inventory and filesystem checks can prove that a recorded worktree is absent.
The receipt records this absence. Retirement does not recreate or remove a worktree or resource.
It preserves graph records, orchestration evidence, commits, task receipts, integration worktrees, lanes, branches, and resource identities.
The atomic record move releases only repository ownership. Repeat the command to resume an interrupted retirement or read its unchanged receipt.
Legacy records remain unchanged and ineligible.

`/graph archive <run-id>` requires interactive approval for one completed current-v4 Run. `/graph archive all` approves one bounded batch.
Archive moves the exact record and sidecars out of active graph state. It preserves commits, worktrees, branches, resources, and Orca evidence.
The confirmation identifies and explicitly abandons any `deliveryPending` marker. A live resource, live coordinator, unfinished delivery receipt, uncertain lease, duplicate Run ID, legacy record, or incomplete graph blocks archive.
The archive receipt and record hash make interruption recovery idempotent.

`/graph purge 90d` requires interactive approval for one verified batch.
It uses each `archivedAt` value and removes no archive before 90 days.
A delivery reference, changed archive, uncertain identity, or uncertain graph state blocks removal.
The command moves each selected archive before removal and leaves a hash receipt.
Repeat the command to recover an interrupted purge.
The command does not change active, retired, legacy, delivery, Git, resource, worktree, or Orca evidence.

`/graph deliver <run-id>` requires interactive approval for a completed Run without pending delivery work.
It fast-forwards each clean local target branch to its exact integration commit.
It does not push.
After delivery, it removes eligible integration worktrees through Orca.
It also removes eligible integration worktrees from predecessor Runs.
It retains an integration workspace when an active or pending-delivery Run still needs that workspace.
Unreadable graph evidence blocks cleanup.
The command preserves dirty, unsettled, unrelated, unmerged, live, or uncertain worktrees.
A durable receipt records each fast-forward and cleanup step.
Repeat the command to resume an interrupted delivery.

## Source checks

The focused tests use real Git repositories in the system temporary directory.
The tests simulate Orca RPCs and worker terminals.
They cover concurrent workers, lane reuse, dependency commits, lost creation receipts, integration setup, combined validation repair, cleanup, resume, and worktree budgets.
They cover resource and worktree identity, missing-worktree evidence, retirement receipts, garbage inspection, source preservation, input capture, hooks, protected paths, and old records.

```sh
node --experimental-strip-types --test pi/extensions/task-graph/tests/task-graph.test.ts pi/extensions/task-graph/tests/workspaces.test.ts pi/extensions/task-graph/tests/workspace-runtime.test.ts pi/extensions/task-graph/tests/runtime-regressions.test.ts pi/extensions/task-graph/tests/delivery.test.ts pi/extensions/task-graph/tests/archive.test.ts
node --test shared/agent-safety/git-operation-policy.test.cjs
```

The graph supports one trusted local user and does not support a shared graph directory. Host-local PID leases protect concurrent Pi sessions on that host.

These tests do not prove installed permissions or live Orca behavior.
A new installed session must complete the acceptance checks.

## Historical evidence

The [historical archive](../../../docs/permission-rewrite-history/graph-validation-v2.md.txt) describes the old implementation.
It does not establish acceptance of this candidate.
