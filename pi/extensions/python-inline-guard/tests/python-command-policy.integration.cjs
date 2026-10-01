const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const { homedir, tmpdir } = require('node:os')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

test('Python script tests pass the real policy while inline interpreter code stays blocked', async () => {
 const sourceAgent = process.env.AGENT_TOOLKIT_PI_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent')
 const packages = createRequire(join(sourceAgent, 'npm/package.json'))
 const permissionRoot = join(packages.resolve('@gotgenes/pi-permission-system'), '../..')
 // Use the same TypeScript loader as Pi to exercise the pinned stock matcher, not a copy of it.
 const globalModules = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
 const piRequire = createRequire(join(globalModules, '@earendil-works/pi-coding-agent/package.json'))
 const { createJiti } = piRequire('jiti')
 const jiti = createJiti(__filename)
 const { compileWildcardPatternEntries, findCompiledWildcardMatch } = await jiti.import(join(permissionRoot, 'src/policy/wildcard-matcher.ts'))
 const config = JSON.parse(fs.readFileSync(join(__dirname, '../../../../shared/agent-safety/pi-permission-system.json'), 'utf8'))
 config.shellTools = { exec_command: { commandArgument: 'cmd' } }
 const policy = compileWildcardPatternEntries(Object.entries(config.permission.bash))
 const runtime = fs.mkdtempSync(join(tmpdir(), 'python-policy-'))
 fs.mkdirSync(join(runtime, 'extensions/pi-permission-system'), { recursive: true })
 fs.writeFileSync(join(runtime, 'extensions/pi-permission-system/config.json'), JSON.stringify(config))
 const previous = { source: process.env.AGENT_TOOLKIT_PI_AGENT_DIR, runtime: process.env.PI_CODING_AGENT_DIR }
 process.env.AGENT_TOOLKIT_PI_AGENT_DIR = sourceAgent
 process.env.PI_CODING_AGENT_DIR = runtime
 try {
  const { default: guard } = await import('../index.ts')
  let handle
  guard({ on(event, handler) { if (event === 'tool_call') handle = handler } })
  assert.equal(typeof handle, 'function')
  const exact = '.venv/bin/python -B -S tools/offline_pytest.py tools/tests/test_identity_delta_scale.py tools/tests/test_product_research_evidence_preparation.py -q'
  for (const command of [
   exact,
   '.venv/bin/python -BS tools/offline_pytest.py tools/tests/test_identity_delta_scale.py -q',
   '.venv/bin/python3.12 -S tools/offline_pytest.py -q',
   'python3 -W ignore::UserWarning -X dev tools/check.py -c literal-script-argument',
   'python3 -m pytest tools/tests/test_identity_delta_scale.py -c pytest.ini',
   'python3 -- tools/check.py -c script-argument',
   "python3 -W 'ignore::UserWarning' tools/check.py",
   "echo 'python3 -c pass'",
   "python3 '-' <<'PY'\n# python3 -c pass\nPY",
   'python3 script.py > out.txt -c script-argument',
   'python3 script.py 0<&-',
   'python3 -m pytest > out.txt -c pytest.ini',
   'python3 script.py <<< text -c script-argument',
   'python3 script.py <<EOF -c script-argument\nEOF',
   "python3 '-' <<EOF -c script-argument\nEOF",
   "cat <<'EOF'\n${UNSET_VAR:-$(python3 -c pass)}\nEOF",
   'python3 "\\-c" pass',
   'python3 "' + '\\\\' + '\n' + '-c" pass',
   "python3 '" + '\\' + '\n' + "-c' pass",
   'python3 "{-B,-S}" -c script-argument',
   "python3 '*.py' -c script-argument",
   'python3 script.py *.py -c script-argument',
  ]) {
   assert.equal(findCompiledWildcardMatch(policy, command)?.state, 'allow', command)
   assert.equal(await handle({ toolName: 'bash', input: { command } }), undefined, command)
  }
  for (const command of [
   'python -c pass',
   'python3 -cpass',
   '.venv/bin/python -B -S -c pass',
   '.venv/bin/python -BScpass',
   '.venv/bin/python3.12 -BSc pass',
   '.venv/bin/python3.13t -BScpass',
   "'.venv/bin/python' '-BSc' pass",
   'python3 -X dev -W ignore -Sc pass',
   "X=1 python3 -c pass",
   'echo ok && python3 -BScpass',
   'echo $(python3 -BScpass)',
   'cat <<EOF\n$(python3 -BScpass)\nEOF',
   'python3 "$FLAGS" tools/check.py',
   'python3 > out.txt -c pass',
   '> out.txt python3 -c pass',
   'python3 -B 2>&1 -cpass',
   'python3 -W > out.txt ignore -c pass',
   'echo ok | python3 > out.txt -c pass',
   'cat <<EOF\n${UNSET_VAR:-$(python3 -c pass)}\nEOF',
   'python3 -W $FLAGS tools/check.py',
   'python3 -X $FLAGS tools/check.py',
   'python3 --check-hash-based-pycs $FLAGS tools/check.py',
   'python3 <<EOF -cpass\nEOF',
   'python3 <<EOF >out.txt -cpass\nEOF',
   'python3 0<&- -cpass',
   'python3 script.py 0<&- -c script-argument',
   '0<&- python3 -cpass',
   'python3 <<< text -cpass',
   'python3 "' + '\\' + '\n' + '-c" pass',
   'python3 -' + '\\' + '\n' + 'cpass',
   '"py' + '\\' + '\n' + 'thon3" -c pass',
   'python3 {-B,-S} -cpass',
   'python3 * -cpass',
   'python3 -? -cpass',
   'python3 -[BS] -cpass',
   '.venv/bin/python3.$v -cpass',
   '.venv/bin/python3.* -cpass',
   // Redirections before the program boundary cannot safely be reconstructed from this grammar.
   '> out.txt python3 script.py -c script-argument',
   'python3 > out.txt script.py -q',
   'python3 -W > out.txt ignore script.py',
   // The grammar drops an unquoted stdin marker before a heredoc; quote it to prove the boundary.
   "python3 - <<'PY'\n# python3 -c pass\nPY",
  ]) {
   const result = await handle({ toolName: 'bash', input: { command } })
   assert.equal(result?.block, true, command)
  }
  assert.equal((await handle({ toolName: 'bash', input: { command: 'python3 "unterminated' } }))?.block, true)
  assert.equal(await handle({ toolName: 'exec_command', input: { cmd: exact } }), undefined)
  assert.equal((await handle({ toolName: 'exec_command', input: { cmd: 'python3 -BScpass' } }))?.block, true)
  assert.equal(await handle({ toolName: 'read', input: { path: 'python3 -c pass' } }), undefined)
  console.log(`Retained Python policy fixture: ${runtime}`)
 } finally {
  for (const [key, value] of [['AGENT_TOOLKIT_PI_AGENT_DIR', previous.source], ['PI_CODING_AGENT_DIR', previous.runtime]]) {
   if (value === undefined) delete process.env[key]
   else process.env[key] = value
  }
 }
})
