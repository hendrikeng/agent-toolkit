'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn, spawnSync } = require('node:child_process')

const label = 'com.agent-toolkit.awake'
const domain = `gui/${process.getuid()}`
// The Claude sandbox blocks the setuid /bin/ps, which the migration needs.
const ps = process.platform === 'darwin' && spawnSync('/bin/ps', ['-p', String(process.pid)]).status === 0

// A fake launchctl: it records each call and keeps the loaded state in a file.
// The file bootout-fails makes bootout fail and leaves the job loaded. With print-fails, print fails
// with an unrelated error. The file bootout-breaks-print makes bootout create print-fails.
// A missing service exits 113, as on macOS 27.
const fakeLaunchctl = `#!/bin/bash
root=\${0%/*}
printf '%s\\n' "$*" >> "$root/launchctl.log"
case $1 in
  print) [[ ! -e $root/print-fails ]] || exit 5; [[ -e $root/loaded ]] || exit 113 ;;
  bootstrap) : > "$root/loaded" ;;
  bootout) [[ ! -e $root/bootout-breaks-print ]] || : > "$root/print-fails"
    [[ ! -e $root/bootout-fails && -e $root/loaded ]] && rm "$root/loaded" ;;
esac
`
const constants = 'agents_dir=$HOME/Library/LaunchAgents\nlaunchctl=/bin/launchctl\n'

// Runs a copy of the script whose two fixed paths point into the test directory.
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tmp.')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = fs.readFileSync(path.join(__dirname, 'agent-awake'), 'utf8')
  assert.ok(source.includes(constants), 'the LaunchAgents directory and launchctl are fixed constants')
  const copy = path.join(root, 'agent-awake.sh')
  fs.writeFileSync(copy, source.replace(constants, `agents_dir=${root}/LaunchAgents\nlaunchctl=${root}/launchctl\n`), { mode: 0o755 })
  fs.writeFileSync(path.join(root, 'launchctl'), fakeLaunchctl, { mode: 0o755 })
  const commands = {}
  for (const name of ['agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']) {
    commands[name] = path.join(root, name)
    fs.symlinkSync(copy, commands[name])
  }
  const env = { ...process.env, XDG_STATE_HOME: root }
  const run = name => execFileSync(commands[name], { env, encoding: 'utf8' })
  const calls = () => { try { return fs.readFileSync(path.join(root, 'launchctl.log'), 'utf8').trimEnd().split('\n') } catch { return [] } }
  return { root, run, calls, env, commands, plist: path.join(root, 'LaunchAgents', `${label}.plist`), pidFile: path.join(root, 'agent-toolkit/caffeinate.pid') }
}

test('agent-awake installs a KeepAlive caffeinate LaunchAgent and agent-sleep removes it', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  assert.match(f.run('agent-awake'), /Keeping the Mac awake/)
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', f.plist], { encoding: 'utf8' }))
  assert.deepEqual(plist, { Label: label, ProgramArguments: ['/usr/bin/caffeinate', '-i'], RunAtLoad: true, KeepAlive: true })
  assert.equal(fs.statSync(f.plist).mode & 0o777, 0o644)
  assert.deepEqual(f.calls(), [`print ${domain}/${label}`, `enable ${domain}/${label}`, `bootstrap ${domain} ${f.plist}`])

  assert.match(f.run('paseo-awake'), /Already keeping/)
  assert.equal(f.calls().length, 4, 'a loaded agent is not bootstrapped again')

  assert.match(f.run('paseo-sleep'), /Stopped keep-awake/)
  assert.equal(fs.existsSync(f.plist), false)
  assert.deepEqual(f.calls().slice(-3), [`print ${domain}/${label}`, `bootout ${domain}/${label}`, `print ${domain}/${label}`])
  assert.match(f.run('agent-sleep'), /already stopped/)
})

test('agent-sleep keeps the plist and fails when the job stays loaded', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  f.run('agent-awake')
  fs.writeFileSync(path.join(f.root, 'bootout-fails'), '')
  const result = spawnSync(f.commands['agent-sleep'], { env: f.env, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Could not unload/)
  assert.doesNotMatch(result.stdout, /normal sleep is allowed/)
  assert.ok(fs.existsSync(f.plist))
})

test('an unknown launchctl state keeps the plist and fails instead of reporting off', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const run = (name, args = []) => spawnSync(f.commands[name], args, { env: f.env, encoding: 'utf8' })
  const unknown = /Could not check com\.agent-toolkit\.awake; keep-awake may still be on\./
  const status = (code, pattern) => {
    const result = run('agent-awake', ['--status'])
    assert.equal(result.status, code)
    assert.match(result.stdout, pattern)
  }
  status(0, /is not loaded/)
  f.run('agent-awake')
  status(0, /is loaded/)
  fs.writeFileSync(path.join(f.root, 'print-fails'), '')
  status(1, /state is unknown/)
  for (const name of ['agent-sleep', 'agent-awake']) {
    const result = run(name)
    assert.equal(result.status, 1, name)
    assert.match(result.stderr, unknown, name)
  }
  assert.ok(!f.calls().some(call => call.startsWith('bootout')), 'no bootout without a known state')
  assert.ok(fs.existsSync(f.plist))

  // The check after bootout follows the same rule.
  fs.rmSync(path.join(f.root, 'print-fails'))
  fs.writeFileSync(path.join(f.root, 'bootout-breaks-print'), '')
  const result = run('agent-sleep')
  assert.equal(result.status, 1)
  assert.match(result.stderr, unknown)
  assert.doesNotMatch(result.stdout, /normal sleep is allowed/)
  assert.ok(fs.existsSync(f.plist))
})

test('the installed script ignores the old AGENT_AWAKE_TEST_ROOT variable', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const result = spawnSync(path.join(__dirname, 'agent-awake'), ['--status'], { env: { ...f.env, AGENT_AWAKE_TEST_ROOT: f.root }, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.deepEqual(f.calls(), [], 'the fake launchctl in the variable root is not used')
})

test('agent-awake refuses a symlinked plist path', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const target = path.join(f.root, 'target')
  fs.mkdirSync(path.dirname(f.plist))
  fs.symlinkSync(target, f.plist)
  const result = spawnSync(f.commands['agent-awake'], { env: f.env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Refusing a symlink plist/)
  assert.equal(fs.existsSync(target), false)
  assert.ok(!f.calls().some(call => call.startsWith('bootstrap')))
})

test('the first run stops only the tracked caffeinate of earlier versions', { skip: !ps && 'needs /bin/ps, which the Claude sandbox blocks' }, async t => {
  const f = fixture(t)
  const old = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' })
  const other = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' })
  t.after(() => { old.kill(); other.kill() })
  await new Promise(resolve => setTimeout(resolve, 200))
  const started = execFileSync('/bin/ps', ['-p', String(old.pid), '-o', 'lstart='], { encoding: 'utf8' }).replace(/\n$/, '')
  fs.mkdirSync(path.dirname(f.pidFile))
  fs.writeFileSync(f.pidFile, `${old.pid}\n${started}\n`)
  const exited = new Promise(resolve => old.on('exit', resolve))

  assert.match(f.run('agent-awake'), /Keeping the Mac awake/)
  await exited
  assert.equal(fs.existsSync(f.pidFile), false)
  process.kill(other.pid, 0)

  // A reused PID with a different start time is not stopped.
  fs.writeFileSync(f.pidFile, `${other.pid}\nwrong start time\n`)
  f.run('agent-sleep')
  process.kill(other.pid, 0)
  assert.equal(fs.existsSync(f.pidFile), false)
})
