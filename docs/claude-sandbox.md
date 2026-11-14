# Claude sandbox for agent work

This guide gives a Claude Code sandbox configuration for Toolkit and TRACN work on macOS.
The sandbox is enforced by the operating system. It applies in `bypassPermissions` mode and to all child processes, including Python and Node scripts.
With the sandbox on, shell commands can write only to the working directory, added directories, and `$TMPDIR`.

The design keeps the sandbox on for normal work and gives one reviewed escape for the rest:

- Most commands run in the sandbox without a prompt (`autoAllowBashIfSandboxed`).
- If the sandbox blocks a command, Claude can retry it once with `dangerouslyDisableSandbox` (`allowUnsandboxedCommands: true`).
  The retry goes through the normal permission flow. In auto mode, which Paseo uses, the auto-mode classifier reviews it.
- No command runs outside the sandbox without the escape. The settings have no `excludedCommands`, also not for the Toolkit helpers.
- Production servers ask before each `ssh`, `scp`, or `rsync` (`permissions.ask`). An ask rule prompts also in auto mode.
- Deny rules block force pushes. A hook scans the outgoing commits for secrets before each `git push`.

With `allowUnsandboxedCommands: false`, every blocked command fails, also `pg-test start`, `agent-stop`, and Docker. That is too restrictive to keep the sandbox on.

## Apply

Run this command once from a trusted human terminal:

```sh
cd ~/Code/wewereyoung/agent-toolkit && git pull --ff-only && scripts/apply-claude-sandbox.sh
```

The script backs up `settings.json` with a timestamp and runs `./update.sh`.
It merges the settings below with `jq`, keeps all other settings, and sets the Git rule.
Then it shows the difference. Use `--dry-run` to see the difference without a change.

The installer (`./install.sh` and `./update.sh`) never turns the sandbox on. It only adds the reviewer model domains to `sandbox.network.allowedDomains`, and only if a `sandbox` object already exists. This script is the only tool that turns the sandbox on.

Before you apply, you can test the settings in one new sandboxed Claude run. This changes no file.
Run it from a terminal or a session without the sandbox. The working directory is an orchestrator checkout:

```sh
cd ~/Code/tracn/tracn-product && claude -p --permission-mode bypassPermissions --setting-sources project,local --settings "$(~/Code/wewereyoung/agent-toolkit/scripts/apply-claude-sandbox.sh --emit)" 'Run this as one Bash call and print its output: bash ~/Code/wewereyoung/agent-toolkit/shared/sandbox-probe.sh'
```

