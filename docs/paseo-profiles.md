# Native Paseo profiles

This guide defines ten optional profiles: four roles and a dedicated UI Worker specialization, each with Codex and Claude variants.
The profiles save launch settings. They do not create ten running agents or install ten separate instruction systems.
Create only the profiles that you use.

Toolkit creates these profiles through an optional trusted-terminal setup command.
The same command offers the included native plugin for trusted Paseo MCP approvals in Codex and Claude.
The ordinary installer still leaves Paseo configuration unchanged.
The setup command offers a separate, default-off compact block for Paseo's System Prompt.
Paseo MCP trust defaults to on at the setup save confirmation. It enables the global plugin switch.
The plugin handles tool confirmations, including worker creation. Other servers, shell approvals, questions, and URL forms keep their existing handling.
Codex can include `properties: {}` in an empty confirmation schema. The plugin accepts that form and the form without `properties`.
The plugin leaves schemas with data fields pending. Its logs record successful approvals with request and agent IDs only.
Provider catalog limits and browser enablement still apply. Trust does not expand the user's assigned task.
Plugin type checks and isolated permission-routing tests pass. Live plugin acceptance requires deployment from a trusted human terminal.

The source references use Paseo `v0.10.3`, the version identified in the earlier host inspection.
Current provider documentation can describe newer behavior.
The selected daemon's discovery results and effective session settings remain the acceptance criteria.

## The four roles

| Role | Responsibility | Expected result | Default thinking |
|---|---|---|---|
| Orchestrator | Own delivery, useful delegation, integration, and cleanup | An integrated result with check evidence and remaining blockers | Medium |
| Planner | Investigate the code and resolve choices before implementation | A proposed plan with scope, dependencies, risks, and acceptance criteria | High |
| Worker | Complete an authorized, bounded assignment | Assigned changes with focused check evidence | Medium |
| Adviser | Answer a bounded question without implementation | A recommendation with evidence, tradeoffs, and uncertainty | Codex High, Claude Medium |

An Orchestrator can implement a small task directly. Delegation is not a requirement.
A Planner supports an interactive plan-and-approval workflow.
An Adviser supplies a completed judgment, not a pending implementation proposal.
A Worker starts after its scope and edit ownership are clear.
The UI Worker specializes the Worker role for frontend implementation and visual verification.
It deserves separate selection notes, not a separate orchestration architecture.

These roles are task instructions, not provider capabilities.
A profile label alone does not assign a role.
The task prompt must name the role and supply the actual objective.

## Codex permissions and Plan are separate

Paseo exposes three Codex permission modes and a separate Plan feature.
The mode IDs below come from the `v0.10.3` adapter.
These mappings apply without conflicting provider options or managed requirements.

| Paseo mode | `modeId` | Approval policy | Sandbox | Approval recipient |
|---|---|---|---|---|
| Default Permissions | `auto` | `on-request` | `workspace-write` | Human |
| Auto-review | `auto-review` | `on-request` | `workspace-write` | Codex approval reviewer for eligible requests |
| Full Access | `full-access` | `never` | `danger-full-access` | No routine approval prompts |

**Default Permissions** supports ordinary implementation.
It does not ask before every edit or command inside the permitted sandbox.
It asks when an action requires approval under the active policy.
The internal ID `auto` does not mean Auto-review.

**Auto-review** keeps the same sandbox preset but changes who evaluates eligible approval requests.
The reviewer can approve an action outside the routine sandbox boundary or deny it.
This mode reduces human interruptions. It does not guarantee safety or expand the configured writable roots by itself.
Routine actions that need no approval receive no approval review.

**Full Access** removes the preset sandbox boundary and routine approval prompts.
It is not necessary for planning, asking questions, orchestration, or normal implementation.
A worktree is not a security boundary for this mode.
Do not choose it merely because a worker needs to finish unattended.

Paseo `v0.10.3` advertises Auto-review as the default when its Codex version probe supports it.
The adapter's threshold is Codex `0.115.0`.
That host default is different from the mode named Default Permissions.
An explicit saved choice avoids dependence on the host's current default.

### Protected writes and denial reports

Workspace write access does not imply permission to write protected Git metadata.
If the active sandbox protects authorized Git metadata writes, request supported native escalation before execution.
For example, `git hash-object -w --stdin` writes into `.git/objects`.
Default Permissions can route the request to a human. Auto-review can route eligible requests to the approval reviewer.
An approved native escalation can permit execution outside the sandbox. Managed policy can still prohibit the operation.

Keep these outcomes distinct:

- A filesystem or sandbox denial reports failed execution. It does not create an approval request.
- A native approval request waits for the designated human or approval reviewer.
- An approval-review rejection rejects the requested action. Stop that action and report the stated reason.
- An explicit task prohibition remains binding until the user explicitly lifts it.

