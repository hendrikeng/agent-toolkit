#!/usr/bin/env bash
# Applies the Claude sandbox settings from docs/claude-sandbox.md. Run it from a trusted human terminal:
#   scripts/apply-claude-sandbox.sh [--dry-run | --emit | --off | --restore <backup>] [--no-update]
# Apply backs up settings.json, runs ./update.sh, merges the sandbox settings with jq, and sets the Git HTTPS rule.
# --off sets only sandbox.enabled to false, after a backup. Apply again to turn the sandbox back on.
# --restore copies an explicit backup over settings.json after a y/N question. It keeps the backup.
set -euo pipefail
repo=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
mode=apply update=1 restore=
usage() { printf 'Usage: scripts/apply-claude-sandbox.sh [--dry-run | --emit | --off | --restore <backup>] [--no-update]\n' >&2; exit 2; }
while (($#)); do
  case $1 in
    --dry-run) mode=dry-run ;;
    --emit) mode=emit ;;
    --off) mode=off ;;
    --restore) [[ ${2:-} ]] || usage; mode=restore restore=$2; shift ;;
    --no-update) update=0 ;;
    *) usage ;;
  esac
  shift
done
command -v jq >/dev/null || { echo 'jq is required: brew install jq' >&2; exit 1; }
if [[ $mode != dry-run && $mode != emit && ! ( -t 0 && -t 1 ) ]]; then
  echo 'Run this script from a trusted human terminal. Agents must not change live permission settings.' >&2; exit 1
fi

link="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
# Paseo Claude homes link settings.json to one file. Change the real file.
settings=$(realpath "$link" 2>/dev/null || printf '%s' "$link")
git_key='url.https://github.com/.insteadOf' git_value='git@github.com:'
# The key can hold several rewrite values. Add only the missing one and keep the others.
has_git_rule() { git config --global --get-all "$git_key" 2>/dev/null | grep -qxF "$git_value"; }
[[ -e $settings ]] || { echo "Missing $settings" >&2; exit 1; }

if [[ $mode == restore ]]; then
  [[ -f $restore ]] || { echo "No backup file $restore" >&2; exit 1; }
  jq empty "$restore" 2>/dev/null || { echo "Cannot parse $restore as JSON" >&2; exit 1; }
  diff -u "$settings" "$restore" || true
  read -r -p "Replace $settings with $restore? [y/N] " answer || answer=
  [[ $answer == [yY] ]] || { echo 'Nothing changed.'; exit 0; }
  cat "$restore" > "$settings"
  if [[ -e $restore.git-rule-added ]]; then
    git config --global --unset "$git_key" '^git@github\.com:$' || true
    echo "Removed the Git rule $git_key=$git_value."
  fi
  echo "Restored $settings from $restore. The backup stays. Start fresh sessions."
  exit 0
fi

