# Permission rewrite status

## Result

The source implementation passes the focused checks. The full specification is not release-complete.
Installation, fresh-session acceptance, and live resource acceptance remain separate required gates.
No live installation, permission change, publication, or removal of retained resources occurred during these checks.

The implementation uses `development-roots-v1`, graph records version 3, and `@gotgenes/pi-permission-system@20.7.3`.
The package exports the native shell inspector, the accepted-policy evaluator, and the selected-directory policy evaluator.
The original `.permission-api-reference/` snapshot remains unchanged.

## Passed source checks

The checks passed 26 focused tests, the configuration self-test, shell and TypeScript syntax checks, and `git diff --check`.
The real-package compatibility check reported an empty blocker list.
It used a fresh scratch installation and standard TypeScript compilation. It did not modify package source during loading.

| Area | Evidence from source checks |
| --- | --- |
| Development roots | Future non-Git directories, physical paths, sibling paths, traversal, and symlink escapes |
| Required restrictions | Accepted-policy denials survive later allows. Native asks and additional restrictions remain effective |
| Selected directories | Bash uses the selected directory. Its native project restrictions apply to that command |
| Shell classification | The native parser covers chains, directory changes, normalized executable names, and unsupported wrappers |
| Native extension | A simulated host exercises startup, the native probe prerequisite, tool routing, and inactive-service failures |
| Probe safety | A symlink cannot redirect the probe into another file |
| Bundles | Manifest integrity, repeatable patching, atomic selection, interrupted staging, failed activation, retained sessions, and dispatcher routing |
| Shared launchers | Codex and Claude preserve their sandbox, account environment, and Git safeguards |
| Git boundaries | Inspection, local mutations, integration separation, active hooks, metadata selectors, inherited overrides, and destructive flags |
| Graph lifecycle | One initial approval, sequential tasks, lost-response recovery, setup, diagnostics, clean checkpoints, and stale evidence |
| Graph scope | Separate execution, incremental expansion, preserved inputs, source changes, leases, and old-record rejection |
| Plan approval | Pending Product and Security approvals block named plans |
| Resource identity | Simulated creation, interrupted responses, authoritative loss, uncertain state, and changed identities |
| Resource limits | Simulated scanner mounts, version checks, memory, storage, lifetime, reset scope, and shutdown |
| Database privileges | PostgreSQL initialization preserves the database owner boundary. Redis disables service administration |

The resource tests use a simulated Docker runtime. They do not prove real container startup, process limits, or service privileges.
The graph tests use real Git fixtures and simulated Orca and permission routing. They do not prove a live Orca session.
The extension checks use the real patched parser and matcher with a simulated Pi SDK. They do not replace native-session acceptance.

## Reproduction

The focused verifier requires an explicit patched package path. It never selects an installed package implicitly.

```sh
./verify.sh --source /Users/hendrik/Code/.agent-toolkit-scratch/permission-source-final.lydoqw/node_modules/@gotgenes/pi-permission-system
node --test shared/agent-safety/git-graph-boundaries.test.cjs
git diff --check
```

The source graph fixtures require the installed `git-test` capability.
All scratch fixtures remain available. The final full verifier retained these evidence directories:

- Package report from the full verifier: `/Users/hendrik/Code/.agent-toolkit-scratch/permission-api-reference-Yw121u/result.json`
- Final extension rerun: `/Users/hendrik/Code/.agent-toolkit-scratch/permission-api-reference-LgeneK/result.json`
- Graph lifecycle: `/Users/hendrik/Code/.agent-toolkit-scratch/graph-v3-DERQL1`
- Resource contract: `/Users/hendrik/Code/.agent-toolkit-scratch/resource-contract-rxaPXb`
- Scanner boundaries: `/Users/hendrik/Code/.agent-toolkit-scratch/scanner-boundaries-u1IokT`
- Shared launchers: `/Users/hendrik/Code/.agent-toolkit-scratch/shared-launchers-NUkv30`

## Commit-boundary checks

The first security review found three defects. The source fixes preserve selected-project asks, record declared inspection checks, and repeat PostgreSQL initialization after restart.
The affected resource tests, all ten graph tests, and the package integration check passed after those fixes.
The package rerun retained `/Users/hendrik/Code/.agent-toolkit-scratch/permission-api-reference-CDn7jN/result.json`.
A later review found that container restarts could extend the approved lifetime.
The fixed wrapper uses the original absolute deadline across restarts and replacements.
A shell regression check covers shortened timeouts and refusal after expiry without starting a service.
The installer also accepts `--use-defaults` as an explicit policy choice. Its argument checks preserve the original policy file.
The affected checks passed. The final package rerun retained `/Users/hendrik/Code/.agent-toolkit-scratch/permission-api-reference-OhSqa9/result.json`.
The user then reported an installed startup failure on Pi 0.85.1: the session extension could not resolve its permission package.
The launcher now links session dependencies to the retained bundle.
The real Pi 0.85.1 loader successfully loaded all three extensions through the corrected layout in a scratch fixture.
The final loader check retained `/Users/hendrik/Code/.agent-toolkit-scratch/extension-loader-7c67Cl`.
The final full verifier retained `/Users/hendrik/Code/.agent-toolkit-scratch/permission-api-reference-JGDlbz/result.json`.
The source verifier now includes this loader check and reports a missing scratch-root prerequisite before any tests.
A further lifecycle fix clears stopped resource credentials without blocking unrelated shell work.
These results remain source evidence, not installed acceptance.

## Required acceptance gates

| Gate | Current status | Required evidence |
| --- | --- | --- |
| Human-reviewed installation | User reported installation of an earlier candidate | Reinstall the corrected source with an explicit policy choice |
| Fresh Pi session | Earlier installed candidate failed extension loading | Retry after reinstall, then complete the native probe and actual Bash routing |
| Installed boundaries | Not performed | Root paths, selected directories, secrets, later allowances, asks, and unsupported operations |
| Live Orca graph | Not performed | Approval, workspaces, task order, validation, restart, scope expansion, and separate execution |
| Live local resources | Not performed | Declared image versions, startup, actual privileges, mounts, limits, expiry, reset, and verified stop |
| Update acceptance | Source checks only | Failed update preserves the selected bundle. Existing sessions retain their original bundle |

These gates require a human installation and a new session. Source tests do not grant installed-runtime authority.
No existing graph approval can substitute for those gates.
The acceptance matrix in the specification remains the release checklist.

## Superseded evidence

`docs/permission-rewrite-history/` retains the earlier trust model and its reports as historical evidence.
Those files do not authorize current execution or establish acceptance of this rewrite.
The [operations guide](permission-rewrite-operations.md) describes the current contract and installation procedure.
