#!/usr/bin/env bash
# Checks whether ordinary agent work runs inside the Claude Code sandbox.
# Run it in a sandboxed Claude session, with the repository under test as the working directory:
#   bash <toolkit>/shared/sandbox-probe.sh [item ...]
# Each item prints PASS, FAIL with the last error line, or SKIP. The script changes no repository files.
# It creates only its own mktemp directory and stops its own pg-test fixture.
# Excluded commands run outside the sandbox only when a whole tool call matches, so this script cannot test them.
set -u
[[ ${TMPDIR:-} ]] || { echo 'TMPDIR is not set' >&2; exit 2; }
work=$(mktemp -d "$TMPDIR/sandbox-probe.XXXXXX") || exit 2
pg_id=
cleanup() {
  if [[ $pg_id ]]; then pg-test stop "$pg_id" >/dev/null 2>&1; fi
  rm -rf -- "${work:?}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
failures=0

# limit SECONDS COMMAND...: run the command in its own process group and stop the whole group at the time limit.
limit() {
  perl -e '$t = shift; $pid = fork // die "fork: $!"; if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127 }
    setpgrp($pid, $pid); $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 2; kill "KILL", -$pid; print STDERR "timed out after $t s\n"; exit 124 };
    alarm $t; waitpid($pid, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$@"
}

# probe NAME SECONDS COMMAND...: run the command with a time limit and report the result.
probe() {
  local name=$1 seconds=$2 output
  shift 2
  if output=$(limit "$seconds" "$@" 2>&1); then
    printf 'PASS %-22s %s\n' "$name" "$(printf '%s' "$output" | tail -n 1 | cut -c1-100)"
  else
    failures=$((failures + 1))
    printf 'FAIL %-22s %s\n' "$name" "$(printf '%s' "$output" | grep -v '^\s*$' | tail -n 1 | cut -c1-160)"
  fi
}
skip() { printf 'SKIP %-22s %s\n' "$1" "$2"; }
has() { command -v "$1" >/dev/null; }

item_tmpdir() { probe tmpdir 10 bash -c 'd=$(mktemp -d "${TMPDIR:?}/p.XXXXXX") && rmdir -- "${d:?}" && echo "$TMPDIR"'; }
# macOS mktemp ignores TMPDIR without a template; agents must pass "$TMPDIR/name.XXXXXX".
item_mktemp_default() { probe mktemp-default 10 bash -c 'd=$(mktemp -d) && rmdir -- "${d:?}"'; }
item_git_local() {
  probe git-local 30 bash -c 'cd "$1" && git init -q r && cd r && git -c user.name=p -c user.email=p@example.test commit -q --allow-empty -m p && git worktree add -q ../w && git worktree remove ../w && echo ok' _ "$work"
}
item_git_cwd() {
  if ! git rev-parse --git-dir >/dev/null 2>&1; then skip git-cwd 'working directory is not a Git repository'; return; fi
  # Creates and deletes a ref named after this probe's own directory, as a commit in a linked worktree writes the shared Git directory.
  probe git-cwd 20 bash -c 'ref=refs/sandbox-probe/$1 && head=$(git rev-parse HEAD) && git update-ref "$ref" "$head" "" && git update-ref -d "$ref" "$head" && git rev-parse --git-common-dir' _ "${work##*.}"
}
# Orchestrators write in the worktrees of their workers. Each check creates and removes its own file.
item_shared_writes() {
  local dir
  for dir in ${PROBE_WRITE_DIRS:-$HOME/Code/paseo-worktrees $HOME/Code/tracn $HOME/Code/wewereyoung}; do
    [[ -d $dir ]] || { skip "write:${dir##*/}" "missing $dir"; continue; }
    probe "write:${dir##*/}" 10 bash -c 'f=$(mktemp "$1/.sandbox-probe.XXXXXX") && rm -f -- "${f:?}" && echo ok' _ "$dir"
  done
}
# A commit in another checkout writes that checkout's Git directory.
item_other_git() {
  local repo=${PROBE_OTHER_REPO:-$HOME/Code/tracn/tracn-api}
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { skip other-git "no Git repository at $repo"; return; }
  probe other-git 20 bash -c 'ref=refs/sandbox-probe/$2 && head=$(git -C "$1" rev-parse HEAD) && git -C "$1" update-ref "$ref" "$head" "" && git -C "$1" update-ref -d "$ref" "$head" && echo ok' _ "$repo" "${work##*.}"
}
item_git_https() { probe git-https 30 git ls-remote https://github.com/octocat/Hello-World.git HEAD; }
item_git_ssh() { probe git-ssh 30 git ls-remote git@github.com:octocat/Hello-World.git HEAD; }
item_gh() { has gh && probe gh 30 gh api rate_limit --jq .resources.core.limit || skip gh 'not installed'; }
item_npm() { has npm && probe npm 60 npm view left-pad version --prefer-online || skip npm 'not installed'; }
item_pnpm() {
  has pnpm || { skip pnpm 'not installed'; return; }
  probe pnpm 120 bash -c 'mkdir "$1/pnpm" && cd "$1/pnpm" && echo "{\"name\":\"p\",\"private\":true}" > package.json && pnpm add --silent is-number@7.0.0 && pnpm store path' _ "$work"
}
item_uv() {
  has uv || { skip uv 'not installed'; return; }
  probe uv 120 bash -c 'cd "$1" && uv venv -q uv-venv && uv pip install -q --python uv-venv six && echo ok' _ "$work"
}
item_pip() { probe pip 120 bash -c 'cd "$1" && python3 -m venv pip-venv && pip-venv/bin/pip install -q six && echo ok' _ "$work"; }
item_localhost() {
  probe localhost 20 node -e 'const s=require("http").createServer((q,r)=>r.end("ok")).listen(0,"127.0.0.1",()=>require("http").get("http://127.0.0.1:"+s.address().port,r=>{r.on("data",d=>{console.log(String(d));s.close()})}))'
}
item_lsof() { probe lsof 20 bash -c 'out=$(lsof -nP -iTCP -sTCP:LISTEN) && printf "%s\n" "$out" | head -n 2'; }
item_pg_test() {
  has pg-test || { skip pg-test 'not installed'; return; }
  local started url
  if ! started=$(limit 120 pg-test start 2>&1); then
    failures=$((failures + 1)); printf 'FAIL %-22s %s\n' pg-test "$(printf '%s' "$started" | tail -n 1 | cut -c1-160)"; return
  fi
  # Register the owned fixture for cleanup before any other step.
  pg_id=$(printf '%s' "$started" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).id)')
  url=$(printf '%s' "$started" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).database_url ?? "")')
  if has psql && [[ $url ]]; then probe pg-test-psql 20 psql "$url" -Atc 'select 1'; fi
  local before=$failures
  probe pg-test 60 pg-test stop "$pg_id"
  # Keep the cleanup registration when the stop fails.
  if (( failures == before )); then pg_id=; fi
}
item_docker() { has docker && probe docker 20 docker info --format '{{.ServerVersion}}' || skip docker 'not installed'; }
item_playwright() {
  local dir=${PROBE_PLAYWRIGHT_DIR:-$HOME/Code/tracn/tracn-web}
  [[ -d $dir/node_modules/@playwright/test ]] || { skip playwright "no @playwright/test in $dir"; return; }
  probe playwright 90 node -e 'const {chromium}=require(require.resolve("@playwright/test",{paths:[process.argv[1]]}));(async()=>{const b=await chromium.launch({args:process.env.CLAUDECODE?["--single-process"]:[]});const p=await b.newPage();await p.setContent("<h1>ok</h1>");console.log(await p.textContent("h1"));await b.close()})().catch(e=>{console.error(e.message.split("\n")[0]);process.exit(1)})' "$dir"
}
item_codex() { has codex && probe codex 30 codex login status || skip codex 'not installed'; }
item_claude() { has claude && probe claude 30 claude --version || skip claude 'not installed'; }
item_autoreview() {
  local helper=${PROBE_AUTOREVIEW:-}
  [[ $helper ]] || { skip autoreview 'set PROBE_AUTOREVIEW=<helper path> to run a real one-commit review'; return; }
  for engine in codex claude; do
    probe "autoreview-$engine" 900 "$helper" --engine "$engine" --mode commit --commit HEAD --output "$work/review-$engine.md"
  done
}
item_paseo() { has paseo && probe paseo 30 paseo ls --json || skip paseo 'not installed'; }
item_infisical() { has infisical && probe infisical 30 infisical --version || skip infisical 'not installed'; }
item_railway() { has railway && probe railway 30 railway whoami || skip railway 'not installed'; }
# GitHub exits with status 1 after a successful SSH login, so check the greeting.
item_ssh() { probe ssh 20 bash -c 'ssh -o BatchMode=yes -o ConnectTimeout=10 -T git@github.com 2>&1 | grep "successfully authenticated"'; }
item_repo_check() {
  [[ ${PROBE_REPO_CHECK:-} ]] || { skip repo-check 'set PROBE_REPO_CHECK to the repository check, for example "pnpm run verify:fast"'; return; }
  probe repo-check 1800 bash -c "$PROBE_REPO_CHECK"
}
# One HTTPS request per host. Any HTTP status means that the sandbox proxy allowed the host.
item_hosts() {
  local host
  for host in ${PROBE_HOSTS:-github.com api.github.com codeload.github.com objects.githubusercontent.com raw.githubusercontent.com \
    registry.npmjs.org pypi.org files.pythonhosted.org app.infisical.com backboard.railway.com console.neon.tech \
    console.neo4j.io api.redislabs.com api.stripe.com api.ubicloud.com api.anthropic.com api.openai.com chatgpt.com \
    auth.openai.com api.cloudflare.com api.tracn.com staging.tracn.com}; do
    probe "host:$host" 20 curl -sS -o /dev/null -w '%{http_code}' "https://$host/"
  done
}

items=("$@")
[[ ${#items[@]} -gt 0 ]] || items=(tmpdir mktemp_default git_local git_cwd shared_writes other_git git_https git_ssh gh npm pnpm uv pip localhost lsof pg_test docker playwright codex claude autoreview paseo infisical railway ssh repo_check hosts)
for item in "${items[@]}"; do "item_${item//-/_}"; done
printf '%s failure(s)\n' "$failures"
(( failures == 0 ))
