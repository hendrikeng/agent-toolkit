# Agent Toolkit

Agent Toolkit provides reviewed skills, Pi extensions, safety policy, and launchers for Claude Code, Codex, Pi, and Orca.

## Requirements

- Node.js 24
- Git
- At least one supported agent CLI
- Orca for `/graph` and Orca notifications
- TruffleHog on `PATH` for AI reviews

## Install

Clone with the pinned blueprint submodule:

```bash
git clone --recurse-submodules https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
```

### Install or update with the new defaults

Review the [development-root contract](docs/permission-rewrite-operations.md) before installation.

From a human terminal in this checkout, run:

```sh
./install.sh
```

For the permission-rewrite worktree on this machine, the complete command is:

```sh
cd /Users/hendrik/orca/workspaces/agent-toolkit/permission-rewrite
./install.sh
```

### Activate the installation

After successful installation, exit the old Pi session. Start a fresh session from your project directory:

```sh
pi-yolo
```

`pi-yolo` defaults to `openai-codex/gpt-5.6-sol` with medium thinking. Explicit `--model` and `--thinking` options override those defaults.
Source changes and `/reload` do not update installed permissions.
The message `repository execution requires trust` identifies the old runtime. Repository-trust approval is not the migration procedure.
`./install.sh` is the only installation mode and updates the installed toolkit after its preflight checks pass.

Make sure that `~/.local/bin` is on `PATH`.

The installer:

- Links reviewed skills and Pi extensions into the agent directories.
- Installs pinned Pi packages and Ponytail.
- Installs the `pi-yolo`, `codex-yolo`, and `claude-yolo` launchers.
- Configures safety policy without replacing user-owned configuration.
- Moves replaced files to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

Pi retains its selected permission bundle for the session. `/reload` does not install or change that bundle.
After a reviewed installation, start a fresh session.

On macOS, install the review scanner with Homebrew:

```bash
brew install trufflehog
```

Autoreview stops before the model call if TruffleHog is missing or scanning fails.

## Included tools

| Tool | Purpose |
|---|---|
| `autoreview` | Run a risk-gated or explicit second-model review. |
| Ponytail | Prefer the smallest correct implementation. |
| `/project` | Audit, adopt, or create a project from the pinned blueprint. |
| `/graph` | Plan or separately execute a coordinator-owned task graph. |
| `/account` | Switch the active Pi and Codex account by email. |
| `/fast` | Control the OpenAI Codex Fast service tier. |
| `/side` | Run an isolated side conversation. |
| `/push` | Perform one reviewed, non-force Git push. |
| `/reviews` | Control automatic risk-gated AI reviews. |
| `/skills-update` | Update this toolkit and reinstall its resources. |
| Web access | Load web tools only when external information is necessary. |
| Figma MCP | Load local Figma Desktop tools only for Figma tasks. |

The toolkit also includes guidance for design exploration, FastAPI, Fastify, Python, Vue, Simple English, React Doctor, and DeepSec.

## Safety

Claude Code and Codex use their native workspace sandboxes. Pi uses `pi-permission-system` for command and path policy.

The yolo launchers remove routine approval prompts but preserve explicit denies. They block common destructive commands and sensitive credential paths.

Pi permits normal filesystem access within `~/Code` and `~/orca/workspaces`, including worktrees outside the current checkout.
The accepted `development-roots-v1` contract also permits ordinary builds, tests, scripts, interpreters, and local dependencies within these physical roots.
It covers future directories without repository-trust approvals. Existing sessions retain their earlier contract.
Private keys, credentials, and environment files retain separate path restrictions. Graph writes remain limited to the active task's approved paths.

Use these launchers for unattended work:

```bash
pi-yolo
codex-yolo
claude-yolo
```

`codex-yolo` keeps the Codex workspace sandbox. `claude-yolo` keeps its network restrictions and full-escape block.

In Pi, `/push` is the only unattended push path. It refuses dirty, detached, behind, or untracked repositories.

Keep irreplaceable data in versioned backups. These controls reduce accidents but do not replace backups.

