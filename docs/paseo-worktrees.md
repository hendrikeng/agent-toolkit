# Paseo worktrees

This guide covers the shared workflow for projects registered in Paseo.
Each project keeps its own native configuration in `paseo.json` at the repository root.
The Toolkit's `paseo.json` prepares Toolkit development worktrees only.
It does not configure other projects or change global provider permissions.

## Project setup

The `worktree.setup` field installs dependencies and prepares a new checkout.
The `scripts` field defines checks and preview services that you start from Paseo.
Paseo reads setup commands from the committed base branch when it creates a worktree.
Uncommitted configuration does not change setup for new worktrees.
Existing worktrees need their dependencies installed separately.

1. Commit each project's configuration and required launchers to its intended base branch.
2. In Paseo, create a workspace with worktree isolation from that branch.
3. Wait for the setup terminal to finish.
4. Open the workspace scripts and start the required check or preview.

Setup commands must stay local to the checkout.
They must not reset shared databases, copy credentials, activate production jobs, or run the global Toolkit installer.
Fresh worktrees do not inherit ignored files or uncommitted source changes.
Use each project's existing runtime configuration workflow.

## Work across repositories

The coordinator assigns edits to a worker in the repository that owns the files.
If the coordinator uses a worktree, workers in other repositories also use task-associated worktrees.
Reuse a worktree only when it belongs to the same task and has compatible edit ownership.
Each target repository uses its own explicit base ref.
The coordinator's branch is not automatically a valid base in another repository.

Use a shared task prefix for new workspace titles, branches, and worktree slugs.
Include the target repository name and preserve names explicitly chosen by the user.
For example, `invite-flow--tracn-web` and `invite-flow--tracn-api` identify workspaces for one task in two repositories.

The coordinator passes the target workspace's `workspaceId` explicitly when it creates each worker.
Cross-repository workers remain attached as native subagents.
They do not need detachment or independent top-level sessions.
Shared names and recorded IDs associate the workspaces, but do not create a native workspace hierarchy.

Record each repository, workspace ID, branch, and path in the task's existing continuation context.
The [host guidance](../shared/hosts/paseo.md) and [role guidance](../shared/hosts/paseo-roles.md) define the full orchestration rules.

## Checks and previews

From a workspace directory, use the native script controls:

```sh
paseo script ls
paseo script start <script-name>
paseo script stop <script-name>
```

Use the same controls in the Paseo app.
For a preview service, omit a fixed `port` and bind the process to `$PASEO_PORT`.
Paseo assigns separate service ports and supplies preview URLs.
Services in the same workspace receive peer ports and URLs through `PASEO_SERVICE_<NAME>_PORT` and `PASEO_SERVICE_<NAME>_URL`.
Services in different repository workspaces need explicit backend configuration.

## Pair services across repositories

`paseo-service` supports local HTTP services across any registered project repositories.
It uses native `paseo workspace ls --json` and `paseo script ls --workspace <id> --json` discovery.
No daemon, plugin, background collector, or port registry is added.
Paseo owns service startup, ports, health, and shutdown.
The helper stores only the chosen workspace IDs, service name, environment variable, and daemon ID.
It resolves the current assigned port each time the consumer starts.

Install Toolkit from a trusted human terminal to add `paseo-service` to `~/.local/bin`.
Use `./install.sh --preserve-permissions` to keep existing provider permission settings.
Ensure that this directory is in the service process's `PATH`.
Run the helper on the daemon machine with its local `PASEO_HOME`, which defaults to `~/.paseo`.
Remote `PASEO_HOST` endpoints are refused because the target address uses that machine's loopback interface.

### Select the pairing

1. List the active workspaces with `paseo workspace ls --json`.
2. Select exact consumer and backend IDs. Similar names are suggestions only.
3. Set `WEB_WORKSPACE_ID` and `API_WORKSPACE_ID` to those selected IDs.
4. Record the pair:

```sh
paseo-service pair "$WEB_WORKSPACE_ID" "$API_WORKSPACE_ID" api TRACN_API_PROXY_TARGET
```

For a task that changes both repositories, select its web and API worktrees.
For a web-only task, explicitly select the shared dev API workspace instead.
Multiple consumers can select the same API. Each pairing remains explicit.
Start the selected API with native Paseo controls before starting web:

```sh
paseo script start api --workspace "$API_WORKSPACE_ID"
```

The record lives at `$PASEO_HOME/toolkit-service-pairs/<consumer-id>--<env-name>.json`.
It contains no credentials, cached URL, or assigned port.
Repeating `pair` explicitly replaces that binding. It does not start or modify any service.
The helper rejects records for another daemon.
Remove a completed pairing explicitly:

```sh
paseo-service unpair "$WEB_WORKSPACE_ID" TRACN_API_PROXY_TARGET
```

`unpair` is safe when the record is already absent. It stops no service and removes no workspace.
After workspace cleanup, remove its pair records with this command. No automatic cleanup changes host state.

### Launch after environment loading

Use the generic helper inside the environment loader, immediately before the application command:

```sh
infisical run <existing-project-flags> -- \
  paseo-service run TRACN_API_PROXY_TARGET -- \
  pnpm exec vite --port "$PASEO_PORT" --host "$HOST"
```

Preserve the application's existing Infisical flags and environment choice.
The helper overwrites `TRACN_API_PROXY_TARGET` after Infisical supplies its environment.
Wrapping the existing `pnpm run dev` outside Infisical does not preserve this ordering.
Other projects use their own loader, service name, variable, and application command.
No Vue, Vite, or TRACN behavior is built into the helper.

For TRACN, the small application integration is a separate `package.json` script named `dev:paseo`:

```json
{
  "dev:paseo": "infisical run --domain https://app.infisical.com/api --projectId 736aa93e-999e-452b-a73d-2d00d3aef986 --env dev --path /runtime --include-imports=false --expand=false --silent -- paseo-service run TRACN_API_PROXY_TARGET -- vite"
}
```

Then change only the web service command in `paseo.json`:

```json
{
  "command": "pnpm run dev:paseo --port \"$PASEO_PORT\" --host \"$HOST\""
}
```

Keep the existing service type and omit a fixed `port` for dynamic allocation.
The API retains `PORT="${PASEO_PORT:-${PORT:-3000}}"`. No API source change is required.
These are proposed application edits. Toolkit implementation does not apply them to application repositories.

By default, `run` selects the unique active workspace for its exact physical working directory.
If several workspaces share that directory, pass the consumer ID explicitly:

```sh
paseo-service run "$WEB_WORKSPACE_ID" TRACN_API_PROXY_TARGET -- pnpm exec vite --port "$PASEO_PORT" --host "$HOST"
```

The explicit ID must still match the launch directory.
Startup prints the consumer ID, selected backend ID, service name, and resolved loopback address.
Missing pairings, archived or ambiguous workspaces, missing services, stopped services, and unavailable ports fail before the application starts.
An unhealthy service also fails. Unknown health still requires a successful connection to the assigned port.
There is no fallback to port 3000 or another API.

### Restarts and acceptance

The target is a startup environment variable, not a continuously updated route.
After an API restart changes its assigned port, stop and restart every paired web service.
The new web process resolves the new API port. Other pairs retain their own selections.
Pair changes also require a web restart. An already running web process retains its old target.
Commit application integration to the base branch for new worktrees, as described in Project setup.

Run `node --test shared/paseo-service.test.cjs` for the executable acceptance checks.
The tests use real disposable HTTP servers and a fixture of the observed Paseo JSON transport.
They demonstrate two independent pairs, an explicit shared API, environment-loader ordering, and port changes after API restart.
They also demonstrate failure for missing, archived, ambiguous, stopped, unhealthy, and unreachable targets.
Test servers and scratch records are removed after the checks.
Native CLI discovery was checked read-only against Paseo 0.10.3.
Actual application previews and live Infisical loading still need the authorized application integration and a service restart.

References: [native service discovery](https://paseo.sh/docs/cli.md#workspace-scripts) and [peer service variables](https://paseo.sh/docs/worktrees.md#service-to-service).

A separate port does not create a separate database or authentication environment.
Authentication origins, local credentials, Docker requirements, and prepared databases remain project-specific.
The Toolkit's own scripts run verification and trust-plugin checks. The Toolkit has no web preview service.

## Remove completed worktrees

A merged branch alone does not remove its worktree.
After delivery, archive each completed disposable workspace in Paseo:

```sh
paseo workspace archive <workspace-id>
```

Paseo stops the workspace's terminals and removes an owned worktree after its last active workspace reference is archived.
The directory removal also removes its local dependencies, virtual environment, and build output.
Local workspaces keep their original checkout. Shared package caches remain outside the worktree.
Archiving the coordinator does not prove that its workers' workspaces were removed.

Verify removal of every completed disposable workspace and its worktree path.
Preserve unresolved work, active sessions, handoff recipients, and resources that the user explicitly retains.

References: [Paseo Git worktrees](https://paseo.sh/docs/worktrees.md) and [Paseo orchestration](https://paseo.sh/docs/orchestration.md).
