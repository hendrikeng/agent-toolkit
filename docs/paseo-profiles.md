# Native Paseo profiles

Toolkit defines twelve optional Paseo profiles: five roles with Codex and Claude variants, and two High effort variants.
A profile saves launch settings: provider, model, effort, permission mode, and features.
A profile does not start an agent or give it a system prompt. Create only the profiles that you use.
The values come from [paseo-profiles.json](../shared/hosts/paseo-profiles.json).

## Profiles

| Profile | Model | Effort | Mode | When to use |
|---|---|---|---|---|
| Toolkit Med - Codex Orchestrator | `gpt-6.1-sol` | Medium | `auto-review` | Default primary session |
| Toolkit Med - Claude Orchestrator | `claude-opus-5-5` | Medium | `auto` | Default primary session |
| Toolkit High - Codex Orchestrator | `gpt-6.1-sol` | High | `auto-review` | Primary session for hard work: migrations, concurrency, security, difficult integration |
| Toolkit High - Claude Fable Orchestrator | `claude-fable-5-2` | High | `auto` | Primary session for hard work |
| Toolkit High - Codex Planner | `gpt-6.1-sol` | High | `auto-review`, `plan_mode: true` | Plan substantial work before implementation |
| Toolkit High - Claude Fable Planner | `claude-fable-5-2` | High | `plan` | Plan substantial work before implementation |
| Toolkit Med - Codex Worker | `gpt-6.1-sol` | Medium | `auto-review` | Bounded implementation and checks |
| Toolkit Med - Claude Worker | `claude-opus-5-5` | Medium | `auto` | Bounded implementation and checks |
| Toolkit Med - Codex UI Worker | `gpt-6.1-sol` | Medium | `auto-review` | Frontend, accessibility, and browser checks |
| Toolkit Med - Claude UI Worker | `claude-opus-5-5` | Medium | `auto` | Frontend, accessibility, and browser checks |
| Toolkit Med - Codex Adviser | `gpt-6.1-sol` | Medium | `auto-review` | Second opinion on a bounded question, no edits |
| Toolkit Med - Claude Adviser | `claude-opus-5-5` | Medium | `auto` | Second opinion on a bounded question, no edits |

Codex profiles set `plan_mode: false` unless the table says otherwise. Claude profiles set `fast_mode: false`.
Codex Plan is the `plan_mode` feature, separate from the permission mode. Claude Plan is `modeId: "plan"`.
Plan mode controls the workflow. It is not a read-only sandbox.
Codex `auto-review` and Claude `auto` are different systems. Their similar names do not give the same protection.

Each name starts with its saved effort. A model name, such as `Fable`, comes before the role only when the model is not the default for its provider.

## Create the profiles

From the checkout in a trusted human terminal, run `./install.sh` and then `./setup-paseo.sh`.
The [README](../README.md#profiles-and-setup) describes the setup prompts, backups, and tool trust.
Setup asks for the account alias and permission mode for each provider family. Enter `-` to skip a family.
Setup adds missing profiles only. It does not change existing profiles.

As a manual alternative, open **Settings → your host → Agents → Agent profiles** and copy the values from the table.
Use only values that the daemon discovery shows for the exact provider and model.
If the editor shows Off but does not save an explicit `false`, toggle the value On, then Off, and save again.

### Updates and customization

`./update.sh` refreshes installed skills and guidance. It does not change saved profiles.
To add new profiles, run `./setup-paseo.sh` again. For a profile-only update, decline the context refresh and enter `n` for tool trust.
Keep the profile editor idle during setup.
To change an existing profile, use the native Paseo editor.
Start fresh sessions after an update. Resumed sessions keep their old settings.

## Effort

- Medium is the start for Orchestrator, Worker, UI Worker, and Adviser.
- High fits planning, difficult debugging, migrations, concurrency, security, and difficult integration. A failed Medium attempt is not a requirement.
- A High Orchestrator does not raise worker effort. To use High workers, ask for them in the task.
- Higher effort adds latency and usage. It does not fix scope. Ponytail and the checks control scope and correctness.
- Extra High, Max, and Ultra Code are not routine defaults.
- Honor explicit human choices of model and effort.

## Fable

The Claude High Orchestrator and Planner use Fable 5.2. All other Claude profiles use Opus 5.5.
At API prices, Fable costs two times more per token than Opus. Cache reads cost the same.
Fable delegates bounded work to Medium Opus Workers with short briefs. Its native subagents also use Opus.
To make Opus the default for native subagents, set `CLAUDE_CODE_SUBAGENT_MODEL` to `claude-opus-5-5` in the `env` block of the Claude `settings.json`.

## Roles and briefs

Profile notes help to select a profile. They do not become instructions for the worker.
The [role instructions](../shared/hosts/paseo-roles.md) give the behavior for each role.
The coordinator names the role in the worker's first prompt and gives the scope, edit ownership, acceptance criteria, review mode, and publication limits.
`create_agent` has no `profile` argument. Copy the profile's provider, model, mode, effort, and features into the launch settings.

Native code review is separate from these profiles. See [code-review.md](code-review.md).
Use [Toolkit acceptance](toolkit-acceptance.md) to test profiles in fresh sessions.