The Git guard rejects unattended rebases, remote mutations, and executable/configuration overrides during init, clone, and fetch. Remote inspection remains available, with `remote show -n` for offline details. Graph checks remove inherited Git overrides and keep credential prompts disabled.
The guard accepts `GIT_CONFIG_COUNT=0` and the exact non-interactive credential pair, including settings injected after launcher startup.
It retains fixed credential restrictions and rejects other inherited configuration.

### Current Pi permission contract

Use [the development-root guide](docs/permission-rewrite-operations.md) for installation, resource scopes, and acceptance checks.
Graph approval adds task ownership. It does not replace native shell policy or authorize publication.
The default policy has ordinary access and hard safety denials, not routine approval prompts. Scripts and hooks run as the local user, not inside an operating-system sandbox.

### Historical trust-policy notes

<details>
<summary>Superseded instructions retained as evidence. Do not use these procedures for the new contract.</summary>

The following repository-trust and policy-migration procedures describe the earlier implementation.
They are not an activation path for `development-roots-v1`.

Ordinary Git inspection uses native command rules, not repository execution trust. Read-only commands can form a shell chain.
The native parser checks each command separately. A read-only prefix does not authorize a later script, merge, or push.
The launcher keeps its default deny. The permission gate checks execution trust for the selected repository on each call, including revocation.
Exact whole-command checks apply only during `/graph`.

A trusted repository can run ordinary builds, tests, lint, scripts, interpreters, and package executables. Dependencies execute third-party code under this authority.
Trust covers later source edits, not immutable contents. It does not grant access to production, publishing, secrets, or destructive operations.
These workflow guards are **not an operating-system sandbox**. Trusted code runs as the local user and can access resources outside native tool checks.

Before service tests, inspect their targets, credentials, resource ownership, and cleanup. Existing acceptance databases need separate authority.
Do not use a denied command through another interpreter. Inline shell programs and opaque command indirection remain restricted.

After maintainer review and required validation, use a trusted human terminal for installation and approval.
For a first installation without existing approvals, approve the toolkit checkout with the source helper:

```bash
cd "$HOME/Code/wewereyoung/agent-toolkit"
node shared/agent-safety/repository-trust.cjs approve "$PWD"
```

For updates with existing approvals, skip that bootstrap step. Run the full installer from the toolkit checkout:

```sh
./install.sh
```

The trust rollout needs the helper, parser patches, and graph extension together. `--pi-launcher-only` cannot perform this rollout.
The installer refuses a Pi update with no valid repository approvals before it changes installed files. It never grants repository trust automatically.
The narrow mode still updates only the launcher and Git guard. It also requires a current trust helper and existing approvals.
The installer preserves custom Pi permission files without overwriting them or claiming ownership. Managed policy files still receive updates and backups.
The launcher still validates its required safety rules and applies execution trust. Custom policy does not bypass those checks.
After successful installation, approve the intended repositories and their registered worktrees:

```bash
node "$HOME/.local/libexec/agent-toolkit/repository-trust.cjs" approve-repository \
  "$HOME/Code/wewereyoung/agent-toolkit" \
  "$HOME/Code/tracn/tracn-api" \
  "$HOME/Code/tracn/tracn-web" \
  "$HOME/Code/tracn/pcvc" \
  "$HOME/Code/wewereyoung/agent-project-blueprint" \
  "$HOME/Code/wewereyoung/booking-agency" \
  "$HOME/Code/envest/envest-app"
```

Use each main checkout, not a linked worktree, for `approve-repository`.
This explicit approval covers current and future worktrees registered with the same physical Git repository.
Pi verifies both registration directions and the common Git-directory identity. Unrelated clones, forged links, and parent directories receive no trust.
At startup, Pi discovers registered worktrees. New worker sessions need no separate approval. Existing sessions retain their directory snapshot until restart.
Start fresh Pi sessions after installation and approval. Do not change live permissions or add per-script execution exceptions.

The private `repository-trust.json` records physical checkout, Git-directory, and common-directory identities, including device and inode numbers.
Missing or replaced main identities invalidate repository-wide approval.
The older `approve` command remains checkout-only. Existing approvals never expand without the explicit `approve-repository` action.

