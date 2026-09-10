# Graph rewrite validation

## Result and scope

The rewrite replaces the worker architecture. It does not retain a parallel or legacy execution mode.
The coordinator owns one workspace per writing repository and runs tasks sequentially.
Planning and execution have separate commands, approvals, records, and workspaces.

The source checkout contained an unfinished redesign. This rewrite replaced its graph implementation and tests.
Validation did not publish changes, execute Tracn plans, or consolidate user worktrees.
Both Tracn consolidation evidence files were read. Their local `dev` foundations remain unchanged.
Consolidation does not prove unfinished feature delivery. No legacy Run was retired or marked complete.

## Final deterministic results

| Check | Result |
|---|---|
| Complete affected graph suite | 33 passed, 0 failed, 0 skipped |
| Complete final-version scenarios | 20 passed in 20 fresh fixtures |
| Graph suite elapsed time | 460,213.4705 ms |
| Permission, Git, gh, and guard installation tests | 5 passed, 0 failed |
| Trusted push tests, including transport stub | 6 passed, 0 failed |
| Permission configuration self-test | Passed |
| `git diff --check` | Passed |
| Separate shell syntax command | Blocked by the runtime rule `bash *` |

Each repeated scenario performs all these steps:

1. Initialize two real Git repositories with staged and unstaged source changes.
2. Approve planning and capture an exact dirty input.
3. Create one planning worktree per repository.
4. Run setup, write plans, run hooks, commit scoped paths, validate, and close planning.
5. Request separate execution approval from the exact planning commits.
6. Create two new execution worktrees from those commits.
7. Execute the cross-repository plan dependency chain in order.
8. Promote and complete each plan through its scoped lifecycle tool.
9. Interrupt between tasks and during an active task with uncommitted work.
10. Resume without another approval, duplicate resources, or later input capture.
11. Validate and close execution.
12. Compare source files, source indexes, source HEADs, and planning HEADs with their expected values.

The scenarios also reject premature task starts, unauthorized writes, duplicate checkpoint paths, and path aliases.
A simulated native permission denial stops the shell before execution.
Some repetitions lose a Run or workspace creation receipt and then recover the same resource.
Every scenario uses the rewritten Git guard. No scenario dispatches a worker or performs integration or cleanup.

Other tests cover failed validation, owned setup output, changed inactive workspaces, symlinks, legacy records, hooks, and exited coordinator processes.

The commit-gate review found three gaps. The fixes reject bundled hook-bypass flags and dangerous long-option abbreviations, require explicit manual validation for read-only tasks, and reject unusable read-only foundations before approval.
The user approved the manual-check contract. Regression tests cover all three fixes, including both direct inspection and approved snapshots.
The second review found the same abbreviation gap in read-command flags. Those forms now fail before Git runs.
A configured fixture diff driver proves that allowed reads keep helpers disabled; abbreviated overrides cannot run it or write an output file.
Later review findings tightened decoded shell arguments and nested `uv run` checks. Quoted publishing, inline-code flags, and shell launchers now fail the same checks as their plain forms.
The hook warning did not reproduce. A real scoped commit ran Git queries in a strict hook and exposed the correct staged file; a regression now covers that case.
The full 20-scenario run above includes all accepted fixes.

Final correctness and complexity review: `scoped-clean`, with no actionable P0–P2 findings or concrete over-engineering findings.
The verified final report and status remain under `/Users/hendrik/.pi/agent/review-results/review-waq3nekv/`.

Logs and per-run fixture paths remain here:

```text
/Users/hendrik/Code/.agent-toolkit-scratch/graph-rewrite-validation.qXznjq/
  graph-suite.log
  permission-git-gh.log
  git-push.log
  final-20-fixtures.json
  production-size.json
```

Reproduction commands:

```sh
node --experimental-strip-types --test pi/extensions/task-graph/tests/*.test.ts
node --test shared/agent-safety/git-graph-boundaries.test.cjs shared/agent-safety/git-yolo-guard.test.cjs shared/agent-safety/git-guard-install.test.cjs shared/agent-safety/pi-runtime-policy.test.cjs
node --experimental-strip-types --test pi/extensions/git-push/tests/*.test.ts
node shared/agent-safety/configure.cjs --self-test
git diff --check
```

## Production size

Counts below exclude test files and Markdown. They include blank lines and comments.
The byte counts prevent line formatting from disguising the size change.
The committed baseline is `1f89a5c9db17b48dbe75ae641334c3374efaa868`.

| Scope | Before lines | After lines | Before bytes | After bytes |
|---|---:|---:|---:|---:|
| Graph production files, committed baseline | 2,882 | 756 | 207,723 | 62,797 |
| All affected non-test, non-Markdown files, including installer and verifier | 4,046 | 1,952 | 268,144 | 124,700 |
| Graph production files, initial dirty candidate | 2,913 | 756 | Not captured | 62,797 |

Graph production bytes decreased by 69.8% against the committed baseline.
The initial dirty candidate's production line count decreased by 74.0%.
Test and documentation changes do not contribute to those reductions.

Removed mechanisms:

- Parallel-worker and source-checkout proposal options.
- Worker worktrees, terminal launches, account pinning, quota checks, dispatches, and retries within graphs.
- Internal worker DAGs and prerequisite workspace pins.
- Worker integration merges and conflict reconciliation.
- Worker cleanup, archived cleanup retries, and delivery relabeling.
- Legacy Run binding, objective migration, and execution recovery.
- Secondary plan-chain locks and separate recovery contracts.
- Private snapshot indexes, raw snapshot commits, direct system-Git fallback, and capture hook bypasses.

