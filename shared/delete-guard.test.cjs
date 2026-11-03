const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { evaluate } = require('./delete-guard.cjs')
const guard = path.join(__dirname, 'delete-guard.cjs')

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'delete-guard-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo'), home = path.join(root, 'home'), tmp = path.join(root, 'T')
  for (const dir of [path.join(repo, 'build'), path.join(repo, '.git'), home, tmp]) fs.mkdirSync(dir, { recursive: true })
  return { root, repo, home, tmp, env: { HOME: home, TMPDIR: tmp + '/' } }
}

test('the delete guard allows the repository interior and owned mktemp paths and refuses everything else', t => {
  const f = fixture(t)
  const owned = fs.mkdtempSync(path.join(f.tmp, 'tmp.')), other = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  fs.mkdirSync(path.join(f.tmp, 'r4ref'))
  fs.symlinkSync('/', path.join(f.repo, 'build/root-link'))
  const allowed = [
    'rm -rf build', 'rm -rf ./build dist', 'rm -f src/a.txt 2>/dev/null', 'rm -f build/*.o', 'rm -rf -- build/out',
    'd=$(mktemp -d) || exit 1; touch "$d/x"; rm -rf -- "${d:?}"',
    'd="$(mktemp -d -t probe)" || exit 1\ntrap \'rm -rf -- "${d:?}"\' EXIT\necho ok',
    'd=$(mktemp -d) && cd "${d:?}" && rm -rf node_modules', 'd=$(mktemp -d); rm -rf "${d:?}"/*',
    `rm -rf ${owned}`, `rm -rf "${owned}/sub"`, `rm -rf "$TMPDIR/${path.basename(owned)}"`,
    'out=build; rm -rf "${out:?}"', 'cd build && rm -rf out', 'find build -name "*.o" -delete', 'find build -type d -exec rm -rf {} +',
    'rmdir /', 'git rm -r src/old', 'echo "rm -rf /"', 'bash -c "rm -rf build"', 'bash --noprofile -o pipefail -c "rm -rf build"', 'command rm -f build/x', 'sudo -u me /bin/rm -rf build/x',
    'cat > notes.sh <<\'EOF\'\nrm -rf /\nEOF', 'bash <<EOF\nrm -rf build\nEOF', 'pg-test stop pg18-abc', 'ls -la',
    'git commit -m "$(cat <<\'EOF\'\nDon\'t rm the (guard\nEOF\n)" && rm -f build/x',
  ]
  const refused = [
    // Incident 1: mkdir -p on another session's existing directory, then rm -rf on it.
    ['mkdir -p "$TMPDIR/r4ref" && rm -rf "$TMPDIR/r4ref"', /outside the current repository/],
    // Incident 2: fixed names in the shared temporary directory.
    ['rm -rf "$TMPDIR/pg-test-output"', /outside/], ['rm -rf /private/tmp/shared-name', /outside/], [`rm -rf ${other}`, /outside/],
    // Incident 3: cleanup of a computed path; a failed mktemp makes this rm -rf /.
    ['L=$(mktemp -d)/file\nrm -rf "$(dirname "$L")"', /command substitution/],
    // Incident 4: shared fixture garbage collection.
    ['pg-test gc', /pg-test gc/],
    ['rm -rf /', /root/], ['rm -rf /*', /root/], ['rm -rf /etc', /top-level/], ['rm -rf /usr/local/lib', /outside/],
    ['rm -rf ~', /home/], ['rm -rf "$HOME"', /home/], ['rm -rf ~/Code', /outside/], ['rm -f ~/.zshrc', /outside/],
    ['rm -rf "$UNSET/x"', /does not set/], ['rm -rf $d/', /does not set/], ['rm -rf ""', /empty/], ['rm -rf "${d:-/}"', /expansion/],
    ['d=$(mktemp -d); rm -rf "$d"', /"\$\{d:\?\}"/], ['d=$(mktemp -d); rm -rf "/x${d:?}"', /\$\{d:\?\}/],
    ['d=$(mktemp -d); d=/; rm -rf "${d:?}"', /more than once/], ['d=$(mktemp -d); rm -rf "${d:?}/../x"', /\.\./],
    ['rm -rf .', /repository root/], ['rm -rf *', /repository root/], ['rm -rf build/..', /repository root/], ['rm -rf ../other', /outside/],
    ['rm -rf build/root-link/..', /root/], ['rm -rf .git', /Git metadata/], ['rm -rf .git/hooks', /Git metadata/],
    ['rm -rf "$(git rev-parse --show-toplevel)"', /command substitution/],
    ['find / -name x -delete', /root/], ['find . -delete', /repository root/], ['find /tmp -exec rm -rf {} +', /top-level/],
    ['ls | xargs rm -rf', /xargs/], ['sh -c \'rm -rf /\'', /root/], ['bash -lc "rm -rf $HOME"', /computed script/],
    ['cat <<\'EOF\' | bash\nrm -rf /\nEOF', /piped into bash/], ['bash <<\'EOF\'\nrm -rf /\nEOF', /root/],
    ['eval "rm -rf $x"', /eval/], ['d=$(mktemp -d); trap "rm -rf $d" EXIT', /single quotes/], ['trap "$cleanup" EXIT; rm -f build/x', /computed/], ['trap \'rm -rf /\' EXIT', /root/],
    ['sudo rm -rf /var/db', /outside/], ['\\rm -rf /', /root/], ['command rm -rf ~', /home/], ['timeout 5 rm -rf /', /root/],
    ['cd / && rm -rf usr', /top-level/], ['cd "$X" && rm -rf build', /cannot resolve/], ['for d in /; do rm -rf "${d:?}"; done', /loop/],
    ['echo $(rm -rf /)', /root/], ['rm -rf "/unterminated', /cannot parse/],
    // Shell option forms, word splitting, text after globs, one-line functions, and trap -- must not skip the check.
    ['bash --login -c \'rm -rf ~/Code\'', /outside/], ['bash --noprofile --norc -c \'rm -rf /\'', /root/],
    ['bash -s -- arg <<\'EOF\'\nrm -rf /\nEOF', /root/], ['cat <<\'EOF\' | bash -s -- x\nrm -rf /\nEOF', /piped into bash/], ['bash - <<\'EOF\'\nrm -rf /\nEOF', /root/],
    ['dirs="build $HOME/.cache/x"; rm -rf ${dirs:?}', /unquoted \$dirs/], ['out=build; rm -rf $out', /target \$out uses/], ['d=$(mktemp -d); rm -rf "${d?}"', /expansion/],
    ['rm -rf src/{gen,../../shared-cache}', /glob or brace/], ['rm -rf build/*/../..', /glob or brace/], ['d=$(mktemp -d); rm -rf "${d:?}"/{a,../tmp.OTHER}', /glob or brace/],
    ['if [ -d dist ]; then out=dist; fi; rm -rf "$out"/*', /\$\{out:\?\}/], ['HOME="$PWD/build"; rm -rf "${HOME:?}"', /shadows/],
    ['rm -rf {"$HOME",build}', /brace expansion/], ['rm -rf build/{dist,"$TMPDIR"/shared}', /brace expansion/],
    ['find build -exec sudo rm -rf / \\;', /root/], ['find build -exec sh -c \'rm -rf "$1"\' _ {} \\;', /shell script/], ['/usr/bin/time rm -rf /', /root/],
    ['cd -- "$HOME/Code/other" && rm -rf node_modules', /outside/], ['cd build && find -- /etc -delete', /top-level/],
    ['while read -r f; do echo "$f"; done < <(find /etc -name x -print -delete)', /top-level/], ['cat <<< "$(rm -rf ~/x)"', /outside/],
    ['echo ${x:-$(rm -rf /)}', /cannot parse/], ['cat <<\'EOF\' |& bash\nrm -rf /\nEOF', /piped into bash/], ['eval -- \'rm -rf /\'', /root/],
    ['time -p rm -rf /', /root/], ['rm -rf packages/*/dist', /glob or brace/], ['rm -rf build/*/', /glob or brace/],
    ['find -L build -name "*.tmp" -exec rm -f {} +', /symbolic links/], ['find build -follow -delete', /symbolic links/],
    ['out=$((cd build && rm -rf ~/Code) 2>&1)', /outside/], ['echo $(( $(rm -rf ~/x; echo 1) ))', /outside/],
    ['echo ~ | xargs find -delete', /xargs/], ['cat dirs.txt | xargs -I{} find {} -name "*.pyc" -delete', /xargs/],
    ['rm -rf (dist|.git)', /parenthesis/], ['rm -rf !(src)', /parenthesis/], ['cleanup() { rm -rf /; }', /root/],
    ['git commit -m $\'don\\\'t stop\'; rm -rf ~/Code # it\'s done', /outside/], ['echo "$(echo $\'a\\\'b\'; rm -rf ~/Code) it\'s"', /outside/],
    ['find -f /etc -delete', /top-level/], ['find -O3 /etc -delete', /top-level/], ['find -D tree /etc -delete', /top-level/],
    ['clean() { rm -rf node_modules; }; cd ../other && clean', /cannot resolve/], ['for p in a b; do rm -rf build; cd ..; done', /cannot resolve/],
    ['bash <<EOF\nrm -rf \\$HOME\nEOF', /computed script/], ['rm -rf $"$HOME"', /home/], ['rm -rf $"/etc"', /top-level/], ['cd build && rm -rf {~,x}', /tilde/],
    ['rm -rf $=dirs', /zsh/], ['rm -rf $~pattern', /zsh/],
    ['d=$(mktemp -d); rm -rf "${d:?}-old"', /sibling/], ['d=$(mktemp -d); paths="${d:?} $HOME/x"; rm -rf ${paths:?}', /unquoted \$paths/],
    ['printf "%s\\n" "rm -rf ~/Code/other" |\n  bash', /piped into bash/], ['echo "cleaned: `rm -rf \\$HOME/.cache/x`"', /backslash inside backticks/],
    ['echo `rm -rf ~/x`', /outside/], ['find build/.* -delete', /dot/],
    ['find build/{.,}* -delete', /dot/], ["rm -rf $'\\x2e\\x2e/other'", /backslash escape/],
    ['x="$(case "$m" in clean) rm -rf ~/Code;; esac)"', /case/], ['d=$(mktemp -d); rm -rf "${d:?}"*', /sibling/], ['bash 0<<EOF\nrm -rf /\nEOF', /root/],
    ['summary="$(\n  # 1) drop the stale checkout\n  rm -rf ~/Code/old-checkout\n  git log -1\n)"', /outside/],
    ['rm -rf "..\\\n/other"', /outside/],
    ['function cleanup { rm -rf "$TMPDIR/shared"; }; cleanup', /outside/], ['trap -- \'rm -rf /\' EXIT', /root/],
  ]
  const check = command => evaluate(command, { cwd: f.repo, env: f.env, owned: [owned], repo: f.repo })
  for (const command of allowed) assert.equal(check(command), null, command)
  for (const [command, reason] of refused) assert.match(check(command) ?? 'allowed', reason, command)
  assert.match(evaluate('rm -rf build', { cwd: f.home, env: f.env, repo: f.home }), /outside/, 'a home-directory repository grants no repository allowance')
})