To revoke an approval, use its recorded main or checkout path from a human terminal.
Repository-wide approval must be revoked at the main checkout. Revoking only an inherited worktree fails rather than reporting false success.
Separate checkout approvals remain independent. Revoke those paths too when necessary:

```bash
node "$HOME/.local/libexec/agent-toolkit/repository-trust.cjs" revoke /absolute/path/to/checkout
```

During graphs, active task restrictions still apply even to a trusted repository or worktree.
Graph approval alone grants no general repository trust. Native checks use the verified workspace for that call.
The general Code and Orca directory grants do not expand graph authority.
Only exact approved setup and validation commands can execute during the graph. Relative file-tool paths retain the actual session directory.

### Pi policy conflicts

A checksum mismatch means that policy ownership is unverified. It does not prove that the user deliberately customized the file.
The installer configures a temporary policy before it records the checksum. A later external write can leave the marker stale.
The installer preserves unknown Pi policies and reports installed, marker, and proposed hashes. It does not reset the marker.
A preserved custom policy does not receive generated policy updates.

If a policy conflict needs inspection, use a trusted human shell outside the agent session.
Stop concurrent installers before this procedure. Review the source configurator before you run it.
These commands use the default Pi paths and create private backup and comparison files. They do not change the installed policy.

```sh
set -eu
umask 077
repo="$HOME/Code/wewereyoung/agent-toolkit"
agent="$HOME/.pi/agent"
policy="$agent/extensions/pi-permission-system/config.json"
marker="$policy.agent-toolkit.sha256"
recovery=$(mktemp -d "${TMPDIR:-/tmp}/agent-toolkit-policy-recovery.XXXXXX")
printf 'Recovery files: %s\n' "$recovery"
test -f "$policy" && test ! -L "$policy"
cp -p "$policy" "$recovery/installed.json"
if test -e "$marker" || test -L "$marker"; then
  test -f "$marker" && test ! -L "$marker"
  cp -p "$marker" "$recovery/installed.marker"
fi
cp "$repo/shared/agent-safety/pi-permission-system.json" "$recovery/proposed.json"
node "$repo/shared/agent-safety/configure.cjs" pi "$recovery/proposed.json" "$repo" "$agent" "$HOME/.pi"
shasum -a 256 "$recovery/installed.json" "$recovery/proposed.json"
if test -f "$recovery/installed.marker"; then cat "$recovery/installed.marker"; fi
diff -u "$recovery/installed.json" "$recovery/proposed.json" || test "$?" -eq 1
```

If you use custom Pi paths, replace the explicit paths before you run the commands.
Keep custom rules unless you explicitly choose to replace them. Do not paste a new checksum into the live marker.
For toolkit ownership, first verify that both live files still match the backups.
Then move both files into the recovery directory from the human shell before the full reviewed installation.
The installer can then create the policy and its marker together. The launcher-only mode does not migrate persistent policy.
If installation fails, retain the recovery files. Do not overwrite newly installed files or concurrent changes during recovery.

</details>

### Disposable Git-history tests

The managed `git-test` helper provides explicit history operations for repositories that it creates in the system temporary directory.
It never accepts an existing repository path. Ordinary Git permissions remain unchanged.

```sh
git-test create
git-test run <id> tag v1 HEAD
git-test run <id> checkout -b fixture-branch
git-test run <id> commit-tree 'HEAD^{tree}' -p HEAD -m 'Fixture commit'
git-test run <id> update-ref HEAD <returned-commit>
```

Creation returns an ID and repository path with an empty foundation commit. Use ordinary guarded Git for normal fixture reads and commits.
Use the helper explicitly for `checkout`, unsigned lightweight `tag`, `commit-tree`, and `update-ref` operations.
A denied command in an existing repository is not permission to use this helper against that repository.

Each operation checks the recorded directory identities and unchanged Git configuration. Shared metadata, symlinks, and hard-linked metadata files are rejected.
The capability record stays outside the worktree so checkout cannot remove it. Repositories and diagnostics remain after success or failure.
There is no publishing, signing, adoption, or cleanup operation. These are workflow checks, not an OS sandbox for hostile code or hooks.

### Disposable PostgreSQL tests

