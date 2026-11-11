const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const helper = path.join(__dirname, 'agent-heavy.pl')

// The suite itself can run under agent-heavy. Do not inherit its bypass or worker settings.
const baseEnv = { ...process.env }
for (const name of ['AGENT_HEAVY', 'AGENT_HEAVY_HELD', 'AGENT_HEAVY_WORKERS']) delete baseEnv[name]

function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-heavy-test-'))
 const pids = []
 t.after(() => {
  for (const pid of pids) try { process.kill(pid, 'SIGKILL') } catch {}
  fs.rmSync(root, { recursive: true, force: true })
 })
 const dir = path.join(root, 'locks')
 const start = (command, env = {}, options = {}, raw = false) => {
  const child = spawn(raw ? command[0] : helper, raw ? command.slice(1) : ['--', ...command], { env: { ...baseEnv, AGENT_HEAVY_DIR: dir, AGENT_HEAVY_SLOTS: '1', ...env }, ...options })
  pids.push(child.pid)
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.result = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })))
  return child
 }
 const run = (command, env, raw) => start(command, env, {}, raw).result
 const file = name => path.join(root, name)
 // Commands write their pid to a file. The test tracks the pid, so cleanup stops the process.
 const waitForPid = async name => {
  const pid = Number(await until(() => fs.existsSync(file(name)) && fs.readFileSync(file(name), 'utf8').trim()))
  pids.push(pid)
  return pid
 }
 return { dir, start, run, file, waitForPid }
}
const node = source => [process.execPath, '-e', source]
const holdAndRecord = file => node(`require('node:fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); setInterval(() => {}, 1000)`)
const printEnv = (exit = 0) => ['/bin/sh', '-c', `printf '{"held":"%s","workers":"%s"}' "$AGENT_HEAVY_HELD" "$AGENT_HEAVY_WORKERS"; exit ${exit}`]
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (check, ms = 10000) => {
 for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) {
  const value = check()
  if (value) return value
 }
 throw Error('Timed out waiting for condition')
}

test('passes exit codes and signals through, forwards SIGTERM, and sets the child environment', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const ok = await f.run(printEnv(7), { AGENT_HEAVY_SLOTS: '2' })
 assert.equal(ok.code, 7, ok.stderr)
 assert.deepEqual(JSON.parse(ok.stdout), { held: '1', workers: String(Math.max(1, Math.floor(os.availableParallelism() / 2))) })
 const killed = await f.run(node('process.kill(process.pid, "SIGTERM")'))
 assert.equal(killed.code, 128 + os.constants.signals.SIGTERM)
 const holder = f.start(holdAndRecord(f.file('term.pid')))
 const pid = await f.waitForPid('term.pid')
 holder.kill('SIGTERM')
 assert.equal((await holder.result).code, 128 + os.constants.signals.SIGTERM)
 assert.equal(alive(pid), false)
 assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700)
 // The wrapper blocks signals around fork. The command must start with the original, empty mask.
 const mask = await f.run(['/usr/bin/perl', '-MPOSIX', '-e', 'my $m = POSIX::SigSet->new; sigprocmask(SIG_BLOCK, POSIX::SigSet->new, $m); print join(",", map { $m->ismember($_) } SIGINT, SIGQUIT, SIGTERM, SIGHUP)'])
 assert.equal(mask.stdout, '0,0,0,0', mask.stderr)
})

test('never runs more children than slots under concurrent acquires', { timeout: 60000 }, async t => {
 const f = fixture(t)
 const active = f.file('active'), seen = f.file('seen')
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
})

test('a SIGKILLed wrapper frees its slot at once, and its command keeps running', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const holder = f.start(holdAndRecord(f.file('orphan.pid')))
 const pid = await f.waitForPid('orphan.pid')
 holder.kill('SIGKILL')
 await once(holder, 'exit') // Not 'close': the orphaned command keeps the stdio pipes open.
 const next = await f.run(node('process.exit(3)'))
 assert.equal(next.code, 3, next.stderr)
 assert.equal(alive(pid), true, 'accepted trade-off: the orphaned command still runs')
})

test('a background process that a command leaves behind does not hold the slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const first = await f.run(['/bin/sh', '-c', `sleep 120 >/dev/null 2>&1 & echo $! > ${JSON.stringify(f.file('daemon.pid'))}`])
 assert.equal(first.code, 0, first.stderr)
 const pid = await f.waitForPid('daemon.pid')
 assert.equal(alive(pid), true)
 const next = await f.run(node('process.exit(4)')) // A leaked lock makes this wait past the test timeout.
 assert.equal(next.code, 4, next.stderr)
})

test('with stdin closed, a background process that inherits stdin does not hold the slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 // With fd 0 closed, a slot file can get fd 0. Apple /usr/bin/perl fills a closed fd 0 with its own
 // /Library/Perl/5.34/AppendToPath file, so this regression shows only with other Perl builds, for example on Linux.
 const daemon = node(`const { spawn } = require('node:child_process')
const child = spawn('sleep', ['120'], { stdio: ['inherit', 'ignore', 'ignore'], detached: true }); child.unref()
require('node:fs').writeFileSync(${JSON.stringify(f.file('daemon.pid'))}, String(child.pid))`)
 const first = await f.run(['/bin/sh', '-c', 'exec "$0" "$@" <&-', helper, '--', ...daemon], {}, true)
 assert.equal(first.code, 0, first.stderr)
 assert.equal(alive(await f.waitForPid('daemon.pid')), true)
 const next = await f.run(node('process.exit(4)')) // A leaked lock makes this wait past the test timeout.
 assert.equal(next.code, 4, next.stderr)
})

test('one SIGINT to the process group reaches the command exactly once', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const ready = f.file('ready.pid')
 // A terminal sends SIGINT to the foreground process group. Here the detached wrapper leads its own group.
 const wrapper = f.start(node(`let count = 0
process.on('SIGINT', () => { if (count++ === 0) setTimeout(() => { console.log(count); process.exit(0) }, 500) })
require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000)`), {}, { detached: true })
 await f.waitForPid('ready.pid')
 process.kill(-wrapper.pid, 'SIGINT')
 const result = await wrapper.result
 assert.equal(result.code, 0, result.stderr)
 assert.equal(result.stdout.trim(), '1')
})

test('fails open with one warning when the lock directory cannot be created', { timeout: 30000 }, async t => {
 const f = fixture(t)
 const readOnly = f.file('read-only')
 fs.mkdirSync(readOnly, { mode: 0o500 })
 const result = await f.run(node('process.exit(5)'), { AGENT_HEAVY_DIR: path.join(readOnly, 'locks') })
 assert.equal(result.code, 5)
 assert.equal(result.stderr.match(/agent-heavy: throttle unavailable/g)?.length, 1, result.stderr)
})

test('nested calls and AGENT_HEAVY=0 run without waiting for a busy slot', { timeout: 30000 }, async t => {
 const f = fixture(t)
 f.start(holdAndRecord(f.file('busy.pid')))
 await f.waitForPid('busy.pid')
 const nested = await f.run(printEnv(), { AGENT_HEAVY_HELD: '1', AGENT_HEAVY_WORKERS: '4' })
 assert.equal(nested.code, 0, nested.stderr)
 assert.deepEqual(JSON.parse(nested.stdout), { held: '1', workers: '4' })
 const bypass = await f.run(printEnv(), { AGENT_HEAVY: '0' })
 assert.equal(bypass.code, 0, bypass.stderr)
 assert.deepEqual(JSON.parse(bypass.stdout), { held: '', workers: '' })
})
