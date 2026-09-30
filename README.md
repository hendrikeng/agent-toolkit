# Agent Toolkit

Agent Toolkit installs shared skills, Pi extensions, safety policy, and launchers for Claude Code, Codex, Pi, and Orca.

## Requirements

- Node.js 24
- Git
- At least one supported agent CLI
- Orca for supervised worker orchestration

## Install

Clone the repository with its pinned blueprint submodule:

```sh
git clone --recurse-submodules https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
./install.sh
```

Run the installer from a trusted human terminal. Then exit old agent sessions and start the managed launcher you need:

```sh
pi-yolo
codex-yolo
claude-yolo
```

Make sure that `~/.local/bin` is on `PATH`.

The installer:

- links the reviewed skills and extensions;
- installs pinned Pi packages and dependencies;
- installs `pi-yolo`, `codex-yolo`, and `claude-yolo`;
- configures safety policy without replacing user-owned files;
- backs up replaced files under `~/.local/share/agent-toolkit/backups/`.

Source edits and `/reload` do not update the installed permission package or policy. Run `./install.sh` and start a fresh agent session after permission changes. The installer uses `proper-lockfile` so concurrent settings updates cannot overwrite each other.

## Main tools

Commands beginning with `/` in this table are Pi extensions. Claude and Codex keep their native interfaces.

| Tool | Purpose |
|---|---|
| `autoreview` | Run an explicit or risk-gated independent review. |
| Test Audit | Gate new tests and audit low-value or duplicate tests. |
| Ponytail | Prefer the smallest correct implementation. |
| `/project` | Audit, adopt, update, or create a project from the pinned blueprint. |
| `/account` | Select a Pi and Codex account. |
| `/fast` | Control OpenAI Codex Fast mode. |
| `/side` | Open an isolated side conversation. |
| `/copy-code` | Copy a clean fenced code block. |
| `/push` | Perform one confirmed, non-force Git push. |
| `/pr` | Create a pull request from the repository template. |
| `/reviews` | Switch automatic reviews between `auto` and `off`. |
| Web access | Load web tools only when external information is needed. |

Pi, Codex, and Claude receive the same shared guidance for FastAPI, Fastify, Python, Vue, Simple English, Test Audit, React Doctor, DeepSec, and AutoReview. DeepSec and React Doctor remain manual-only.

Test Audit applies while an agent writes, changes, reviews, or audits tests. It does not trigger an independent AI review.

`claude-yolo` starts Claude Opus with medium effort unless you supply overrides. It enforces the toolkit sandbox and Git guard.

All three managed launchers load the same toolkit rules without replacing `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md`. Repository instructions still apply after the shared defaults.

## Permission model

Pi uses the pinned stock `@gotgenes/pi-permission-system` package with one managed global policy. The toolkit does not patch that package, replace Pi's Bash tool, maintain permission bundles, or manage Docker resource scopes.

The policy allows ordinary development under `~/Code` and `~/orca/workspaces`. It denies sensitive credentials, destructive commands, direct publication, system administration, and existing database administration. A `pi-yolo` session disables project trust because trusted project code can bypass any in-process policy.

Orca owns worker orchestration and worktree selection. Start each worker in its target worktree rather than routing Bash calls across repositories.

The permission extension is a decision layer, not an operating-system sandbox. Allowed scripts and hooks run as the local account. Keep irreplaceable data in versioned backups.

### Git and publication

The managed Git guard blocks force pushes, destructive history operations, executable overrides, credential helpers, and remote configuration changes. Direct `git push` and mutating `gh` shell commands remain blocked.

After an explicit user request, `/push` and `/pr` provide bounded publication flows. Use the GitHub inspection tools for pull requests, reviews, checks, and failed Actions logs.

### Disposable PostgreSQL

For a new local PostgreSQL fixture:

```sh
pg-test start
pg-test start-migration
pg-test start-admin
pg-test start-admin --postgres-version 18
pg-test status <id>
pg-test stop <id>
pg-test gc
```

All three start commands accept `--postgres-version 17` or `--postgres-version 18`. The default remains PostgreSQL 17. The selected Homebrew version must already be installed. The helper never installs it or falls back to another version.

The resource ID identifies the version: `pg17-…` or `pg18-…`. Status and stop need only this ID. Existing PG17 resources keep their lifecycle support.

