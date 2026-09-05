# Agent Toolkit

Agent Toolkit provides reviewed skills, Pi extensions, safety policy, and launchers for Claude Code, Codex, Pi, and Orca.

## Requirements

- Node.js 24
- Git
- At least one supported agent CLI
- Orca for `/graph` and Orca notifications

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

## Included tools

| Tool | Purpose |
|---|---|
| `autoreview` | Run a risk-gated or explicit second-model review. |
| `handoff` | Create a portable handoff prompt. |
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

A successful update preserves earlier decision packets and writes a new update packet. It applies the approved values to incoming templates and preserves project-owned files. Pi then runs focused checks and reports unresolved conflicts or unavailable checks. Sync success alone does not prove application correctness.

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

Missing or duplicate Plan-IDs stop planning. Draft plans, blocked plans, ambiguous scope, and unresolved external approvals also stop planning.

#### Planning and approval

The extension takes a host-local target lock before planning. For a plan path, the lock key uses the repository and Plan-ID.

After proposal validation, it locks every plan in the chain before approval. An overlapping chain cannot execute the same prerequisite at the same time.

The Plan-ID keeps each lock identity stable when a plan moves between `future`, `active`, and `completed` directories.

The planner reads every plan, its repository rules, acceptance criteria, targets, gates, and required validation. Mutation tools remain blocked during this work.

The planner orders prerequisites before dependent plans. If several plans are ready, it uses priority first and Plan-ID second.

The approval screen shows the complete top-to-bottom execution order. One approval authorizes the displayed plan chain and its required local commits.

#### Execution

After approval, `/graph` uses one stable Orca Run objective. It resumes one unfinished matching Run or creates a Run when none exists.

The coordinator creates one non-dispatched Orca task for each plan. These tasks store the approved dependencies and provide the durable execution ledger.

The coordinator selects the first unfinished ready plan in the approved order. It rechecks the plan before it changes any files.

A ready future plan moves to `docs/exec-plans/active/` immediately before execution. Its status changes to `queued`, then to `in-progress` when work starts.

The coordinator splits the active plan into one to six internal worker tasks. Independent tasks start together after ownership validation.

Each task gets a fresh `pi-yolo` worker in that plan repository's current worktree. Completed workers never receive another task.

Every worker launch pins the coordinator's selected provider and model. Codex launches also pin its selected account, so the quota gate checks the worker's subscription.

Workers use medium thinking for bounded work. Architecture, security, concurrency, migration, API-contract, and difficult debugging work uses high thinking.

The coordinator supervises every dispatch and releases every completed worker. One failed medium worker can receive one fresh high-thinking replacement.

Workers do not commit or push. The coordinator integrates results, resolves mechanical conflicts, and runs the plan's complete validation and closeout.

The coordinator moves a plan to `completed` only after all requirements pass. It records evidence, completes the plan task, and selects the next ready plan.

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

Recovery preserves completed tasks and existing task IDs. It continues live dispatches, processes settled results, and creates only missing tasks.

Completed-plan recovery can only bind an existing Run and reconcile its ledger. It cannot create a Run, edit files, or launch workers.

Orca does not provide cross-host Run leases, event triggers for stopped coordinators, or scoped CLI credentials. The command guards assume a trusted coordinator and are not a sandbox against an agent that deliberately wraps Orca calls in another interpreter. When Orca provides these APIs, `/graph` will add cross-host locking, automatic restart, and Orca-side mutation scopes.

The toolkit does not use scheduled polling. Polling consumes quota and can race with a live coordinator.

Trusted push, pull-request, merge, release, credential, and permission boundaries remain interactive. The plan chain stops with completed local work at these boundaries.

## Skills

| Skill | Loading |
|---|---|
| `fastapi` | Automatic for matching work |
| `fastify` | Automatic for matching work |
| `python` | Automatic for matching work |
| `vue` | Automatic for matching work |
| `explore-design` | Automatic for visual exploration and chosen-mock implementation |
| `autoreview` | Explicit or risk-gated |
| `handoff` | Explicit |
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
| `codex/skills/` | Codex-native review and handoff skills |
| `shared/agent-safety/` | Launchers and safety policy |
| `shared/ponytail/` | Ponytail version and configuration |
| `shared/pi-web-access/` | Web-tool defaults |
| `vendor/agent-project-blueprint/` | Pinned project blueprint |

Installed toolkit resources are symlinks to this checkout. Edit repository files, then run `/reload`.

## Licensing

Upstream licenses and notices remain with their skills, extensions, and packages. See the local `LICENSE` and `NOTICE.md` files.
