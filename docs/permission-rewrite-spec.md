# Development permissions and graph rewrite

## Status and scope

Status: proposed specification, not implementation approval.

The user selected a rewrite specification after the permission audit. This document describes the replacement contract. It does not change current instructions, installed permissions, repository trust, or graph records.

Implementation needs a separately authorized session with instructions that permit this replacement. Installation needs explicit human acceptance of the development-root execution model.

The source baseline is `529910c07ea7f84e980c098d39f868aa49ccbb68`, plus the pre-existing uncommitted work. Implementation must inspect that work again rather than discard it.

## Goal

Agents can do ordinary development under `~/Code` and `~/orca/workspaces` without separate approval for each checkout, worktree, command, or script.

Graph mode adds task ownership and completion requirements. It does not replace ordinary development permissions or control shell access outside graphs.

The user approves the complete execution scope and its bounded local test resources once. Agents then continue approved tasks without routine per-task or per-command prompts.

This is unattended execution within approved scope, not automatic authorization from planning through deployment.

The replacement has one current policy contract. It has no legacy execution mode, per-script exceptions, or automatic conversion of old trust records.

## 1. Permission contract

### Development roots

The human installer presents both development roots and the execution risks before activation. Acceptance covers current and future directories under those roots, including new checkouts and worktrees.

Approval covers local builds, lint, tests, interpreters, repository scripts, and dependency installation. It does not cover secrets, destructive operations, publication, deployment, or existing database administration.

A directory can contain development work without a `.git` directory. Permission does not depend on checkout inode records or Git registration.

Physical paths define the boundary. Symlinks and parent traversal cannot extend access outside approved roots. Explicit command targets and the effective working directory both matter.

Outside those roots, access requires a separate bounded grant. Selecting a trusted working directory does not authorize explicit targets elsewhere.

### Operation matrix

| Operation | Ordinary session | Active graph |
| --- | --- | --- |
| Read and search development files | Allowed, except protected secrets | Same access, including source inspection |
| Create and edit development files | Allowed without discarding unrelated work | Active workspace, owned paths, and graph mode apply |
| Read-only Git inspection | Allowed, including safe composition | Same access before approval, between tasks, and during tasks |
| Local builds, lint, tests, scripts, dependencies | Allowed under root execution approval | Allowed in the active writing workspace under task scope |
| Additional diagnostics | Allowed | Allowed without changing required completion criteria |
| Local database, storage, and scanner resources | Explicit bounded setup authorization | Included once in execution approval, not approved again for each command |
| Create required worktrees, branches, and task records | Requires task scope | Included in graph approval, with no per-resource prompt |
| Continue approved execution tasks | Within the approved task scope | No routine per-task approval |
| Move from planning to implementation | Explicit execution approval | Separate from planning approval |
| Required validation | Focused checks for the task | Recorded successful command and result for the final checkpoint |
| Local Git mutation | Requires task scope or explicit user request, with hooks | Scoped graph checkpoint operations only |
| Branch integration | Requires explicit user request and preservation of local work | Not part of graph approval |
| Declared fixture resets inside owned disposable resources | Covered by bounded setup authorization | Covered by the declared local resource scope |
| Resource deletion, discarded work, history replacement, hook bypass | Not granted by root access | Not granted by graph approval |
| Publication, deployment, production access | Separate operation-specific authorization | Not part of graph approval |
| Existing database administration | Separate resource-specific authorization | Not part of graph approval |

Read-only service inspection is not service administration. Command families must not receive blanket denials merely because some subcommands change state.

Existing bounded Git and PostgreSQL fixture helpers remain useful. They do not become prerequisites for ordinary development or substitutes for access to existing resources.

### One execution approval

Root approval covers ordinary development commands. Execution approval covers the complete task sequence, owned paths, required validation, and declared local test resources.

Each graph approval also authorizes its required worktree, branch, and task-record creation. This applies to planning approval and separately requested execution approval.

The approval screen must present these together. It must not request setup authorization later for resources already included in the accepted scope.

The accepted scope permits setup, implementation, diagnostics, retries, validation, and progression through approved tasks. Each action remains subject to task dependencies and ownership.

A failed test does not require renewed approval for an in-scope fix or retry. Resume does not require renewed approval for unchanged scope and verified resources.

Planning approval does not authorize implementation. Missing Product or Security approvals remain blockers. Development permissions never manufacture these approvals or override an explicit denial.

A scope expansion requires approval of the change only. Examples include another repository, broader write ownership, a new resource class, external credentials, or higher resource limits.

Publication, branch integration, deployment, existing database administration, and resource deletion remain separately authorized operations. Execution approval does not include them implicitly.

