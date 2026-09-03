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
codex_profile_name=agent-toolkit-verify-$$
codex_profile_link=$HOME/.codex-accounts/$codex_profile_name
trap 'rm -f "$codex_profile_link"; rm -rf "$tmp_dir"' EXIT
mkdir -p "$HOME/.codex-accounts" "$tmp_dir/codex-profile"
ln -s "$tmp_dir/codex-profile" "$codex_profile_link"
node - "$tmp_dir/codex-profile/auth.json" <<'NODE'
const fs = require("node:fs");
const claims = { email: "verify@example.com", exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "verify-account" } };
const token = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
fs.writeFileSync(process.argv[2], JSON.stringify({ tokens: { access_token: token, refresh_token: "verify-refresh", account_id: "verify-account" } }));
NODE

node "$repo_dir/shared/agent-safety/configure.cjs" --self-test
bash -n "$repo_dir/shared/agent-safety/agent-yolo"
bash -n "$repo_dir/shared/agent-safety/git-yolo-guard"
bash -n "$repo_dir/update.sh"
bash -n "$repo_dir/shared/update-global-skills"
"$repo_dir/update.sh" --help >/dev/null
"$repo_dir/shared/update-global-skills" --help >/dev/null
grep -q -- '--package=skills@1.5.22' "$repo_dir/shared/update-global-skills"
mkdir "$tmp_dir/fake-bin"
cat >"$tmp_dir/fake-bin/pi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cp "$PI_CODING_AGENT_DIR/extensions/pi-permission-system/config.json" "$PI_YOLO_CAPTURE"
printf '%s\n' "$AGENT_TOOLKIT_PI_AGENT_DIR" > "$PI_YOLO_SOURCE_CAPTURE"
printf '%s\n' "$AGENT_TOOLKIT_PI_WEB_CONFIG_DIR" > "$PI_YOLO_WEB_CONFIG_CAPTURE"
if [[ -n ${PI_YOLO_AUTH_CAPTURE:-} ]]; then
  cp "$PI_CODING_AGENT_DIR/auth.json" "$PI_YOLO_AUTH_CAPTURE"
  printf '%s\n' "$PI_CODING_AGENT_DIR" > "$PI_YOLO_AGENT_DIR_CAPTURE"
  if [[ -n ${PI_YOLO_REAL_AGENT_DIR_CAPTURE:-} ]]; then
    (cd "$PI_CODING_AGENT_DIR" && pwd -P) > "$PI_YOLO_REAL_AGENT_DIR_CAPTURE"
  fi
  printf '%s\n' "$AGENT_TOOLKIT_CODEX_ACCOUNT" > "$PI_YOLO_ACCOUNT_CAPTURE"
fi
SH
chmod +x "$tmp_dir/fake-bin/pi"
cp "$repo_dir/shared/agent-safety/agent-yolo" "$tmp_dir/pi-yolo"
chmod +x "$tmp_dir/pi-yolo"
PATH="$tmp_dir/fake-bin:$PATH" CODEX_HOME= PI_CODING_AGENT_DIR="$pi_agent_dir" AGENT_TOOLKIT_PI_WEB_CONFIG_DIR="$pi_web_config_dir" PI_YOLO_CAPTURE="$tmp_dir/pi-yolo-config.json" PI_YOLO_SOURCE_CAPTURE="$tmp_dir/pi-yolo-source.txt" PI_YOLO_WEB_CONFIG_CAPTURE="$tmp_dir/pi-yolo-web-config.txt" "$tmp_dir/pi-yolo"
test "$(<"$tmp_dir/pi-yolo-source.txt")" = "$pi_agent_dir"
test "$(<"$tmp_dir/pi-yolo-web-config.txt")" = "$pi_web_config_dir"

