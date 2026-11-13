#!/usr/bin/env bash
# Applies the Claude sandbox settings from docs/claude-sandbox.md. Run it once from a trusted human terminal:
#   scripts/apply-claude-sandbox.sh [--dry-run | --undo] [--no-update]
# It backs up settings.json, runs ./update.sh, merges the sandbox settings with jq, and sets the Git HTTPS rule.
# --undo restores the latest backup and removes the Git rule if this script added it.
set -euo pipefail
repo=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
mode=apply update=1
for arg in "$@"; do
  case $arg in
    --dry-run) mode=dry-run ;;
    --undo) mode=undo ;;
    --emit) mode=emit ;;
    --no-update) update=0 ;;
    *) printf 'Usage: scripts/apply-claude-sandbox.sh [--dry-run | --emit | --undo] [--no-update]\n' >&2; exit 2 ;;
  esac
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

if [[ $mode == undo ]]; then
  backup=$(ls -1 "$settings".before-sandbox-* 2>/dev/null | grep -v '\.git-rule-added$' | sort | tail -n 1 || true)
  [[ $backup ]] || { echo "No backup found for $settings" >&2; exit 1; }
  diff -u "$settings" "$backup" || true
  cp -p "$backup" "$settings"
  if [[ -e $backup.git-rule-added ]]; then
    git config --global --unset "$git_key" '^git@github\.com:$' || true
    echo "Removed the Git rule $git_key=$git_value."
  fi
  # Each undo consumes its backup, so the next undo goes one run further back.
  rm -f -- "$backup" "$backup.git-rule-added"
  echo "Restored $settings from $backup. Start fresh sessions."
  exit 0
fi

