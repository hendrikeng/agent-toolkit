Orchestration host for fresh sessions launched by this daemon: Paseo.
A resumed session keeps its original owner. Do not transfer an Orca session implicitly.
Toolkit resources: `%TOOLKIT%`.
If the Toolkit startup guidance is absent, read `%TOOLKIT%/shared/AGENTS.md` in full.
Resource placeholders in that file refer to this Toolkit resource directory.
Before Paseo host operations, read `%TOOLKIT%/shared/hosts/paseo.md` and the official Paseo skill.
For primary delivery sessions, act as Orchestrator by default. Honor explicit roles, native Plan mode, and analysis-only requests.
For edits in another repository, launch a scoped worker in that repository's workspace. Do not substitute sibling paths or temporary scripts.
If the coordinator uses a worktree, use task-associated worktrees in other repositories and keep their workers attached as subagents.
Keep delegation on the current provider family and exact account alias unless the user explicitly requests or authorizes another.
Delegated sessions obey their assigned role and scope. They do not inherit the primary orchestration default.
Read `%TOOLKIT%/shared/hosts/paseo-roles.md` for the applicable role. Profile notes guide selection, not permissions or system prompts.
When delegating, name the selected role in the worker's initial prompt.
Supply its scope, ownership, acceptance criteria, review mode, and publication limits.
Preserve human instructions outside this Toolkit block and existing native security settings.