If the active policy and task permit escalation after a filesystem or sandbox denial, use supported native escalation.
Do not repeat the command under unchanged sandbox conditions or bypass the denial through another tool, path, worker, or mode.
General publication approval does not lift an explicit no-Git-write-retries restriction.
Do not change live permissions or grant yourself access.

Record the command, target, agent, effective permission mode, and denial type in the task report.
In the reported incident, the diagnostics worker in Default Permissions failed at `git hash-object -w --stdin`.
The write target was `.git/objects`. The publication worker stopped under the earlier no-Git-write-retries restriction.
A separate Full Access PostgreSQL worker succeeded. That result does not establish Git publication permission.
Do not attribute the diagnostics denial to either of those workers.

### The separate Plan feature

Codex uses `featureValues.plan_mode`, not a fourth entry in the permission-mode selector.

- `true` selects planning-only collaboration behavior.
- `false` selects implementation collaboration behavior.
- The selected permission mode remains a separate setting.

For example, a Codex Planner can use Default Permissions with Plan on.
An Orchestrator or Worker can use the same permission mode with Plan off.
Auto-review with Plan on still means a planning workflow with automatic approval review.
Full Access with Plan on still has the Full Access permission preset.

Plan controls the workflow. It does not change `workspace-write` into an OS-enforced read-only sandbox.
An analysis-only prompt also does not establish that boundary.
For strict read-only access, a human must deliberately configure and verify the provider's native sandbox or another isolation boundary.
This recipe does not change those settings.

### Is a planner that asks questions appropriate?

Yes. Codex Plan mode explicitly supports context gathering, clarification, and a proposal before implementation.
Questions are useful when an answer changes product behavior, scope, compatibility, risk, or acceptance criteria.
The Planner must first read the available repository evidence.
It must not ask the human to supply facts that the repository already contains.

For a primary planning conversation, the human answers the necessary questions.
For a delegated Planner, the Orchestrator supplies known decisions in the brief and relays unresolved human choices.
A question can leave the worker waiting for input. This is different from a tool approval or a failed task.
Neither Auto-review nor Full Access supplies the human's product decisions.

In Paseo `v0.10.3`, approving the Codex plan's Implement action sets `plan_mode` to `false`.
The adapter then starts an implementation prompt.
It preserves other features, including Fast, rather than resetting them.
For a planning-only worker, collect the proposal without approving Implement.
Before later implementation, select the intended Worker settings and verify the effective permissions.

For advice that needs no approval cycle, select an Adviser with Plan off and an analysis-only task prompt.

## Claude permission modes

Claude uses native `plan` mode, not Codex's `plan_mode` feature.
Paseo `v0.10.3` exposes these IDs:

| Paseo label | `modeId` | Purpose |
|---|---|---|
| Plan Mode | `plan` | Explore and propose changes before implementation |
| Always Ask | `default` | Manual approval flow for actions that require permission |
| Accept File Edits | `acceptEdits` | Approve in-scope edits automatically while retaining other approval handling |
| Auto mode | `auto` | Use Claude's action classifier instead of routine human approval |
| Bypass | `bypassPermissions` | Skip ordinary permission checks |

Claude's current documentation calls `default` Manual mode.
The native name and the Paseo label can differ.
Reads and pre-approved actions do not necessarily prompt in this mode.

Claude Plan mode changes native permission handling as well as planning instructions.
It is still not an OS sandbox.
Approving a Claude plan can also select an execution permission mode.
Verify that mode before implementation.

The conservative recipe below uses `default` for nonplanning Claude profiles.
An existing, deliberately selected `acceptEdits` or `auto` choice can remain instead.
Bypass is not the recommended solution to approval fatigue.
Claude Auto mode and Codex Auto-review have different implementations and policies.
Their similar names do not establish equivalent protection.

## Exact profile data

The records below provide the names, models, thinking IDs, mode IDs, features, and exact **When to use** text.
The canonical presets are in [paseo-profiles.json](../shared/hosts/paseo-profiles.json).
Setup reads their installed copies, not editable source.
They use the built-in `codex` and `claude` provider IDs as examples.

Before saving, replace each provider ID with the intended existing account alias if applicable.
Keep that exact alias during delegation. Do not fall back to another account after an authentication or quota error.
Default to the current session's provider family and exact account alias when selecting workers.
Another provider or account requires an explicit user request or authorization; its presence in the catalog is not enough.
If no matching profile exists, discover native settings for the current alias. Ask before launch if that alias is unknown.
An explicitly requested Claude child does not change a Codex primary session's provider.
Verify that the selected daemon exposes the model, thinking level, mode, and features.
If discovery does not expose a required value, leave the profile unvalidated rather than guessing a replacement.

