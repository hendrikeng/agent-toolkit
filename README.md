# Agent Toolkit

Agent Toolkit installs shared skills, Pi extensions, safety policy, and launchers for Claude Code, Codex, Pi, and Orca.

## Requirements

- Node.js 24
- Git
- At least one supported agent CLI
- Orca for supervised worker orchestration
- TruffleHog on `PATH` for autoreview

## Install

Clone the repository with its pinned blueprint submodule:

```sh
git clone --recurse-submodules https://github.com/hendrikeng/agent-toolkit.git
cd agent-toolkit
./install.sh
```

Run the installer from a trusted human terminal. Then exit old Pi sessions and start a new one:

```sh
pi-yolo
```

Make sure that `~/.local/bin` is on `PATH`.

The installer:

- links the reviewed skills and extensions;
- installs pinned Pi packages and dependencies;
- installs `pi-yolo`, `codex-yolo`, and `claude-yolo`;
- configures safety policy without replacing user-owned files;
- backs up replaced files under `~/.local/share/agent-toolkit/backups/`.

Source edits and `/reload` do not update the installed permission package or policy. Run `./install.sh` and start a fresh Pi session after permission changes. The installer uses `proper-lockfile` so concurrent settings updates cannot overwrite each other.

## Main tools

| Tool | Purpose |
|---|---|
| `autoreview` | Run an explicit or risk-gated independent review. |
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
| Figma MCP | Load local Figma Desktop tools only for Figma tasks. |

The toolkit also includes guidance for design exploration, FastAPI, Fastify, Python, Vue, Simple English, React Doctor, and DeepSec.

## Permission model

Pi uses the pinned stock `@gotgenes/pi-permission-system` package with one managed global policy. The toolkit does not patch that package, replace Pi's Bash tool, maintain permission bundles, or manage Docker resource scopes.

The policy allows ordinary development under `~/Code` and `~/orca/workspaces`. It denies sensitive credentials, destructive commands, direct publication, system administration, and existing database administration. A `pi-yolo` session disables project trust because trusted project code can bypass any in-process policy.

Orca owns worker orchestration and worktree selection. Start each worker in its target worktree rather than routing Bash calls across repositories.

The permission extension is a decision layer, not an operating-system sandbox. Allowed scripts and hooks run as the local account. Keep irreplaceable data in versioned backups.

### Git and publication

The managed Git guard blocks force pushes, destructive history operations, executable overrides, credential helpers, and remote configuration changes. Direct `git push` and mutating `gh` shell commands remain blocked.

After an explicit user request, `/push` and `/pr` provide bounded publication flows. Use the GitHub inspection tools for pull requests, reviews, checks, and failed Actions logs.

### Disposable PostgreSQL

For a new local PostgreSQL 17 fixture:

```sh
pg-test start
pg-test start-admin
pg-test status <id>
pg-test stop <id>
```

Use the returned connection URL only for the test process. The helper creates a private temporary cluster and a non-superuser role. It accepts no raw SQL, database path, server option, or existing database target. It retains files and logs after stop or failure.

## Reviews

Automatic AI review is risk-gated and runs only at a requested commit, push, pull request, merge, or ship boundary. Explicit review requests always run.

Switch the session policy when needed:

```text
/reviews auto
/reviews off
/reviews
```

`auto` applies the risk gates from `pi/AGENTS.md`. `off` disables automatic AI review for the session. It does not block an explicit review request.

Autoreview remains the full hardened reviewer. It validates its Git target, scans frozen input with TruffleHog, isolates the reviewer, validates structured output, and writes reports under `AGENT_TOOLKIT_REVIEW_ROOT`.

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

### Figma Desktop

```text
/figma on
/figma status
/figma tools
/figma off
```

Open Figma Desktop and enable its local MCP server first.

### Manual security and React scans

DeepSec and React Doctor run only when explicitly requested:

```text
/skill:deepsec plan
/skill:react-doctor changed
```

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