`pi-yolo` exposes the managed `pg-test` helper for an existing Homebrew PostgreSQL 17 installation.
It accepts only these operations:

```sh
pg-test start
pg-test start-admin
pg-test status <id>
pg-test stop <id>
```

`start` creates a new cluster in the system temporary directory. It returns an ID and a connection URL.
The server listens on loopback at a temporary port. The test role owns one database and has no superuser privileges.
The helper disables the bootstrap login before it returns the URL. The lifecycle record contains no plaintext password.

Use the returned URL for the test process. Keep it out of committed files.
After validation, stop the cluster with its returned ID. The helper retains database files and logs.
If setup fails, inspect the retained files. The helper never retries, deletes a cluster, or restarts an existing database automatically.

The helper accepts no raw SQL, server options, executable overrides, or database paths.
New Pi sessions deny direct `postgres`, `initdb`, `pg_ctl`, and `psql` commands. Homebrew receives no directory or write allowance.
The launcher verifies managed fixture helpers before it permits their command names. Missing or changed helpers disable those commands, not Pi startup.
Existing Git, secret, and deletion guards remain active.
The helper controls database setup, not arbitrary test code. It is not an operating-system sandbox.
`start-admin` creates a separate new cluster with `CREATEDB` and `CREATEROLE`. It does not upgrade an existing cluster or accept a database target.
The role remains `NOSUPERUSER`, `NOREPLICATION`, and `NOBYPASSRLS`. The bootstrap superuser remains unable to log in.
New test roles can connect only through password authentication on loopback. The helper does not grant server-file or server-program privileges.
Tests that require a database superuser remain outside this helper's scope.

After review, install from a trusted human shell:

```sh
cd ~/Code/wewereyoung/agent-toolkit
./install.sh
```

Then start a new API session:

```sh
cd ~/Code/tracn/tracn-api
pi-yolo
```

`/reload` does not install the helper or regenerate launcher permissions.
The helper tests use simulated PostgreSQL processes and real private directories. A live PostgreSQL smoke test remains necessary after installation.

## Codex accounts

Each account uses one directory under `~/.codex-accounts/`. Directory names are internal labels and can be arbitrary.

Add an account from Pi:

```text
/account add
```

Pi opens the OpenAI OAuth flow in the browser. After authentication, Pi imports the login and switches to that account.

You can also log in from a terminal:

```bash
CODEX_HOME="$HOME/.codex-accounts/account-1" codex login
```

Start Pi with an existing account:

```bash
CODEX_HOME="$HOME/.codex-accounts/account-1" pi-yolo
CODEX_HOME="$HOME/.codex-accounts/account-2" pi-yolo
```

`pi-yolo` gives every Pi instance an isolated authentication file. Multiple Pi instances can use different accounts at the same time.

Switch one running Pi instance by email:

```text
/account first@example.com
/account second@example.com
```

Run `/account` without an argument to select, type, or add an account.

An account change becomes the default for new `pi-yolo` instances. It does not change Pi instances that are already running.

Pi imports existing Codex logins automatically. A separate Pi `/login` is not required for OpenAI Codex.

Use Pi `/login` only for other subscription providers. Refreshed Pi credentials persist in the selected Pi profile.

The Pi profile is the canonical credential store. Codex subprocesses receive a temporary credential from the active Pi profile.

After import, the toolkit removes the refresh token from the bootstrap Codex profile. Use a separate `CODEX_HOME` login for standalone Codex sessions.

The footer shows the active email and current Codex limits:

```text
first@example.com | 5h 72% ↻ 2h · 7d 39% ↻ 3d · ↻ 3 · 22d | FAST | YOLO | PONYTAIL FULL | REVIEWS AUTO
```

## Pi commands

### Project blueprint

```text
/project audit .
/project adopt .
/project update .
/project new ../new-project
```

`update` uses the local blueprint checkout, not the latest upstream revision. It shows the installed and source revisions and managed-file differences before approval.

The guarded updater compares managed files with their configured baseline. It stops if these files contain local changes. Never force an update to bypass conflicts.