### Automatic graph preparation

The initial graph approval covers the infrastructure required to carry out that graph. The user does not approve individual worktrees, branches, task records, or preparation commands.

The approval identifies repositories, foundation commits, input snapshots, write ownership, and required setup. Generated worktree names, branch names, and record IDs do not require advance selection.

Within that approval, the coordinator can:

- Create the graph Run and its task records.
- Create one isolated worktree and new branch per writing repository under approved development roots.
- Create an approved input-snapshot workspace where the graph requires one.
- Capture selected inputs and create scoped commits with hooks enabled.
- Run declared worktree setup and local resource setup.
- Record resource identities and start the first ready task.
- Continue subsequent tasks and record their results without new approval.

Orca worktree creation must use the supported managed interface. The native permission integration must recognize this graph authority without requesting another per-worktree grant.

New graph worktrees inherit the accepted development-root execution model immediately. They need no checkout trust registration, launcher restart, or return to the user for access approval.

Worktree creation can update the selected repository's Git administrative metadata. That necessary operation does not authorize changes to its source files, index, or existing branches.

Preparation uses declared setup, not undisclosed Orca default commands or terminals. Any automatic default behavior must fit the approved setup scope before preparation starts.

The runtime records creation intent before a resource operation and the returned identity afterward. After interruption, it reconciles the same recorded operation without duplicate creation.

A lost response does not require another approval. Uncertain ownership or uncertain loss blocks progress. Neither authorizes overwriting or adopting unrelated work.

Verified loss of a disposable local test resource permits the recorded replacement procedure below. Missing graph worktrees, commits, or input snapshots remain blockers, not disposable-resource replacements.

Only material scope changes require new approval. Routine generated names, available port selection, and unchanged retries do not change scope.

The graph does not gain worktree deletion, existing branch replacement, publication, or merge-back authority. These are not prerequisites for graph preparation or local completion.

### Bounded local test resources

Execution approval includes an explicit resource setup declaration. This declaration can cover disposable databases, local storage services, scanner processes, and their test data.

The declaration identifies:

- Resource types, required versions, and purpose.
- The supported helper or local runtime, including required privileges.
- Private storage locations under approved roots and generated resource identities.
- Loopback endpoints and port allocation rules, without public exposure.
- Generated test credentials, synthetic data, and credential handling.
- Permitted setup operations, fixture changes, retries, and process shutdown.
- Resource count, storage, and lifetime limits.
- Any required downloads, registry access, or scanner network targets.

Approval covers resource creation within those bounds. It does not require names or ports before creation. The runtime records actual identities before tests use them.

Resources must be newly created for the approved scope. A matching name, localhost address, or development-root path does not establish ownership of an existing service.

Within these resources, approval covers declared schema creation, migrations, seed data, and fixture resets. Such operations cannot target pre-existing databases or shared storage.

An approved fixture reset can destroy synthetic test contents within a verified, scope-owned disposable resource. Examples include truncating fixture tables, recreating declared test schemas, and clearing declared test objects.

The setup declaration defines the reset boundary. Each reset verifies the resource identity and that boundary before mutation. In-scope resets need no additional approval.

Reset authority does not include deleting the enclosing database, cluster, storage service, volume, or resource identity record. Those resource deletions require separate explicit authorization.

Resource deletion cannot be disguised as a fixture reset. Reset scope never includes retained evidence, source files, or unrelated data.

Scanner approval identifies permitted local targets. It does not authorize arbitrary network scans, host administration, or access to real credentials.

Setup must not replace occupied ports, alter shared services, or install privileged host components. Missing runtime capabilities produce a specific setup blocker.

A stopped or interrupted session retains resource identity records. Resume verifies ownership before reuse and never adopts a different resource by name alone.

After verified loss, retries or resume can create a replacement disposable local test resource within the original approved limits. No renewed approval is required.

Verified loss requires authoritative evidence that the recorded resource no longer exists. A timeout, refused connection, unavailable runtime, or missing local receipt alone does not establish loss.

Before replacement, the runtime records the old identity, loss evidence, and replacement intent. It then creates a new resource and records its new identity.

The replacement retains the original resource type, isolation, and scope limits. The old identity record and available evidence remain intact and linked to the replacement.

Uncertain ownership or uncertain loss blocks replacement. The runtime never adopts a same-name resource, deletes a conflicting resource, or overwrites remaining data to make progress.

Process shutdown is permitted only for verified scope-owned processes. Resource deletion needs separate explicit authorization and identity checks. Neither completion nor exit implies cleanup.