The replacement keeps one approved record, a coordinator lease, exact workspace receipts, and verified task results.
Orca tasks mirror those results. A remote completion cannot replace local validation evidence.
The scoped lifecycle move tool applies only to the active plan in the new workflow.

## Permission-change ledger

| Surface | Change and legitimate operation | Boundary evidence |
|---|---|---|
| Launcher policy | No new path, shell, credential, or temporary-directory allowance. Existing source and scratch roots remain subject to graph ownership. | `pi-runtime-policy.test.cjs` checks scratch access, protected credentials, symlink rejection, and closed runtime/temp roots. `configure.cjs --self-test` checks generated defaults. |
| Graph shell | Only the active task's exact declared repository check runs. Before approval, bounded Git inspection disables optional index locks. | `task-graph.test.ts` rejects chaining, substitution, shell launchers, assignments, hosting commands, and executable/config/path overrides. It checks decoded arguments and supported nested `uv run` commands. Repeated scenarios compare source indexes. |
| Graph writes and commits | Only active-task paths can change. Capture deletion requires an explicit input selection. Scoped checkpoints use normal Git hooks. | Graph tests reject source writes, implementation during planning, lifecycle promotion during planning, symlinks, unauthorized history, and duplicate paths. Capture tests exercise rejecting and successful hooks. |
| Internal Git | Removed raw `commit-tree`, private-index operations, direct system-Git fallback, integration, and cleanup. Remaining calls use checked workspace paths and the guarded `git` executable. | All 20 scenarios run through the rewritten guard. Capture tests preserve source indexes and later source edits. |
| Git global selectors | Removed `--git-dir`, `--work-tree`, namespace, super-prefix, bare/global pathspec variants, and executable overrides. Exact `-C` remains for repository-scoped operations. | `git-graph-boundaries.test.cjs` proves `-C` reads and rejects adjacent selectors and environment overrides. |
| Git config reads | Retained explicit read actions needed by Git and gh. Options must precede operands. Config writes and config-file overrides remain blocked. | `git-yolo-guard.test.cjs` tests read forms and adjacent writes. It runs real `gh repo set-default --view` through the guard without network access. |
| Git history and output | Added rejection of amend and hook-bypass flags, including bundled short forms and dangerous long-option abbreviations. Read commands reject output files, external diffs, and text conversion, including abbreviated options. | `git-graph-boundaries.test.cjs` checks return code 126 and unchanged files, index, and config. |
| Git worktrees | Retained add/list for local workspace creation and inspection. Removed lock, unlock, repair, and move. Removal stays blocked. | Repeated real-Git fixtures exercise add. Guard boundary tests exercise list and reject repair, move, and removal. Graph shell never permits raw worktree commands. |
| Trusted push | Removed `core.hooksPath=/dev/null` and `--no-verify`. Kept explicit user arming, confirmation, exact commit/ref, SSH restriction, and lease checks. | Six push tests pass. The runtime test uses a safe transport stub, rejects unarmed reuse and inherited executable config, and asserts that hooks are not disabled. |
| Installation | Removed hook disabling from submodule commands. The managed-copy and extension-link mechanisms remain. | Guard installation tests verify managed updates and refusal to overwrite user policy. The graph link fixture preserves legacy records and exposes only the new implementation. |

The Git guard remains shared with ordinary non-graph workflows. It is not a replacement for Pi's permission parser or an operating-system sandbox.
Repository scripts and hooks remain trusted executable code. No test claims to contain a hostile script with workflow checks alone.

## Installed and live verification

The installed graph extension, push extension, and `AGENTS.md` links resolve to this checkout.
The disposable installation fixture also verifies the real installer link function.
Guard-only installation passes in a disposable HOME, including managed-copy integrity and user-policy preservation.
No live installation or reload occurred.

**Installed permission integration remains blocked, not passed.**
A runtime denial stopped the attempted inspection of these paths:

```text
/Users/hendrik/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system
/Users/hendrik/.local/bin/git
```

The pinned permission-system version is `20.7.3`.
The installed parser's full command/path handling and new tool routing were not inspected through another tool after that denial.
The generated-policy tests and simulated hook routing do not replace that inspection.
A separate syntax-check command also received a hard denial for `bash -n` under the `bash *` rule.
No alternate executable or subprocess was used to repeat that denied syntax check.

**Live Orca end-to-end verification remains not run.**
Read-only `orca status --json` reported version `1.4.194`, a reachable runtime, and a ready orchestration graph.
The version-matched guide and task command help were inspected.
No live Run, user worktree, terminal, or repository registration changed.
The remaining gate is the new extension's complete flow through installed permissions and an isolated live Orca fixture.
Default terminal behavior must also be verified before live workspace creation.

The local record and Git tests prove deterministic behavior with Orca RPC doubles. They do not prove live readiness.
Read-only installed-parser inspection needs a policy that permits that operation. This session did not change its runtime policy.
Neither `/reload` nor restarting an unchanged launcher grants a denied operation.

## Activation

The extension links already point here. For the narrow guard update, run this from a trusted human shell:

```sh
cd /Users/hendrik/Code/wewereyoung/agent-toolkit
./install.sh --git-guard-only
```

Then restart `pi-yolo` to verify the managed guard and load the new extension interfaces.
`/reload` can reload the linked graph and push code, but it does not regenerate launcher permissions.
If the installation links are absent on another machine, use the full `./install.sh` procedure instead.
The full installer can initialize submodules and install pinned packages. It was not run against the live installation here.

New commands:

```text
/graph plan <objective-or-plan-path>
/graph execute <objective-or-plan-path>
```

Repeat the exact command to resume the same approved record. Do not use a legacy Run ID as execution authority.
Activation instructions do not resolve the remaining installed-permission or live-verification gates.