The permission choices below are explicit recommendations for initial acceptance, not changes to existing choices.
If you retain another native permission mode, record its exact ID in the saved profile.
Keep Planner planning controls as specified.

```json
[
  {
    "name": "Toolkit Codex Orchestrator",
    "provider": "codex",
    "model": "gpt-6.1-sol",
    "thinkingOptionId": "medium",
    "modeId": "auto-review",
    "featureValues": { "plan_mode": false },
    "notes": "Use as the primary delivery coordinator. Own scope, useful delegation, integration, check evidence, handoffs, and cleanup. Complete small tasks directly. Put the actual assignment and authorization in the task prompt."
  },
  {
    "name": "Toolkit Claude Orchestrator",
    "provider": "claude",
    "model": "claude-opus-5-5",
    "thinkingOptionId": "medium",
    "modeId": "auto",
    "featureValues": { "fast_mode": false },
    "notes": "Use as the primary delivery coordinator. Own scope, useful delegation, integration, check evidence, handoffs, and cleanup. Complete small tasks directly. Put the actual assignment and authorization in the task prompt."
  },
  {
    "name": "Toolkit Codex Planner",
    "provider": "codex",
    "model": "gpt-6.1-sol",
    "thinkingOptionId": "high",
    "modeId": "auto-review",
    "featureValues": { "plan_mode": true },
    "notes": "Use for a substantial implementation proposal before authorization. Read the code, resolve choices, and define scope, dependencies, risks, and acceptance criteria. Ask only necessary unresolved questions. Collect the plan without approving Implement for a planning-only assignment."
  },
  {
    "name": "Toolkit Claude Planner",
    "provider": "claude",
    "model": "claude-opus-5-5",
    "thinkingOptionId": "high",
    "modeId": "plan",
    "featureValues": { "fast_mode": false },
    "notes": "Use for a substantial implementation proposal before authorization. Read the code, resolve choices, and define scope, dependencies, risks, and acceptance criteria. Ask only necessary unresolved questions. Collect the plan without approving implementation for a planning-only assignment."
  },
  {
    "name": "Toolkit Codex Worker",
    "provider": "codex",
    "model": "gpt-6.1-sol",
    "thinkingOptionId": "medium",
    "modeId": "auto-review",
    "featureValues": { "plan_mode": false },
    "notes": "Use for authorized, bounded implementation, debugging, or verification. Require explicit edit ownership and observable acceptance criteria. Return changes, focused check evidence, and blockers. Do not delegate or publish without authorization in the task prompt."
  },
  {
    "name": "Toolkit Claude Worker",
    "provider": "claude",
    "model": "claude-opus-5-5",
    "thinkingOptionId": "medium",
    "modeId": "auto",
    "featureValues": { "fast_mode": false },
    "notes": "Use for authorized, bounded implementation, debugging, or verification. Require explicit edit ownership and observable acceptance criteria. Return changes, focused check evidence, and blockers. Do not delegate or publish without authorization in the task prompt."
  },
  {
    "name": "Toolkit Codex UI Worker",
    "provider": "codex",
    "model": "gpt-6.1-sol",
    "thinkingOptionId": "medium",
    "modeId": "auto-review",
    "featureValues": { "plan_mode": false },
    "notes": "Use for authorized frontend implementation: components, layout, styling, responsive behavior, accessibility, and interaction states. Reuse the existing framework and design system. Require assigned files, observable acceptance criteria, and visual verification when browser access is available. Report missing browser verification explicitly."
  },
  {
    "name": "Toolkit Claude UI Worker",
    "provider": "claude",
    "model": "claude-opus-5-5",
    "thinkingOptionId": "medium",
    "modeId": "auto",
    "featureValues": { "fast_mode": false },
    "notes": "Use for authorized frontend implementation: components, layout, styling, responsive behavior, accessibility, and interaction states. Reuse the existing framework and design system. Require assigned files, observable acceptance criteria, and visual verification when browser access is available. Report missing browser verification explicitly."
  },
  {
    "name": "Toolkit Codex Adviser",
    "provider": "codex",
    "model": "gpt-6.1-sol",
    "thinkingOptionId": "high",
    "modeId": "auto-review",
    "featureValues": { "plan_mode": false, "fast_mode": false },
    "notes": "Use for a completed recommendation or second opinion on a bounded question. Require an analysis-only assignment with evidence, alternatives, and uncertainty. Do not edit, approve implementation, delegate, or publish."
  },
  {
    "name": "Toolkit Claude Adviser",
    "provider": "claude",
    "model": "claude-opus-5-5",
    "thinkingOptionId": "medium",
    "modeId": "auto",
    "featureValues": { "fast_mode": false },
    "notes": "Use for a completed recommendation or second opinion on a bounded question. Require an analysis-only assignment with evidence, alternatives, and uncertainty. Do not edit, approve implementation, delegate, or publish."
  }
]
```