test('the hook records only directories that its own mktemp command created and blocks with the safe pattern', t => {
  const f = fixture(t)
  assert.equal(spawnSync('git', ['init', '-q', f.repo]).status, 0)
  const other = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  const env = { ...process.env, ...f.env }
  const hook = (input, session = 'session-1') => spawnSync(process.execPath, [guard], { env, encoding: 'utf8', input: JSON.stringify({ session_id: session, cwd: f.repo, tool_name: 'Bash', ...input }) })
  const create = 'd=$(mktemp -d "$TMPDIR/tmp.XXXXXX") || exit 1; echo "$d"'
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-1', tool_input: { command: create } }).status, 0)
  const made = spawnSync('/bin/sh', ['-c', create], { env, encoding: 'utf8' }).stdout.trim()
  assert.equal(hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-1', tool_input: { command: create }, tool_response: { stdout: `${made}\n` } }).status, 0)
  // Output that lists another session's new directory as well records neither.
  const listing = 'd=$(mktemp -d "$TMPDIR/tmp.XXXXXX") || exit 1; ls -d "$TMPDIR"/*'
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-3', tool_input: { command: listing } }).status, 0)
  const mine = fs.mkdtempSync(path.join(f.tmp, 'tmp.')), theirs = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  assert.equal(hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-3', tool_input: { command: listing }, tool_response: { stdout: `${mine}\n${theirs}\n` } }).status, 0)
  for (const dir of [mine, theirs]) assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${dir}` } }).status, 2)
  // The same holds when the output shows only the other session's directory.
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-5', tool_input: { command: listing } }).status, 0)
  const own = fs.mkdtempSync(path.join(f.tmp, 'tmp.')), concurrent = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  assert.equal(hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-5', tool_input: { command: listing }, tool_response: { stdout: `${concurrent}\n` } }).status, 0)
  for (const dir of [own, concurrent]) assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${dir}` } }).status, 2)
  // A listing that names older temporary entries records nothing, even if the command's own directory is gone.
  const removed = 'd=$(mktemp -d "$TMPDIR/tmp.XXXXXX") || exit 1; trap \'rm -rf -- "${d:?}"\' EXIT; ls -d "$TMPDIR"/*'
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-6', tool_input: { command: removed } }).status, 0)
  const parallel = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  assert.equal(hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-6', tool_input: { command: removed }, tool_response: { stdout: `${other}\n${parallel}\n` } }).status, 0)
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${parallel}` } }).status, 2)
  // A command that creates no directory records none, even when another session creates one meanwhile.
  const fileOnly = 't=$(mktemp) || exit 1; ls -d "$TMPDIR"/*/'
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-4', tool_input: { command: fileOnly } }).status, 0)
  const foreign = fs.mkdtempSync(path.join(f.tmp, 'tmp.'))
  assert.equal(hook({ hook_event_name: 'PostToolUse', tool_use_id: 'call-4', tool_input: { command: fileOnly }, tool_response: { stdout: `${foreign}/\n` } }).status, 0)
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${foreign}` } }).status, 2)
  const remove = target => hook({ hook_event_name: 'PreToolUse', tool_use_id: 'call-2', tool_input: { command: `rm -rf -- ${target}` } })
  assert.equal(remove(made).status, 0)
  const refusal = remove(other)
  assert.equal(refusal.status, 2)
  assert.match(refusal.stderr, /Delete guard refused.*outside/)
  assert.ok(refusal.stderr.includes('d=$(mktemp -d) || exit 1; ...; rm -rf -- "${d:?}"'))
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${made}` } }, 'session-2').status, 2)
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: 'rm -rf build' } }).status, 0)
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: ['bash', '-lc', 'rm -rf .', 'arg0'] } }).status, 2)
  assert.equal(spawnSync(process.execPath, [guard], { env, input: 'not json rm -rf /' }).status, 2)
  // Ownership records are re-validated, and state in a directory that others can write is refused.
  const stateDir = path.join(f.tmp, 'agent-toolkit-delete-guard')
  fs.appendFileSync(path.join(stateDir, 'session-1.jsonl'), JSON.stringify({ own: f.home }) + '\n')
  assert.equal(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: `rm -rf ${f.home}/x` } }).status, 2)
  fs.chmodSync(stateDir, 0o777)
  assert.match(hook({ hook_event_name: 'PreToolUse', tool_use_id: 'x', tool_input: { command: 'rm -rf build' } }).stderr, /unsafe guard state/)
})
