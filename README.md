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
./install.sh
```

Make sure that `~/.local/bin` is on `PATH`.

The installer:

- Links reviewed skills and Pi extensions into the agent directories.
- Installs pinned Pi packages and Ponytail.
- Installs the `pi-yolo`, `codex-yolo`, and `claude-yolo` launchers.
- Configures safety policy without replacing user-owned configuration.
- Moves replaced files to timestamped backups under `~/.local/share/agent-toolkit/backups/`.

Run `/reload` after an extension change. Restart Pi after a launcher or account-runtime change.

To update only the installed Git guard, without package or account changes:

```bash
./install.sh --git-guard-only
```

This uses the same backup and ownership checks as the full installer. It refuses to overwrite user-modified policy.

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
| `/graph` | Plan and supervise an Orca task graph. |
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

Trusted development roots are `~/Code` and `~/orca/workspaces`. Private keys, credentials, and environment files remain denied or gated.

Use these launchers for unattended work:

```bash
pi-yolo
codex-yolo
claude-yolo
```

`codex-yolo` keeps the Codex workspace sandbox. `claude-yolo` keeps its network restrictions and full-escape block.

In Pi, `/push` is the only unattended push path. It refuses dirty, detached, behind, or untracked repositories.

Keep irreplaceable data in versioned backups. These controls reduce accidents but do not replace backups.

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

Task graphs coordinate approved local work across repositories. Progress lives in Git, saved workspace records, and the Orca task ledger, not only in conversation history.

| Capability | Benefit |
|---|---|
| Cross-repository dependencies | Dependent workers wait for completed, integrated prerequisite work. |
| Isolated coordinator and worker worktrees | Parallel workers do not share an index or committing checkout. Original checkouts remain separate by default. |
| Explicit input snapshots | Approved dirty files enter the graph without changes to the source index or branch. |
| Repository paths and pinned prerequisite HEADs | Builds use the graph's dependency versions instead of accidental source-checkout paths. |
| Saved task, workspace, and launch identities | Interrupted runs resume existing work instead of duplicating workers or recapturing later source edits. |
| Checked checkpoints and integration | Each imported commit must stay within approved ownership, even if a later commit reverts it. |
| Conflict, lifecycle, and quota recovery | Long graphs preserve progress across interruptions and continue after the blocker is resolved. |
| Local readiness separate from publication | A graph can finish local work without claiming that the product shipped. |
| Opt-in worker cleanup | Completed graphs can leave one readable delivery worktree per repository instead of a pile of temporary workers. |

Keep Orca open. Enable its orchestration experimental feature.

`/graph` has one command form:

```text
/graph <objective-or-plan-path>
```

Examples:

```text
/graph Add customer search
/graph docs/future/customer-search.md
/graph docs/exec-plans/active/customer-search.md
/graph docs/future/final-plan.md
```

#### Scope selection

A plain-text objective produces one bounded task graph. Its Git repository and exact objective form a stable Run identity for recovery.

The planner can stop when parallel workers provide no clear benefit.

An existing future, active, or completed plan path selects a target plan. The target is the requested endpoint.

`/graph` follows `Dependencies` backward from the target. It includes unfinished prerequisites, but it does not include later plans that depend on the target.

A target without unfinished dependencies produces a plan chain of one. Completed dependencies do not run again.

Dependencies can span local Git repositories available to Orca. Each Plan-ID must match exactly one plan across those repositories. Every execution plan must declare a Plan-ID.

Missing or duplicate Plan-IDs stop execution. Draft or blocked targets permit documentation-only planning work, not implementation. Unresolved dependencies and external approvals still block execution.

#### Planning and approval

The extension takes a host-local target lock before planning. For a plan path, the lock key uses the repository and Plan-ID.

After proposal validation, it locks every plan in the chain before approval. An overlapping chain cannot execute the same prerequisite at the same time.

The Plan-ID keeps each lock identity stable when a plan moves between `future`, `active`, and `completed` directories.

The planner reads every plan, its repository rules, acceptance criteria, targets, gates, and required validation. Mutation tools remain blocked during this work.

The planner orders prerequisites before dependent plans. If several plans are ready, it uses priority first and Plan-ID second.

The approval screen shows the execution order, local base commits, input files and hashes, and workspace permissions. Approval authorizes isolated worktrees, the listed input captures, scoped local commits, and integration within the Run.

#### Isolated workspaces

Every writing run uses isolated Orca worktrees by default. This includes planning documents, preparation, plan moves, implementation, and closeout. Read-only work does not need another worktree.

The source checkout can remain dirty. The proposal lists each required dirty input file explicitly. Capture uses working-file contents, not the staged version. It preserves the source files, index, and branch.

The runtime records approved inputs in an immutable raw-byte snapshot before it changes the destination. A private temporary index preserves the source index. Raw snapshots skip commit hooks and file filters. The final input checkpoint applies normal Git file conversions, including CRLF normalization, without commit hooks. Normal task checkpoints still run required hooks.

Interrupted capture resumes from the saved snapshot, not from later source edits. Recovery accepts only the base or approved version of each destination file. Other destination changes stop recovery without rollback. Symlinks and nested repositories also stop capture. Unrelated dirty files stay outside the run.

The coordinator uses `prepare_task_graph_workspace` before any writes. File tools use the returned absolute paths. The native `bash` tool accepts the exact workspace path in its `repository` parameter. Its normal Pi permission hooks remain active. `checkpoint_task_graph` commits explicit owned paths without broad staging or history rewrites.

Each writing worker receives a separate task worktree. Launch and dispatch checks verify its repository, path, branch, starting commit, ownership, and terminal. The launch command also pins the workspace contract. Workers cannot disable extensions through extra launch flags. A saved launch intent and unique terminal title prevent automatic relaunch after a lost result.

Required setup belongs in the approved task's `setup` field. The coordinator runs that exact command through `bash` in each prepared worker workspace before launch. Ignored setup outputs do not transfer between worktrees. Orca creation skips setup hooks, but configured default terminals can still start. Inspect that repository configuration before approval.

The returned repository map and `AGENT_TOOLKIT_GRAPH_REPOSITORIES` identify each repository's execution path and HEAD. Cross-repository builds must use these paths instead of implicit sibling paths. Declared prerequisite repositories stay at their recorded HEADs until dependent workers finish. Coordinator writes and integration wait while a dependent worker pins that repository. Existing scripts can require explicit setup configuration for this layout.

A `current_checkout` proposal requires separate human approval and clean source checkouts. It changes coordinator placement only. Writing workers still receive separate worktrees.

Planning-work approval permits Markdown changes under `docs/`, except `docs/exec-plans/`. It does not permit implementation or plan promotion.

#### Execution

After approval, `/graph` uses one stable Orca Run objective. It resumes one unfinished matching Run or creates a Run when none exists.

For an explicitly named Run with a changed objective, the coordinator can call `bind_task_graph_run` with `recover: true`. Recovery requires interactive confirmation and the preserved original graph contract. It validates the repository, task identities, ownership, dependencies, and live dispatches before any Run mutation. It preserves the original objective, task IDs, specs, contract markers, and dispatches.

This recovery path supports complete top-level task graphs, not partial ledgers or plan chains. Missing evidence, changed ownership, conflicting Runs, unavailable live workers, or an active original graph lock stop recovery. The model, account, quota, and closeout guards remain active.

The coordinator creates one non-dispatched Orca task for each plan. These tasks store the approved dependencies and provide the durable execution ledger.

The coordinator selects the first unfinished ready plan in the approved order. It rechecks the plan before it changes any files.

A ready future plan moves to `docs/exec-plans/active/` immediately before execution. Its status changes to `queued`, then to `in-progress` when work starts.

The coordinator splits the active plan into one to six internal worker tasks. Independent tasks start together after ownership validation.

Each task gets a fresh `pi-yolo` worker in its verified task worktree. Completed workers never receive another task.

Every worker launch pins the coordinator's selected provider and model. Codex launches also pin its selected account, so the quota gate checks the worker's subscription.

Workers use medium thinking unless the user explicitly requests high. Task risk does not authorize a higher thinking level.

The coordinator supervises every dispatch and releases every completed worker. One failed worker can receive one replacement at the same thinking level. A replacement requires a failed, closed dispatch and a clean retained worktree.

Workers use `checkpoint_task_graph` for scoped local commits after required checks and risk-gated reviews. They cannot push or merge into the source branch. After the worker terminal closes, `integrate_task_graph_worker` verifies every imported commit and merges it into the run branch. Dependent workers start from integrated prerequisite changes.

For merge conflicts, file tools edit the resolution and `checkpoint_task_graph` stages its explicit paths. A repeated integration call completes the recorded merge. Lifecycle recovery also creates its own local checkpoint, including during recovery-only sessions.

Validation and required reviews cover the complete proposed delivery diff, including captured inputs. Worker commits do not replace plan closeout.

The coordinator moves a plan to `completed` only after all requirements pass. It records evidence, completes the plan task, and selects the next ready plan.

Graph approval never authorizes publication or merge-back. Worker cleanup requires the explicit option described below. If repository rules require publication for completion, the plan remains active with `Status: validation`. `finish_task_graph` accepts `delivery_pending: true` after all local work and validation pass. It records local readiness without a shipped-completion claim.

These checks constrain agent operations but do not provide an operating-system sandbox. Trusted setup scripts and hooks retain their usual filesystem access. Existing secret and destructive-operation permissions remain in force.

A blocker, failed validation, unresolved decision, or trusted external boundary stops the plan chain. The current Orca state remains available for recovery.

#### Quota control

For Codex subscriptions, `/graph` checks quota before each worker launch.

It reserves 15% of the long quota window. If Codex reports a short window, it also reserves 5% of that window.

Missing long-window data stops new workers. Missing short-window data does not stop them.

Existing workers finish their current wave. The coordinator marks the active plan `budget-exhausted` and preserves the Run state.

After the quota resets, run the same `/graph` command to continue. Usage reports can lag, so the reserve is not an exact guarantee.

#### Duplicate protection and recovery

Only one coordinator can run a target on one host. A second coordinator receives an active-run error instead of creating duplicate work.

If the coordinator process crashes, its PID lock becomes stale. Only the same target may replace locks for its unfinished plan chain.

Other targets cannot take those plan locks while crash-surviving workers may still exist. Run the same target plan after a crash. Approve the recovered schedule, and `/graph` binds to the unfinished Orca Run.

Successful closeout explicitly releases every lock. If a coordinator turn ends without closeout, `/graph` abandons the locks but preserves their target identity for recovery.

Recovery preserves completed tasks, task IDs, and workspace records. It continues live dispatches, processes settled results, and creates only missing tasks. It verifies recorded worktrees instead of creating replacements or copying source inputs again.

An incomplete input capture requires reconciliation. The runtime does not overwrite it on resume. Legacy Runs without workspace records require an explicit current-checkout exception.

Successful closeout preserves delivery worktrees and archives the graph records beside the graph locks. Local completion does not mean published or merged. Publishing, PR creation, merge-back, and source reconciliation remain separate authorized actions. The runtime does not assume a branch name or hosting provider.

Source reconciliation is not automatic. Original dirty inputs remain in the source checkout, including any later user edits.

Completed-plan recovery can only bind an existing Run and reconcile its ledger. A checked lifecycle tool handles the missing status or move inside the recorded workspace. Recovery cannot create a Run or launch workers.

#### Delivery worktrees and worker cleanup

New coordinator worktrees use an objective-based name with a short unique suffix, such as `customer-search-delivery-a1b2c3d4`. These worktrees collect worker commits and become the delivery worktrees. There is no extra consolidation branch.

The optional `cleanup_workers: true` proposal authorizes cleanup once, on the graph approval screen. After local closeout, the coordinator calls `cleanup_completed_task_graph` separately. Pi can deny this tool independently of `finish_task_graph`. The extension does not weaken shell, secret, or destructive-operation permissions.

Cleanup removes only isolated worker worktrees whose tasks and dispatches are completed and released. Each worker must be clean, and its exact integrated commit must remain reachable from the delivery branch. No terminal can remain in the worker worktree, including an idle shell. Approval includes removal of ignored setup artifacts such as installed dependencies.

Cleanup preserves source and delivery worktrees, dirty or unintegrated work, failed workers, and worktrees with terminals. It waits for unfinished graphs that use the same repository. A shared host-local lock prevents graph startup during cleanup checks and removal. It also preserves worker worktrees that serve as sources or delivery worktrees in another archived graph. Each retained worktree has a reported reason.

Orca performs removal without `--force` or archive hooks. A permission error stops that removal without a filesystem fallback. Saved cleanup intent supports recovery after a lost result. Orca can retain a local branch if it cannot prove that branch is merged.

Delivery worktrees receive readable Orca display labels. Existing custom labels and Git branch names stay unchanged. Separate Runs keep separate delivery worktrees: cleanup does not guess which older coordinator branches to combine.

For an older completed Run, request `cleanup_completed_task_graph` with its Run ID in a graph repository. The tool requires an archived completion record and asks for cleanup approval once. It does not create a Run or restart workers. Unfinished Runs must complete or undergo explicit reconciliation first.

You control the final merge into the target branch and the push.

#### Intentional boundaries

The graph coordinates approved local work. It does not expand its own authority or replace the execution environment.

- **Publication requires separate authorization.** Graph approval does not authorize pushes, publication, or merge-back.
- **Cleanup is narrowly scoped.** Only the explicit worker-cleanup option authorizes deletion of verified temporary worktrees. Other deletion requires separate authorization.
- **Existing permissions stay active.** The graph does not bypass secret or destructive-operation permissions.
- **Script sandboxing belongs to the execution environment.** Worktrees share Git metadata, and scripts and hooks retain host filesystem access. Workflow guards cannot contain a hostile program.
- **Cross-host coordination belongs to Orca or a shared service.** Graph locks are host-local. They do not prevent a second coordinator on another host.

These boundaries are deliberate, not a promise to add broader authority to the extension.

The toolkit does not use scheduled polling. Polling consumes quota and can race with a live coordinator.

Trusted push, pull-request, merge, release, credential, and permission boundaries remain interactive. The plan chain stops with completed local work at these boundaries.

#### Validation coverage

The focused suite covers capture recovery, CRLF conversion, staged-file preservation, multi-repository execution, prerequisite pinning, worker retries, integration conflicts, and lifecycle closeout. Cleanup tests cover approval, permission denial, protected worktrees, ignored setup artifacts, and lost removal results. Git operations use disposable real repositories. Orca operations and permission-hook routing use test doubles. Live Orca and installed-permission integration remain unverified.

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