Use the returned connection URL only for the test process. The helper creates a private temporary cluster and a non-superuser role.

`start` creates a restricted `toolkit_test` database owner. `start-admin` creates the same fixture owner with `CREATEROLE` and `BYPASSRLS`. These attributes let migrations create fixture roles. The helper does not create a separate maintenance role. Neither profile grants superuser or database-creation privileges.

The helper accepts no raw SQL, database path, server option, or existing database target. It retains files and logs until garbage collection removes an eligible fixture.

Fixtures live in `~/Code/.agent-toolkit-scratch/agent-toolkit-fixtures`. PostgreSQL socket directories remain under the temporary directory to keep their paths short.

Managed sessions record the session process as the fixture owner. Fixtures started outside a managed session have no owner.

Garbage collection runs before each start and after a managed session ends. It stops a cluster when its recorded owner process is gone. It stops a running ownerless cluster only after two hours. It removes a stopped fixture only when its record is more than three days old. It preserves and reports records with changed, ambiguous, or invalid identities. Run `pg-test gc` to collect garbage at any time.

The `status` and `stop` commands also find clusters in the older temporary-directory roots. If an ID exists in more than one root, these commands refuse it.

When you finish with a fixture, run `pg-test stop <id>`. This command is important for fixtures started outside a managed session. In managed Claude sessions, the `pg-test` start, `status`, `stop`, and `gc` commands run outside the sandbox. This exception applies only when `pg-test` is the complete command. Do not put `pg-test` in a pipeline, an `&&` chain, `$(...)`, or a script. In those forms, the sandbox blocks `/bin/ps` and `pg-test` fails. The launcher also stops its fixtures when the session exits.

## Reviews

Automatic AI review is risk-gated and runs only at a requested commit, push, pull request, merge, or ship boundary. Explicit review requests always run.

Switch the session policy when needed:

```text
/reviews auto
/reviews off
/reviews
```

`auto` applies the risk gates from the shared managed rules, whose source is `pi/AGENTS.md`. `off` disables automatic AI review for the session. It does not block an explicit review request. In Claude or Codex, say `reviews:auto` or `reviews:off` instead of using the Pi command.

AutoReview validates its Git target, isolates the reviewer, validates structured output, and writes reports under `AGENT_TOOLKIT_REVIEW_ROOT`. It does not scan for secrets before it sends the review bundle to the model.

## Accounts

Add or select an account from Pi:

```text
/account add
/account first@example.com
/account
```

Each account uses a directory under `~/.codex-accounts/`. The Pi profile is the canonical credential store. Running Pi sessions can use different accounts without changing each other.

## Project blueprint

The pinned blueprint is in `vendor/agent-project-blueprint`.

```text
/project audit .
/project adopt .
/project update .
/project new ../new-project
```

The workflow infers values from repository evidence and asks only for missing decisions. Mutating modes require approval. Updates stop instead of overwriting changed managed files.

## Optional tools

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

Side messages do not enter the main conversation. Explicit side edits still change the workspace.

### Web access

```text
/web on
/web off
/web status
```

### Manual security and React scans

DeepSec and React Doctor run only when explicitly requested. Use the host's skill syntax:

```text
Pi:     /skill:deepsec plan
Claude: /deepsec plan
Codex:  $deepsec plan
```

Use the same syntax with `react-doctor changed`.

Read each skill before using it. DeepSec AI stages can use shell access and incur substantial model charges.

## Update

From a trusted human terminal:

```sh
./update.sh
```

The script confirms the upstream, fast-forwards the current branch, updates pinned global skills, and runs `install.sh`. Nothing updates automatically at startup.

## Checks

```sh
./verify.sh
```

## Repository layout

| Path | Contents |
|---|---|
| `pi/extensions/` | Pi commands and integrations |
| `pi/skills/` | Shared task guidance |
| `codex/skills/` | Autoreview |
| `shared/agent-safety/` | Launchers, Git guard, and permission policy |
| `shared/ponytail/` | Ponytail version and configuration |
| `shared/pi-web-access/` | Web-tool defaults |
| `vendor/agent-project-blueprint/` | Pinned project blueprint |

Upstream licenses and notices remain with their packages. See the local `LICENSE` and `NOTICE.md` files where present.
