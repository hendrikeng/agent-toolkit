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

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tmp.')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const commands = {}
  for (const name of ['agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']) {
    commands[name] = path.join(root, name)
    fs.symlinkSync(path.join(__dirname, 'agent-awake'), commands[name])
  }
  const env = { ...process.env, AGENT_AWAKE_TEST_ROOT: root, XDG_STATE_HOME: root }
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
  assert.equal(f.calls().at(-1), `bootout ${domain}/${label}`)
  assert.match(f.run('agent-sleep'), /already stopped/)
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
