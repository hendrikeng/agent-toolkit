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