These records omit the required `id` field because they describe new profiles before creation.
Automation must assign IDs and preserve IDs for existing entries.
Paseo stores profiles under `daemon.agentProfiles` in `$PASEO_HOME/config.json`.
The inspected agent MCP catalog exposes `list_profiles`, not a profile-creation tool.
That limitation does not mean that configuration automation is unsupported.

The profile schema deliberately excludes a system prompt.
The native SDK supports `config.systemPrompt` for agent creation, but that is not a saved profile instruction field.
The agent MCP launch interface uses `initialPrompt` for the assignment and has no `profile` argument.

### Supported automation route

From the checkout in a trusted human terminal:

```sh
./install.sh
./setup-paseo.sh
```

`setup-paseo.sh` honors `PASEO_HOME` and explicitly selects that local home for every native command.
It does not target `PASEO_HOST` or configure a remote daemon from the client machine.
The selected local daemon must already run and expose its providers.
The installed copies must include the new profile presets, role instructions, and context template.

Setup asks once per provider family for the existing account alias and deliberate permission mode.
The defaults are Codex `auto-review` and Claude `auto`. Claude Planner retains `plan`.
Codex Auto-review retains the workspace sandbox. Claude Auto uses its native approval classifier.
Existing profiles retain their saved modes during setup. Change those modes deliberately through the native profile editor.
Enter `-` to skip a family.
It separately offers compact context for default primary orchestration and Toolkit guidance references.
The setup choice defaults to off and leaves the System Prompt unchanged.
Setup also asks whether to trust Paseo MCP calls through the native plugin. The default accepts this option.
This option enables trusted, unsandboxed plugins on the selected daemon. Enter `n` to retain existing plugin settings.
Setup then shows the selected changes and asks for one save confirmation.
This avoids ten separate forms without guessing accounts or silently choosing broader permissions.
The inspected native model command lowercases provider IDs.
Setup refuses mixed-case aliases rather than querying an unintended account.
For those aliases, use the native editor with the exact existing ID.

Setup uses Paseo's existing CLI, not a new SDK dependency:

- `daemon config get daemon.agentProfiles` establishes native profile support.
- `provider ls` and `provider models <alias> --thinking` establish provider, model, and thinking availability.
- `daemon config set daemon.agentProfiles <complete-list>` validates and saves the merged profiles.
- When selected, `daemon config set daemon.appendSystemPrompt <text>` saves the compact context while preserving human text.

Paseo's SDK also supports `client.config.get()` and `client.config.patch({ agentProfiles: nextProfiles })`.
Its own profile editor uses the same configuration mechanism.
The mutable API field is `agentProfiles`, while the persisted file nests it under `daemon`.
The CLI avoids another dependency for this one-time administrative setup.

The profile array is a whole-list replacement, not an entry-by-entry merge.
Setup keeps existing matching names unchanged, including their IDs, notes, accounts, modes, models, and features.
It also preserves unrelated profiles.
It stops on duplicate names, ID collisions, or unsupported selections.
When context installation is selected, a changed or unowned context block also stops setup.
Existing profiles that differ from the recipe remain human choices, not automatic update targets.

Setup backs up the exact original configuration in a private directory under `~/.local/share/agent-toolkit/backups/paseo-*`.
An ownership receipt lives under `~/.local/share/agent-toolkit/paseo-<home-hash>.json`.
Repeated setup adds only missing profiles. Context updates require a separate selection and an unchanged, owned block.
Selected tool trust reloads or enables an existing plugin from the installed Toolkit path. A conflicting source requires manual reconciliation.
The native CLI can reformat its configuration. The backup retains the original bytes.

Keep the profile editor and other configuration writers idle during setup.
The native CLI has no compare-and-swap contract.
Toolkit checks for concurrent edits but cannot eliminate every read-and-save race.
The profile save and context save are separate native operations.
If a command fails after persistence, setup stops and reports its private backup.
A file-only save or a reported runtime override also stops setup for human inspection.
It does not retry a denial, roll back concurrent human changes, or restart the daemon.
Inspect any partial save before deliberate recovery.

Setup does not enable tool injection, change provider commands or credentials, launch workers, or configure an OS sandbox.
Feature discovery and effective security still require the fresh-session acceptance steps.
Before launch, the coordinator uses native `inspect_provider` with the exact provider and selected settings.
Only returned feature IDs are used. An unavailable required planning control stops that profile's launch.
Installation and updates do not silently rerun setup or reset profiles.
Manual creation remains an available fallback.

### Updates and customization