profile_agent_dir="$tmp_dir/profile-agent"
mkdir -p "$profile_agent_dir/extensions/pi-permission-system"
cp "$pi_agent_dir/extensions/pi-permission-system/config.json" "$profile_agent_dir/extensions/pi-permission-system/config.json"
printf '%s\n' '{"openai-codex":{"type":"oauth","access":"old","refresh":"old","expires":1},"github-copilot":{"type":"oauth","access":"old","refresh":"old","expires":1},"anthropic":{"type":"api_key","key":"keep"}}' > "$profile_agent_dir/auth.json"
PATH="$tmp_dir/fake-bin:$PATH" CODEX_HOME="$profile_agent_dir/codex-runtimes/$codex_profile_name" AGENT_TOOLKIT_CODEX_ACCOUNT="$codex_profile_name" AGENT_TOOLKIT_CODEX_PROFILE_HOME="$HOME/.codex-accounts/$codex_profile_name/../$codex_profile_name/" AGENT_TOOLKIT_PI_AGENT_DIR="$profile_agent_dir" PI_CODING_AGENT_DIR="$profile_agent_dir" PI_YOLO_CAPTURE="$tmp_dir/profile-config.json" PI_YOLO_SOURCE_CAPTURE="$tmp_dir/profile-source.txt" PI_YOLO_WEB_CONFIG_CAPTURE="$tmp_dir/profile-web-config.txt" PI_YOLO_AUTH_CAPTURE="$tmp_dir/profile-auth-target.txt" PI_YOLO_AGENT_DIR_CAPTURE="$tmp_dir/profile-agent-dir.txt" PI_YOLO_REAL_AGENT_DIR_CAPTURE="$tmp_dir/profile-real-agent-dir.txt" PI_YOLO_ACCOUNT_CAPTURE="$tmp_dir/profile-account.txt" "$tmp_dir/pi-yolo"
case "$(<"$tmp_dir/profile-agent-dir.txt")" in
  "${TMPDIR:-/tmp}"/agent-toolkit-pi-yolo.*) ;;
  *) printf 'pi-yolo did not use an isolated account runtime\n' >&2; exit 1 ;;
