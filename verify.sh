#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

"$repo_dir/codex/skills/autoreview/scripts/autoreview" --self-test
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-goal/tests/goal-core.test.ts"
npm --prefix "$repo_dir/pi/extensions/figma-mcp" test
test -f "$repo_dir/pi/extensions/figma-mcp/node_modules/mcp-remote/dist/proxy.js"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/codex-goal/index.ts" --list-models >"$tmp_dir/goal-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/figma-mcp/index.ts" --list-models >"$tmp_dir/figma-models.txt"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | pi --offline --mode rpc --no-session >"$tmp_dir/rpc.jsonl" 2>"$tmp_dir/rpc.err"
grep -q '"name":"goal"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"figma"' "$tmp_dir/rpc.jsonl"

printf '\nAll checks passed.\n'
