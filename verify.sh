#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
pi_agent_dir=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
if [[ $pi_agent_dir != /* ]]; then
  printf 'PI_CODING_AGENT_DIR must be an absolute path; expand ~ before running verification\n' >&2
  exit 2
fi
if [[ -n ${PI_CODING_AGENT_DIR:-} ]]; then
  pi_web_config_dir=$pi_agent_dir
elif [[ -n ${XDG_CONFIG_HOME:-} ]]; then
  pi_web_config_dir=$XDG_CONFIG_HOME/pi
else
  pi_web_config_dir=$HOME/.pi
fi
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

"$repo_dir/codex/skills/autoreview/scripts/autoreview" --self-test
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$HOME/.codex/skills/handoff/SKILL.md"
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$pi_agent_dir/skills/handoff/SKILL.md"
cmp "$repo_dir/pi/skills/react-doctor/SKILL.md" "$pi_agent_dir/skills/react-doctor/SKILL.md"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$pi_agent_dir/skills/vue/SKILL.md"
cmp "$repo_dir/shared/ponytail/config.json" "$config_root/ponytail/config.json"
test ! -L "$pi_web_config_dir/web-search.json"
node -e '
  const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(config.workflow === "none" && config.allowBrowserCookies === false ? 0 : 1);
' "$pi_web_config_dir/web-search.json"

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
  pi list --no-approve | grep -F "npm:pi-web-access@0.13.0" >/dev/null
  pi_settings=$pi_agent_dir/settings.json
  node -e '
    const settings = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const entry = settings.packages?.find((item) =>
      typeof item === "object" && item?.source === "npm:pi-web-access@0.13.0"
    );
    process.exit(entry && Array.isArray(entry.skills) && entry.skills.length === 0 ? 0 : 1);
  ' "$pi_settings"
fi

"$repo_dir/pi/skills/react-doctor/scripts/react-doctor" --help >/dev/null
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-goal/tests/goal-core.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/web-access-gate/tests/web-access-core.test.ts"
npm --prefix "$repo_dir/pi/extensions/figma-mcp" test
test -f "$repo_dir/pi/extensions/figma-mcp/node_modules/mcp-remote/dist/proxy.js"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/codex-goal/index.ts" --list-models >"$tmp_dir/goal-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/figma-mcp/index.ts" --list-models >"$tmp_dir/figma-models.txt"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | pi --offline --mode rpc --no-session >"$tmp_dir/rpc.jsonl" 2>"$tmp_dir/rpc.err"
grep -q '"name":"goal"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"figma"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"ponytail"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"web"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:handoff"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:react-doctor"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:vue"' "$tmp_dir/rpc.jsonl"
if grep -q '"name":"skill:librarian"' "$tmp_dir/rpc.jsonl"; then
  printf 'pi-web-access librarian skill should be filtered out\n' >&2
  exit 1
fi

fresh_agent_dir="$tmp_dir/fresh-pi-agent"
mkdir -p "$fresh_agent_dir/skills"
ln -s "$repo_dir/codex/skills/handoff" "$fresh_agent_dir/skills/handoff"
printf '%s\n' '{"enableSkillCommands":true}' >"$fresh_agent_dir/settings.json"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | PI_CODING_AGENT_DIR="$fresh_agent_dir" pi --offline --mode rpc --no-session --no-extensions \
    >"$tmp_dir/fresh-rpc.jsonl" 2>"$tmp_dir/fresh-rpc.err"
grep -q '"name":"skill:handoff"' "$tmp_dir/fresh-rpc.jsonl"

printf '\nAll checks passed.\n'
