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

For a new installation or an update with the new defaults, explicitly select that policy:

```sh
./install.sh --accept-development-roots --use-defaults
```

This choice does not import custom restrictions. The original policy file remains unchanged.

For an existing policy, compare its rules before installation. Put the restrictions to retain in a JSON file.
Then provide that reviewed file:

```sh
./install.sh --accept-development-roots --restrictions /absolute/path/to/reviewed-restrictions.json
```

An empty object explicitly selects the new defaults, like `--use-defaults`. It does not import the existing policy.
Supported restriction surfaces are `bash`, `path`, `external_directory`, `read`, `write`, and `edit`.
Restrictions can use `deny` or `ask`. They cannot weaken required denials.
A blanket restriction takes precedence over earlier specific allowances.

Example restriction:

```json
{
  "bash": { "npm ci*": "ask" },
  "path": { "*/private-project/*": "deny" }
}
```

The installer stages a new bundle before selection. It replaces the launcher symlink atomically after dependency installation and bundle checks.
Earlier bundles remain available. A failed staging step leaves the selected bundle unchanged.
A changed or incomplete bundle fails verification. Sessions do not repair it.
The launcher-only update path cannot install this contract.
The Git-guard-only installer does not update a retained Pi bundle.

After installation, start a fresh session. Complete its native report probe before ordinary work.
The probe requires native `write` followed by native `read`. Shell filesystem access is not equivalent evidence.

## Graphs

Graph records use version 3. Earlier approvals remain evidence and receive no expanded authority.
Planning and execution require separate approvals and separate writing workspaces.

One approval covers the declared task scope. The coordinator runs tasks sequentially.
Ordinary diagnostics can run in the active writing workspace after setup.
Only successful declared validation on the clean checkpoint creates validation evidence.
Later mutation invalidates that evidence.

Read-only Git inspection can run before, during, and after a graph.
A later mutation in a command chain does not inherit inspection authority.
Git hooks remain enabled. Graph checkpoints do not authorize publication or branch integration.

Resume with the exact original graph command. Keep the original snapshots and resource identities.
Do not recapture changed source files or recreate missing workspaces.
A scope change requires incremental approval. New tasks and repositories do not replace earlier snapshots or approval records.
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
Fresh-session acceptance must cover the native probe, selected repository, physical path boundaries, operator restrictions, graph lifecycle, and declared resources.
It must also cover failed updates, retained sessions, and changed resource identities.

[Current validation status](permission-rewrite-status.md) records the remaining work.
Historical trust-policy evidence does not establish acceptance of this contract.
