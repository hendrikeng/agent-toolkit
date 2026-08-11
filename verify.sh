#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
config_root=${XDG_CONFIG_HOME:-$HOME/.config}
pi_agent_dir=${AGENT_TOOLKIT_PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}
if [[ $pi_agent_dir != /* ]]; then
  printf 'PI_CODING_AGENT_DIR must be an absolute path; expand ~ before running verification\n' >&2
  exit 2
fi
if [[ -n ${AGENT_TOOLKIT_PI_WEB_CONFIG_DIR:-} ]]; then
  pi_web_config_dir=$AGENT_TOOLKIT_PI_WEB_CONFIG_DIR
elif [[ -n ${PI_CODING_AGENT_DIR:-} ]]; then
  pi_web_config_dir=$pi_agent_dir
elif [[ -n ${XDG_CONFIG_HOME:-} ]]; then
  pi_web_config_dir=$XDG_CONFIG_HOME/pi
else
  pi_web_config_dir=$HOME/.pi
fi
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

node "$repo_dir/shared/agent-safety/configure.cjs" --self-test
bash -n "$repo_dir/shared/agent-safety/agent-yolo"
bash -n "$repo_dir/shared/agent-safety/git-yolo-guard"
mkdir "$tmp_dir/fake-bin"
cat >"$tmp_dir/fake-bin/pi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cp "$PI_CODING_AGENT_DIR/extensions/pi-permission-system/config.json" "$PI_YOLO_CAPTURE"
printf '%s\n' "$AGENT_TOOLKIT_PI_AGENT_DIR" > "$PI_YOLO_SOURCE_CAPTURE"
printf '%s\n' "$AGENT_TOOLKIT_PI_WEB_CONFIG_DIR" > "$PI_YOLO_WEB_CONFIG_CAPTURE"
SH
chmod +x "$tmp_dir/fake-bin/pi"
cp "$repo_dir/shared/agent-safety/agent-yolo" "$tmp_dir/pi-yolo"
chmod +x "$tmp_dir/pi-yolo"
PATH="$tmp_dir/fake-bin:$PATH" PI_CODING_AGENT_DIR="$pi_agent_dir" PI_YOLO_CAPTURE="$tmp_dir/pi-yolo-config.json" PI_YOLO_SOURCE_CAPTURE="$tmp_dir/pi-yolo-source.txt" PI_YOLO_WEB_CONFIG_CAPTURE="$tmp_dir/pi-yolo-web-config.txt" "$tmp_dir/pi-yolo"
test "$(<"$tmp_dir/pi-yolo-source.txt")" = "$pi_agent_dir"
test "$(<"$tmp_dir/pi-yolo-web-config.txt")" = "$pi_agent_dir"
node - "$tmp_dir/pi-yolo-config.json" "$pi_agent_dir" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(config.yoloMode, true);
assert.equal(config.permission.external_directory["*"], "deny");
assert.equal(config.permission.external_directory[path.join(process.env.HOME, "Code", "*")], "allow");
assert.equal(config.permission.path["*.env"], "deny");
assert.equal(config.permission.bash["bash *"], "deny");
assert.equal(config.permission.bash["*/git *"], "deny");
const managedAgentDir = fs.realpathSync(process.argv[3]);
assert.ok(config.piInfrastructureReadPaths.includes(path.join(managedAgentDir, "git")));
assert.ok(config.piInfrastructureReadPaths.includes(path.join(managedAgentDir, "npm/node_modules")));
assert.ok(!config.piInfrastructureReadPaths.includes(managedAgentDir));
NODE
for launcher in pi-yolo codex-yolo claude-yolo; do
  target=$HOME/.local/bin/$launcher
  test ! -L "$target"
  cmp "$repo_dir/shared/agent-safety/agent-yolo" "$target"
  test -x "$target"
  test "$(<"$target.agent-toolkit.sha256")" = "$(shasum -a 256 "$target" | awk '{print $1}')"
done
test ! -L "$HOME/.local/libexec/agent-toolkit/git"
cmp "$repo_dir/shared/agent-safety/git-yolo-guard" "$HOME/.local/libexec/agent-toolkit/git"
test -x "$HOME/.local/libexec/agent-toolkit/git"
test "$(<"$HOME/.local/libexec/agent-toolkit/git.agent-toolkit.sha256")" = "$(shasum -a 256 "$HOME/.local/libexec/agent-toolkit/git" | awk '{print $1}')"
absolute_git_dir=$(git -C "$repo_dir" rev-parse --absolute-git-dir)
"$repo_dir/shared/agent-safety/git-yolo-guard" --git-dir="$absolute_git_dir" --work-tree="$repo_dir" status >/dev/null
if "$repo_dir/shared/agent-safety/git-yolo-guard" -C "$repo_dir" clean -nd >/dev/null 2>&1; then
  printf 'git yolo guard allowed git clean\n' >&2
  exit 1
fi
"$repo_dir/codex/skills/autoreview/scripts/autoreview" --self-test
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$HOME/.codex/skills/handoff/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$HOME/.codex/skills/fastify/SKILL.md"
cmp "$repo_dir/pi/extensions/simple-english/SKILL.md" "$HOME/.codex/skills/simple-english/SKILL.md"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$HOME/.codex/skills/vue/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$HOME/.claude/skills/fastify/SKILL.md"
cmp "$repo_dir/pi/extensions/simple-english/SKILL.md" "$HOME/.claude/skills/simple-english/SKILL.md"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$HOME/.claude/skills/vue/SKILL.md"
cmp "$repo_dir/codex/skills/autoreview/SKILL.md" "$pi_agent_dir/skills/autoreview/SKILL.md"
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$pi_agent_dir/skills/handoff/SKILL.md"
cmp "$repo_dir/pi/AGENTS.md" "$pi_agent_dir/AGENTS.md"
cmp "$repo_dir/pi/extensions/codex-account/index.ts" "$pi_agent_dir/extensions/codex-account/index.ts"
cmp "$repo_dir/pi/extensions/git-push/index.ts" "$pi_agent_dir/extensions/git-push/index.ts"
cmp "$repo_dir/pi/skills/react-doctor/SKILL.md" "$pi_agent_dir/skills/react-doctor/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$pi_agent_dir/skills/fastify/SKILL.md"
test ! -e "$pi_agent_dir/skills/simple-english" && test ! -L "$pi_agent_dir/skills/simple-english"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$pi_agent_dir/skills/vue/SKILL.md"
cmp "$repo_dir/shared/ponytail/config.json" "$config_root/ponytail/config.json"
cmp "$repo_dir/pi/extensions/orca-permission-bell/index.ts" "$pi_agent_dir/extensions/orca-permission-bell/index.ts"
cmp "$repo_dir/pi/extensions/review-mode/index.ts" "$pi_agent_dir/extensions/review-mode/index.ts"
cmp "$repo_dir/pi/extensions/simple-english/index.ts" "$pi_agent_dir/extensions/simple-english/index.ts"
test ! -L "$pi_web_config_dir/web-search.json"
node -e '
  const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(config.workflow === "none" && config.allowBrowserCookies === false ? 0 : 1);
' "$pi_web_config_dir/web-search.json"

ponytail_version=$(<"$repo_dir/shared/ponytail/VERSION")
permission_version=$(<"$repo_dir/shared/agent-safety/PI_PERMISSION_SYSTEM_VERSION")
if command -v claude >/dev/null 2>&1; then
  "$HOME/.local/bin/claude-yolo" --help >/dev/null
  claude plugin list --json | node -e '
    const plugins = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.exit(plugins.some(plugin =>
      plugin.id === "ponytail@ponytail" &&
      plugin.scope === "user" &&
      plugin.enabled === true
    ) ? 0 : 1);
  '
  node -e '
    const settings = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const deny = settings.permissions?.deny ?? [];
    const roots = settings.permissions?.additionalDirectories ?? [];
    process.exit(settings.sandbox?.enabled === true && settings.sandbox?.failIfUnavailable === true && deny.includes("Bash(rm *)") && deny.includes("Bash(git reset --hard)") && roots.some((root) => root.endsWith("/Code")) ? 0 : 1);
  ' "$HOME/.claude/settings.json"
fi
if command -v codex >/dev/null 2>&1; then
  "$HOME/.local/bin/codex-yolo" --help >/dev/null
  codex plugin list | grep '^ponytail@ponytail[[:space:]].*installed, enabled' >/dev/null
  test ! -L "$HOME/.codex/rules/agent-safety.rules"
  cmp "$repo_dir/shared/agent-safety/codex.rules" "$HOME/.codex/rules/agent-safety.rules"
  test "$(<"$HOME/.codex/rules/agent-safety.rules.agent-toolkit.sha256")" = "$(shasum -a 256 "$HOME/.codex/rules/agent-safety.rules" | awk '{print $1}')"
  codex execpolicy check --pretty --rules "$HOME/.codex/rules/agent-safety.rules" -- rm -rf keep-me \
    | grep -q '"decision": "forbidden"'
  codex execpolicy check --pretty --rules "$HOME/.codex/rules/agent-safety.rules" -- /bin/rm -rf keep-me \
    | grep -q '"decision": "forbidden"'
  codex execpolicy check --pretty --rules "$HOME/.codex/rules/agent-safety.rules" -- git clean -fdx \
    | grep -q '"decision": "forbidden"'
  codex execpolicy check --pretty --rules "$HOME/.codex/rules/agent-safety.rules" -- git -C /tmp status \
    | grep -q '"decision": "prompt"'
  grep -Eq "^[[:space:]]*sandbox_mode[[:space:]]*=[[:space:]]*['\"](workspace-write|read-only)['\"]([[:space:]]*#.*)?$" "$HOME/.codex/config.toml"
  grep -Eq "^[[:space:]]*approval_policy[[:space:]]*=[[:space:]]*(['\"](on-request|untrusted)['\"]|\\{)" "$HOME/.codex/config.toml"
fi
if command -v pi >/dev/null 2>&1; then
  "$HOME/.local/bin/pi-yolo" --help >/dev/null
  pi list --no-approve \
    | grep -F "git:github.com/DietrichGebert/ponytail@v$ponytail_version" >/dev/null
  pi list --no-approve | grep -F "npm:pi-web-access@0.13.0" >/dev/null
  pi list --no-approve | grep -F "npm:@gotgenes/pi-permission-system@$permission_version" >/dev/null
  test ! -L "$pi_agent_dir/extensions/pi-permission-system/config.json"
  cp "$repo_dir/shared/agent-safety/pi-permission-system.json" "$tmp_dir/pi-permission-system.json"
  node "$repo_dir/shared/agent-safety/configure.cjs" pi "$tmp_dir/pi-permission-system.json" "$repo_dir" "$pi_agent_dir" "$pi_web_config_dir"
  cmp "$tmp_dir/pi-permission-system.json" "$pi_agent_dir/extensions/pi-permission-system/config.json"
  test "$(<"$pi_agent_dir/extensions/pi-permission-system/config.json.agent-toolkit.sha256")" = "$(shasum -a 256 "$pi_agent_dir/extensions/pi-permission-system/config.json" | awk '{print $1}')"
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
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-account/tests/codex-account.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-goal/tests/goal-core.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/git-push/tests/git-push.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/orca-permission-bell/tests/orca-permission-bell.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/review-mode/tests/review-mode.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/simple-english/tests/simple-english.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/web-access-gate/tests/web-access-core.test.ts"
npm --prefix "$repo_dir/pi/extensions/figma-mcp" test
test -f "$repo_dir/pi/extensions/figma-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/codex-goal/index.ts" --list-models >"$tmp_dir/goal-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/figma-mcp/index.ts" --list-models >"$tmp_dir/figma-models.txt"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | pi --offline --mode rpc --no-session >"$tmp_dir/rpc.jsonl" 2>"$tmp_dir/rpc.err"
grep -q '"name":"goal"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"figma"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"push"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"ponytail"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"codex-account"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"reviews"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"simple-english"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"web"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:autoreview"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:handoff"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:react-doctor"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:fastify"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:vue"' "$tmp_dir/rpc.jsonl"
if grep -q '"name":"skill:simple-english"' "$tmp_dir/rpc.jsonl"; then
  printf 'Simple English should be exposed only through /simple-english in Pi\n' >&2
  exit 1
fi
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
