const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const helper = path.join(__dirname, 'agent-heavy.cjs')

// The suite itself can run under agent-heavy. Do not inherit its bypass or worker settings.
const baseEnv = { ...process.env }
for (const name of ['AGENT_HEAVY', 'AGENT_HEAVY_HELD', 'AGENT_HEAVY_WORKERS']) delete baseEnv[name]

function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-heavy-test-'))
 const pids = []
 t.after(() => {
  for (const pid of pids) try { process.kill(pid, 'SIGKILL') } catch {}
  try { fs.chmodSync(dir, 0o700) } catch {} // A test can make the lock directory read-only.
  fs.rmSync(root, { recursive: true, force: true })
 })
 const dir = path.join(root, 'locks')
 const start = (command, env = {}) => {
  const child = spawn(process.execPath, [helper, '--', ...command], { env: { ...baseEnv, AGENT_HEAVY_DIR: dir, AGENT_HEAVY_SLOTS: '1', ...env } })
  pids.push(child.pid)
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.result = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })))
  return child
 }
 const run = (command, env) => start(command, env).result
 // Occupy slot 0 with a live owner (this test process) so a throttled call would wait.
 const occupy = () => {
  fs.mkdirSync(path.join(dir, 'slot-0'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'slot-0/owner.json'), JSON.stringify({ pid: process.pid, childPid: null, cwd: root, command: ['test'] }))
 }
 return { root, dir, start, run, occupy, track: pid => pids.push(pid) }
}
const node = source => [process.execPath, '-e', source]
// A shell probe: Node opens fd 3 itself. The gate must not leak its fd 3 into the command.
const printEnv = (exit = 0) => ['/bin/sh', '-c', `printf '{"held":"%s","workers":"%s","fd3":%s}' "$AGENT_HEAVY_HELD" "$AGENT_HEAVY_WORKERS" "$([ -e /dev/fd/3 ] && echo true || echo false)"; exit ${exit}`]
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid
// A slot left by a wrapper and command that are both dead.
const staleSlot = (dir, index) => {
 fs.mkdirSync(path.join(dir, `slot-${index}`), { recursive: true })
 fs.writeFileSync(path.join(dir, `slot-${index}/owner.json`), JSON.stringify({ pid: deadPid(), childPid: deadPid(), cwd: dir, command: ['dead'] }))
}
const readOwner = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'slot-0/owner.json'), 'utf8')) } catch {} }
const slots = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.startsWith('slot-')) : []
const until = async (check, ms = 10000) => {
 for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) {
  const value = check()
  if (value) return value
 }
 throw Error('Timed out waiting for condition')
}

test('passes exit codes and signals through, sets the child environment, and releases the slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const ok = await f.run(printEnv(7), { AGENT_HEAVY_SLOTS: '2' })
 assert.equal(ok.code, 7, ok.stderr)
 assert.deepEqual(JSON.parse(ok.stdout), { held: '1', workers: String(Math.max(1, Math.floor(os.availableParallelism() / 2))), fd3: false })
 const killed = await f.run(node('process.kill(process.pid, "SIGTERM")'))
 assert.equal(killed.code, 128 + os.constants.signals.SIGTERM)
 assert.deepEqual(slots(f.dir), [])
 assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700)
})

test('never runs more children than slots under concurrent acquires and reclaims', { timeout: 60000 }, async t => {
 const f = fixture(t)
 staleSlot(f.dir, 1) // Every waiter races to reclaim it.
 const active = path.join(f.root, 'active'), seen = path.join(f.root, 'seen')
 fs.mkdirSync(active); fs.mkdirSync(seen)
 const child = node(`const fs = require('node:fs'), path = require('node:path');
const me = path.join(${JSON.stringify(active)}, String(process.pid));
fs.writeFileSync(me, '');
fs.writeFileSync(path.join(${JSON.stringify(seen)}, String(process.pid)), String(fs.readdirSync(${JSON.stringify(active)}).length));
setTimeout(() => fs.rmSync(me), 400);`)
 const results = await Promise.all(Array.from({ length: 6 }, () => f.run(child, { AGENT_HEAVY_SLOTS: '2' })))
 for (const result of results) assert.equal(result.code, 0, result.stderr)
 const counts = fs.readdirSync(seen).map(name => Number(fs.readFileSync(path.join(seen, name), 'utf8')))
 assert.equal(counts.length, 6)
 assert.ok(Math.max(...counts) <= 2, `observed ${Math.max(...counts)} concurrent children`)
 assert.deepEqual(slots(f.dir), [])
})

test('keeps a slot while the orphaned child lives and reclaims it after both are SIGKILLed', { timeout: 60000 }, async t => {
 const f = fixture(t)
 const holder = f.start(node('setInterval(() => {}, 1000)'))
 const owner = await until(() => readOwner(f.dir)?.childPid && readOwner(f.dir))
 f.track(owner.childPid)
 holder.kill('SIGKILL')
 await once(holder, 'exit') // Not 'close': the orphaned child keeps the stdio pipes open.
 const waiter = f.start(node('process.exit(3)'))
 let exited = false
 waiter.result.then(() => { exited = true })
 await new Promise(resolve => setTimeout(resolve, 3000))
 assert.equal(exited, false, 'the waiter must not take a slot whose child still runs')
 process.kill(owner.childPid, 'SIGKILL')
 const result = await waiter.result
 assert.equal(result.code, 3, result.stderr)
 assert.deepEqual(slots(f.dir), [])
})

test('fails open with one warning when the lock directory cannot be created', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const readOnly = path.join(f.root, 'read-only')
 fs.mkdirSync(readOnly, { mode: 0o500 })
 const result = await f.run(node('process.exit(5)'), { AGENT_HEAVY_DIR: path.join(readOnly, 'locks') })
 assert.equal(result.code, 5)
 assert.equal(result.stderr.match(/agent-heavy: throttle unavailable/g)?.length, 1, result.stderr)
})

test('nested calls and AGENT_HEAVY=0 run without taking a slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 f.occupy()
 const nested = await f.run(printEnv(), { AGENT_HEAVY_HELD: '1', AGENT_HEAVY_WORKERS: '4' })
 assert.equal(nested.code, 0, nested.stderr)
 assert.deepEqual(JSON.parse(nested.stdout), { held: '1', workers: '4', fd3: false })
 const bypass = await f.run(printEnv(), { AGENT_HEAVY: '0' })
 assert.equal(bypass.code, 0, bypass.stderr)
 assert.deepEqual(JSON.parse(bypass.stdout), { held: '', workers: '', fd3: false })
 assert.deepEqual(slots(f.dir), ['slot-0'])
})

test('a reclaim marker left by a killed waiter does not block the slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 staleSlot(f.dir, 0)
 const stat = fs.statSync(path.join(f.dir, 'slot-0'))
 fs.mkdirSync(path.join(f.dir, `reclaim-0-${stat.ino}-${Math.round(stat.birthtimeMs)}-${deadPid()}-0000`))
 const result = await f.run(node('process.exit(4)'))
 assert.equal(result.code, 4, result.stderr)
 assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('keeps the exit code and warns when the slot cannot be released', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const result = await f.run(node(`require('node:fs').chmodSync(${JSON.stringify(f.dir)}, 0o500); process.exit(6)`))
 assert.equal(result.code, 6)
 assert.equal(result.stderr.match(/agent-heavy: could not release/g)?.length, 1, result.stderr)
})
