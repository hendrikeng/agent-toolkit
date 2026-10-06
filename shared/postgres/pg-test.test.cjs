const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const test = require('node:test')

const fixtureHomes = []
test.after(() => { for (const home of fixtureHomes) fs.rmSync(home, { recursive: true, force: true }) })

function fixture(major = '18') {
 const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-fixture-')))
 fixtureHomes.push(home)
 const shortTmp = path.join(home, 'claude-tmp')
 const scratch = path.join(shortTmp, 'agent-toolkit-fixtures')
 const legacy = path.join(home, 'Code/.agent-toolkit-scratch/agent-toolkit-fixtures')
 const systemTmp = path.join(home, 'system-tmp'), darwinTmp = path.join(home, 'darwin-tmp')
 const installed = {
  '/opt/homebrew/opt/postgresql@17/bin': '/opt/homebrew/Cellar/postgresql@17/17.6/bin',
  '/opt/homebrew/opt/postgresql@18/bin': '/opt/homebrew/Cellar/postgresql@18/18.1/bin',
 }
 const bin = installed[`/opt/homebrew/opt/postgresql@${major}/bin`]
 for (const directory of [shortTmp, systemTmp, darwinTmp]) fs.mkdirSync(directory)
 const calls = [], processes = new Map()
 const owner = { session: '12345678-1234-1234-1234-123456789abc', pid: 3210, started: 'Tue Sep 29 12:00:00 2026' }
 const owners = new Map([[owner.pid, owner.started]])
 let nextPid = 43210, failure = '', failureError, onInitdb, foreign = false, longSocket = false, missing = false, ownerDiesOnReload = false, serverMajor = major, stopRace = false
 const mockFs = { ...fs,
  chmodSync: (value, mode) => {
   if (!value.startsWith(shortTmp + path.sep)) throw Object.assign(Error('Fixture permission denial outside allowed temp'), { code: 'EPERM' })
   return fs.chmodSync(value, mode)
  },
  existsSync: value => Object.hasOwn(installed, value) ? !missing || installed[value] !== bin : /^\/usr\/local\/opt\/postgresql@(17|18)\/bin$/.test(value) ? false : fs.existsSync(value),
  realpathSync: value => value === '/tmp' ? systemTmp : installed[value] ?? (value.startsWith(bin + '/') ? value : fs.realpathSync(value)),
  statSync: value => value.startsWith(bin + '/') ? { isFile: () => true } : fs.statSync(value),
 }
 const execFileSync = (file, args, options) => {
  calls.push({ file, args: [...args], options })
  if (file === '/usr/bin/getconf') return `${darwinTmp}\n`
  if (file === '/bin/ps') {
   if (failure === 'ps') throw Object.assign(Error('spawnSync /bin/ps EPERM'), { code: 'EPERM' })
   const pid = Number(args[args.indexOf('-p') + 1])
   if (args.includes('lstart=')) {
    if (owners.has(pid)) return owners.get(pid)
    throw Object.assign(Error('process absent'), { status: 1 })
   }
   if (!processes.has(pid)) throw Object.assign(Error('process absent'), { status: 1 })
   return foreign ? 'postgres -D /unrelated/database' : `${bin}/postgres -D ${processes.get(pid)}`
  }
  assert.equal(path.dirname(file), bin)
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR'])
  assert.ok([scratch, legacy].some(root => options.cwd.startsWith(root + `/pg${major}-`)))
  assert.equal(options.env.HOME, options.cwd); assert.equal(options.env.TMPDIR, options.cwd)
  const program = path.basename(file)
  if (failure === program) throw failureError ?? Error('simulated executable failure')
  if (program === 'postgres') { assert.deepEqual(Array.from(args), ['--version']); return `postgres (PostgreSQL) ${serverMajor}.1` }
  const data = args.includes('-D') ? args[args.indexOf('-D') + 1] : undefined
  if (program === 'initdb') {
   if (onInitdb) onInitdb()
   fs.mkdirSync(data)
   for (const name of ['postgresql.conf', 'pg_hba.conf']) fs.writeFileSync(path.join(data, name), '')
   fs.writeFileSync(path.join(data, 'PG_VERSION'), `${major}\n`)
  }
  if (program === 'pg_ctl' && args.at(-1) === 'start') {
   const port = fs.readFileSync(path.join(data, 'postgresql.conf'), 'utf8').match(/\nport = (\d+)/)[1]
   processes.set(++nextPid, data)
   fs.writeFileSync(path.join(data, 'postmaster.pid'), `${nextPid}\n${data}\n1700000000\n${port}\n`)
  }
  if (program === 'pg_ctl' && args.at(-1) === 'reload' && ownerDiesOnReload) owners.delete(owner.pid)
  if (program === 'pg_ctl' && args.at(-1) === 'stop') {
   const pid = Number(fs.readFileSync(path.join(data, 'postmaster.pid'), 'utf8').split('\n')[0])
   processes.delete(pid)
   fs.renameSync(path.join(data, 'postmaster.pid'), path.join(data, 'stopped.pid'))
   if (stopRace) throw Error('concurrent stop completed first')
  }
  return ''
 }
 const module = { exports: {} }
 const mockProcess = { env: { AGENT_TOOLKIT_SESSION_ID: owner.session, AGENT_TOOLKIT_SESSION_PID: String(owner.pid) }, argv: [], on: () => {} }
 const mockOs = { ...os, tmpdir: () => shortTmp, userInfo: () => ({ homedir: home }), platform: () => 'darwin' }
 // Port allocation is an OS boundary; fixture PostgreSQL processes are simulated too.
 let nextPort = 24000
 const mockNet = { createServer: () => ({ once() {}, listen(_port, _host, ready) { ready() }, address: () => ({ port: nextPort++ }), close(done) { done() } }) }
 const customRequire = name => name === 'node:net' ? mockNet : name === 'node:fs' ? mockFs : name === 'node:os' ? mockOs : name === 'node:process' ? mockProcess : name === 'node:child_process' ? { execFileSync } : require(name)
 // Model Claude's writable temporary directory for socket checks.
 const mockBuffer = { byteLength: value => longSocket ? 104 : Buffer.byteLength(value.replace(shortTmp, '/private/tmp/claude-501').replace(home, '/Users/test')) }
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pg-test.cjs'), 'utf8'), { require: customRequire, module, Buffer: mockBuffer, console, setTimeout })
 function moveToLegacy(started) {
  fs.mkdirSync(legacy, { recursive: true })
  const moved = { ...started, path: path.join(legacy, started.id) }
  fs.renameSync(started.path, moved.path)
  const pidFile = path.join(moved.path, 'data/postmaster.pid')
  const lines = fs.readFileSync(pidFile, 'utf8').split('\n')
  lines[1] = path.join(moved.path, 'data')
  fs.writeFileSync(pidFile, lines.join('\n'))
  processes.set(Number(lines[0]), lines[1])
  return moved
 }
 function existingCluster() {
  const id = `pg${major}-ABC123`, root = path.join(legacy, id), data = path.join(root, 'data')
  fs.mkdirSync(data, { recursive: true })
  const state = { version: 1, bin, port: 24680, ready: true, pid: ++nextPid, started: '1700000000' }
  fs.writeFileSync(path.join(root, 'pg-test.json'), JSON.stringify(state))
  fs.writeFileSync(path.join(data, 'PG_VERSION'), `${major}\n`)
  fs.writeFileSync(path.join(data, 'postmaster.pid'), `${state.pid}\n${data}\n${state.started}\n${state.port}\n`)
  processes.set(state.pid, data)
  return { id, path: root }
 }
 return {
  main: module.exports.main, calls, home, legacy, owner, scratch, shortTmp, darwinTmp, moveToLegacy, existingCluster,
  set managed(value) { if (value) Object.assign(mockProcess.env, { AGENT_TOOLKIT_SESSION_ID: owner.session, AGENT_TOOLKIT_SESSION_PID: String(owner.pid) }); else { delete mockProcess.env.AGENT_TOOLKIT_SESSION_ID; delete mockProcess.env.AGENT_TOOLKIT_SESSION_PID } },
  set missing(value) { missing = value },
  set failureError(value) { failureError = value },
  set onInitdb(value) { onInitdb = value },
  set ownerAlive(value) { if (value) owners.set(owner.pid, owner.started); else owners.delete(owner.pid) },
  set ownerDiesOnReload(value) { ownerDiesOnReload = value }, set serverMajor(value) { serverMajor = value }, set stopRace(value) { stopRace = value }, set longSocket(value) { longSocket = value }, set failure(value) { failure = value }, set foreign(value) { foreign = value }
 }
}