After an approved manual migration, the blueprint's `harness-sync.mjs reconcile` command can record the reconciled installation. This separate command requires a reviewed hash record. It writes only the manifest and retains customized-file markers. It rejects changed inputs, missing managed files, symlinks, and incomplete reviews. The command and review contract are documented in `vendor/agent-project-blueprint/README.md`. `/project update` does not approve or perform this reconciliation automatically.

A successful update preserves earlier decision packets and writes a new update packet. It applies the approved values to incoming templates and preserves project-owned files. Pi then runs focused checks and reports unresolved conflicts or unavailable checks. Sync success alone does not prove application correctness.

Legacy installations can use `update` without a decision packet when the manifest has no recorded decision path or configured hashes. Pi gathers fresh decisions and requires interactive approval. After approval, it saves a new packet and attempts `bootstrap-configure.mjs --baseline-only true` before the guarded update. This migration changes only manifest metadata and marks differing files as preserved local edits. It does not overwrite those files.

Migration requires the installed blueprint revision, matching templates, and the original ownership manifest. For older revisions, Pi creates a temporary checkout from local Git objects after approval. It copies the current migration scripts and questionnaire into that checkout, without changing its templates or ownership manifest. The migrator verifies the installed file set and template hashes before it records baseline metadata.

The migrator accepts omitted bootstrap-only entries only when the reviewed current ownership manifest lists them in `bootstrapOnlyGlobs`. Pi passes this policy through `--bootstrap-policy` for baseline-only migration without changing the historical ownership manifest. Omitted helpers stay omitted. Pi removes the temporary checkout after success or failure.

Automatic recovery requires Git with `clone --revision` support and the installed commit in the local blueprint repository. It does not fetch upstream changes or move the existing checkout. Unavailable commits, mismatched templates, missing managed files, and local-edit conflicts remain blockers. A missing packet at an explicitly recorded path requires restoration, not legacy migration.

### Fast mode

```text
/fast on
/fast off
/fast status
```

Fast mode reduces latency and uses more subscription quota.

### Side conversations

```text
/side Why did you choose this approach?
/side Fix the typo in README.md
/side close
```

Side messages do not enter the main conversation. Explicit side edits remain in the workspace.

Do not ask two agents to edit the same file at the same time.

### Review mode

```text
/reviews auto
/reviews off
/reviews
```

Automatic AI reviews run only at a requested commit, push, pull request, merge, or ship boundary. Risk triggers must also apply.

Explicit review requests always run.

#### Review result access

`pi-yolo` gives native read tools access to a dedicated results directory, normally `~/.pi/agent/review-results`. `AGENT_TOOLKIT_REVIEW_ROOT` contains its path. This exception does not permit file-tool writes or access to the whole temporary directory. Secret restrictions remain active.

Before a review, the agent reads `.read-probe.txt` in that directory through the native `read` tool. A denied read stops the workflow before the reviewer starts. The `autoreview` helper also verifies the generated policy and filesystem access.

In Pi, the helper creates a unique results directory by default. It prints the path and saves `report.txt`, `report.json`, and `status.json` there. Progress logs remain in the terminal output. Explicit output paths outside the approved results root fail before reviewer launch.

After this update, restart existing sessions through `pi-yolo` once. `/reload` does not rebuild a running session's generated policy. Existing reports in other temporary directories still require an explicit read exception. Review completion requires a verified status and report, not merely a process ID.

### Web access

```text
/web on
/web off
/web status
```

When enabled, Pi exposes `web_search`, `fetch_content`, and `get_search_content`. Browser-cookie access remains disabled.

### Figma Desktop

```text
/figma on
/figma status
/figma tools
/figma off
```

Open Figma Desktop and enable its local MCP server first.

## Project workflows

The pinned `agent-project-blueprint` lives at `vendor/agent-project-blueprint`.

Initialize it in an existing checkout when necessary:

```bash
git submodule update --init --recursive
```

### Project setup

```text
/project audit /path/to/project
/project adopt /path/to/project
/project new /path/to/empty-project
```

- `audit` inspects without changes.
- `adopt` adds the blueprint while preserving existing files.
- `new` initializes an empty project.

The workflow infers values from repository evidence. It asks only for missing decisions and requires approval before writes.

