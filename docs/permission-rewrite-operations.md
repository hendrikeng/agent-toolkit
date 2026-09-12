# Development-root permissions

## Scope

`development-roots-v1` permits ordinary local development within physical `~/Code` and `~/orca/workspaces` roots.
The contract includes future directories, non-Git projects, and sibling worktrees.
It does not use repository-trust approvals or script-name exceptions.

Scripts, dependencies, and hooks run as the local account. These controls are not an operating-system sandbox.
Secrets, destructive actions, publication, deployment, global installation, and existing database administration remain separate operations.
Native asks remain asks. A chat message cannot override a denial.

The installed `~/.local/bin/pi-yolo` symlink selects a retained bundle through its dispatcher.
Its manifest covers the policy, package, extensions, dispatcher, launcher, and helpers.
Each session keeps that bundle. Source edits and `/reload` do not activate another version.

## Installation

Installation requires a reviewed source candidate and a human terminal. Source validation does not authorize installation.

For a new installation or update, run:

```sh
./install.sh
```

The installer stages a new bundle before selection. It replaces the launcher symlink atomically after dependency installation and bundle checks.
Earlier bundles remain available. A failed staging step leaves the selected bundle unchanged.
A changed or incomplete bundle fails verification. Sessions do not repair it.
The launcher-only update path cannot install this contract.

After installation, start a fresh session. Existing and new worktrees in the development roots work without registration or a startup probe.

## Graphs

Graph records use version 4. Earlier approvals remain evidence and receive no expanded authority.
Planning and execution require separate approvals.

The proposal declares a worktree budget. This budget includes integration worktrees and writing lanes.
One approval covers task records, worker launches, declared setup, validation, retries, bounded resources, and internal integration.
Independent ready tasks run through `pi-yolo` workers. Each writing worker gets an exclusive lane labeled with the plan and task ID.
Worker commits include the task ID. The integration branch uses the plan name, and merge commits identify each task.
The worker validates its checkpoint. After integration, the graph runs the same validation on the combined checkout.
A clean lane returns to the pool after integration. A dirty or interrupted lane stays intact.
Closeout removes verified clean lanes and keeps the integration worktree.
Read-only workers use an existing checkout.

Read-only Git inspection works before approval. Ordinary diagnostics do not need new permission approval.
Only successful declared validation on the clean checkpoint creates validation evidence.
A later mutating command invalidates that evidence. Read-only inspection and completion reports do not invalidate it.

Resume with the exact graph command. The graph reuses recorded workers, lanes, snapshots, and resource identities.
Do not recapture changed source files or recreate missing workspaces.
Pending Product and Security approvals block a named plan.

## Local resources

The source provides bounded database, storage, and scanner classes through the resource tools.
Each declaration specifies an immutable image digest, memory, storage, lifetime, and permitted operations.
The helper fixes the process limit at 128 and private shared memory at 16 MiB.
PostgreSQL requires at least 256 MiB memory and 128 MiB storage.
Docker uses a local Unix socket, private credential-free configuration, and loopback ports. The helper does not target an existing service.

Image downloads require explicit declaration of that exact image.
A scanner also needs workspace-relative targets and a signature database.
The helper mounts those paths read-only. It does not update scanner signatures.

Resource creation intent is durable before creation. Resume verifies the engine, token, container identity, and configuration.
Only authoritative absence permits replacement. The replacement retains its earlier identity in the record.
Uncertain state does not permit recreation.

Only declared fixture resets are available. The helper does not accept arbitrary SQL or deletion commands.
The PostgreSQL test role owns the public schema, not the database. The bootstrap role cannot log in after initialization.
Redis uses one database and disables service administration commands.
A fixed shell wrapper computes the remaining time from the original deadline. A timeout process uses `SIGKILL` at that limit.
Restarts and replacements retain the same deadline. Expired resources cannot restart under the same declaration.
Credentials remain private and enter checks through `RESOURCE_<ID>_URL` variables.
Do not commit those values.

Live resource behavior remains a separate acceptance step. See the current status before installation.

## Validation layers

Run focused source checks in an authorized development session:

```sh
./verify.sh --source /absolute/path/to/patched-source-package
```

The graph source tests require the separately installed `git-test` fixture capability.
They use retained Git fixtures and simulated Orca routing. They are not a live Orca acceptance test.
The parser check only reads its selected package.

From an authorized human shell, inspect a retained bundle:

```sh
./verify.sh --bundle /absolute/path/to/retained-bundle
```

Bundle verification does not prove native tool routing or fresh-session behavior.
Fresh-session acceptance must cover ordinary access in existing and new worktrees, physical path boundaries, hard safety denials, graph lifecycle, and declared resources.
It must also cover failed updates, retained sessions, and changed resource identities.

[Current validation status](permission-rewrite-status.md) records the remaining work.
Historical trust-policy evidence does not establish acceptance of this contract.
