const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const helper = path.join(__dirname, 'agent-stop.pl')
const stop = (...args) => spawnSync(helper, args, { encoding: 'utf8' })

// The session temporary directory is an allowed root on macOS, so no override of the roots is necessary.
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stop-test-'))
 const children = []
 t.after(() => {
  for (const child of children) child.kill('SIGKILL')
  fs.rmSync(root, { recursive: true, force: true })
 })
 // A child in the given directory. Its source prints "ready" when the test can use it.
 const start = async (cwd, source = "setInterval(() => {}, 1000); console.log('ready')", options = {}) => {
  const child = spawn(process.execPath, ['-e', source], { cwd, stdio: ['ignore', 'pipe', 'inherit'], ...options })
  children.push(child)
  child.exited = once(child, 'exit')
  let output = ''
  for await (const chunk of child.stdout) if ((output += chunk).includes('ready')) break
  child.output = output
  return child
 }
 return { root, start }
}

test('stops a process that runs below an allowed root, and refuses one outside the roots', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
 const f = fixture(t)
 const inside = await f.start(f.root), outside = await f.start('/')
 const result = stop('--wait', '5', String(inside.pid), String(outside.pid))
 assert.equal(result.stdout, `pid ${inside.pid}: stopped (TERM)\npid ${outside.pid}: refused: working directory / is outside the allowed roots\n`)
 assert.equal(result.status, 1)
 assert.deepEqual(await inside.exited, [null, 'SIGTERM'])
 assert.equal(outside.exitCode, null, 'the refused process still runs')
 assert.equal(stop(String(inside.pid)).stdout, `pid ${inside.pid}: not found\n`)
})

test('refuses pid 1, the caller chain, protected hosts, groups, and malformed targets', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
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

test('--port stops the listening process and reports a free port as not found', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
 const f = fixture(t)
 const server = await f.start(f.root, "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => console.log('ready', s.address().port))")
 const port = server.output.trim().split(' ')[1]
 const result = stop('--port', port)
 assert.equal(result.stdout, `port ${port} pid ${server.pid}: stopped (TERM)\n`)
 assert.equal(result.status, 0)
 await server.exited
 const free = stop('--port', port)
 assert.equal(free.stdout, `port ${port}: not found\n`)
 assert.equal(free.status, 0)
})
