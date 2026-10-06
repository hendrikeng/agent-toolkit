# Paseo worktrees

The repository uses native Paseo scripts in `paseo.json`.
Paseo reads setup commands from the committed base branch when it creates a worktree.
Uncommitted configuration does not change setup for new worktrees.

## Start a worktree

1. Commit the configuration and its launcher changes to the intended base branch.
2. In Paseo, create a workspace with worktree isolation from that branch.
3. Wait for the setup terminal to finish.
4. Open the workspace scripts and start the required script.

Setup installs dependencies in the new checkout.
It does not copy credentials, reset databases, run migrations, or start background workers.
Existing worktrees need their dependencies installed separately.

## Workspace scripts

From the workspace directory, list the native scripts:

```sh
paseo script ls
```

Setup initializes the pinned submodules and installs repository-local Node dependencies.
It does not run `install.sh` or `setup-paseo.sh`.
It does not change global skills, provider permissions, or daemon configuration.

`verify` runs `bash verify.sh`.
`paseo-trust-check` runs the native trust plugin's typecheck and tests.
The Toolkit has no web app preview service.

Reference: [Paseo Git worktrees](https://paseo.sh/docs/worktrees.md).

## Remove completed worktrees

A merged branch alone does not remove its worktree.
After delivery, archive the completed workspace in Paseo.
Paseo stops its terminals and removes an owned worktree after its last active workspace reference is archived.
The worktree removal also removes its local dependencies, virtual environment, and build output.
Local workspaces keep their original checkout.
Shared package caches remain outside the worktree.

```sh
paseo workspace archive <workspace-id>
```

Archive only completed task workspaces after their changes are safely delivered.
Keep unresolved workspaces and workspaces that the user explicitly retains.