`./update.sh` refreshes installed skills and host guidance. It does not change saved profiles or rerun Paseo setup.
Rerun `./setup-paseo.sh` to add missing presets. Select context refresh only if you use its owned block.
Existing matching profiles keep their IDs, accounts, models, effort, modes, features, and notes.
Compare deliberate changes with the canonical presets, then edit through native Paseo settings.
Start fresh sessions to verify the installed guidance and effective launch settings.

Setup adds up to five missing profiles for each selected provider family.
Use the native editor to create only individual presets or select modes outside setup's offered choices.
The setup choices are Codex `auto` and `auto-review`, and Claude `default`, `acceptEdits`, and `auto`.
Claude Planner uses native `plan` mode.
Existing profiles with other modes remain unchanged.

### Startup instructions versus the System Prompt

The rebuilt installer appends shared guidance to native `AGENTS.md` and `CLAUDE.md` files.
Paseo's providers load that guidance from their selected homes.
The ordinary installer does not change `daemon.appendSystemPrompt` or saved profiles.
When deliberately selected, setup adds a small marked context block to that daemon field.
The block identifies fresh Paseo ownership and points to the installed startup, host, and role guidance.
It defaults primary delivery sessions to Orchestrator, while preserving explicit roles, native Plan mode, and delegated assignments.
For your default orchestration workflow, enable this compact context once. No repeated role prompt is necessary for primary delivery tasks.
If native startup guidance is already present, the agent does not need another full copy.
If it is absent, the block directs the agent to read the installed shared guidance.

Shared instructions are essential. The System Prompt field is one delivery mechanism, not the only valid mechanism.
A full duplicate of every skill increases context without supplying new instructions.
A global prompt also cannot make every session a Planner, Worker, Adviser, and Orchestrator at once.
The profile schema deliberately excludes role system prompts.

The extra daemon prompt is optional for skill discovery and coding guidance.
Native provider instruction files already supply the shared skill rules across every profile.
Enable the compact context for default primary orchestration or missing host ownership and guidance references.
Do not copy complete skills or a second native tool manual into it.
A prompt cannot enable unavailable tools or enforce an OS sandbox.

The installed [role instructions](../shared/hosts/paseo-roles.md) give the coordinator reusable behavior for each role.
The coordinator names the selected role in each worker's initial prompt and supplies the actual brief.
Shared startup guidance, profile launch settings, and task instructions remain separate.
Creating profiles automatically does not make their selection notes into worker system prompts.

### Feature details

The `v0.10.3` adapter exposes Fast for Astra and Opus 5.5.
Its Codex Fast allowlist does not include `gpt-6.1-sol`, so the Sol records omit that feature.
If your daemon exposes Fast for Sol, save `fast_mode: false` there too.
Only use feature IDs returned by discovery for the exact provider and model.

Claude has no `plan_mode` feature in this recipe.
Its Plan control is `modeId: "plan"`.
Select `medium` or `high`, not the separate Ultra Code thinking choice.
Verify that no existing native setting still activates a usage multiplier.

Absent optional values stay absent.
An explicit `false` must remain present during profile selection and worker launch.
The inspected editor can display Off without saving an explicit false value.
If a required false value is absent after saving, toggle On, then Off, and save again.

## Instruction text

Profile notes guide selection. They do not become the worker's system prompt.
Put the common block, one role block, and the actual brief in the first prompt or delegated `initialPrompt`.
The same role block serves both provider variants.
Use these prompts only in a fresh Paseo-owned session.

The installed startup guidance still supplies recurring skills and review rules.
Do not duplicate all skill bodies in these prompts.
Setup supplies only a compact daemon context block and references the installed role guidance.

### Common block

```text
Read the applicable repository instructions and installed Toolkit startup guidance.
Use only the current session owner's host guidance.
Preserve unrelated edits and existing account, provider, model, reasoning, and permission choices.
For coding tasks, load Ponytail and keep full mode unless the user selects another mode.
For test work, load Test Audit.
For Markdown work, read the full Simple English skill and use pragmatic mode.
Use the smallest correct solution and the smallest directly relevant deterministic checks.
Preserve the review mode supplied in the task brief.
Do not start an AI review merely because edits or checks finish.
At an authorized publication boundary, apply the installed review gates unless automatic reviews are off.
Do not commit, push, open a PR, merge, deploy, or publish unless the task explicitly authorizes that action.
Do not use production services or existing databases without explicit target and cleanup authorization.
Do not change live permissions or evade a hard denial.
Ask only for decisions that repository evidence and the task brief cannot resolve.
Report missing evidence, blockers, and uncertainty rather than claiming unverified success.
```

### Orchestrator block