test('default PG18 fixture lifecycle isolates bootstrap credentials, releases stopped files, and refuses arbitrary commands or foreign processes', async () => {
 const f = fixture()
 for (const args of [[], ['start', '-D', '/elsewhere'], ['start', '--postgres-version'], ['start', '--postgres-version', '17'], ['start', '--postgres-version', '18'], ['start', '--postgres-version', '19'], ['start', '--postgres-version', '18', 'extra'], ['start', '--postgres-version=18'], ['gc', 'extra'], ['psql', '-c', 'select 1'], ['stop', '../existing'], ['status', '/absolute'], ['stop', 'pg18-ABC123', '--postgres-version', '17']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const started = await f.main(['start'])
 assert.match(started.id, /^pg18-[A-Za-z0-9]{6}$/)
 assert.equal(started.status, 'running')
 assert.equal(started.profile, 'restricted')
 assert.ok(started.path.startsWith(f.scratch + path.sep))
 assert.match(started.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 assert.equal(fs.statSync(started.path).mode & 0o777, 0o700)
 const config = fs.readFileSync(path.join(started.path, 'data/postgresql.conf'), 'utf8')
 assert.match(config, new RegExp(`unix_socket_directories = '${f.shortTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/agent-pg-[A-Za-z0-9]{6}'`))
 const record = fs.readFileSync(path.join(started.path, 'pg-test.json'), 'utf8')
 assert.ok(!record.includes(new URL(started.database_url).password))
 assert.deepEqual(JSON.parse(record).owner, f.owner)
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql')
 assert.equal(queries.length, 3)
 assert.match(queries[0].options.input, /^CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '[a-f0-9]{48}';\n$/)
 assert.ok(queries.every(call => !call.args.includes('-c') && call.args.includes('-X') && call.args.includes('--no-password')))
 assert.match(queries[2].options.input, /toolkit_admin NOLOGIN/)
 const hba = fs.readFileSync(path.join(started.path, 'data/pg_hba.conf'), 'utf8')
 assert.equal(hba, 'local all all reject\nhost toolkit_test toolkit_test 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
 assert.equal((await f.main(['status', started.id])).status, 'running')
 fs.writeFileSync(path.join(started.path, 'postgres.log'), 'fixture server log')
 f.foreign = true
 const stops = () => f.calls.filter(call => call.args.at(-1) === 'stop').length
 await assert.rejects(f.main(['stop', started.id]), /outside this test cluster/)
 assert.equal(stops(), 0)
 f.foreign = false
 f.stopRace = true
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
 assert.equal(stops(), 1)
 assert.equal(fs.existsSync(path.join(started.path, 'data')), false)
 assert.deepEqual(fs.readdirSync(started.path), ['pg-test.json'])
 assert.equal(fs.existsSync(JSON.parse(record).socket), false)
 fs.renameSync(path.join(started.path, 'pg-test.json'), path.join(started.path, 'saved.json'))
 fs.symlinkSync(path.join(started.path, 'saved.json'), path.join(started.path, 'pg-test.json'))
 await assert.rejects(f.main(['status', started.id]), /regular files/)
})

test('default PG18 admin fixture uses the normal fixture owner without exposing superuser or targeting an existing database', async () => {
 const f = fixture()
 for (const args of [['start-admin', 'existing'], ['start-admin', '--superuser']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const restricted = await f.main(['start'])
 const admin = await f.main(['start-admin'])
 assert.notEqual(admin.id, restricted.id)
 assert.equal(admin.profile, 'admin')
 assert.match(admin.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql' && call.options.cwd === admin.path)
 assert.equal(queries.length, 3)
 assert.match(queries[0].options.input, /^CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION BYPASSRLS PASSWORD '[a-f0-9]{48}';\n$/)
 assert.equal(queries[1].options.input, 'CREATE DATABASE toolkit_test OWNER toolkit_test;\n')
 assert.equal(queries[2].options.input, 'ALTER ROLE toolkit_admin NOLOGIN;\n')
 assert.ok(queries.every(call => !call.options.input.includes('maintenance')))
 const hba = fs.readFileSync(path.join(admin.path, 'data/pg_hba.conf'), 'utf8')
 assert.equal(hba, 'local all all reject\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
 assert.ok(!fs.readFileSync(path.join(admin.path, 'pg-test.json'), 'utf8').includes(new URL(admin.database_url).password))
 assert.equal((await f.main(['stop', admin.id])).status, 'stopped')
 assert.equal((await f.main(['status', restricted.id])).status, 'running')
 await f.main(['stop', restricted.id])
})

test('default PG18 migration fixture permits role creation without BYPASSRLS or access to an existing database', async () => {
 const f = fixture()
 for (const args of [['start-migration', 'existing'], ['start-migration', '--superuser']]) await assert.rejects(f.main(args), /Usage/)
 const started = await f.main(['start-migration'])
 assert.equal(started.profile, 'migration')
 assert.match(started.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql' && call.options.cwd === started.path)
 assert.match(queries[0].options.input, /^CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '[a-f0-9]{48}';\n$/)
 assert.equal(queries[1].options.input, 'CREATE DATABASE toolkit_test OWNER toolkit_test;\n')
 assert.equal(fs.readFileSync(path.join(started.path, 'data/pg_hba.conf'), 'utf8'), 'local all all reject\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
})

test('PG18 failed setup preserves a controllable incomplete cluster without retrying or deleting it', async () => {
 const f = fixture()
 f.failure = 'psql'
 await assert.rejects(f.main(['start']), /Files retained/)
 const [id] = fs.readdirSync(f.scratch)
 assert.equal((await f.main(['status', id])).status, 'incomplete')
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, 1)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'psql').length, 1)
 assert.equal((await f.main(['stop', id])).status, 'stopped')
 assert.deepEqual(fs.readdirSync(path.join(f.scratch, id)), ['pg-test.json'])
 f.longSocket = true
 const initialized = f.calls.filter(call => path.basename(call.file) === 'initdb').length
 await assert.rejects(f.main(['start']), /Files retained/)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, initialized)
})

test('PG18 setup reports bounded initdb diagnostics but never bootstrap SQL or credentials', async () => {
 const initialization = fixture()
 initialization.failure = 'initdb'
 initialization.failureError = Object.assign(Error('command failed with unsafe stdout'), {
  status: 1,
  stderr: '\x1b[31mFATAL: could not create shared memory segment: Operation not permitted\x1b[0m\nDETAIL: Failed system call was shmget(key=123, size=56, 03600).\n' + 'x'.repeat(5000),
  stdout: 'not-for-output',
 })
 await assert.rejects(initialization.main(['start-admin']), error => {
  assert.match(error.message, /Command: initdb; exit status: 1/)
  assert.match(error.message, /could not create shared memory segment: Operation not permitted/)
  assert.match(error.message, /PostgreSQL shared-memory initialization was denied/)
  assert.match(error.message, /native approval path/)
  assert.ok(!error.message.includes('\x1b') && !error.message.includes('not-for-output'))
  assert.ok(error.message.length < 3000)
  return true
 })
 const [id] = fs.readdirSync(initialization.scratch)
 assert.equal((await initialization.main(['stop', id])).status, 'stopped')
 assert.equal(initialization.calls.filter(call => path.basename(call.file) === 'initdb').length, 1)
 assert.ok(fs.existsSync(path.join(initialization.scratch, id, 'pg-test.json')))

 const bootstrap = fixture()
 bootstrap.failure = 'psql'
 bootstrap.failureError = Object.assign(Error('PASSWORD secret-password'), {
  status: null, signal: 'SIGTERM', code: 'ETIMEDOUT', stderr: "CREATE ROLE toolkit_test PASSWORD 'secret-password';", stdout: 'secret-password',
 })
 await assert.rejects(bootstrap.main(['start']), error => {
  assert.match(error.message, /Command: psql; exit status: unavailable; signal: SIGTERM/)
  assert.match(error.message, /ETIMEDOUT/)
  assert.ok(!error.message.includes('secret-password') && !error.message.includes('CREATE ROLE'))
  return true
 })
 await bootstrap.main(['stop', fs.readdirSync(bootstrap.scratch)[0]])
})

test('existing PG17 fixtures remain manageable without creating new PG17 clusters', async () => {
 const f = fixture('17')
 const existing = f.existingCluster()
 assert.equal((await f.main(['status', existing.id])).status, 'running')
 f.missing = true
 const blocked = await f.main(['gc'])
 assert.equal(blocked.preserved.some(item => item.id === existing.id), true)
 assert.equal(fs.existsSync(existing.path), true)
 assert.equal(f.calls.filter(call => call.args.at(-1) === 'stop').length, 0)
 f.missing = false
 assert.equal((await f.main(['stop', existing.id])).status, 'stopped')
 assert.equal((await f.main(['status', existing.id])).status, 'stopped')
 const record = path.join(existing.path, 'pg-test.json')
 const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
 fs.utimesSync(record, old, old)
 const cleanup = await f.main(['gc'])
 assert.deepEqual(Array.from(cleanup.deleted, item => item.id), [existing.id])
 assert.equal(fs.existsSync(existing.path), false)
 assert.equal(f.calls.some(call => path.basename(call.file) === 'initdb'), false)
})

test('garbage collection recognizes legacy owners and reaps dead-owner fixtures before the next start', async () => {
 const f = fixture()
 fs.mkdirSync(path.join(f.scratch, 'pg17-ABC123'), { recursive: true })
 const abandoned = await f.main(['start'])
 const abandonedRecord = path.join(abandoned.path, 'pg-test.json')
 const state = JSON.parse(fs.readFileSync(abandonedRecord, 'utf8'))
 state.owner = { session: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pid: 9999, started: 'Mon Sep 28 12:00:00 2026' }
 fs.writeFileSync(abandonedRecord, JSON.stringify(state))
 const partial = path.join(f.scratch, 'pg18-DEF456')
 fs.mkdirSync(path.join(partial, 'data'), { recursive: true })
 fs.writeFileSync(path.join(partial, 'pg-test.json'), JSON.stringify({ ...state, pid: undefined, started: undefined, socket: path.join(f.shortTmp, 'agent-pg-DEF456') }))
 const current = await f.main(['start-admin'])
 assert.equal((await f.main(['status', abandoned.id])).status, 'stopped')
 assert.equal(JSON.parse(fs.readFileSync(path.join(partial, 'pg-test.json'), 'utf8')).owner, undefined)
 assert.equal((await f.main(['status', current.id])).status, 'running')
 f.ownerAlive = false
 const cleanup = await f.main(['gc'])
 assert.deepEqual(Array.from(cleanup.stopped, item => item.id), [current.id])
 assert.equal((await f.main(['status', current.id])).status, 'stopped')
 for (const root of [abandoned.path, partial, current.path]) assert.deepEqual(fs.readdirSync(root), ['pg-test.json'])
 assert.equal(f.calls.filter(call => call.args.at(-1) === 'stop').length, 2)
})

test('a fixture stops itself when its managed session exits during startup', async () => {
 const f = fixture()
 f.ownerDiesOnReload = true
 await assert.rejects(f.main(['start']), /failed during owner process check/)
 const [id] = fs.readdirSync(f.scratch)
 assert.equal((await f.main(['status', id])).status, 'stopped')
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.scratch, id, 'pg-test.json'), 'utf8')).owner, undefined)
})

test('denied process inspection asks for native approval without bypass advice', async () => {
 const f = fixture()
 f.failure = 'ps'
 await assert.rejects(f.main(['start']), /native permission approval/)
})

test('fixtures outside managed sessions have no owner', async () => {
 const f = fixture()
 f.managed = false
 const started = await f.main(['start'])
 const state = JSON.parse(fs.readFileSync(path.join(started.path, 'pg-test.json'), 'utf8'))
 assert.equal(state.owner, undefined)
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
})

test('garbage collection stops dead-owner and old ownerless clusters but keeps live and fresh clusters', async () => {
 const f = fixture()
 const dead = await f.main(['start'])
 const oldOwnerless = f.moveToLegacy(await f.main(['start']))
 const live = await f.main(['start'])
 const freshOwnerless = await f.main(['start'])
 const rewrite = (started, owner, startedAt) => {
  const record = path.join(started.path, 'pg-test.json')
  const state = JSON.parse(fs.readFileSync(record, 'utf8'))
  state.owner = owner
  if (startedAt) {
   state.started = String(startedAt)
   const pidFile = path.join(started.path, 'data/postmaster.pid')
   const lines = fs.readFileSync(pidFile, 'utf8').split('\n')
   lines[2] = state.started
   fs.writeFileSync(pidFile, lines.join('\n'))
  }
  fs.writeFileSync(record, JSON.stringify(state))
 }
 rewrite(dead, { ...f.owner, pid: 9999 })
 rewrite(oldOwnerless, undefined)
 rewrite(freshOwnerless, undefined, Math.floor(Date.now() / 1000))
 const summary = await f.main(['gc'])
 assert.deepEqual(Array.from(summary.stopped, item => item.id).sort(), [dead.id, oldOwnerless.id].sort())
 for (const root of [oldOwnerless.path, dead.path]) assert.deepEqual(fs.readdirSync(root), ['pg-test.json'])
 assert.equal((await f.main(['status', oldOwnerless.id])).status, 'stopped')
 assert.equal((await f.main(['status', dead.id])).status, 'stopped')
 assert.equal((await f.main(['status', live.id])).status, 'running')
 assert.equal((await f.main(['status', freshOwnerless.id])).status, 'running')
})

test('garbage collection deletes only stopped fixtures with records older than three days', async () => {
 const f = fixture()
 const old = await f.main(['start'])
 const missingSocket = await f.main(['start'])
 const fresh = await f.main(['start'])
 const owned = await f.main(['start'])
 for (const started of [old, missingSocket, fresh, owned]) await f.main(['stop', started.id])
 const ownedRecord = path.join(owned.path, 'pg-test.json')
 const ownedState = JSON.parse(fs.readFileSync(ownedRecord, 'utf8'))
 ownedState.owner = f.owner
 fs.writeFileSync(ownedRecord, JSON.stringify(ownedState))
 const oldSocket = path.join(f.shortTmp, `agent-pg-${old.id.slice(5)}`)
 const missingRecord = path.join(missingSocket.path, 'pg-test.json')
 const missingState = JSON.parse(fs.readFileSync(missingRecord, 'utf8'))
 assert.equal(fs.existsSync(missingState.socket), false)
 missingState.socket = path.join(f.home, 'vanished-tmp', path.basename(missingState.socket))
 fs.writeFileSync(missingRecord, JSON.stringify(missingState))
 const then = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
 for (const record of [path.join(old.path, 'pg-test.json'), missingRecord, ownedRecord]) fs.utimesSync(record, then, then)
 const summary = await f.main(['gc'])
 assert.deepEqual(Array.from(summary.deleted, item => item.id).sort(), [old.id, missingSocket.id].sort())
 assert.equal(fs.existsSync(old.path), false)
 assert.equal(fs.existsSync(oldSocket), false)
 assert.equal(fs.existsSync(missingSocket.path), false)
 assert.equal(fs.existsSync(fresh.path), true)
 assert.equal(fs.existsSync(owned.path), true)
})

test('garbage collection preserves and reports an invalid record without aborting', async () => {
 const f = fixture()
 const invalid = await f.main(['start'])
 const reclaimable = await f.main(['start'])
 const record = path.join(reclaimable.path, 'pg-test.json')
 const state = JSON.parse(fs.readFileSync(record, 'utf8'))
 state.owner = { ...f.owner, pid: 9999 }
 fs.writeFileSync(record, JSON.stringify(state))
 fs.writeFileSync(path.join(invalid.path, 'pg-test.json'), '{')
 const summary = await f.main(['gc'])
 assert.equal(summary.preserved.some(item => item.id === invalid.id), true)
 assert.equal(summary.stopped.some(item => item.id === reclaimable.id), true)
 assert.equal(fs.existsSync(invalid.path), true)
})

test('PG18 default refuses a missing installation or wrong binary without falling back to PG17', async () => {
 const missing = fixture('18')
 missing.missing = true
 await assert.rejects(missing.main(['start-admin']), /Expected exactly one existing Homebrew PostgreSQL 18 installation/)
 assert.equal(missing.calls.every(call => call.file === '/usr/bin/getconf'), true)
 const wrong = fixture('18')
 wrong.serverMajor = '17'
 await assert.rejects(wrong.main(['start-admin']), /failed during PostgreSQL version check/)
 assert.deepEqual(wrong.calls.filter(call => !['/usr/bin/getconf', '/bin/ps'].includes(call.file)).map(call => path.basename(call.file)), ['postgres'])
})

test('PG18 lifecycle binds the resource ID to both the binary record and cluster version', async () => {
 const f = fixture('18')
 const started = await f.main(['start-admin'])
 const recordPath = path.join(started.path, 'pg-test.json')
 const original = fs.readFileSync(recordPath, 'utf8')
 const record = JSON.parse(original)
 record.bin = '/opt/homebrew/Cellar/postgresql@17/17.6/bin'
 fs.writeFileSync(recordPath, JSON.stringify(record))
 await assert.rejects(f.main(['stop', started.id]), /Invalid or changed test database record/)
 fs.writeFileSync(recordPath, original)
 const versionPath = path.join(started.path, 'data/PG_VERSION')
 fs.writeFileSync(versionPath, '17\n')
 await assert.rejects(f.main(['status', started.id]), /Not a PostgreSQL 18 test cluster/)
 await assert.rejects(f.main(['stop', started.id]), /Not a PostgreSQL 18 test cluster/)
 assert.equal(f.calls.filter(call => call.args.at(-1) === 'stop').length, 0)
 fs.writeFileSync(versionPath, '18\n')
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
})

// These cases protect the destructive cleanup boundary, not private helper details.
test('cleanup preserves foreign sockets, symlink paths, and ambiguous live postmasters', async () => {
 for (const unsafe of ['socket', 'data', 'log', 'missing-pid']) {
  const f = fixture()
  const started = await f.main(['start'])
  const recordPath = path.join(started.path, 'pg-test.json')
  const state = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  const foreign = path.join(f.home, 'keep-me')
  fs.mkdirSync(foreign)
  fs.writeFileSync(path.join(foreign, 'important'), 'unrelated')
  if (unsafe === 'socket') {
   state.socket = foreign
   fs.writeFileSync(recordPath, JSON.stringify(state))
  } else if (unsafe === 'data') {
   fs.renameSync(path.join(started.path, 'data'), path.join(started.path, 'saved-data'))
   fs.symlinkSync(foreign, path.join(started.path, 'data'))
  } else if (unsafe === 'log') {
   fs.symlinkSync(path.join(foreign, 'important'), path.join(started.path, 'postgres.log'))
  } else {
   fs.unlinkSync(path.join(started.path, 'data/postmaster.pid'))
  }
  await assert.rejects(f.main(['stop', started.id]), /outside the fixture roots|without symlinks|regular files|still exists without its PID file/)
  const summary = await f.main(['gc'])
  // GC also refuses ambiguous stopped paths once their owner exits.
  if (unsafe === 'socket' || unsafe === 'log') {
   f.ownerAlive = false
   assert.equal((await f.main(['gc'])).preserved.some(item => item.id === started.id), true)
  } else assert.equal(summary.preserved.some(item => item.id === started.id), true)
  assert.equal(fs.readFileSync(path.join(foreign, 'important'), 'utf8'), 'unrelated')
  assert.equal(fs.existsSync(path.join(started.path, 'data')), true)
 }
})

test('overlapping garbage collection preserves a fresh ownerless startup and releases abandoned setup files later', async () => {
 const f = fixture()
 f.managed = false
 let overlappingCollection
 f.onInitdb = () => { overlappingCollection = f.main(['gc']) }
 const started = await f.main(['start'])
 const summary = await overlappingCollection
 assert.equal(summary.preserved.length, 0)
 assert.equal((await f.main(['status', started.id])).status, 'running')
 await f.main(['stop', started.id])

 const root = path.join(f.scratch, 'pg18-DEF456')
 const socket = path.join(f.shortTmp, 'agent-pg-DEF456')
 const state = JSON.parse(fs.readFileSync(path.join(started.path, 'pg-test.json'), 'utf8'))
 state.socket = socket
 fs.mkdirSync(path.join(root, 'data'), { recursive: true })
 fs.mkdirSync(socket)
 const record = path.join(root, 'pg-test.json')
 fs.writeFileSync(record, JSON.stringify(state))
 await f.main(['gc'])
 assert.equal(fs.existsSync(path.join(root, 'data')), true)
 assert.equal(fs.existsSync(socket), true)
 const stale = new Date(Date.now() - 3 * 60 * 60 * 1000)
 fs.utimesSync(record, stale, stale)
 await f.main(['gc'])
 assert.deepEqual(fs.readdirSync(root), ['pg-test.json'])
 assert.equal(fs.existsSync(socket), false)
})
