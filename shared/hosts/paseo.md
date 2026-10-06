# Native Paseo sessions

This guidance applies only when Paseo owns the current session. Use normal providers and Paseo's native permission modes.
Use the installed official `paseo` skill for agents, profiles, workspaces, scripts, supervision, and waiting.
Use the official `paseo-handoff` skill for ownership transfers. Never duplicate, rewrite, or overwrite official Paseo skills.
Do not import Orca worker instructions, terminal launchers, sandbox extensions, or lifecycle operations.

Before choosing a worker, read `list_profiles` and every profile's notes. Honor an explicitly requested profile and account alias.
By default, select workers from the current session's provider family and exact account alias.
Use another provider family or account only when the user explicitly requests or authorizes it. Available profiles alone are not authorization.
If no matching profile exists, discover native settings for the current alias. If that alias is unknown, ask before launch.
Materialize the selected provider/model, mode, thinking, and features through the official native creation interface.
Before launch, use native `inspect_provider` for the exact provider and selected model, mode, thinking, and feature settings.
Use only returned feature IDs. If a required planning control is unavailable, report the limitation before launching that profile.
Preserve absent values and explicit false feature values. Profile notes guide selection. Put the actual assignment in the task prompt.
If no profile fits, use provider discovery. Do not substitute another account after a failure.
If the selected profile has no model, discover one for that exact provider before launch.
Use the saved effort as the starting point. Honor an explicit human effort choice.
Prefer Medium for routine coordination, implementation, and advice. Select High for substantial planning, hard debugging, security, migrations, concurrency, or difficult integration.
For a task-specific effort adjustment, explain the reason before launch. Use native settings, without adding another profile.
Give workers an assigned role, scope, edit ownership, constraints, shared coding/review guidance, and acceptance criteria.
Pass the active review policy, publication authorization, and delegation limits explicitly. Do not assume inherited conversation context.
For Toolkit profiles, read the sibling `paseo-roles.md` and name the selected role in the worker's initial prompt.
UI Worker specializes Worker for frontend implementation, accessibility, responsive behavior, and visual verification.
Use the provider's discovered planning control for a proposed implementation plan.
Do not approve a planning-only worker's Implement action merely to collect its report.
An analysis-only assignment does not establish an OS-enforced read-only boundary.
Use the existing AutoReview helper for change-bundle reviews. Paseo profiles do not replace its reviewer isolation or settings.
Before launching an editing worker, identify the repository that owns its assigned files.
Choose the worker's workspace from that repository, not from the coordinator's current location.
For cross-repository tasks, split edit ownership by repository and launch each worker in its repository's workspace.
Apply this rule to every repository, including small fixes and checks that write or generate files.
Do not edit another repository through sibling paths, temporary scripts, or shell directory changes from the coordinator session.
Read-only cross-repository inspection can remain in the coordinator workspace.
For example, launch a web worker in the web repository and an API worker in the API repository.
The coordinator can remain in the web workspace and integrate both results.
Discover the target repository and its workspaces through the official native interfaces.
If the coordinator uses worktree isolation, preserve that isolation for edits in every other repository.
Create a worktree-backed workspace in each target repository, or reuse one verified to belong to the same task with compatible edit ownership.
Do not select the target repository's main checkout or an unrelated worktree as a shortcut.
For new workspaces, use the coordinator's task or worktree name as a shared prefix for titles, branch names, and worktree slugs.
Honor names explicitly chosen by the user. Do not rename existing user workspaces or branches.
Include the target repository name. Add a short coordinator workspace ID if the shared prefix is ambiguous.
For example, a task named `invite-flow` can use `invite-flow--tracn-api` as its API workspace title and worktree slug.
Choose an explicit base ref from the target repository. The coordinator's branch name is not a base ref in another repository.
Record the coordinator workspace ID and each target repository, workspace ID, branch, and path in the task's existing continuation context.
Include the coordinator workspace ID and shared task name in each worker's brief.
Create workers through the current agent's native interface with the target `workspaceId` so they remain its subagents.
Do not detach workers or launch independent top-level sessions merely because they work in another repository.
Shared names and recorded workspace IDs associate the workspaces. They do not create a native workspace hierarchy or share uncommitted files.
For independent parallel edits, create separate worktree-backed workspaces in each target repository with explicit base refs.
Pass the target checkout as `create_workspace.path`. Omitting it also inherits the coordinator's workspace.
Pass the selected workspace's `workspaceId` explicitly to `create_agent`. An omitted value inherits the coordinator's workspace.
Include the repository path and workspace ID in the worker's brief. Verify the returned workspace before further instructions.
If the target repository is unclear, inspect available project information before asking the user.
Use the current workspace for read-only investigation when it contains the required evidence.
Verify the required evidence is present. New worktrees do not inherit staged, unstaged, or untracked source changes.
Keep finish notifications enabled and follow official asynchronous waiting rules. Do not poll running workers.

Use Paseo's workspace browser tools and current browser documentation. Browser tools need host enablement and a connected browser host.
Report missing capabilities. Do not switch to Orca. Use web search/fetch for research and GitHub CLI inspection for PRs and Actions.

Collect results and check evidence, integrate required changes, then archive disposable agents and temporary editing workspaces explicitly.
After a task branch is merged and its results are safely delivered, archive its completed disposable workspaces.
A merged branch alone does not remove its worktree. Paseo removes an owned worktree after its last active workspace reference is archived.
Verify removal through the native workspace list and the returned worktree path. Report cleanup failures instead of leaving them silent.
Retain blocked or unresolved workspaces. Never archive the coordinator workspace, a handoff recipient, or user-retained resources.
Cross-workspace children remain subagents. Archiving a parent does not prove that child workspaces were removed.
Handoffs name the receiving agent/workspace and leave detachment to the user. No timer-based cleanup or separate lifecycle collector.