home=$HOME
# macOS mktemp without a template uses this per-user directory, not TMPDIR.
darwin_tmp=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)
# Deployment servers that agents reach with ssh, scp, and rsync: Porta Mundi, Bonzani, and WFW.
servers=${SANDBOX_SSH_SERVERS-agawulum@sl90.web.hostpoint.ch bonzanib@sl662.web.hostpoint.ch wfw-prod@wfw.ch wfw-staging@wfw.ch}
merge() {
  jq --arg home "$home" --arg darwin_tmp "${darwin_tmp%/}" --arg servers "$servers" '
    # Append missing items and keep the existing order.
    def append($items): reduce $items[] as $item (. // []; if index([$item]) then . else . + [$item] end);
    # Deny rules for each command form: plain, with global options, and by path. See docs/claude-sandbox.md.
    def deny($tool; $actions): [($tool, "\($tool) -*", "*/\($tool)", "*/\($tool) -*") as $form | $actions[] | "Bash(\($form) \(.))"];
    .env = ((.env // {}) + {SSL_CERT_FILE: "/etc/ssl/cert.pem"})
    # Actions that cannot be undone. reset --hard, stash drop, and branch -D stay with the auto mode classifier.
    | .permissions.deny |= append(
        # -f alone or in a short-option cluster with -u, -v, or -q, such as -uf or -uvf. -*f* would also match -u feature.
        deny("git"; [("", "u", "v", "q", "uv", "vu", "uq", "qu", "vq", "qv") as $c | "push -\($c)f*", "push * -\($c)f*"]
          + ["push --force*", "push * --force*", "push --mirror*", "push * --mirror*", "push +*", "push * +*",
          "clean -*x*", "clean -*X*", "stash clear*", "reflog expire*", "gc --prune*", "gc * --prune*"])
        # Only the subcommands that delete, with the aliases from fly --help. An argument such as --app destroy-demo stays allowed.
        # The deprecated fly destroy has no option form: fly -* destroy* matches fly --app destroy-demo status.
        + ([("fly", "flyctl") as $tool | ["Bash(\($tool) destroy*)", "Bash(*/\($tool) destroy*)"]
          + deny($tool; ["ext * destroy", "ext * destroy *", "extensions * destroy", "extensions * destroy *"]
          + [("apps", "app") as $g | ("destroy", "delete", "remove", "rm") as $v | "\($g) \($v)*"]
          + [("machine", "machines", "m") as $g | ("destroy", "remove", "rm") as $v | "\($g) \($v)*"]
          + [("volumes", "volume", "vol", "v") as $g | ("destroy", "delete", "rm") as $v | "\($g) \($v)*"]
          + [("mpg", "redis", "storage", "tigris") as $g | "\($g) destroy*"])] | add)
        + deny("supabase"; ["projects delete*", "db reset *--linked*", "db reset *--db-url*"])
        + deny("vercel"; ["remove*", "rm*"]))
    # An earlier version set CLAUDE_CODE_TMPDIR. The sandbox does not move its write rule there, so every
    # temporary file and the cwd file of each call fail. Remove any value.
    | del(.env.CLAUDE_CODE_TMPDIR)
    | .sandbox = (.sandbox // {})
    | .sandbox.enabled = true
    | .sandbox.failIfUnavailable = true
    | .sandbox.autoAllowBashIfSandboxed = true
    | .sandbox.allowUnsandboxedCommands = false
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
    # Orchestrators commit in worker worktrees, whose Git data is in the main checkouts.
    # The project roots must stay the same as the allowed roots in shared/agent-stop.pl. The test compares them.
    # ~/.fly and the pnpm cache (pnpm dlx) need probe verification.
    | .sandbox.filesystem.allowWrite |= append([$home + "/.npm", $home + "/.cache/uv", $home + "/Library/pnpm/store",
        $home + "/Library/Caches/pnpm", $home + "/.fly",
        $home + "/Code/paseo-worktrees", $home + "/Code/tracn", $home + "/Code/wewereyoung", $home + "/Code/envest"]
        + (if $darwin_tmp == "" then [] else [$darwin_tmp] end))
    # An agent can change capture.mjs in its working directory and then run it outside the sandbox.
    # The Docker socket replaces the earlier docker exclusion.
    # Server entries in the generated form are replaced, so a shorter or empty list removes old servers.
    | .sandbox.excludedCommands = ((.sandbox.excludedCommands // []) | map(select((contains("capture.mjs") or . == "docker *"
        or test("^ssh [^ ]+@[^ ]+ \\*$") or test("^(scp|rsync) \\* [^ ]+@[^ ]+:\\*$")) | not)))
    | .sandbox.excludedCommands |= append([
        "pg-test *", "pg18-fresh", "paseo *",
        $home + "/.claude/skills/autoreview/scripts/autoreview *",
        $home + "/.paseo/zerosub/homes/*/skills/autoreview/scripts/autoreview *",
        $home + "/.local/share/agent-toolkit/resources/skills/autoreview/scripts/autoreview *",
        # The sandbox blocks signals to processes from earlier calls. The helper checks every target itself.
        $home + "/.local/bin/agent-stop *",
        # The sandbox blocks ~/Library/LaunchAgents and launchctl bootstrap. These run no arguments; they manage one fixed LaunchAgent.
        $home + "/.local/bin/agent-awake", $home + "/.local/bin/agent-sleep",
        $home + "/.local/bin/paseo-awake", $home + "/.local/bin/paseo-sleep",
        # ps is setuid, so the sandbox blocks it. It reads process data and cannot run code.
        "/bin/ps *"]
        # Plain ssh cannot pass the sandbox proxy. Only these servers are excluded.
        # ponytail: options such as ssh -o ProxyCommand, scp -S, and rsync -e can run local code outside the sandbox.
        # Accepted because these agents already control the servers; a validating wrapper closes it if needed.
        + ($servers | split(" ") | map(select(. != "")) | map("ssh \(.) *", "scp * \(.):*", "rsync * \(.):*")))
  ' "$1"
}

[[ -e $settings ]] || { echo "Missing $settings" >&2; exit 1; }
# --emit prints the merged settings for a one-off test that skips the live user file:
#   claude -p --setting-sources project,local --settings "$(scripts/apply-claude-sandbox.sh --emit)"
if [[ $mode == emit ]]; then merge "$settings"; exit; fi
work=$(mktemp -d "${TMPDIR:?}/tmp.XXXXXX")
trap 'rm -rf -- "${work:?}"' EXIT

if [[ $mode == dry-run ]]; then
  merge "$settings" > "$work/settings.json" || { echo "Cannot parse $settings as JSON" >&2; exit 1; }
  diff -u "$settings" "$work/settings.json" || true
  has_git_rule || echo "Would set: git config --global $git_key $git_value"
  [[ $update == 0 ]] || echo "Would run: $repo/update.sh"
  echo 'Dry run: nothing changed.'
  exit 0
fi

# Fail on invalid JSON before anything changes.
merge "$settings" > /dev/null || { echo "Cannot parse $settings as JSON" >&2; exit 1; }
backup="$settings.before-sandbox-$(date +%Y%m%d-%H%M%S)"
[[ ! -e $backup ]] || { echo "Backup $backup exists. Wait one second and run again." >&2; exit 1; }
cp -p "$settings" "$backup"
echo "Backup: $backup"
if [[ $update == 1 ]]; then "$repo/update.sh"; fi
# update.sh can change settings.json, so merge the current file.
merge "$settings" > "$work/settings.json"
diff -u "$backup" "$work/settings.json" || true
cat "$work/settings.json" > "$settings"
if ! has_git_rule; then
  git config --global --add "$git_key" "$git_value"
  : > "$backup.git-rule-added"
  echo "Set the Git rule $git_key=$git_value."
fi
echo 'Applied. Start fresh sessions, then run the probe from docs/claude-sandbox.md. Undo: scripts/apply-claude-sandbox.sh --undo'