```text
Act as Orchestrator for the task in the brief.
Own the scope, implementation result, integration, focused checks, and final report.
Complete small tasks directly rather than delegating for its own sake.
Before Paseo operations, read the official Paseo skill and applicable host guidance.
Before choosing workers, call list_profiles and read every profile's notes.
Honor requested profiles and preserve exact account aliases.
Materialize the chosen profile's model, mode, thinking, and features through the official creation interface.
Explain a proposed task-specific effort adjustment before launch.
Choose each editing worker's workspace from the repository that owns its assigned files.
For cross-repository tasks, split edit ownership by repository and pass each target workspaceId explicitly to create_agent.
For independent parallel edits, create separate worktree-backed workspaces with explicit base refs and disjoint edit ownership.
Verify that each worker has the required evidence, including any required uncommitted source changes.
Give each worker an objective, permitted actions, ownership, constraints, acceptance criteria, review mode, and publication limits.
Keep finish notifications enabled and obey the official asynchronous waiting rules.
Do not poll running workers.
For a planning-only worker, collect the proposal without approving its Implement action.
Relay necessary unresolved human choices rather than inventing an answer.
Collect each result and its check evidence before integration.
Verify the integrated result against the acceptance criteria.
Preserve required results before archiving disposable agents and temporary editing workspaces.
Retain blocked, unresolved, active, handoff, and user-retained resources.
Report the integrated result, check evidence, blockers, and retained resources.
```

### Planner block

```text
Act as Planner for the task in the brief.
This assignment authorizes investigation and a proposed plan, not implementation.
Read the relevant code, callers, repository instructions, and supplied evidence first.
Use the provider's native planning control.
Do not edit project files, install dependencies, start services, delegate, or publish for this assignment.
Use permitted inspection tools without changing project state.
Ask only when an unresolved decision changes scope, behavior, compatibility, risk, or acceptance criteria.
For delegated work, direct unresolved choices to the Orchestrator and identify any required human decision.
State assumptions for reversible details that need no human decision.
Choose the smallest viable approach rather than listing unnecessary architectures.
Return the current behavior, proposed change, affected paths, dependencies, risks, and observable acceptance criteria.
Include the focused verification commands and useful worker boundaries.
Identify cross-repository contracts and integration order when the task spans repositories.
Stop after the proposal and necessary questions.
Do not approve or start implementation yourself.
```

Native providers can create their own plan or session artifacts.
The no-edit instruction concerns project files and implementation side effects.
For a strict no-write requirement, verify an independent native access boundary before launch.

### Worker block

```text
Act as Worker for the task in the brief.
Implement only the authorized objective within the assigned edit ownership.
Read the relevant code and callers before changing it.
Use implementation settings, not a pending planning-only workflow.
Preserve unrelated changes and avoid speculative abstractions, dependencies, or cleanup.
If the fix requires another worker's files or a scope change, report the dependency before editing them.
Do not delegate or change provider settings unless the brief explicitly authorizes it.
Run the smallest directly relevant deterministic checks.
Do not start services or database tests until their target, credentials, ownership, and cleanup are clear.
Do not publish or start an independent AI review unless the brief and active review policy authorize it.
Return the changed paths, behavior, exact check commands and results, and remaining blockers.
Identify the branch or workspace containing the result.
Leave lifecycle cleanup to the Orchestrator.
```

### UI Worker supplement

Use the Worker block and this supplement for either UI Worker variant:

```text
Act as UI Worker within the assigned Worker scope.
Read the existing framework conventions, components, styles, and design system first.
Reuse existing UI primitives and dependencies.
Load the applicable framework skill, including Vue for Vue work.
Preserve keyboard access, semantic controls, focus behavior, and accessible labels.
Cover loading, empty, error, disabled, and success states that apply to the task.
Verify the requested responsive sizes and interaction behavior.
For visual verification, use only the session owner's supported browser workflow.
Do not start a service until its target, credentials, ownership, and cleanup are clear.
If browser access is unavailable, report visual verification as incomplete.
Do not substitute passing unit tests for a visual check.
Do not broaden the task into a redesign or add a component library without authorization.
Return changed paths, focused check evidence, visual observations, and remaining gaps.
```

Medium remains the saved default. High fits difficult state handling, accessibility interactions, or frontend integration.
Neither provider has a demonstrated UI advantage in this recipe.
React Doctor remains explicit-request only.

### Adviser block

```text
Act as Adviser for the question in the brief.
This is an analysis-only assignment, not implementation or an automatic code review.
Read the supplied evidence and relevant code without changing project state.
Do not edit files, install dependencies, start services, approve implementation, delegate, or publish.
Return a direct recommendation with evidence and the most relevant alternative.
Separate observed facts, assumptions, and preferences.
State uncertainty and the smallest useful way to resolve it.
Do not claim that a provider, model, effort level, or host performs better without relevant evidence.
Ask only for a missing decision or fact necessary to answer the question.
Stop after the recommendation.
```

### Actual task brief