### Task graphs

The graph runs independent tasks through `pi-yolo` workers. Each writing worker gets an exclusive lane.

- Each writing repository gets one integration worktree.
- The approved worktree budget limits integration worktrees, writing lanes, and read-only input snapshots.
- Clean lanes return to the pool after integration.
- Read-only workers use an existing checkout.

Planning does not start implementation. Source files, indexes, branches, and planning commits remain separate from execution.

#### Start and approve

Keep Orca open with orchestration enabled. Use one of these commands:

```text
/graph plan Design customer search
/graph execute docs/future/customer-search.md
```

Without a mode, `/graph` means planning. The coordinator reads repository rules and resolves the requested plan dependencies before approval.
The coordinator must stop on ambiguous plans, blocked dependencies, or missing approvals. It must not infer feature completion from repository consolidation.

The proposal lists tasks in dependency order. Each writing task declares its repository, owned paths, completion criteria, setup, and validation.
Read-only tasks use `validation: "manual: <inspection criteria>"` and have no setup. They report inspection evidence without a new worktree, can use safe Git inspection, and do not block unrelated integration.
Each repository needs a full foundation commit. Branch names and short hashes are not valid foundation selectors.
The proposal also declares a worktree budget. The approval screen shows the paths, commits, input hashes, and budget.

One approval covers the Run, task records, worker launches, setup, validation, retries, bounded resources, and internal integration.
Closeout removes verified clean lanes and keeps each integration worktree.
It does not permit source writes, publication, source-branch merge-back, unrelated or dirty cleanup, or production administration.
Planning writes must be Markdown under `docs/`, outside `docs/exec-plans/`. Planning cannot implement code or promote execution plans.

#### Work and closeout

1. Call `prepare_task_graph_workspace` to prepare the Run and integration worktrees.
2. Call `start_task_graph_task` for each ready task.
3. Let each worker operate only in its assigned checkout. Orca labels its lane with the plan name and task ID.
4. Let each writing worker use `checkpoint_task_graph` for commits. Commit subjects include the task ID.
5. Call `complete_task_graph_task` after the worker completes its validation. The graph merges the checkpoint, runs its declared setup in the integration checkout, then validates the combined commit. Set `delivery_pending` when the task intentionally leaves its plan active for delivery.
6. Start dependent tasks only after their dependencies are integrated.
7. Call `finish_task_graph` after all closeout requirements pass.

Start independent tasks until the budget is full. Never assign two writing workers to one lane.
The graph reuses a lane only after successful integration. A dirty or interrupted lane stays intact.

Cross-repository scripts use `AGENT_TOOLKIT_GRAPH_REPOSITORIES`. The map contains approved paths, branch names, and pinned commits. Workers can inspect those repositories and reference them from checks, but cannot write to them. Unused repositories can progress independently; a command fails only when a repository it uses changed from its pinned commit.
Only the declared validation command creates validation evidence. Integration commands receive the approved repository map and local resource endpoints automatically. A later mutation invalidates that evidence. If integration setup or combined validation fails, the same task receives a repair dispatch in its retained lane without another approval. Resume also retries terminal closure after durable task completion.
Git hooks remain enabled for input capture, worker checkpoints, and integration commits.

A focused check does not replace repository closeout. Complete all required validation, review, approval, and evidence work.
If publication is required, leave the plan in `validation` and use `delivery_pending: true`.
Local completion does not mean shipped completion. The integration worktree and branch use the plan name and remain available for a pull request. Merge commits identify each task. Clean lanes are removed; dirty, interrupted, and conflicted lanes remain.

#### Select the execution foundation

Start a separate execution graph from the retained planning worktree. Select the other repositories' retained planning paths explicitly in the proposal.
Verify each full foundation commit on the execution approval screen. Another explicitly selected foundation is also supported.
The runtime never chooses a historical Run or a branch because it appears newer.

The worktree count never exceeds the approved budget. The graph reuses lanes across compatible tasks instead of creating per-task worktrees.

#### Interruption and legacy state

