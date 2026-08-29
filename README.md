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
| `/goal` | Track a persistent Pi objective. |
| `/side` | Run an isolated side conversation. |
| `/push` | Perform one reviewed, non-force Git push. |
| `/reviews` | Control automatic risk-gated AI reviews. |
| `/skills-update` | Update this toolkit and reinstall its resources. |
| Web access | Load web tools only when external information is necessary. |
| Figma MCP | Load local Figma Desktop tools only for Figma tasks. |

The toolkit also includes guidance for FastAPI, Fastify, Python, Vue, Simple English, React Doctor, and DeepSec.

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

Pi imports existing Codex logins automatically. A separate Pi `/login` is not required for OpenAI Codex.

Use Pi `/login` only for other subscription providers. Refreshed Pi credentials persist in the selected Pi profile.

The Pi profile is the canonical credential store. Codex subprocesses receive a temporary credential from the active Pi profile.

After import, the toolkit removes the refresh token from the bootstrap Codex profile. Use a separate `CODEX_HOME` login for standalone Codex sessions.

The footer shows the active email and current Codex limits:

```text
first@example.com | 5h 72% ↻ 2h · 7d 39% ↻ 3d · ↻ 3 | FAST | YOLO | PONYTAIL FULL
```

## Pi commands

### Fast mode

```text
/fast on
/fast off
/fast status
```

Fast mode reduces latency and uses more subscription quota.

### Goals

```text
/goal <objective>
/goal
/goal edit
/goal pause
/goal resume
/goal clear
```

Goal state remains in the current Pi session.

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

Keep Orca open and enable its orchestration experimental feature.

```text
/graph Add customer search
/graph docs/future/customer-search.md
/graph docs/exec-plans/active/customer-search.md
```

The planner validates task dependencies, ownership, completion criteria, and focused checks. Execution starts only after approval.

Workers use medium thinking by default. High-risk or difficult tasks use high thinking. A failed medium worker gets one high-thinking retry.

Each worker owns separate files or contract areas. The coordinator owns integration, conflict resolution, validation, and closeout.

The coordinator resolves mechanical merge conflicts. It asks the user only when the intended behavior is ambiguous.

## Skills

| Skill | Loading |
|---|---|
| `fastapi` | Automatic for matching work |
| `fastify` | Automatic for matching work |
| `python` | Automatic for matching work |
| `vue` | Automatic for matching work |
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
