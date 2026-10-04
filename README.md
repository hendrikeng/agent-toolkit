# Agent Toolkit

Agent Toolkit installs shared skills, Pi extensions, safety policy, and launchers for Claude Code, Codex, Pi, and Orca.

## Requirements

- Node.js 24
- Git
- Codex CLI 0.160.0 or later for Codex and Pi sandboxing
- Claude Code 2.1.289 or later for managed Claude sessions
- Pi with `createBashToolDefinition` and `createLocalBashOperations` in its public SDK
- macOS or Linux with the native sandbox dependencies
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

`claude-yolo` starts Claude Opus with medium effort unless you supply model or effort overrides. It uses restricted file tools and the native Bash sandbox.

All three managed launchers load the same toolkit rules without replacing `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md`. Agents must read repository instructions before work.

## Permission model

Each launcher selects one repository or folder under `~/Code` or `~/orca/workspaces`. Neither development root is a writable session scope. Home and workspace paths cannot contain permission glob characters.

The session receives private scratch, cache, and review directories. Builds, tests, inline programs, and generated-file cleanup work inside this scope. Other projects do not receive automatic write access.

Codex uses a native permission profile and its network proxy. Claude uses restricted file tools and its native Bash sandbox. Pi uses the stock permission package for file tools and an overridden Bash backend through `codex sandbox`.

The shell policy permits package registries, source downloads, and loopback development services. Credential directories and private `.env` files remain blocked. The public `.env.example` file remains readable. Loopback access supports HTTP, raw TCP clients, and local server binding.

Sessions copy Git identity and the initial branch preference into a private settings file. They do not expose global Git credentials or credential helpers.

Claude sessions disable executable hooks but retain installed skill guidance. Pi sessions disable project trust and reject flags that disable the sandbox extension. The old Git wrapper, inline-interpreter guard, and restricted deletion helper are removed.

### Boundary limits

These settings constrain development tools, not the whole host application. Installed extensions, MCP servers, frontend services, and authentication helpers remain trusted host programs.

Local services remain reachable through loopback access. The sandbox does not authorize existing database administration. Agents can remove files inside their assigned workspace, so versioned backups remain necessary.

Raw terminal and Docker brokers can run commands outside a development sandbox. The toolkit does not grant these brokers an automatic socket exception. Frontend orchestration requires its own trusted, bounded tool interface.

Native permission profiles are a beta Codex feature. Unsupported engines fail before the session starts. Launchers refuse retired sandbox settings in the selected account and project settings. These settings otherwise override native permission profiles.

On Linux, native secret-glob enforcement uses a startup snapshot with a 64-level scan limit. The current boundary checks cover macOS, not Linux.

### Git and publication

Ordinary Git inspection and index operations use the real Git executable. Native rules request approval for common publication and destructive commands. These rules are safeguards, not the filesystem boundary.

After an explicit user request, Pi provides the confirmed `/push` and `/pr` flows. Other clients require their confirmed publication controls or a trusted human terminal. Shell commands do not receive publication credentials automatically.

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

When you finish with a fixture, run `pg-test stop <id>`. This command is important for fixtures started outside a managed session. For the bounded host exception in Claude, use the absolute path: `~/.local/bin/pg-test`. Pi also accepts the direct `pg-test` command. Use the helper as the complete command. Pipelines, redirects, and compound commands remain sandboxed. The launcher also stops its fixtures when the session exits.

Managed Codex sessions cannot run host helpers with the denied-read profile. Run these helpers from a trusted human terminal. Keep the sandbox enabled.

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

The focused boundary checks use disposable files and an owned loopback server. They run the real Codex sandbox without a model request.

```sh
node --test shared/agent-safety/native-permissions.test.cjs shared/agent-safety/shared-launcher.test.cjs
```

After installation, validate Claude file tools and Pi tool loading in fresh managed sessions. Launcher fixtures do not prove these native client boundaries. Do not treat the source rewrite as an installed security upgrade.

## Repository layout

| Path | Contents |
|---|---|
| `pi/extensions/` | Pi commands and integrations |
| `pi/skills/` | Shared task guidance |
| `codex/skills/` | Autoreview |
| `shared/agent-safety/` | Launchers, native permission profiles, and fixture helpers |
| `shared/ponytail/` | Ponytail version and configuration |
| `shared/pi-web-access/` | Web-tool defaults |
| `vendor/agent-project-blueprint/` | Pinned project blueprint |

Upstream licenses and notices remain with their packages. See the local `LICENSE` and `NOTICE.md` files where present.
