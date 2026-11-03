# Claude sandbox for agent work

This guide gives a tested Claude Code sandbox configuration for Toolkit and TRACN work on macOS.
The sandbox is enforced by the operating system. It applies in `bypassPermissions` mode and to all child processes, including Python and Node scripts.
With the sandbox on, shell commands can write only to the working directory, added directories, and `$TMPDIR`.

## Apply

Run this command once from a trusted human terminal:

```sh
cd ~/Code/wewereyoung/agent-toolkit && git pull --ff-only && scripts/apply-claude-sandbox.sh
```

The script backs up `settings.json` with a timestamp and runs `./update.sh`.
It merges the settings below with `jq` and keeps all other settings. It also removes the `capture.mjs` exclusion and sets the Git rule.
Then it shows the difference. Use `--dry-run` to see the difference without a change, and `--undo` to restore the latest backup.

Before you apply, you can test the settings in one new sandboxed Claude run. This changes no file.
Run it from a terminal or a session without the sandbox. The working directory is an orchestrator checkout:

```sh
cd ~/Code/tracn/tracn-product && claude -p --permission-mode bypassPermissions --setting-sources project,local --settings "$(~/Code/wewereyoung/agent-toolkit/scripts/apply-claude-sandbox.sh --emit)" 'Run this as one Bash call and print its output: bash ~/Code/wewereyoung/agent-toolkit/shared/sandbox-probe.sh'
```

`--setting-sources project,local` skips the live user settings file. The emitted settings replace it, so removed values stay removed.
The `git-ssh` item passes only after the script sets the Git rule.
Start fresh sessions after the change.

## Settings

All Paseo Claude homes link their `settings.json` to `~/.claude/settings.json`. The script changes the real file.
Merge the keys into the existing file.
Remove the existing `capture.mjs` entry from `excludedCommands`. An agent can change that file in its working directory and then run it outside the sandbox.
If the capture script must run outside the sandbox, install a copy outside writable workspaces and exclude only that path.

```jsonc
{
  "env": {
    // Go tools such as gh and infisical cannot reach the macOS trust service in the sandbox.
    "SSL_CERT_FILE": "/etc/ssl/cert.pem"
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "network": {
      "allowLocalBinding": true,
      "allowedDomains": [
        "github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com",
        "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
        "app.infisical.com", "backboard.railway.com", "*.neon.tech", "console.neo4j.io", "*.databases.neo4j.io",
        "*.redislabs.com", "*.redis-cloud.com", "api.stripe.com", "*.ubicloud.com", "api.cloudflare.com",
        "api.anthropic.com", "api.openai.com", "chatgpt.com", "auth.openai.com", "*.tracn.com"
      ]
    },
    "filesystem": {
      "allowWrite": [
        "/Users/hendrik/.npm", "/Users/hendrik/.cache/uv", "/Users/hendrik/Library/pnpm/store",
        "/Users/hendrik/Code/paseo-worktrees", "/Users/hendrik/Code/tracn", "/Users/hendrik/Code/wewereyoung",
        "/var/folders/ng/983309q54vq0fpqdhbblh4c40000gn/T"
      ]
    },
    "excludedCommands": [
      "pg-test *",
      "pg18-fresh",
      "docker *",
      "paseo *",
      "/Users/hendrik/.claude/skills/autoreview/scripts/autoreview *",
      "/Users/hendrik/.paseo/zerosub/homes/*/skills/autoreview/scripts/autoreview *",
      "/Users/hendrik/.local/share/agent-toolkit/resources/skills/autoreview/scripts/autoreview *"
    ]
  }
}
```

Also change Git once, in the same terminal. Git then uses HTTPS for GitHub remotes that use SSH:

```sh
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

Start fresh sessions after the change.
Existing SSH remote URLs stay unchanged. The keychain credential helper supplies HTTPS authentication.

## Why each setting is necessary

| Setting | Reason |
|---|---|
| `SSL_CERT_FILE` | `gh` failed with `x509: OSStatus -26276`. Go tools verify certificates through `trustd`, which the sandbox blocks. With the system certificate file, `gh` and `infisical` work inside the sandbox. This is narrower than `enableWeakerNetworkIsolation` or an excluded command. |
| No `CLAUDE_CODE_TMPDIR` | In the `env` settings, this value changes `TMPDIR` but not the sandbox write rule. The sandbox still allows only `/tmp/claude-501`, so every temporary file failed, including shell heredocs. The script removes the value that an earlier version set. |
| Git `insteadOf` | On macOS, Git over SSH cannot pass the sandbox proxy. Git over HTTPS worked for fetch and push, including private repositories. |
| `allowWrite` | npm and uv failed to write their caches in `~/.npm` and `~/.cache/uv`. pnpm moved its store into `$TMPDIR`, which loses the shared store. Only the store is writable, not the global `pnpm` commands. |
| `allowWrite` for `~/Code/paseo-worktrees`, `~/Code/tracn`, `~/Code/wewereyoung` | An orchestrator commits, merges, and pushes in the worktrees of its workers. A commit in a worktree also writes the Git directory of the main checkout. Without these entries, both fail. |
| `allowWrite` for the macOS temporary directory | macOS `mktemp -d` without a template ignores `TMPDIR` and uses `getconf DARWIN_USER_TEMP_DIR`. Repository scripts use it. The script reads the path on your Mac. |
| `pg-test *`, `pg18-fresh` | PostgreSQL cannot create shared memory inside the sandbox. Both are trusted helpers outside the workspace, and the sandbox cannot change them. |
| `docker *` | The Docker socket is outside the sandbox. Docker access gives full host access in any configuration. The Neo4j lane in `pcvc` uses Docker Compose. |
| `paseo *` | The Paseo CLI fails because Node `os.uptime()` returns `EPERM` in the sandbox. Agents normally use the Paseo MCP tools, which run outside the sandbox. |
| AutoReview paths | Codex runs its tool commands in its own Seatbelt sandbox. A nested sandbox fails with `sandbox_apply: Operation not permitted`. The helper owns its reviewer isolation. |
| `allowedDomains` | In `bypassPermissions` mode, hosts outside this list are allowed without a prompt. The list applies in the other permission modes. |

An excluded command runs outside the sandbox only if the whole shell call matches.
Run `pg-test`, `docker`, `paseo`, and the AutoReview helper as separate calls. Write the helper path without quotes.

## Probe results

`shared/sandbox-probe.sh` checks each item and prints `PASS`, `FAIL`, or `SKIP` with the reason.
Run it in a sandboxed Claude session, with the repository under test as the working directory:

```sh
bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh
PROBE_REPO_CHECK='pnpm run verify:fast' bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh repo_check
PROBE_AUTOREVIEW=<installed-autoreview-skill>/scripts/autoreview bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh autoreview
```

A script cannot test excluded commands, because the exclusion applies only to a whole tool call.
Test `pg-test start`, `docker info`, `paseo ls`, and an AutoReview run as separate tool calls.

On 2026-11-03, the probe ran in a sandboxed Claude session in `bypassPermissions` mode, with the old settings.
The working directory was this repository. The second run added `SSL_CERT_FILE` and the Git `insteadOf` rule as environment variables.

| Item | Result with old settings | Result with the new settings |
|---|---|---|
| `$TMPDIR` write with a `mktemp` template | PASS | PASS |
| `mktemp -d` without a template | FAIL: macOS uses `/var/folders/.../T` | `allowWrite` for that directory |
| Writes in `~/Code/paseo-worktrees`, `~/Code/tracn`, `~/Code/wewereyoung` from another working directory | FAIL | `allowWrite` |
| Ref write in another checkout (`tracn-api`) | FAIL: cannot lock ref | `allowWrite` |
| Local Git, commit, worktree add and remove | PASS | PASS |
| Ref write in the shared Git directory of a worktree | PASS | PASS |
| Git over HTTPS, fetch and push (dry run) | PASS | PASS |
| Git over SSH | FAIL | PASS through `insteadOf` |
| `gh api`, `gh pr view` | FAIL: `x509: OSStatus -26276` | PASS with `SSL_CERT_FILE` |
| npm registry | FAIL: `EPERM` in `~/.npm/_cacache` | PASS with a writable cache (tested with `npm_config_cache`) |
| pnpm install | PASS, store moved to `$TMPDIR` | `allowWrite` keeps the shared store |
| uv | FAIL: `EPERM` in `~/.cache/uv` | PASS with a writable cache (tested with `UV_CACHE_DIR`) |
| pip in a virtual environment | PASS | PASS |
| Local server on `127.0.0.1` | PASS | PASS |
| `lsof` | PASS | PASS |
| `pg-test start` | FAIL: shared memory denied | Excluded command |
| Docker | FAIL: socket permission denied | Excluded command |
| Playwright Chromium (`@playwright/test` in `tracn-web`) | FAIL: browser closed at launch | PASS with `--single-process` (repository change, see below) |
| `codex login status`, `claude --version` | PASS | PASS |
| AutoReview, Claude engine | PASS | PASS |
| AutoReview, Codex engine | FAIL: temporary directory under `/tmp` | Excluded command |
| Paseo CLI | FAIL: `os.uptime()` `EPERM` | Excluded command |
| `infisical --version`, `railway whoami` | PASS | PASS |
| Plain `ssh` | FAIL: host name not resolved | Not supported |
| Toolkit `./verify.sh` | FAIL: 4 AutoReview helper tests refuse `/tmp` | FAIL. Run Toolkit checks from a human terminal. Real AutoReview runs are excluded commands. |
| 22 HTTPS hosts (GitHub, registries, Infisical, Railway, Neon, Neo4j Aura, Redis Cloud, Stripe, Ubicloud, Anthropic, OpenAI, Cloudflare, TRACN) | PASS | PASS |
| Node `fetch`, Python HTTPS, TCP to a Neon host on port 5432 | PASS | PASS in `bypassPermissions` mode |

The `allowWrite` entries and the excluded commands were not tested in a session with these settings.
Run the probe and the separate excluded-command calls in a fresh session after you apply them.

## Limits

- **Plain `ssh`** to servers, for example `*.orb.local` hosts, does not work in the sandbox. The docs say that `ssh` ignores the proxy. Run it from a human terminal, or add a narrow excluded command for one host.
- **Database drivers in other permission modes.** In `bypassPermissions` mode, TCP to remote databases worked. In other modes, the docs say most database drivers cannot connect, even to an allowed host.
- **Playwright** needs `--single-process` in the Chromium launch arguments when a sandboxed Claude session runs it. Change the Playwright configuration in `tracn-web` and `pcvc`, for example `launchOptions: { args: process.env.CLAUDECODE ? ['--single-process'] : [] }`. The Paseo browser tools run outside the sandbox and need no change.
- **Excluded commands run with full access.** The Docker daemon can mount any host path. Do not add patterns for interpreters, package scripts, or files in the working directory, because an agent can change them.
- **The Write and Edit tools** are outside the sandbox. They cannot delete directories.
- **The working directory, including the repository root and `.git`, stays writable.**
- **All projects in `~/Code/paseo-worktrees`, `~/Code/tracn`, and `~/Code/wewereyoung` are writable from every session.** The sandbox does not keep one project's agent out of another project there. It still protects the home directory, system paths, configuration, and other folders.
- **The macOS temporary directory and `/tmp/claude-501` are shared by all sessions.** Use `mktemp` names and delete only your own exact path.

## Separate temporary directory for each agent

With the settings above, all Claude sessions share `/tmp/claude-501`. One session can still delete the temporary files of another session.
A `CLAUDE_CODE_TMPDIR` value in the `env` settings does not move the sandbox write rule. Before you build the plugin, verify that the value in the process environment of a new agent moves both `TMPDIR` and the write rule.
The fix gives each agent its own temporary root. The sandbox then allows writes only to the agent's own root, so the operating system blocks deletes in another agent's root.

Design:

1. A small Paseo plugin uses a `server.before` hook for agent creation. The hook creates `/Users/hendrik/.agent-tmp/<first 8 characters of the agent ID>` with mode `0700`.
2. The hook sets `CLAUDE_CODE_TMPDIR` and `TMPDIR` to this directory in the agent environment. Claude appends `claude-501`. Unsandboxed commands and Codex use `TMPDIR` directly.
3. For Codex, set `exclude_slash_tmp = true` in `[sandbox_workspace_write]`. The writable temporary root is then only the agent's `TMPDIR`.
4. A `server.on` hook removes the agent's own directory when the agent is archived. It removes only the exact path that the hook created.
5. Keep the path short. macOS limits Unix socket paths to 104 bytes, and Claude uses a short fallback for long paths. `pg-test` puts its sockets in the temporary root.

Acceptance for the plugin:

- Two fresh agents report different `TMPDIR` values.
- Agent A cannot create or delete a file in the root of agent B. Expect `Operation not permitted`.
- `pg-test start` and `stop`, the probe, and AutoReview pass in both agents.
- After the agent is archived, its directory no longer exists. The directories of other agents remain.

Codex sandbox behavior with `exclude_slash_tmp` and a TMPDIR for each agent is not tested yet.