Replace every placeholder before launch:

```text
Assigned role: <Orchestrator, Planner, Worker, UI Worker, or Adviser>
Objective or question: <specific outcome>
Repository and workspace: <exact paths and workspace ID>
Base ref and required evidence: <explicit ref, paths, and dirty changes that must be available>
Known decisions: <requirements already settled>
Permitted actions: <inspection, assigned edits, commands, and allowed fixture use>
Edit ownership: <exact files or directories, or none>
Constraints and dependencies: <interfaces, compatibility, other workers, and exclusions>
Acceptance criteria: <observable behavior and focused checks>
Review mode: <reviews:auto or reviews:off>
Publication authorization: <none, or exact authorized action and target>
Delegation authorization: <none, or allowed worker scope>
Expected result: <plan, integrated change, bounded changes, or recommendation>
Cleanup ownership: <coordinator and resources to retain>
```

A profile does not supply the brief, inherit the parent's entire conversation, or synchronize uncommitted changes.
A new worktree contains committed history unless the coordinator deliberately supplies additional evidence.

### Placement across repositories

Paseo inherits the coordinator's workspace when an agent-scoped `create_agent` call omits `workspaceId`.
Mentioning another repository in the task prompt does not change the worker's workspace.
For a task across tracking-web and tracking-api, the coordinator can remain in tracking-web.
The web worker uses a tracking-web workspace, and the API worker uses a tracking-api workspace.

Identify the repository that owns each worker's assigned files before launch.
Discover an appropriate workspace in that repository through the official native interfaces.
For independent parallel edits, create a worktree-backed workspace in the target repository with an explicit base ref.
Pass the target checkout as `create_workspace.path` to avoid inheriting the coordinator's repository.
Pass the target workspace ID explicitly to `create_agent`.
Include the repository path and workspace ID in the brief.
Verify the returned workspace and required source evidence before further instructions.

Workspace placement does not change provider, account, parentage, review policy, or publication authorization.

## Reasoning and model choices

Medium is the routine starting point for Orchestrator, Worker, and Claude Adviser.
Codex Adviser uses Sol with High effort for bounded second opinions.
High is the Planner default for substantial choices, risks, dependencies, and acceptance criteria.
For a straightforward plan, select Medium before launch.

High also fits difficult debugging, migrations, concurrency, security-sensitive work, and cross-repository integration.
It is not reserved for the Planner, and it does not require a failed Medium attempt first.
Select effort for the task. Keep the same profiles rather than creating an effort variant for every role.

Higher effort does not inherently cause overengineering.
Scope and Ponytail govern implementation size. Verification governs whether the result works.
Higher effort can increase latency and usage without helping a routine task.
Compare correctness, corrections, elapsed time, and actual usage on representative tasks.

OpenAI documents Medium as Sol's API default.
Anthropic recommends explicit Medium as the Opus 5.5 calibration starting point.
API defaults do not prove effective Paseo launch settings.
Effort labels do not represent equal reasoning budgets across providers or models.
Extra High, Max, and Ultra Code are not routine defaults in this recipe.

Astra remains an optional task-specific choice. The Codex Adviser default is Sol with High effort.
Sonnet 5.5 is an optional Worker adjustment after task-level comparison.
Honor explicit human model and effort choices rather than substituting automatically.

## Create and verify the profiles