esac
test ! -e "$(<"$tmp_dir/profile-agent-dir.txt")"
test "$(<"$tmp_dir/profile-account.txt")" = "$codex_profile_name"
node - "$tmp_dir/profile-config.json" "$tmp_dir/profile-real-agent-dir.txt" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const runtimeDir = fs.readFileSync(process.argv[3], "utf8").trim();
assert.equal(config.permission.path[path.join(runtimeDir, "auth.json")], "deny");
assert.equal(config.permission.path[path.join(runtimeDir, "codex-runtimes", "*", "auth.json")], "deny");
NODE
node - "$profile_agent_dir/auth-profiles/$codex_profile_name/auth.json" "$tmp_dir/profile-auth-target.txt" "$tmp_dir/codex-profile/auth.json" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
for (const path of process.argv.slice(2, 4)) {
  const auth = JSON.parse(fs.readFileSync(path, "utf8"));
  assert.equal(auth["openai-codex"].access.includes("."), true);
  assert.equal(auth["openai-codex"].refresh, "verify-refresh");
  assert.equal(auth["openai-codex"].accountId, "verify-account");
  assert.equal(auth["github-copilot"], undefined);
  assert.deepEqual(auth.anthropic, { type: "api_key", key: "keep" });
}
const codex = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
assert.equal(codex.tokens.access_token, undefined);
assert.equal(codex.tokens.refresh_token, undefined);
NODE
printf '{"profile":"%s"}\n' "$codex_profile_name" > "$profile_agent_dir/active-codex-account.json"
PATH="$tmp_dir/fake-bin:$PATH" CODEX_HOME="$tmp_dir/orca-codex-home" AGENT_TOOLKIT_PI_AGENT_DIR="$profile_agent_dir" PI_CODING_AGENT_DIR="$profile_agent_dir" PI_YOLO_CAPTURE="$tmp_dir/default-profile-config.json" PI_YOLO_SOURCE_CAPTURE="$tmp_dir/default-profile-source.txt" PI_YOLO_WEB_CONFIG_CAPTURE="$tmp_dir/default-profile-web-config.txt" PI_YOLO_AUTH_CAPTURE="$tmp_dir/default-profile-auth.txt" PI_YOLO_AGENT_DIR_CAPTURE="$tmp_dir/default-profile-agent-dir.txt" PI_YOLO_ACCOUNT_CAPTURE="$tmp_dir/default-profile-account.txt" "$tmp_dir/pi-yolo"
test "$(<"$tmp_dir/default-profile-account.txt")" = "$codex_profile_name"
node - "$tmp_dir/default-profile-auth.txt" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const auth = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(auth["openai-codex"].accountId, "verify-account");
NODE
node - "$tmp_dir/pi-yolo-config.json" "$pi_agent_dir" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(config.yoloMode, true);
assert.equal(config.permission.external_directory["*"], "deny");
assert.equal(config.permission.external_directory[path.join(process.env.HOME, "Code", "*")], "allow");
assert.equal(config.permission.path["*.env"], "deny");
assert.equal(config.permission.path["~/.pi/agent/auth-profiles"], "deny");
assert.equal(config.permission.path["~/.pi/agent/auth-profiles/*"], "deny");
assert.equal(config.permission.path["~/.pi/agent/codex-fast.json"], "deny");
assert.equal(config.permission.bash["bash *"], "deny");
assert.equal(config.permission.bash["*/git *"], "deny");
const managedAgentDir = fs.realpathSync(process.argv[3]);
assert.ok(config.piInfrastructureReadPaths.includes(path.join(managedAgentDir, "git")));
assert.ok(config.piInfrastructureReadPaths.includes(path.join(managedAgentDir, "npm/node_modules")));
const temporaryDir = fs.realpathSync(require("node:os").tmpdir());
assert.ok(config.piInfrastructureReadPaths.includes(path.join(temporaryDir, "orca-paste-*")));
assert.ok(config.piInfrastructureReadPaths.includes(path.join(temporaryDir, "pi-clipboard-*")));
assert.ok(config.piInfrastructureReadPaths.includes(path.join(temporaryDir, "codex-clipboard-*")));
assert.ok(!config.piInfrastructureReadPaths.includes(temporaryDir));
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
cmp "$repo_dir/pi/skills/fastapi/SKILL.md" "$HOME/.codex/skills/fastapi/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$HOME/.codex/skills/fastify/SKILL.md"
cmp "$repo_dir/pi/skills/python/SKILL.md" "$HOME/.codex/skills/python/SKILL.md"
cmp "$repo_dir/pi/extensions/simple-english/SKILL.md" "$HOME/.codex/skills/simple-english/SKILL.md"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$HOME/.codex/skills/vue/SKILL.md"
cmp "$repo_dir/pi/skills/fastapi/SKILL.md" "$HOME/.claude/skills/fastapi/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$HOME/.claude/skills/fastify/SKILL.md"
cmp "$repo_dir/pi/skills/python/SKILL.md" "$HOME/.claude/skills/python/SKILL.md"
cmp "$repo_dir/pi/extensions/simple-english/SKILL.md" "$HOME/.claude/skills/simple-english/SKILL.md"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$HOME/.claude/skills/vue/SKILL.md"
cmp "$repo_dir/codex/skills/autoreview/SKILL.md" "$pi_agent_dir/skills/autoreview/SKILL.md"
cmp "$repo_dir/codex/skills/handoff/SKILL.md" "$pi_agent_dir/skills/handoff/SKILL.md"
cmp "$repo_dir/pi/AGENTS.md" "$pi_agent_dir/AGENTS.md"
cmp "$repo_dir/pi/extensions/ask-user-question/index.ts" "$pi_agent_dir/extensions/ask-user-question/index.ts"
cmp "$repo_dir/pi/extensions/codex-account/index.ts" "$pi_agent_dir/extensions/codex-account/index.ts"
cmp "$repo_dir/pi/extensions/codex-fast/index.ts" "$pi_agent_dir/extensions/codex-fast/index.ts"
cmp "$repo_dir/pi/extensions/codex-fast/fast-core.ts" "$pi_agent_dir/extensions/codex-fast/fast-core.ts"
cmp "$repo_dir/pi/extensions/status-format/index.ts" "$pi_agent_dir/integrations/status-format/index.ts"
node -e 'const settings=require(process.argv[1]); if (!settings.extensions?.includes(process.argv[2])) process.exit(1)' "$pi_agent_dir/settings.json" "$pi_agent_dir/integrations/status-format"
cmp "$repo_dir/pi/extensions/git-push/index.ts" "$pi_agent_dir/extensions/git-push/index.ts"
cmp "$repo_dir/pi/skills/deepsec/SKILL.md" "$pi_agent_dir/skills/deepsec/SKILL.md"
cmp "$repo_dir/pi/skills/react-doctor/SKILL.md" "$pi_agent_dir/skills/react-doctor/SKILL.md"
cmp "$repo_dir/pi/skills/fastapi/SKILL.md" "$pi_agent_dir/skills/fastapi/SKILL.md"
cmp "$repo_dir/pi/skills/fastify/SKILL.md" "$pi_agent_dir/skills/fastify/SKILL.md"
cmp "$repo_dir/pi/skills/python/SKILL.md" "$pi_agent_dir/skills/python/SKILL.md"
test ! -e "$pi_agent_dir/skills/simple-english" && test ! -L "$pi_agent_dir/skills/simple-english"
cmp "$repo_dir/pi/skills/vue/SKILL.md" "$pi_agent_dir/skills/vue/SKILL.md"
cmp "$repo_dir/shared/ponytail/config.json" "$config_root/ponytail/config.json"
cmp "$repo_dir/pi/extensions/orca-permission-bell/index.ts" "$pi_agent_dir/extensions/orca-permission-bell/index.ts"
cmp "$repo_dir/pi/extensions/project-blueprint/index.ts" "$pi_agent_dir/extensions/project-blueprint/index.ts"
cmp "$repo_dir/pi/extensions/project-blueprint/project-blueprint-core.ts" "$pi_agent_dir/extensions/project-blueprint/project-blueprint-core.ts"
test -f "$repo_dir/vendor/agent-project-blueprint/distribution/bootstrap-questionnaire.json"
cmp "$repo_dir/pi/extensions/review-mode/index.ts" "$pi_agent_dir/extensions/review-mode/index.ts"
cmp "$repo_dir/pi/extensions/simple-english/index.ts" "$pi_agent_dir/extensions/simple-english/index.ts"
cmp "$repo_dir/pi/extensions/side-question/index.ts" "$pi_agent_dir/extensions/side-question/index.ts"
cmp "$repo_dir/pi/extensions/side-question/side-core.ts" "$pi_agent_dir/extensions/side-question/side-core.ts"
cmp "$repo_dir/pi/extensions/skills-update/index.ts" "$pi_agent_dir/extensions/skills-update/index.ts"
cmp "$repo_dir/pi/extensions/task-graph/index.ts" "$pi_agent_dir/extensions/task-graph/index.ts"
cmp "$repo_dir/pi/extensions/task-graph/task-graph-core.ts" "$pi_agent_dir/extensions/task-graph/task-graph-core.ts"
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
    process.exit(settings.sandbox?.enabled === true && settings.sandbox?.failIfUnavailable === true && !deny.includes("Bash(dangerouslyDisableSandbox:true)") && deny.includes("Bash(rm *)") && deny.includes("Bash(git reset --hard)") && roots.some((root) => root.endsWith("/Code")) ? 0 : 1);
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
  pi list --no-approve | grep -F "npm:@ff-labs/pi-fff@0.10.3" >/dev/null
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

