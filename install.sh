#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
timestamp=$(date +%Y%m%d-%H%M%S)
backup_root="${XDG_DATA_HOME:-$HOME/.local/share}/agent-toolkit/backups/$timestamp"

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

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to install figma-mcp dependencies.\n' >&2
  exit 1
fi

printf 'installing figma-mcp dependencies…\n'
(
  cd "$repo_dir/pi/extensions/figma-mcp"
  npm ci --ignore-scripts --no-audit --no-fund
)

install_link "$repo_dir/codex/skills/autoreview" "$HOME/.codex/skills/autoreview"
install_link "$repo_dir/pi/extensions/codex-goal" "$HOME/.pi/agent/extensions/codex-goal"
install_link "$repo_dir/pi/extensions/figma-mcp" "$HOME/.pi/agent/extensions/figma-mcp"

printf '\nInstallation complete. Run /reload in active Pi sessions.\n'