Use the [automatic setup command](#supported-automation-route) for the selected local daemon.
The following procedure remains a manual alternative:

1. Select the affected daemon host in Paseo.
2. Open **Settings → your host → Agents → Agent profiles**.
3. Select **New profile**.
4. Copy a record's name and **When to use** notes.
5. Select the intended existing provider/account alias.
6. Select the exact model and thinking level explicitly.
7. Select the deliberate permission mode.
8. Save the required planning and Fast values exposed by discovery.
9. Save the profile.
10. Repeat for the profiles you need.

The records are a complete catalog, not a requirement to create all ten.
Saved changes affect future selections, not running agents.
Keep unrelated profiles and provider settings.

For delegation, enable **Settings → your host → Agents → Enable Paseo tools**.
Start a fresh agent or reload it after that deliberate host change.
Install the official Paseo skill through the host's supported skill workflow.
Tool injection is off by default.

Ask the fresh Paseo agent to inspect `list_profiles`, `list_providers`, and the selected provider's discovery results.
Verify exact aliases, models, thinking IDs, modes, and explicit feature values.
When provider options overlap a mode preset, provider options take precedence.
Inspect the effective native sandbox, approval policy, network access, and writable roots rather than trusting a mode label.

There is no `profile` argument on `create_agent`.
The official skill maps the selected profile as follows:

| Saved field | Launch field |
|---|---|
| `provider` and `model` | `provider` as the exact `provider/model` pair |
| `modeId` | `settings.modeId` |
| `thinkingOptionId` | `settings.thinkingOptionId` |
| `featureValues` | `settings.features` |
| `notes` | Selection guidance, not a launch instruction field |
| Common block, role block, and brief | `initialPrompt` |

Discover a model for the exact provider when a saved profile has none.
Copy explicit false values without filtering them out.
Leave finish notifications enabled for supervised workers.

Before relying on the recipe:

- Verify actual skill loading in fresh sessions through [Toolkit acceptance](../README.md#installation-and-fresh-session-acceptance).
- Verify that an Adviser leaves project files unchanged.
- Verify that a Planner asks a meaningful unresolved question and stops without implementation.
- In a disposable trial only, verify that approving a plan enters the intended implementation settings.
- Verify that a Worker changes only its assigned files and returns focused check evidence.
- Verify isolated parallel edits, integration, finish notifications, idle resume, and explicit cleanup.

Focused fixture checks cover merges, preserved choices, backups, repetition, refusal, and partial saves.
They substitute native persistence and do not prove live CLI compatibility, feature support, or sandbox behavior.
No live acceptance or coding-quality benchmark was performed for this recipe.

## Code review remains separate

A saved Reviewer profile is not necessary for Toolkit's change-bundle reviews.
AutoReview's existing skill-local helper owns reviewer isolation, collection, and reports.
Ponytail Review retains its complexity-review gate.
An Adviser is not a way to bypass the active review policy with an unrequested second-model review.

For an explicit or qualifying review, read the applicable skill first.
Use the helper in the intended native account context:

| Engine | Explicit helper settings |
|---|---|
| Codex | `--engine codex --model gpt-6.1-sol --thinking high` |
| Claude | `--engine claude --model claude-opus-5-5 --thinking high` |

These settings do not select a Paseo account alias.
Reviewer effort is independent of worker effort.
Medium is an optional adjustment for a deliberately lightweight explicit review.
The explicit Claude model matters because the pinned helper's default differs from this recipe.

Codex **Auto-review** evaluates approval requests.
Toolkit **AutoReview** evaluates a change bundle.
`reviews:off` disables automatic Toolkit reviews, not native approval handling.
Neither review system configures the other.

## Sources

- [Paseo profiles](https://paseo.sh/docs/agent-profiles.md): saved fields, selection notes, and human creation workflow.
- [Paseo CLI targeting](https://github.com/getpaseo/paseo/blob/v0.10.3/public-docs/cli.md#select-one-daemon): explicit local `--home` selection overrides environment targets.
- [Paseo configuration edits](https://paseo.sh/docs/configuration): native saves, runtime application, partial failures, and deployment overrides.
- [Paseo SDK configuration](https://paseo.sh/docs/sdk/reference.md#clientconfig): native configuration reads and patches.
- [Paseo v0.10.3 profile schema](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/protocol/src/agent-profile.ts): profile IDs, fields, and deliberate exclusion of system prompts.
- [Paseo v0.10.3 profile persistence](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/app/src/agent-profiles/internal/use-agent-profiles.ts): the editor's whole-list native configuration patch.
- [Paseo v0.10.3 data model](https://github.com/getpaseo/paseo/blob/v0.10.3/docs/data-model.md): persisted `daemon.agentProfiles` and runtime-safe configuration handling.
- [Paseo MCP reference](https://paseo.sh/docs/mcp.md): profile-to-launch mapping and tool injection.
- [Paseo orchestration](https://paseo.sh/docs/orchestration.md): mixed-provider workers and finish notifications.
- [Paseo provider options](https://paseo.sh/docs/sdk/provider-options.md): strict keys, deep merge, and precedence over modes.
- [Paseo v0.10.3 provider manifest](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/protocol/src/provider-manifest.ts): exact mode IDs and labels.
- [Paseo v0.10.3 Codex adapter](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/server/src/server/agent/providers/codex-app-server-agent.ts): mode presets, version gate, separate planning control, questions, and implementation transition.
- [Paseo v0.10.3 Codex features](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/server/src/server/agent/providers/codex-feature-definitions.ts): Plan and model-specific Fast support.
- [Paseo v0.10.3 Claude models](https://github.com/getpaseo/paseo/blob/v0.10.3/packages/server/src/server/agent/providers/claude/model-manifest.ts): model IDs, effort IDs, Ultra Code, and Fast support.
- [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review): approval-review scope, denials, and limits.
- [Codex manual](https://developers.openai.com/codex/codex-manual): Plan mode and clarifying questions.
- [Claude permission modes](https://code.claude.com/docs/en/permission-modes): native permissions, planning, and approval behavior.
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning) and [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): task-based effort choices.
- [Opus 5.5 calibration](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5): explicit Medium and model-specific effort budgets.