"$repo_dir/pi/skills/deepsec/scripts/deepsec" --help >/dev/null
"$repo_dir/pi/skills/deepsec/scripts/deepsec" plan | grep -q 'no Vercel account'
if "$repo_dir/pi/skills/deepsec/scripts/deepsec" init --max-cost-usd 1 --max-duration 1m >/dev/null 2>&1; then
  printf 'DeepSec wrapper allowed AI setup without explicit confirmation\n' >&2
  exit 1
fi
if DEEPSEC_ALLOW_AI=1 DEEPSEC_ALLOW_VERCEL=1 "$repo_dir/pi/skills/deepsec/scripts/deepsec" init --max-cost-usd 1 >/dev/null 2>&1; then
  printf 'DeepSec wrapper allowed uncapped AI setup\n' >&2
  exit 1
fi
if DEEPSEC_ALLOW_AI=1 "$repo_dir/pi/skills/deepsec/scripts/deepsec" triage >/dev/null 2>&1; then
  printf 'DeepSec wrapper allowed triage without Claude approval\n' >&2
  exit 1
fi
if DEEPSEC_ALLOW_AI=1 "$repo_dir/pi/skills/deepsec/scripts/deepsec" sandbox process >/dev/null 2>&1; then
  printf 'DeepSec wrapper allowed sandbox use without Vercel approval\n' >&2
  exit 1
fi
grep -q -- 'npx --yes deepsec@2.3.5' "$repo_dir/pi/skills/deepsec/scripts/deepsec"
"$repo_dir/pi/skills/react-doctor/scripts/react-doctor" --help >/dev/null
node --experimental-strip-types --test "$repo_dir/pi/extensions/ask-user-question/tests/ask-user-question.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-account/tests/codex-account.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-fast/tests/codex-fast.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/codex-goal/tests/goal-core.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/status-format/tests/status-format.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/git-push/tests/git-push.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/orca-permission-bell/tests/orca-permission-bell.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/project-blueprint/tests/project-blueprint.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/review-mode/tests/review-mode.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/simple-english/tests/simple-english.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/side-question/tests/side-question.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/skills-update/tests/skills-update.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/task-graph/tests/task-graph.test.ts"
node --experimental-strip-types --test "$repo_dir/pi/extensions/web-access-gate/tests/web-access-core.test.ts"
npm --prefix "$repo_dir/pi/extensions/figma-mcp" test
test -f "$repo_dir/pi/extensions/figma-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/ask-user-question/index.ts" --list-models >"$tmp_dir/question-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/codex-goal/index.ts" --list-models >"$tmp_dir/goal-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/side-question/index.ts" --list-models >"$tmp_dir/side-models.txt"
pi --offline --no-session --no-extensions --extension "$repo_dir/pi/extensions/figma-mcp/index.ts" --list-models >"$tmp_dir/figma-models.txt"
printf '%s\n' '{"id":"commands","type":"get_commands"}' \
  | pi --offline --mode rpc --no-session >"$tmp_dir/rpc.jsonl" 2>"$tmp_dir/rpc.err"
grep -q '"name":"goal"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"figma"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"fff-health"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"push"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"ponytail"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"account"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"fast"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"reviews"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"simple-english"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skills-update"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"graph"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"web"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:autoreview"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:handoff"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:deepsec"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:react-doctor"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:fastapi"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:fastify"' "$tmp_dir/rpc.jsonl"
grep -q '"name":"skill:python"' "$tmp_dir/rpc.jsonl"
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
