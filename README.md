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

The coordinator writes every task itself. Tasks record progress, not agents to launch. There is no parallel-worker option.

- Planning uses one planning worktree per writing repository.
- Separately approved execution uses one new execution worktree per writing repository.
- Read-only inspection needs no worktree unless approved dirty inputs need a snapshot.

Planning does not start implementation. Source files, indexes, branches, and planning commits remain separate from execution.

#### Start and approve

Keep Orca open with orchestration enabled. Use one of these commands:

```text
/graph plan Design customer search
/graph execute docs/future/customer-search.md
```

Without a mode, `/graph` means planning. The coordinator reads repository rules and resolves the requested plan dependencies before approval.
The coordinator must stop on ambiguous plans, blocked dependencies, or missing approvals. It must not infer feature completion from repository consolidation.

The proposal lists tasks in dependency order. Each writing task declares its repository, literal owned paths, completion criteria, and exact setup and validation commands.
Read-only tasks declare `validation: "manual: <inspection criteria>"`, have no setup, and report inspection evidence at completion. They do not claim a script ran.
Without a snapshot or writing workspace, a read-only repository's selected foundation must equal its source HEAD. Approval rejects other foundations before creating a record or Run.
Each repository needs an explicit full foundation commit. Branch names and abbreviated hashes are not foundation selectors.
The approval screen shows source paths, commits, input hashes, workspace roles, and permissions.

Approval permits the listed input captures and scoped local commits. It does not permit source writes, publishing, merge-back, or worktree removal.
Planning writes must be Markdown under `docs/`, outside `docs/exec-plans/`. Planning cannot implement code or promote execution plans.

#### Work and closeout

1. Call `prepare_task_graph_workspace` to prepare or verify the Run, task ledger, and workspaces.
2. Call `start_task_graph_task` for the first unfinished task.
3. Run its declared setup through `bash`, with `repository` set to the exact workspace path.
4. Edit only the active task's paths in that workspace.
5. Use `checkpoint_task_graph` to commit explicit paths.
6. Run its declared validation on the clean final checkpoint.
7. Call `complete_task_graph_task` with evidence.
8. After all tasks and repository closeout requirements pass, call `finish_task_graph`.

Use `move_task_graph_plan` for the current approved plan's lifecycle move. Update its status and `Done-Evidence` before the final move.

Cross-repository scripts use the returned repository map or `AGENT_TOOLKIT_GRAPH_REPOSITORIES`. They must not assume sibling paths.
Graph shell commands are exact approved repository checks. Chaining, substitutions, environment assignments, hosting commands, and shell wrappers are blocked.
There is no raw shell Git mutation channel inside a graph.

Git hooks remain enabled for input captures and task checkpoints. Orca workspace creation skips setup hooks, but configured default terminals can still start.
Inspect those terminal settings before approval. Trusted repository scripts and Git hooks retain host access: graph checks are not an operating-system sandbox.

A task's focused check does not replace repository closeout. The coordinator must satisfy required validation lanes, reviews, approval gates, and evidence updates.
If publication is required for completion, leave the plan active in `validation` and use `delivery_pending: true`.
Local completion never means shipped completion. All planning and execution worktrees remain available after closeout.

#### Select the execution foundation

Start a separate execution graph from the retained planning worktree. Select the other repositories' retained planning paths explicitly in the proposal.
Verify each full foundation commit on the execution approval screen. Another explicitly selected foundation is also supported.
The runtime never chooses a historical Run or a branch because it appears newer.

For two writing repositories, planning and execution leave four worktrees: two planning worktrees and two execution worktrees.
There are no per-task worktrees, worker accounts, quota checks, dispatches, integration merges, or cleanup tasks.

#### Interruption and legacy state

Repeat the exact `/graph` command from the same selected repository to resume. Keep the original command even after plan files move.
The repository identity, mode, and exact objective select the retained version-2 record under the managed agent directory's `task-graphs/` directory.
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

If the extension directory already links to this checkout, `/reload` loads the new graph code. It does not regenerate launcher permissions.
After guard or launcher changes, run the installer from a trusted human shell, then start a new `pi-yolo` session:

```sh
cd /Users/hendrik/Code/wewereyoung/agent-toolkit
./install.sh
```

For a Git-guard-only update, use `./install.sh --git-guard-only`. The installer preserves unmanaged policy files instead of overwriting them.

The graph suite uses disposable real Git repositories and runs the full planning-to-execution scenario twenty times in fresh fixtures.
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