Repeat the exact `/graph` command from the same selected repository to resume. Keep the original command even after plan files move.
The repository identity, mode, and exact objective select the retained version-4 record in the managed agent directory.
Older approvals remain unchanged evidence. They do not inherit the new contract.
Resume does not need a second proposal or another approval. It verifies the saved contract and reuses its resource names, commits, and input bytes.

Input bytes enter the record before any workspace mutation. Capture accepts only unchanged base files or approved bytes.
Unexpected destination files, index changes, history, or duplicate receipts stop recovery without rollback.
A live coordinator excludes another coordinator. An unfinished graph blocks new graphs that select the same repository.
Leases are host-local. Invalid records or interrupted lease-recovery reservations need explicit inspection, not automatic deletion.

Legacy records under `task-graph-locks/` remain evidence. They cannot resume execution, migrate into the new workflow, or complete automatically.
A related legacy record, or one with unknown scope, produces a diagnostic before new graph mutations.
Known unrelated records remain untouched; the runtime does not assume that their workers stopped.
Retirement requires a separately scoped, verified, authorized operation.

#### Activation and validation

The retained Pi bundle includes its graph extension. `/reload` keeps that version.
Use the reviewed full-installation procedure in [the development-root guide](docs/permission-rewrite-operations.md).
Then start a fresh `pi-yolo` session.


The current focused graph suite uses retained Git fixtures for planning, separate execution, failed checks, and interrupted preparation.
Earlier twenty-run results describe the superseded implementation.
Orca RPCs and native permission-hook routing in that suite are test doubles. They do not prove installed permission integration or live Orca readiness.
The permission audit and measured results are in [the graph rewrite report](pi/extensions/task-graph/VALIDATION.md).

## Skills

| Skill | Loading |
|---|---|
| `fastapi` | Automatic for matching work |
| `fastify` | Automatic for matching work |
| `python` | Automatic for matching work |
| `vue` | Automatic for matching work |
| `explore-design` | Automatic for visual exploration and chosen-mock implementation |
| `autoreview` | Explicit or risk-gated |
| `simple-english` | Explicit |
| `react-doctor` | Explicit |
| `deepsec` | Explicit |
| Ponytail skills | Automatic or explicit by mode |

Use `/skill:<name>` in Pi to force a skill.

### Ponytail

Ponytail starts in `full` mode for coding tasks.

```text
/ponytail lite
/ponytail full
/ponytail ultra
/ponytail off
/ponytail-review
/ponytail-audit
/ponytail-debt
/ponytail-gain
/ponytail-help
```

Set `PONYTAIL_DEFAULT_MODE` to `lite`, `full`, `ultra`, or `off` for a process-level default.

### DeepSec

DeepSec is manual-only. AI stages can use shell access and incur high costs.

Start with:

```text
/skill:deepsec plan
/skill:deepsec scaffold
/skill:deepsec install
/skill:deepsec scan
```

AI, Vercel, and source-upload steps require separate approval. Read `pi/skills/deepsec/SKILL.md` before those steps.

### React Doctor

```text
/skill:react-doctor changed
/skill:react-doctor lines
/skill:react-doctor full
```

Use it for requested checks or important pre-ship reviews, not after every small edit.

## Update

From Pi:

```text
/skills-update
```

From a terminal:

```bash
./update.sh
```

Both paths require approval, fast-forward the configured upstream, update pinned global skills, and run `install.sh`.

Nothing updates automatically at startup.

## Checks

Run all toolkit checks:

```bash
./verify.sh
```

The script checks extensions, skills, command discovery, package pins, and safety policy.

## Main paths

| Path | Contents |
|---|---|
| `pi/extensions/` | Pi commands and runtime integrations |
| `pi/skills/` | Shared task guidance |
| `codex/skills/` | Shared code-review skill |
| `shared/agent-safety/` | Launchers and safety policy |
| `shared/ponytail/` | Ponytail version and configuration |
| `shared/pi-web-access/` | Web-tool defaults |
| `vendor/agent-project-blueprint/` | Pinned project blueprint |

Installed toolkit resources are symlinks to this checkout. Edit repository files, then run `/reload`.

## Licensing

Upstream licenses and notices remain with their skills, extensions, and packages. See the local `LICENSE` and `NOTICE.md` files.
