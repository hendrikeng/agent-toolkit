const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const helper = path.join(__dirname, 'agent-stop.pl')
const stop = (...args) => spawnSync(helper, args, { encoding: 'utf8' })
// The Claude sandbox blocks the setuid /bin/ps. agent-stop runs outside the sandbox, so test it outside.
const ps = spawnSync('/bin/ps', ['-o', 'pid=', '-p', String(process.pid)]).status === 0
const darwin = { skip: process.platform !== 'darwin' ? 'macOS only' : !ps && '/bin/ps is blocked, for example in the Claude sandbox', timeout: 30000 }

// The session temporary directory is an allowed root on macOS, so no override of the roots is necessary.
function fixture(t) {
 const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stop-test-')))
 const children = []
 t.after(() => {
  for (const child of children) child.kill('SIGKILL')
  fs.rmSync(root, { recursive: true, force: true })
 })
 // A child in the given directory. Its source prints "ready" when the test can use it.
 const start = async (cwd, source = "setInterval(() => {}, 1000); console.log('ready')", { executable = process.execPath, ...options } = {}) => {
  const child = spawn(executable, ['-e', source], { cwd, stdio: ['ignore', 'pipe', 'inherit'], ...options })
  children.push(child)
  child.exited = once(child, 'exit')
  let output = ''
  for await (const chunk of child.stdout) if ((output += chunk).includes('ready')) break
  child.output = output
  return child
 }
 return { root, start }
}

test('stops a process that runs below an allowed root, and refuses one outside the roots', darwin, async t => {
 const f = fixture(t)
 const inside = await f.start(f.root), outside = await f.start('/')
 const result = stop('--wait', '5', String(inside.pid), String(outside.pid))
 assert.equal(result.stdout, `pid ${inside.pid}: stopped (TERM)\npid ${outside.pid}: refused: working directory / is outside the allowed roots\n`)
 assert.equal(result.status, 1)
 assert.deepEqual(await inside.exited, [null, 'SIGTERM'])
 assert.equal(outside.exitCode, null, 'the refused process still runs')
 assert.equal(stop(String(inside.pid)).stdout, `pid ${inside.pid}: not found\n`)
})

test('refuses pid 1, the caller chain, protected hosts, groups, and malformed targets', darwin, async t => {
 const f = fixture(t)
 // argv0 makes the process look like an agent host, while its working directory is allowed.
 const host = await f.start(f.root, undefined, { argv0: 'codex' })
 const result = stop('1', String(process.pid), String(host.pid), '-5', '0', 'node')
 assert.equal(result.stdout, [
  'pid 1: refused: protected: init or the caller of agent-stop',
  `pid ${process.pid}: refused: protected: init or the caller of agent-stop`,
  `pid ${host.pid}: refused: protected: agent host, browser, or terminal`,
  ...['-5', '0', 'node'].map(pid => `pid ${pid}: refused: not a single process id (no groups, 0, or names)`), ''].join('\n'))
 assert.equal(result.status, 1)
 assert.equal(host.exitCode, null)
 for (const args of [[], ['--signal', 'HUP', '1'], ['--wait', 'x', '1'], ['--pattern', 'node']]) assert.equal(stop(...args).status, 2, args.join(' '))
})

test('--port stops the listening process and reports a free port as not found', darwin, async t => {
 const f = fixture(t)
 const server = await f.start(f.root, "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => console.log('ready', String(s.address().port)))")
 const port = server.output.trim().split(' ')[1]
 const result = stop('--port', port)
 assert.equal(result.stdout, `port ${port} pid ${server.pid}: stopped (TERM)\n`)
 assert.equal(result.status, 0)
 await server.exited
 const free = stop('--port', port)
 assert.equal(free.stdout, `port ${port}: not found\n`)
 assert.equal(free.status, 0)
})

test('ignores PERL5LIB and PERL5OPT, so a caller cannot load code into the unsandboxed helper', darwin, t => {
 const f = fixture(t)
 const marker = path.join(f.root, 'marker')
 fs.writeFileSync(path.join(f.root, 'Evil.pm'), `package Evil; open(my $f, '>', ${JSON.stringify(marker)}); 1;\n`)
 const result = spawnSync(helper, ['1'], { encoding: 'utf8', env: { ...process.env, PERL5LIB: f.root, PERL5OPT: '-MEvil' } })
 assert.equal(result.stdout, 'pid 1: refused: protected: init or the caller of agent-stop\n', result.stderr)
 assert.equal(fs.existsSync(marker), false)
})

test('a root that is a symlink does not allow its target', darwin, async t => {
 const f = fixture(t)
 // A copy with test roots: the agent could replace a root path with a link to another directory.
 const real = path.join(f.root, 'real'), outside = path.join(f.root, 'outside'), link = path.join(f.root, 'link')
 // Both processes run one level below, because a root itself is not an allowed working directory.
 for (const dir of [real, outside]) fs.mkdirSync(path.join(dir, 'work'), { recursive: true })
 fs.symlinkSync(outside, link)
 const source = fs.readFileSync(helper, 'utf8'), roots = /^my @roots = .*;$/m
 assert.match(source, roots)
 const copy = path.join(f.root, 'agent-stop')
 fs.writeFileSync(copy, source.replace(roots, `my @roots = (${JSON.stringify(link)}, ${JSON.stringify(real)});`), { mode: 0o755 })
 const allowed = await f.start(path.join(real, 'work')), linked = await f.start(path.join(outside, 'work'))
 const result = spawnSync(copy, [String(allowed.pid), String(linked.pid)], { encoding: 'utf8' })
 assert.equal(result.stdout, `pid ${allowed.pid}: stopped (TERM)\npid ${linked.pid}: refused: working directory ${outside}/work is outside the allowed roots\n`, result.stderr)
 assert.equal(linked.exitCode, null)
})

test('checks the real executable, not the argv0 that ps shows', darwin, async t => {
 const f = fixture(t)
 // APFS clones of node. Copies of Apple platform binaries do not start outside the system volume.
 const app = path.join(f.root, 'Fake.app/Contents/MacOS/node'), codex = path.join(f.root, 'bin/codex')
 for (const file of [app, codex]) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(process.execPath, file, fs.constants.COPYFILE_FICLONE)
 }
 const inApp = await f.start(f.root, undefined, { executable: app, argv0: 'fake' })
 const named = await f.start(f.root, undefined, { executable: codex, argv0: 'fake' })
 const result = stop(String(inApp.pid), String(named.pid))
 assert.equal(result.stdout, `pid ${inApp.pid}: refused: protected: macOS app\npid ${named.pid}: refused: protected: agent host, browser, or terminal\n`)
 assert.equal(inApp.exitCode, null)
 assert.equal(named.exitCode, null)
})