`--setting-sources project,local` skips the live user settings file. The emitted settings replace it, so removed values stay removed.
The `git-ssh` item passes only after the script sets the Git rule.
Start fresh sessions after the change. Then do the [first-session checklist](#first-session-checklist).

## Turn off and restore

To turn the sandbox off, run this from a trusted human terminal:

```sh
scripts/apply-claude-sandbox.sh --off
```

`--off` makes a timestamped backup, sets only `sandbox.enabled` to `false`, and shows the difference. All other settings stay.
To turn the sandbox on again, run `scripts/apply-claude-sandbox.sh --no-update`.

To restore all settings from one backup, give the backup file:

```sh
scripts/apply-claude-sandbox.sh --restore ~/.claude/settings.json.before-sandbox-20261114-120000
```

`--restore` shows the difference and asks `y/N`. It never deletes the backup. If the apply run that made this backup also added the Git rule, the restore removes the Git rule.
Start fresh sessions after each change.

## Settings

All Paseo Claude homes link their `settings.json` to `~/.claude/settings.json`. The script changes the real file.
Merge the keys into the existing file.
The script removes the `excludedCommands` entries that earlier versions wrote, in the bare and the full-path form.
These are `pg-test *`, `pg18-fresh`, `agent-stop *`, `agent-awake`, `agent-sleep`, `paseo-awake`, `paseo-sleep`, and `/bin/ps *`.
It also removes the `capture.mjs` entry. An agent can change that file in its working directory and then run it outside the sandbox.
It removes the OrbStack Docker socket from `allowUnixSockets`.
If `settings.json` resolves to a path inside a root in `allowWrite`, the script stops and changes nothing. The sandbox must not be able to change its own settings.
The script keeps other entries that you added.

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
    "allowUnsandboxedCommands": true,
    "network": {
      "allowLocalBinding": true,
      "allowUnixSockets": ["/Users/hendrik/.fly/fly-agent.sock"],
      "allowedDomains": [
        "github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com",
        "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
        "app.infisical.com", "backboard.railway.com", "*.neon.tech", "console.neo4j.io", "*.databases.neo4j.io",
        "*.redislabs.com", "*.redis-cloud.com", "api.stripe.com", "*.ubicloud.com", "api.cloudflare.com",
        "api.anthropic.com", "api.openai.com", "chatgpt.com", "auth.openai.com", "*.tracn.com",
        "release-assets.githubusercontent.com", "*.supabase.co", "api.supabase.com",
        "app.envest.vc", "*.fly.dev", "api.fly.io", "api.machines.dev", "registry.fly.io", "api.vercel.com", "vercel.com",
        "fonts.googleapis.com", "fonts.gstatic.com", "cdn.playwright.dev", "playwright.download.prss.microsoft.com", "nodejs.org"
      ]
    },
    "filesystem": {
      "denyRead": ["/Users/hendrik/.ssh"],
      "denyWrite": [
        "/Users/hendrik/.local/bin", "/Users/hendrik/.local/share/agent-toolkit",
        "/Users/hendrik/.zshrc", "/Users/hendrik/.zprofile", "/Users/hendrik/.bashrc", "/Users/hendrik/.bash_profile", "/Users/hendrik/.profile"
      ],
      "allowWrite": [
        "/Users/hendrik/.npm", "/Users/hendrik/.cache/uv", "/Users/hendrik/Library/pnpm/store",
        "/Users/hendrik/Library/Caches/pnpm", "/Users/hendrik/.fly",
        "/Users/hendrik/Code/paseo-worktrees", "/Users/hendrik/Code/tracn", "/Users/hendrik/Code/wewereyoung", "/Users/hendrik/Code/envest",
        "/var/folders/ng/983309q54vq0fpqdhbblh4c40000gn/T"
      ]
    }
  },
  "permissions": {
    "deny": [
      "Bash(git push -f*)", "Bash(git push * -f *)", "Bash(git push *--force*)", "Bash(git push +*)", "Bash(git push * +*)"
      // The same five rules for the prefixes "git -* push", "*/git push", and "*/git -* push".
    ],
    "ask": [
      "Bash(ssh *agawulum@sl90.web.hostpoint.ch*)", "Bash(scp *agawulum@sl90.web.hostpoint.ch*)", "Bash(rsync *agawulum@sl90.web.hostpoint.ch*)"
      // The same three rules for bonzanib@sl662.web.hostpoint.ch and wfw-prod@wfw.ch. Staging servers get no rule.
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
| No `CLAUDE_CODE_TMPDIR` | In the `env` settings, this value changes `TMPDIR` but not the sandbox write rule. The sandbox still allows only `/tmp/claude-501`, so every temporary file failed, including shell heredocs. Claude also failed to write its `cwd-…` file after each call, so commands reported false exit codes. Do not set it. |
| Git `insteadOf` | On macOS, Git over SSH cannot pass the sandbox proxy. Git over HTTPS worked for fetch and push, including private repositories. |
| `allowWrite` | npm and uv failed to write their caches in `~/.npm` and `~/.cache/uv`. pnpm moved its store into `$TMPDIR`, which loses the shared store. Only the store is writable, not the global `pnpm` commands. |
| `allowWrite` for `~/Code/paseo-worktrees`, `~/Code/tracn`, `~/Code/wewereyoung`, `~/Code/envest` | An orchestrator commits, merges, and pushes in the worktrees of its workers. A commit in a worktree also writes the Git directory of the main checkout. Without these entries, both fail. The envest worktrees use `~/Code/envest/envest-app/.git`, and the envest backups are also in `~/Code/envest`. `agent-stop` uses the same project roots. A test fails if the two lists are different. |
| `allowWrite` for `~/.fly` and `~/Library/Caches/pnpm`, `allowUnixSockets` for `~/.fly/fly-agent.sock` | `fly` writes its configuration and talks to its local agent through this socket. `pnpm dlx` writes its cache in `~/Library/Caches/pnpm`. These entries need probe verification. `fly deploy` can also need WireGuard, which the sandbox can block. The Fly agent cannot run host commands, but sandboxed code can use its WireGuard tunnels into Fly private networks. The sandbox can also read the Fly token in `~/.fly/config.yml`. |
| `allowWrite` for the macOS temporary directory | macOS `mktemp -d` without a template ignores `TMPDIR` and uses `getconf DARWIN_USER_TEMP_DIR`. Repository scripts use it. The script reads the path on your Mac. |
| `allowUnsandboxedCommands: true` | A blocked command can be retried once outside the sandbox with `dangerouslyDisableSandbox`. The normal permission flow reviews the retry. In auto mode, the classifier reviews it. With `false`, each blocked command failed. See [The escape](#the-escape). |
| `autoAllowBashIfSandboxed: true` | Sandboxed commands run without a prompt. If the key is absent, the script sets it, because its default can change in newer Claude Code versions. |
| `denyWrite` for `~/.local/bin`, `~/.local/share/agent-toolkit`, and the shell startup files | Helpers and shell startup files run later outside the sandbox. A sandboxed command must not change them. These paths are not in `allowWrite`, so the sandbox already blocks them. The deny entries keep them blocked if a broad `allowWrite` entry is added later. |
| `denyRead` for `~/.ssh` (absolute path) | Sandboxed commands cannot read SSH keys. Git uses HTTPS through the Git rule, so it does not need them. `ssh` runs outside the sandbox through the escape, so it still reads its keys. |
| No `excludedCommands` | An excluded command runs outside the sandbox with an environment that the caller controls, for example `NODE_OPTIONS`, `BASH_ENV`, `PATH`, `HOME`, and `TMPDIR`. A helper path alone does not make the call safe. Helpers such as `pg-test`, `pg18-fresh`, `agent-stop`, `agent-awake`, and `/bin/ps` now use the escape, where the classifier sees the full call. |
| No Docker socket | The Docker daemon has full host access, so the socket lets sandboxed code leave the sandbox. Docker, also from scripts such as the `tracn-api` database scripts, goes through the escape. |
| `permissions.deny` for force pushes | Each rule matches the command text. The rules cover `-f`, `--force`, `--force-with-lease`, and a `+` refspec, with plain `git`, `git` with options such as `-C`, and `git` by path. |
| No `ssh`, `scp`, or `rsync` exclusions | Plain `ssh` cannot pass the sandbox proxy. Do not exclude these commands for a server. Options such as `ssh -o ProxyCommand`, `scp -S`, and `rsync -e` run any local program, so each entry is a full escape without review. These commands go through the escape. |
| `permissions.ask` for production servers | An ask rule wins over each allow rule. Thus a generic `Bash(ssh *)` ask rule with allow rules for staging prompts for staging too. The script reads the server list from `SANDBOX_SSH_SERVERS` (default: Porta Mundi, Bonzani, `wfw-prod@wfw.ch`, `wfw-staging@wfw.ch`). `SANDBOX_SSH_STAGING` lists the staging servers (default: `wfw-staging@wfw.ch`). Each other server is production and gets ask rules for `ssh`, `scp`, and `rsync`. The script only adds ask rules. It never removes an ask rule, so remove a rule for an old server by hand. A `*` in a rule matches any text, so options before the host also match. Staging uses the classifier-reviewed escape. |
| No `paseo *` | The Paseo CLI can start agents and terminals in any permission mode, so an exclusion is a full escape. Agents use the Paseo MCP tools. A human can use the CLI in a terminal. |
| `allowedDomains` | In `bypassPermissions` mode, hosts outside this list are allowed without a prompt. In auto mode, which Paseo uses, the sandbox refuses a host outside this list without a prompt. A missing host fails the command. |

## The escape

If the sandbox blocks a command, Claude can retry the command once with `dangerouslyDisableSandbox`.
The retry runs outside the sandbox only after the permission flow approves it:

- In auto mode, which Paseo uses, the auto-mode classifier reviews the command.
- In default and `acceptEdits` mode, Claude shows a prompt.
- In `bypassPermissions` mode, the retry runs without a prompt.
- An ask rule, for example a production server rule, prompts in each mode.

The agent rules in `shared/AGENTS.md` add two limits. The agent gives the reason for each escape.
The escape is allowed for the repository's own test, build, browser-test (for example Playwright Chromium), database, and Docker commands, also when they run changed code.
Chromium cannot start inside the macOS sandbox: it registers a Mach service (`bootstrap_check_in`), and the sandbox profile of Claude Code allows no Mach registration. `sandbox.network.allowMachLookup` only adds lookups, so it does not help. Agents run browser tests with the escape from the start. A test on 2026-11-14 in auto mode: the classifier approved the escape, and Chromium started with no prompt. The agent does not write a new script only to run it outside the sandbox. In auto mode, the classifier reviews each escape.
Typical escape cases are `ssh` to a staging server, a remote database connection, Docker, `pg-test`, and a nested reviewer.

## Agent rules for helpers and processes

`shared/AGENTS.md` points agents to this section.

- The sandbox blocks `pg-test start`, `pg18-fresh`, `agent-stop`, `agent-awake`, `agent-sleep`, Docker, and the setuid `/bin/ps`. Run each of them as a separate call. If the sandbox blocks it, retry it with the escape.
- Run `pg-test start` as its own call, and pass its URL to scripts.
- In scripts, use `lsof -t` instead of `ps`.
- Start a long-lived server with the `run_in_background` option of the Bash tool, and stop it with TaskStop.
- Or start the servers and the tests in one call with `trap 'kill $pids' EXIT`.
- Never start a server with `&` or `nohup` and expect to stop it in a later call.
- If a server from an earlier call still runs, run `agent-stop <pid>` or `agent-stop --port <port>`. Also stop its parent pid, for example of pnpm or turbo.
- For Docker Compose services, use `docker compose down`.
- Write the `agent-stop` path in full, without quotes or `~`, for example `/Users/<name>/.local/bin/agent-stop`. The classifier then sees the installed helper.


## Stop background processes

The sandbox blocks signals to processes that an earlier tool call started.
An agent then cannot stop its own background servers, for example an API and fake services on ports 3401 to 3406.
`agent-stop` closes this gap. The sandbox also blocks the signal from `agent-stop`, so it runs through the escape.
Run it by its full installed path as a separate call:

```sh
/Users/hendrik/.local/bin/agent-stop 12345 12346
/Users/hendrik/.local/bin/agent-stop --port 3401 3402
/Users/hendrik/.local/bin/agent-stop --signal INT --wait 5 12345
```

The default signal is `TERM`. The other permitted signals are `INT` and `KILL`.
`--port` stops the processes that listen on each TCP port.
`--wait <seconds>` reports the processes that still run after that time. The helper never changes to `KILL` by itself.
The helper writes one line for each target: `stopped`, `refused` with the reason, or `not found`.
It exits with 0 if each target stopped or was already gone, 1 if it refused a target or a target still runs after `--wait`, and 2 for a usage error.

A reviewer can approve the escape for these reasons:

- The path is fixed. `denyWrite` keeps `~/.local/bin` and the installed Toolkit resources read-only in the sandbox, so an agent cannot change the helper.
- Perl runs in taint mode (`-T`). Perl then ignores `PERL5LIB`, `PERLLIB`, and `PERL5OPT`, so the caller cannot load a module into the helper.
- The helper accepts only process IDs, port numbers, `--signal`, and `--wait`. It refuses `0`, negative IDs (process groups), and names. It never runs an argument as code or through a shell.
- The process must belong to the current user. Its working directory must be below an allowed root: `~/Code/paseo-worktrees`, `~/Code/tracn`, `~/Code/wewereyoung`, `~/Code/envest`, the macOS temporary directory, or `/private/tmp/claude-<uid>`.
  These roots are the same as the `allowWrite` roots above, without the caches and `~/.fly`.
- A root must be a directory of the current user, and no part of its path can be a symlink. The helper ignores a root that fails this test. A symlink therefore cannot move a root to another directory.
- The helper always refuses process 1, itself, and its parent chain. It also refuses each macOS app and each process with the name Paseo, Claude, Codex, Chrome, Chromium, Firefox, Safari, or tmux.
- The helper reads the real executable from the `txt` file descriptor, because a process can set the `argv[0]` that `ps` shows. The app and name rules apply to both.
- If the helper cannot read the owner, the executable, the command, or the working directory, it refuses.
- On macOS, the helper reads the home directory from the user database and the temporary directory from `getconf`. `HOME` and `TMPDIR` do not change the roots.

The helper does the checks again immediately before it sends the signal. The last check compares the owner and the start time of the process.
A pid can still be reused in the few milliseconds between that check and the signal. This needs a new process with the same pid in that window.
The allowed roots also contain the projects of other agents. An agent can stop a server of another agent there, as it can already change its files.

`agent-heavy` is different. It runs any command that it gets, so it must never be excluded, and an escape for it is an escape for that command.
`agent-stop` runs no command that it gets. It runs only `ps`, `lsof`, and `getconf` from fixed paths, and it sends a signal only after the checks above.

## Probe results

`shared/sandbox-probe.sh` checks each item and prints `PASS`, `FAIL`, or `SKIP` with the reason.
Run it in a sandboxed Claude session, with the repository under test as the working directory:

```sh
bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh
PROBE_REPO_CHECK='pnpm run verify:fast' bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh repo_check
```

The `paseo`, `ssh`, `docker`, and `pg-test` items print `SKIP`, because these commands run through the escape. Set `PROBE_PG_TEST=1` to run the `pg-test` item outside the sandbox.
The `deny-write` item passes if the sandbox blocks a write in `~/.local/bin`.
Use the [first-session checklist](#first-session-checklist) for the escape.

The `kill_across` item needs a process from an earlier call. Run `perl -e 'sleep 600' & echo $!` in one call. Claude Code blocks a call that starts with `sleep`.
Then run the probe in a second call with `PROBE_KILL_PID=<pid>`. The probe tries to stop it, which shows whether `agent-stop` is necessary.
For the wildcard hosts `*.supabase.co` and `*.fly.dev`, add a project host to `PROBE_HOSTS`.

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
| `pg-test start` | FAIL: shared memory denied | Escape |
| Docker | FAIL: socket permission denied | Escape. The Docker socket is not allowed. |
| Playwright Chromium (`@playwright/test` in `tracn-web`) | FAIL: browser closed at launch | PASS with `--single-process` (repository change, see below) |
| `codex login status`, `claude --version` | PASS | PASS |
| Paseo CLI | FAIL: `os.uptime()` `EPERM` | Not excluded. Agents use the Paseo MCP tools. |
| `infisical --version`, `railway whoami` | PASS | PASS |
| Plain `ssh` | FAIL: host name not resolved | Escape. Production servers ask. |
| Toolkit `./verify.sh` | FAIL on 2026-11-03: 4 helper tests of the former AutoReview skill refused `/tmp`. Those tests are removed. Not measured again. | Not measured again |
| 22 HTTPS hosts (GitHub, registries, Infisical, Railway, Neon, Neo4j Aura, Redis Cloud, Stripe, Ubicloud, Anthropic, OpenAI, Cloudflare, TRACN) | PASS | PASS |
| Node `fetch`, Python HTTPS | PASS | PASS |
| Database connection to Neon (Postgres protocol) | PASS with the sandbox network open | FAIL: `getaddrinfo ENOTFOUND`. Use the escape. |

The `allowWrite` entries were not tested in a session with these settings.
On 2026-11-14, Toolkit removed all helper exclusions and the Docker socket. It added `denyWrite` and the force-push deny rules. A push hook for secret scans was tried and removed: Claude Code hooks run outside the sandbox, and git in an agent-controlled repository can run programs through its config.
Toolkit removed the AutoReview skill on 2026-11-14, with its probe item, its helper tests, and its excluded commands. The table shows the 2026-11-03 results without the AutoReview rows.
Do the [first-session checklist](#first-session-checklist) after you apply them.

## Limits

- **Plain `ssh`** does not work in the sandbox. The docs say that `ssh` ignores the proxy. `ssh`, `scp`, and `rsync` go through the escape. If a production server is missing from `SANDBOX_SSH_SERVERS`, it gets no ask rule. Add it and apply again. A server in `SANDBOX_SSH_STAGING` gets no ask rule.
- **In `bypassPermissions` mode, the escape retries without a prompt.** There, the sandbox protects little. Paseo agents run in auto mode, where the classifier reviews each escape.
- **The production ask rules match the literal `user@host` text.** A generic `Bash(ssh *)` ask rule is not possible with a staging exception, because an ask rule wins over each allow rule. `ssh -l user host`, an alias from `~/.ssh/config`, or `-o User=` do not match. Use the same `user@host` form for production hosts in the SSH configuration, or treat the ask rules as a speed bump, not a boundary.
- **An ask rule matches the command text.** It does not match `sh -c '...'`, `/usr/bin/ssh`, or a deploy script that calls `ssh` inside. The classifier still reviews these forms when they use the escape.
- **Deploy scripts** such as `scripts/deploy-rsync.sh` call `rsync` and `ssh` inside the script. The script needs the escape. Do not run a deploy script that you changed in the same task through the escape. Do not exclude the script itself, because an agent can change it.
- **Remote database connections do not work in the sandbox.** Only HTTPS passes the sandbox proxy. Database drivers for Neon, Neo4j Aura, and Redis cannot resolve the host. The connection goes through the escape. For a long database task, a human can run `scripts/apply-claude-sandbox.sh --off`, and then `scripts/apply-claude-sandbox.sh --no-update` when the task is complete.
- **Playwright** needs `--single-process` in the Chromium launch arguments when a sandboxed Claude session runs it. Change `tracn-web/playwright.config.ts`, in the `use` block: `launchOptions: { args: process.env.CLAUDECODE ? ['--single-process'] : [] }`. The Paseo browser tools run outside the sandbox and need no change.
- **The escape runs a command with full access.** The classifier and the ask rules review it, but they are not an OS boundary. The sandbox here protects against accidental damage, not against an agent that tries to escape.
- **A Codex native review can fail in a sandboxed Claude session.** Codex runs its tool commands in its own Seatbelt sandbox, and a nested sandbox fails with `sandbox_apply: Operation not permitted`. A nested Claude reviewer (`claude -p`) can fail in the same way. The reviewer then goes through the escape. This is not tested. Do not exclude `codex *` or `claude -p *`, because that lets an agent run any prompt outside the sandbox without review.
- **Excluded commands run with full access** and with an environment that the caller controls. The settings exclude no command. Do not add patterns for helpers, interpreters, package scripts, or files in the working directory.
- **The force-push rules match the command text.** A force push inside a script or an alias does not match.
- **The Write and Edit tools** are outside the sandbox. They cannot delete directories.
- **The working directory, including the repository root and `.git`, stays writable.**
- **All projects in `~/Code/paseo-worktrees`, `~/Code/tracn`, `~/Code/wewereyoung`, and `~/Code/envest` are writable from every session.** The sandbox does not keep one project's agent out of another project there. It still protects the home directory, system paths, configuration, and other folders.
- **The macOS temporary directory and `/tmp/claude-501` are shared by all sessions.** Use `mktemp` names and delete only your own exact path.

## First-session checklist

Do this checklist once, in a fresh Paseo Claude session in auto mode, after you apply the settings. Record each result as text.

1. Run the probe: `bash ~/.local/share/agent-toolkit/resources/shared/sandbox-probe.sh`.
2. Run `/Users/<name>/.local/bin/pg-test start` as one call. Expect a sandbox block, and then a classifier-reviewed retry with the escape. Stop the fixture with `pg-test stop <id>` in the same way.
3. Run `docker info`. Expect a sandbox block, and then a classifier-reviewed retry with the escape.
4. Run `gh pr list` in a repository. Expect a pass in the sandbox.
5. Run `git push --dry-run`. Expect a pass in the sandbox over HTTPS.
6. Run a read-only `psql` query against a Neon database. Expect the sandbox to block it, and then a classifier-approved retry with the escape.
7. Run `ssh wfw-staging@wfw.ch true`. Expect a block, and then a classifier-reviewed retry.
8. Run `ssh wfw-prod@wfw.ch true`. Expect an ask prompt.
9. Run the native reviewer command from `docs/code-review.md`. Record if it needs the escape.
10. Start a worker with the Paseo MCP tools. Expect no sandbox error.
11. Do one normal task. Count the prompts and the escapes.

These claims are not tested yet:

- Ask rules prompt in auto mode for a command that uses the escape (step 8).
- A nested reviewer starts inside the sandbox (step 9). A quick check on 2026-11-14 started a nested `claude -p` without the escape.

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
- `pg-test start` and `stop`, the probe, and a native code review pass in both agents.
- After the agent is archived, its directory no longer exists. The directories of other agents remain.

Codex sandbox behavior with `exclude_slash_tmp` and a TMPDIR for each agent is not tested yet.
