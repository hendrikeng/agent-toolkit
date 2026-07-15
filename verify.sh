#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

"$repo_dir/codex/skills/autoreview/scripts/autoreview" --self-test
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$HOME/.codex/skills/handoff/SKILL.md"
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$HOME/.pi/agent/skills/handoff/SKILL.md"
cmp "$repo_dir/shared/ponytail/config.json" "$config_root/ponytail/config.json"

ponytail_version=$(<"$repo_dir/shared/ponytail/VERSION")
if command -v claude >/dev/null 2>&1; then
  claude plugin list --json | node -e '
    const plugins = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.exit(plugins.some(plugin =>
      plugin.id === "ponytail@ponytail" &&
      plugin.scope === "user" &&
      plugin.enabled === true
    ) ? 0 : 1);
  '
fi
if command -v codex >/dev/null 2>&1; then
  codex plugin list | grep '^ponytail@ponytail[[:space:]].*installed, enabled' >/dev/null
fi
if command -v pi >/dev/null 2>&1; then
  pi list --no-approve \
    | grep -F "git:github.com/DietrichGebert/ponytail@v$ponytail_version" >/dev/null
fi

node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-goal/tests/goal-core.test.ts"
npm --prefix "$repo_dir/pi/extensions/figma-mcp" test
test -f "$repo_dir/pi/extensions/figma-mcp/node_modules/mcp-remote/dist/proxy.js"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/codex-goal/index.ts" --list-models >"$tmp_dir/goal-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/figma-mcp/index.ts" --list-models >"$tmp_dir/figma-models.txt"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | pi --offline --mode rpc --no-session >"$tmp_dir/rpc.jsonl" 2>"$tmp_dir/rpc.err"
grep -q '"name":"goal"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"figma"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"ponytail"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:handoff"' "$tmp_dir/rpc.jsonl"

fresh_agent_dir="$tmp_dir/fresh-pi-agent"
mkdir -p "$fresh_agent_dir/skills"
ln -s "$repo_dir/codex/skills/handoff" "$fresh_agent_dir/skills/handoff"
printf '%s\n' '{"enableSkillCommands":true}' >"$fresh_agent_dir/settings.json"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | PI_CODING_AGENT_DIR="$fresh_agent_dir" pi --offline --mode rpc --no-session --no-extensions \
    >"$tmp_dir/fresh-rpc.jsonl" 2>"$tmp_dir/fresh-rpc.err"
grep -q '"name":"skill:handoff"' "$tmp_dir/fresh-rpc.jsonl"

printf '\nAll checks passed.\n'