These resource permissions require runtime support and human acceptance. This proposed specification grants no new capability to the current session.

### Security limits

Repository scripts, hooks, and dependencies run code with the user account. Root execution approval accepts that risk. Command filtering is not an operating-system sandbox.

The policy must reject recognized destructive commands outside explicitly approved fixture reset boundaries. Protected targets remain restricted regardless of reset approval.

It cannot prove that arbitrary scripts are non-destructive from their names.

Graph ownership checks constrain native mutations and verify repository changes. They do not contain a hostile process or prevent every side effect inside a script.

Stronger process containment is separate work. This rewrite must not claim guarantees that its tests cannot establish.

### Decision order

1. Resolve the selected working directory and explicit paths to physical locations.
2. Apply protected-secret and dangerous-operation restrictions.
3. Apply human restrictions that narrow the development-root contract.
4. Apply active graph ownership and mode restrictions.
5. Permit operations covered by accepted root, graph, or bounded local resource scope without another approval prompt.
6. Request bounded authorization for other operations through a supported host approval mechanism.

A hard denial remains a denial. If the host cannot provide bounded approval, the diagnostic identifies the required human action.

Graph approval never overrides an explicit denial. A diagnostic string never carries authorization.

## 2. Shell and Git behavior

The existing native shell parser remains the starting point. The rewrite must not add another shell parser or a growing list of whole-command regular expressions.

The permission decision covers every parsed command unit, explicit path, substitution, and redirection. A permitted first command does not authorize later commands in a chain.

Ordinary shell composition does not require a new repository wrapper script. Environment assignments and interpreter arguments are not automatically destructive.

Policy-sensitive environment variables remain restricted. Git metadata selectors, executable overrides, credential redirects, and external diff execution retain their existing protections.

The Git guard remains responsible for Git-specific argument semantics. Native permission integration must agree with that guard rather than maintain a conflicting command inventory.

The original regression must run before, during, and after a graph:

```sh
git rev-parse HEAD && git status && git log -5 --oneline && git diff --stat && git rev-parse -q --verify MERGE_HEAD
```

Without an active merge, the final command returns status 1. That result is a Git outcome, not a permission error or proof of failed earlier commands.

Unsupported syntax produces a specific diagnostic. It does not produce a misleading repository-trust error or suggest an ineffective chat approval.

## 3. Graph contract

The graph extension owns graph state only. Removing or disabling it does not change ordinary development access.

### Preserved behavior

- One coordinator writes tasks sequentially.
- One isolated workspace exists per writing repository.
- Foundations and approved input snapshots retain exact identities.
- Planning writes documentation only and does not start implementation.
- Execution requires a separate explicit approval.
- Native writes stay within active task ownership.
- Source checkouts, unrelated workspaces, and retained inputs remain unchanged.
- Completion requires evidence from the clean final checkpoint.
- Resume reuses recorded resources and snapshots.
- Graph completion does not authorize publication, integration, or cleanup.

### Changed behavior

Read-only inspection remains available before approval, between tasks, after interruption, and during active tasks. Inspection does not grant mutation authority.

Approved task setup and validation define required evidence, not the entire list of permitted shell commands. Additional focused diagnostics can run in the active workspace.

Only successful completion of the declared validation satisfies the validation requirement. Additional diagnostics cannot silently replace it.

A mutation invalidates earlier validation evidence. Failed or interrupted commands cannot record successful setup or validation.

Commands with possible local side effects use the active writing workspace. Read-only tasks do not gain script execution in source checkouts.

Graph shell access uses the same native permission decisions as ordinary access, plus graph scope. It does not use a global trust callback.

Task transitions record progress but do not request approval again. Declared local resource setup uses the execution approval rather than separate prompts for each service command.

## 4. Code removal and replacement

Paths below identify implementation scope, not permission to modify installed copies or existing records.

