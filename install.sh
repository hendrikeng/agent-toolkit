#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
timestamp=$(date +%Y%m%d-%H%M%S)
backup_root="${XDG_DATA_HOME:-$HOME/.local/share}/agent-toolkit/backups/$timestamp"
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
pi_agent_dir=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
if [[ $pi_agent_dir != /* ]]; then
  printf 'PI_CODING_AGENT_DIR must be an absolute path; expand ~ before running the installer\n' >&2
  exit 2
fi
if [[ -n ${PI_CODING_AGENT_DIR:-} ]]; then
  pi_web_config_dir=$pi_agent_dir
elif [[ -n ${XDG_CONFIG_HOME:-} ]]; then
  pi_web_config_dir=$XDG_CONFIG_HOME/pi
else
  pi_web_config_dir=$HOME/.pi
fi

install_link() {
  local source=$1
  local target=$2

  mkdir -p "$(dirname "$target")"

  if [[ -L "$target" ]]; then
    ln -sfn "$source" "$target"
    printf 'updated %s -> %s\n' "$target" "$source"
    return
  fi

  if [[ -e "$target" ]]; then
    local relative_target=${target#"$HOME"/}
    local backup="$backup_root/$relative_target"
    mkdir -p "$(dirname "$backup")"
    mv "$target" "$backup"
    printf 'backed up %s -> %s\n' "$target" "$backup"
  fi

  ln -s "$source" "$target"
  printf 'installed %s -> %s\n' "$target" "$source"
}

claude_ponytail_marketplace_source() {
  claude plugin marketplace list --json 2>/dev/null | node -e '
    const marketplaces = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const marketplace = marketplaces.find(entry => entry.name === "ponytail");
    if (marketplace) process.stdout.write(`${marketplace.source}:${marketplace.repo}`);
  '
}

codex_ponytail_marketplace_source() {
  codex plugin marketplace list --json 2>/dev/null | node -e '
    const result = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const marketplace = result.marketplaces.find(entry => entry.name === "ponytail");
    if (marketplace) {
      process.stdout.write(`${marketplace.marketplaceSource.sourceType}:${marketplace.marketplaceSource.source}`);
    }
  '
}

claude_has_user_ponytail() {
  claude plugin list --json 2>/dev/null | node -e '
    const plugins = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const requireEnabled = process.argv[1] === "enabled";
    process.exit(plugins.some(plugin =>
      plugin.id === "ponytail@ponytail" &&
      plugin.scope === "user" &&
      (!requireEnabled || plugin.enabled === true)
    ) ? 0 : 1);
  ' "$1"
}

install_pi_web_config() {
  local target=$pi_web_config_dir/web-search.json
  mkdir -p "$pi_web_config_dir"
  node -e '
    const fs = require("fs");
    const defaultsPath = process.argv[1];
    const target = process.argv[2];
    const defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
    let current = {};
    let targetStat;
    try { targetStat = fs.lstatSync(target); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (targetStat) {
      try { current = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) {
        if (!targetStat.isSymbolicLink() || error?.code !== "ENOENT") throw error;
      }
    }
    const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ ...current, ...defaults }, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  ' "$repo_dir/shared/pi-web-access/defaults.json" "$target"
  printf 'configured %s from safe defaults (existing API keys preserved)\n' "$target"
}

install_pi_web_access() {
  local source="npm:pi-web-access@0.13.0"
  if ! command -v pi >/dev/null 2>&1; then
    printf 'skipped Pi web access package (pi not found)\n'
    return
  fi

  pi install "$source"

  local settings_path=$pi_agent_dir/settings.json
  node "$repo_dir/shared/pi-web-access/configure-package.cjs" "$settings_path" "$source"
}

install_ponytail() {
  local version pi_source marketplace_source
  version=$(<"$repo_dir/shared/ponytail/VERSION")
  pi_source="git:github.com/DietrichGebert/ponytail@v$version"

  if command -v claude >/dev/null 2>&1; then
    marketplace_source=$(claude_ponytail_marketplace_source)
    case "$marketplace_source" in
      '') claude plugin marketplace add DietrichGebert/ponytail ;;
      github:DietrichGebert/ponytail) ;;
      *) printf 'refusing unexpected Claude Ponytail marketplace: %s\n' "$marketplace_source" >&2; return 1 ;;
    esac
    if claude_has_user_ponytail enabled; then
      printf 'Claude Ponytail plugin already installed and enabled at user scope\n'
    elif claude_has_user_ponytail any; then
      claude plugin enable ponytail@ponytail --scope user
    else
      claude plugin install ponytail@ponytail --scope user
    fi
  else
    printf 'skipped Claude Ponytail plugin (claude not found)\n'
  fi

  if command -v codex >/dev/null 2>&1; then
    marketplace_source=$(codex_ponytail_marketplace_source)
    case "$marketplace_source" in
      '') codex plugin marketplace add DietrichGebert/ponytail ;;
      git:https://github.com/DietrichGebert/ponytail.git) ;;
      *) printf 'refusing unexpected Codex Ponytail marketplace: %s\n' "$marketplace_source" >&2; return 1 ;;
    esac
    if codex plugin list 2>/dev/null | grep '^ponytail@ponytail[[:space:]].*installed, enabled' >/dev/null; then
      printf 'Codex Ponytail plugin already installed and enabled\n'
    else
      codex plugin add ponytail@ponytail
    fi
  else
    printf 'skipped Codex Ponytail plugin (codex not found)\n'
  fi

  if command -v pi >/dev/null 2>&1; then
    pi install "$pi_source"
  else
    printf 'skipped Pi Ponytail package (pi not found)\n'
  fi
}

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to install figma-mcp dependencies.\n' >&2
  exit 1
fi

printf 'installing pinned toolkit dependencies…\n'
(
  cd "$repo_dir/pi/extensions/figma-mcp"
  npm ci --ignore-scripts --no-audit --no-fund
)
(
  cd "$repo_dir/pi/skills/react-doctor"
  npm ci --ignore-scripts --no-audit --no-fund
)
(
  cd "$repo_dir/shared/pi-web-access"
  npm ci --ignore-scripts --no-audit --no-fund
)

install_link "$repo_dir/codex/skills/autoreview" "$HOME/.codex/skills/autoreview"
install_link "$repo_dir/codex/skills/handoff" "$HOME/.codex/skills/handoff"
install_link "$repo_dir/codex/skills/handoff" "$pi_agent_dir/skills/handoff"
install_link "$repo_dir/pi/extensions/codex-goal" "$pi_agent_dir/extensions/codex-goal"
install_link "$repo_dir/pi/extensions/figma-mcp" "$pi_agent_dir/extensions/figma-mcp"
install_link "$repo_dir/pi/extensions/web-access-gate" "$pi_agent_dir/extensions/web-access-gate"
install_link "$repo_dir/pi/skills/react-doctor" "$pi_agent_dir/skills/react-doctor"
install_link "$repo_dir/pi/skills/vue" "$pi_agent_dir/skills/vue"
install_link "$repo_dir/shared/ponytail/config.json" "$config_root/ponytail/config.json"
install_pi_web_config

printf '\ninstalling Ponytail for available agent hosts…\n'
install_ponytail
printf '\ninstalling lazy Pi web access…\n'
install_pi_web_access

printf '\nInstallation complete. Run /reload in active Pi sessions and start new agent sessions.\n'
printf 'On first Codex start, review and trust Ponytail hooks when prompted (or open /hooks).\n'