home=$HOME
# macOS mktemp without a template uses this per-user directory, not TMPDIR.
darwin_tmp=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)
# Deployment servers that agents reach with ssh, scp, and rsync: Porta Mundi, Bonzani, and WFW.
# ssh runs through the reviewed escape. Each server that is not in SANDBOX_SSH_STAGING is production and gets ask rules.
servers=${SANDBOX_SSH_SERVERS-agawulum@sl90.web.hostpoint.ch bonzanib@sl662.web.hostpoint.ch wfw-prod@wfw.ch wfw-staging@wfw.ch}
staging=${SANDBOX_SSH_STAGING-wfw-staging@wfw.ch}
merge() {
  jq --arg home "$home" --arg darwin_tmp "${darwin_tmp%/}" --arg servers "$servers" --arg staging "$staging" '
    # Append missing items and keep the existing order.
    def append($items): reduce $items[] as $item (. // []; if index([$item]) then . else . + [$item] end);
    .env = ((.env // {}) + {SSL_CERT_FILE: "/etc/ssl/cert.pem"})
    | .sandbox = (.sandbox // {})
    | .sandbox.enabled = true
    | .sandbox.failIfUnavailable = true
    # A blocked command can be retried once outside the sandbox. Normal permissions, in auto mode the classifier, review the retry.
    # Set these two only when absent: an explicit stricter user value stays.
    | .sandbox |= (if has("autoAllowBashIfSandboxed") then . else .autoAllowBashIfSandboxed = true end)
    | .sandbox |= (if has("allowUnsandboxedCommands") then . else .allowUnsandboxedCommands = true end)
    | .sandbox.network.allowLocalBinding = true
    # Docker works in the sandbox, also from scripts. The Docker daemon has full host access.
    # Fly talks to its local agent through a socket. Needs probe verification.
    | .sandbox.network.allowUnixSockets |= append([$home + "/.orbstack/run/docker.sock", $home + "/.fly/fly-agent.sock"])
    | .sandbox.network.allowedDomains |= append([
        "github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com",
        "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
        "app.infisical.com", "backboard.railway.com", "*.neon.tech", "console.neo4j.io", "*.databases.neo4j.io",
        "*.redislabs.com", "*.redis-cloud.com", "api.stripe.com", "*.ubicloud.com", "api.cloudflare.com",
        "api.anthropic.com", "api.openai.com", "chatgpt.com", "auth.openai.com", "*.tracn.com",
        "release-assets.githubusercontent.com", "*.supabase.co", "api.supabase.com",
        "app.envest.vc", "*.fly.dev", "api.fly.io", "api.machines.dev", "registry.fly.io", "api.vercel.com", "vercel.com",
        "fonts.googleapis.com", "fonts.gstatic.com", "cdn.playwright.dev", "playwright.download.prss.microsoft.com", "nodejs.org"])
    # Git uses HTTPS (the Git rule below). ssh runs outside the sandbox through the escape, so it still reads its keys.
    | .sandbox.filesystem.denyRead |= append([$home + "/.ssh"])
    # Orchestrators commit in worker worktrees, whose Git data is in the main checkouts.
    # The project roots must stay the same as the allowed roots in shared/agent-stop.pl. The test compares them.
    # ~/.fly and the pnpm cache (pnpm dlx) need probe verification.
    | .sandbox.filesystem.allowWrite |= append([$home + "/.npm", $home + "/.cache/uv", $home + "/Library/pnpm/store",
        $home + "/Library/Caches/pnpm", $home + "/.fly",
        $home + "/Code/paseo-worktrees", $home + "/Code/tracn", $home + "/Code/wewereyoung", $home + "/Code/envest"]
        + (if $darwin_tmp == "" then [] else [$darwin_tmp] end))
    # An agent can change capture.mjs in its working directory and then run it outside the sandbox.
    # Earlier versions wrote bare names, which match any binary with that name on PATH. The full-path forms below replace them.
    | .sandbox.excludedCommands = ((.sandbox.excludedCommands // []) | map(select((contains("capture.mjs") or IN("pg-test *", "pg18-fresh",
        "agent-stop *", "agent-awake", "agent-sleep", "paseo-awake", "paseo-sleep")) | not)))
    | .sandbox.excludedCommands |= append([
        # PostgreSQL cannot create shared memory in the sandbox. Absolute paths: a bare name matches any pg-test on PATH.
        $home + "/.local/bin/pg-test *", $home + "/.local/bin/pg18-fresh",
        # The sandbox blocks signals to processes from earlier calls. The helper checks every target itself.
        $home + "/.local/bin/agent-stop *",
        # The sandbox blocks ~/Library/LaunchAgents and launchctl bootstrap. These run no arguments; they manage one fixed LaunchAgent.
        $home + "/.local/bin/agent-awake", $home + "/.local/bin/agent-sleep",
        $home + "/.local/bin/paseo-awake", $home + "/.local/bin/paseo-sleep",
        # ps is setuid, so the sandbox blocks it. It reads process data and cannot run code.
        "/bin/ps *"])
    # Production servers ask before each ssh, scp, or rsync. Ask rules are only added, never removed.
    | .permissions.ask |= append(($staging | split(" ")) as $stage | $servers | split(" ") | map(select(. != "" and (. as $s | $stage | index([$s]) | not)))
        | map("Bash(ssh *\(.)*)", "Bash(scp *\(.)*)", "Bash(rsync *\(.)*)"))
  ' "$1"
}

# Refuse a settings file that the sandbox can write: an agent could then change its own sandbox.
check_location() {
  local root
  while IFS= read -r root; do
    case $root in '~/'*) root=$home/${root#'~/'} ;; //*) root=${root#/} ;; esac
    root=$(realpath "$root" 2>/dev/null || printf '%s' "$root")
    if [[ $settings == "${root%/}"/* ]]; then
      echo "Refusing $settings: it is inside the sandbox write root $root." >&2; exit 1
    fi
  done < <(jq -r '.sandbox.filesystem.allowWrite[]' "$1")
  jq -r '.sandbox | to_entries[] | select((.key == "autoAllowBashIfSandboxed" or .key == "allowUnsandboxedCommands") and .value != true)
    | "Keeping the existing sandbox.\(.key) = \(.value | tojson)."' "$settings"
}

# --emit prints the merged settings for a one-off test that skips the live user file:
#   claude -p --setting-sources project,local --settings "$(scripts/apply-claude-sandbox.sh --emit)"
if [[ $mode == emit ]]; then merge "$settings"; exit; fi
work=$(mktemp -d "${TMPDIR:?}/tmp.XXXXXX")
trap 'rm -rf -- "${work:?}"' EXIT

if [[ $mode == dry-run ]]; then
  merge "$settings" > "$work/settings.json" || { echo "Cannot parse $settings as JSON" >&2; exit 1; }
  check_location "$work/settings.json"
  diff -u "$settings" "$work/settings.json" || true
  has_git_rule || echo "Would set: git config --global $git_key $git_value"
  [[ $update == 0 ]] || echo "Would run: $repo/update.sh"
  echo 'Dry run: nothing changed.'
  exit 0
fi

backup="$settings.before-sandbox-$(date +%Y%m%d-%H%M%S)"
[[ ! -e $backup ]] || { echo "Backup $backup exists. Wait one second and run again." >&2; exit 1; }
if [[ $mode == off ]]; then
  jq '.sandbox.enabled = false' "$settings" > "$work/settings.json" || { echo "Cannot parse $settings as JSON" >&2; exit 1; }
  cp -p "$settings" "$backup"
  echo "Backup: $backup"
  diff -u "$backup" "$work/settings.json" || true
  cat "$work/settings.json" > "$settings"
  echo 'Sandbox off. Start fresh sessions. Turn it on again: scripts/apply-claude-sandbox.sh --no-update'
  exit 0
fi

# Fail on invalid JSON before anything changes.
merge "$settings" > "$work/settings.json" || { echo "Cannot parse $settings as JSON" >&2; exit 1; }
check_location "$work/settings.json"
cp -p "$settings" "$backup"
echo "Backup: $backup"
if [[ $update == 1 ]]; then "$repo/update.sh"; fi
# update.sh can change settings.json, so merge the current file.
merge "$settings" > "$work/settings.json"
check_location "$work/settings.json"
diff -u "$backup" "$work/settings.json" || true
cat "$work/settings.json" > "$settings"
if ! has_git_rule; then
  git config --global --add "$git_key" "$git_value"
  : > "$backup.git-rule-added"
  echo "Set the Git rule $git_key=$git_value."
fi
echo "Applied. Start fresh sessions, then run the checklist in docs/claude-sandbox.md. Off: --off. Full restore: --restore $backup"