| Current source | Replacement |
| --- | --- |
| `shared/agent-safety/agent-yolo` | Generate root-based runtime permissions without checkout discovery or a trust fallback. Remove `AGENT_TOOLKIT_ENFORCE_REPOSITORY_TRUST`. |
| `shared/agent-safety/repository-trust.cjs` | Remove from the active runtime and installer after root-model acceptance. Do not import its approvals automatically. Preserve existing user records as evidence. |
| `pi/extensions/task-graph/index.ts` | Remove `repositoryTrusted`, `ordinaryTrust`, and the global execution-trust callback. Replace `readGit` and exact-command-only gating with graph-scoped access. |
| `pi/extensions/task-graph/task-graph-core.ts` | Remove the second command-language filter from `assertGraphShell`. Retain task-contract validation, path ownership, and identity checks. |
| `shared/agent-safety/patch-permission-tool-visibility.cjs` | Remove the reason-string override and trust callback integration. Retain only necessary, documented package integration until upstream supports it. |
| `shared/agent-safety/pi-permission-system.json` and `configure.cjs` | Define the same operation contract and narrow infrastructure grants. Preserve secret restrictions. |
| `shared/agent-safety/git-yolo-guard` | Preserve Git-specific safeguards. Distinguish safe inspection, scoped local mutation, and separately authorized operations. |
| `install.sh` and `verify.sh` | Replace checkout approval prerequisites with root-model acceptance and complete installation verification. |
| Graph approval records and bounded resource helpers | Record setup scope once. Bind actual resource identities, limits, permitted operations, and resume evidence without granting general service administration. |
| Permission and graph tests | Replace obsolete trust expectations with behavior tests for this contract. Preserve relevant negative cases. |
| `README.md`, `pi/AGENTS.md`, and graph validation guidance | Publish one current contract. Separate historical evidence from activation instructions. |

The bash tool must support an explicit working directory independently of graph mode. That capability belongs to ordinary tool integration, not graph authorization.

Existing Pi APIs and the pinned permission package require inspection before implementation. Unsupported integration is a blocker, not a reason for hidden globals or patch chains.

Necessary compatibility changes must remain small and version-checked. Installation must verify the actual installed bytes without repairing them inside a test loader.

Shared launcher and Git changes require focused Codex and Claude regression checks. This task does not rewrite their unrelated account or sandbox behavior.

## 5. Installation and session behavior

Installation presents one coherent permission integration version. A minimal manifest identifies the launcher, permission package, policy, and required extension versions or hashes.

The installer stages and verifies that set before activation. Failure before activation leaves the previous compatible set usable.

Activation must not expose a new launcher with incompatible dependencies. Partial installation must not start an apparently healthy but unusable session.

Existing sessions retain their recorded policy version. A later installation does not silently change their authorization model.

A fresh session verifies its required components before accepting work. Its startup message identifies the active policy version and approved development roots.

`/reload` does not claim to regenerate permissions. Missing components produce a specific installation error, not a default repository-trust denial.

Custom human restrictions retain their meaning. Installation neither overwrites them silently nor adopts them through a reset checksum marker.

A policy mismatch requires a human decision before activation. The agent never repairs live permissions during a task.

### Report and scratch paths

The launcher grants creation, reading, and writing within its designated scratch and report directories. These grants do not expose the surrounding agent configuration.

A startup probe must use the same native tool routes as normal work. Shell directory creation alone does not prove that native report writes work.

Probes and unfinished reports remain available for diagnosis. Cleanup is not an implicit part of startup, resume, or exit.

## 6. Legacy and interrupted state

The current execution path supports one graph format. It has no old worker mode, old trust fallback, or automatic migration path.

Existing version-2 graphs retain their approved contracts. Resuming an old approval does not silently expand its shell authority to the new contract.

Any changed approval semantics require an explicit reviewed transition or separate scope. New permissions do not retroactively authorize old tasks.

Old worker records and locks require a one-time, separately authorized retirement procedure:

1. Inventory records, Runs, workers, repositories, retained commits, and workspaces without mutation.
2. Verify exact resource identities and determine whether any worker or coordinator remains active.
3. Record ownership conflicts and unknown scope as blockers.
4. Obtain human authorization for the exact retirement scope.
5. Preserve the evidence and retained work without marking unfinished delivery complete.
6. Record the retirement result outside the new execution format.

Normal graph admission must not repeatedly interpret retired formats. It must still prevent conflicts with verified active ownership.

Unknown state cannot silently become free ownership. This specification does not authorize retirement, deletion, or modification of any existing record.

## 7. Diagnostics

Every permission rejection identifies:

- The denying layer: path policy, operation policy, Git guard, graph ownership, or installation.
- The active permission integration version.
- The selected working directory and relevant target path.
- The rejected operation or parsed command unit.
- Whether supported bounded approval exists.
- The exact next action, without instructions to bypass the denial.

Diagnostics must redact secrets and credential values. They must distinguish command exit status, permission denial, graph scope failure, and unavailable installation components.

## 8. Implementation sequence

1. Reconcile the current source diff and preserve unrelated changes.
2. Verify the host and permission-package integration APIs against this contract.
3. Implement ordinary root-based permissions independently of the graph extension.
4. Remove the superseded trust bridge and conflicting shell restrictions together.
5. Implement graph-scoped diagnostics and validation evidence behavior.
6. Implement complete installation verification and native report probes.
7. Replace obsolete tests and current operating instructions.
8. Run focused deterministic checks in explicitly authorized disposable resources.
9. Run real installed-session acceptance checks after human installation approval.
10. Report source completion and installed acceptance separately.

Legacy retirement remains a separate authorized operation. No implementation step depends on deleting old records or workspaces.

## 9. Acceptance tests

All rows are required before a release claim. They are planned checks, not results from this specification task.

| Area | Required evidence |
| --- | --- |
| Root access | Native read, create, edit, search, and focused tests work under both roots without checkout registration. |
| New resources | A new checkout, ordinary non-Git directory, and registered Orca worktree inherit the approved root model. |
| Working directory | Default and explicitly selected directories use the same permission contract. Outside-root targets remain restricted. |
| Graph independence | Ordinary development works with the graph extension absent or disabled. |
| Graph preparation | One graph approval creates required Orca worktrees, new branches, Run records, and task records without further prompts. |
| Immediate workspace access | Native edits, declared setup, and tests work in newly created graph worktrees without registration, restart, or renewed approval. |
| Preparation recovery | A lost creation response reconciles the reserved resource without duplicate creation or a repeated approval prompt. |
| Source preservation | Worktree registration changes only necessary Git metadata. Source files, the source index, and existing branch tips remain unchanged. |
| Report access | Native write and read succeed under the report root. Adjacent credentials and configuration stay protected. |
| Git regression | The exact reported chain runs in ordinary, pre-approval, between-task, and active-task states. |
| Safe composition | Benign chains, pipelines, quoted arguments, and environment assignments work without wrapper scripts. |
| Mixed commands | A permitted inspection command cannot authorize a destructive later command, substitution, or redirection. |
| Git safeguards | External executable overrides, unsafe metadata selectors, hook bypass, and unauthorized history replacement remain blocked. |
| Graph ownership | Native source writes, unrelated workspace writes, and writes outside active ownership fail. |
| Planning mode | Implementation writes fail even inside an otherwise permitted development root. |
| Execution approval | One approval covers the declared task sequence and local setup. No routine prompts occur during task progression or diagnostics. |
| Local resources | Approved disposable database, storage, and scanner setup runs without new command approvals. Actual identities and limits remain recorded. |
| Resource isolation | Occupied ports, existing services, shared data, undeclared scan targets, and privileged host setup remain outside approval. |
| Fixture resets | Declared destructive resets of synthetic contents need no extra approval. Identity mismatches, boundary escapes, enclosing-resource deletion, and evidence deletion fail. |
| Resource lifecycle | Verified loss permits a recorded replacement within approved limits without renewed approval. Old evidence remains linked. Resource deletion remains separately authorized. |
| Uncertain resource state | Timeouts, unavailable runtimes, missing receipts, and conflicting ownership cannot authorize replacement or adoption. Missing graph worktrees and snapshots remain blockers. |
| Scope expansion | Only the changed scope requires approval. Missing Product or Security approvals still block execution. |
| Validation | Failure and interruption never record success. Additional diagnostics never replace required validation. |
| Evidence invalidation | A later mutation invalidates validation. Completion requires the clean final checkpoint. |
| Resume | The exact approved record resumes without recapture, duplicate workspaces, or expanded old authority. |
| Secret and path boundaries | Protected credentials, explicit outside-root paths, traversal, and symlink escapes remain restricted. |
| External effects | Root access does not authorize publication, deployment, or existing database administration. |
| Installation | Interrupted staging retains a usable old set. Incompatible activation fails before agent work. |
| Session versions | Old sessions identify their old contract. Fresh sessions load and verify the accepted new contract. |
| Legacy ownership | Retirement requires separate authorization. Unknown or live ownership cannot become silently available. |
| Shared tools | Focused Codex and Claude checks preserve their existing safety and account behavior. |

Component tests cover the actual installed parser and policy without source transformation. Separate tests cover patch generation where compatibility code remains necessary.

At least one real fresh Pi session must exercise native authorization and graph lifecycle behavior. Simulated Orca calls and mocked permission routing do not satisfy that requirement.

Negative tests must use dry policy evaluation or identity-checked disposable resources. They must never target real secrets, production services, or existing repositories for destructive effects.

## 10. Definition of done

The rewrite is complete only after source checks and real installed-session acceptance pass. Every acceptance row needs a retained result or an explicit blocker.

The delivered diff removes superseded runtime code and contradictory instructions. It does not retain two permission models or add per-repository workarounds.

The final delivery identifies the installed version, root acceptance, remaining restrictions, and any separately pending legacy retirement. No report claims installation from source-only tests.
