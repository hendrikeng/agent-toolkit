const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const test = require('node:test')

function fixture(major = '17') {
 const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-fixture-')))
 const scratch = path.join(home, 'agent-toolkit-fixtures')
 const installed = {
  '/opt/homebrew/opt/postgresql@17/bin': '/opt/homebrew/Cellar/postgresql@17/17.6/bin',
  '/opt/homebrew/opt/postgresql@18/bin': '/opt/homebrew/Cellar/postgresql@18/18.1/bin',
 }
 const bin = installed[`/opt/homebrew/opt/postgresql@${major}/bin`], shortTmp = path.join(home, 'short-tmp')
 fs.mkdirSync(shortTmp)
 const calls = [], processes = new Map()
 let nextPid = 43210, failure = '', foreign = false, longSocket = false, missing = false, serverMajor = major
 const mockFs = { ...fs,
  existsSync: value => Object.hasOwn(installed, value) ? !missing || installed[value] !== bin : /^\/usr\/local\/opt\/postgresql@(17|18)\/bin$/.test(value) ? false : fs.existsSync(value),
  realpathSync: value => installed[value] ?? (value === '/tmp' ? shortTmp : value.startsWith(bin + '/') ? value : fs.realpathSync(value)),
  statSync: value => value.startsWith(bin + '/') ? { isFile: () => true } : fs.statSync(value),
 }
 const execFileSync = (file, args, options) => {
  calls.push({ file, args: [...args], options })
  if (file === '/bin/ps') return foreign ? 'postgres -D /unrelated/database' : `${bin}/postgres -D ${processes.get(Number(args[args.indexOf('-p') + 1]))}`
  assert.equal(path.dirname(file), bin)
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR'])
  assert.ok(options.cwd.startsWith(scratch + `/pg${major}-`))
  assert.equal(options.env.HOME, options.cwd); assert.equal(options.env.TMPDIR, options.cwd)
  const program = path.basename(file)
  if (failure === program) throw Error('simulated executable failure')
  if (program === 'postgres') { assert.deepEqual(Array.from(args), ['--version']); return `postgres (PostgreSQL) ${serverMajor}.1` }
  const data = args.includes('-D') ? args[args.indexOf('-D') + 1] : undefined
  if (program === 'initdb') {
   fs.mkdirSync(data)
   for (const name of ['postgresql.conf', 'pg_hba.conf']) fs.writeFileSync(path.join(data, name), '')
   fs.writeFileSync(path.join(data, 'PG_VERSION'), `${major}\n`)
  }
  if (program === 'pg_ctl' && args.at(-1) === 'start') {
   const port = fs.readFileSync(path.join(data, 'postgresql.conf'), 'utf8').match(/\nport = (\d+)/)[1]
   processes.set(++nextPid, data)
   fs.writeFileSync(path.join(data, 'postmaster.pid'), `${nextPid}\n${data}\n1700000000\n${port}\n`)
  }
  if (program === 'pg_ctl' && args.at(-1) === 'stop') {
   const pid = Number(fs.readFileSync(path.join(data, 'postmaster.pid'), 'utf8').split('\n')[0])
   processes.delete(pid)
   fs.renameSync(path.join(data, 'postmaster.pid'), path.join(data, 'stopped.pid'))
  }
  return ''
 }
 const module = { exports: {} }
 const customRequire = name => name === 'node:fs' ? mockFs : name === 'node:os' ? { ...os, tmpdir: () => home } : name === 'node:child_process' ? { execFileSync } : require(name)
 // Model the normal temporary-directory length for socket checks.
 const mockBuffer = { byteLength: value => longSocket ? 104 : Buffer.byteLength(value.replace(shortTmp, '/private/tmp').replace(home, '/Users/test')) }
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pg-test.cjs'), 'utf8'), { require: customRequire, module, Buffer: mockBuffer, console })
 return { main: module.exports.main, calls, scratch, shortTmp, set missing(value) { missing = value }, set serverMajor(value) { serverMajor = value }, set longSocket(value) { longSocket = value }, set failure(value) { failure = value }, set foreign(value) { foreign = value } }
}

for (const major of ['17', '18']) {
const startArgs = action => major === '17' ? [action] : [action, '--postgres-version', major]

test(`PG${major} fixture lifecycle isolates bootstrap credentials, retains files, and refuses arbitrary commands or foreign processes`, async () => {
 const f = fixture(major)
 for (const args of [[], ['start', '-D', '/elsewhere'], ['start', '--postgres-version'], ['start', '--postgres-version', '19'], ['start', '--postgres-version', '18', 'extra'], ['start', '--postgres-version=18'], ['psql', '-c', 'select 1'], ['stop', '../existing'], ['status', '/absolute'], ['stop', 'pg18-ABC123', '--postgres-version', '17']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const started = await f.main(startArgs('start'))
 assert.match(started.id, new RegExp(`^pg${major}-[A-Za-z0-9]{6}$`))
 assert.equal(started.status, 'running')
 assert.equal(started.profile, 'restricted')
 assert.match(started.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 assert.equal(fs.statSync(started.path).mode & 0o777, 0o700)
 const config = fs.readFileSync(path.join(started.path, 'data/postgresql.conf'), 'utf8')
 assert.match(config, new RegExp(`unix_socket_directories = '${f.shortTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/agent-pg-[A-Za-z0-9]{6}'`))
 const record = fs.readFileSync(path.join(started.path, 'pg-test.json'), 'utf8')
 assert.ok(!record.includes(new URL(started.database_url).password))
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql')
 assert.equal(queries.length, 3)
 assert.match(queries[0].options.input, /^CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '[a-f0-9]{48}';\n$/)
 assert.ok(queries.every(call => !call.args.includes('-c') && call.args.includes('-X') && call.args.includes('--no-password')))
 assert.match(queries[2].options.input, /toolkit_admin NOLOGIN/)
 const hba = fs.readFileSync(path.join(started.path, 'data/pg_hba.conf'), 'utf8')
 assert.equal(hba, 'local all all reject\nhost toolkit_test toolkit_test 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
 assert.equal((await f.main(['status', started.id])).status, 'running')
 f.foreign = true
 const stops = () => f.calls.filter(call => call.args.at(-1) === 'stop').length
 await assert.rejects(f.main(['stop', started.id]), /outside this test cluster/)
 assert.equal(stops(), 0)
 f.foreign = false
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
 assert.equal(stops(), 1)
 assert.ok(fs.existsSync(path.join(started.path, 'data/PG_VERSION')))
 fs.renameSync(path.join(started.path, 'pg-test.json'), path.join(started.path, 'saved.json'))
 fs.symlinkSync(path.join(started.path, 'saved.json'), path.join(started.path, 'pg-test.json'))
 await assert.rejects(f.main(['status', started.id]), /regular files/)
})

test(`PG${major} admin fixture uses the normal fixture owner without exposing superuser or targeting an existing database`, async () => {
 const f = fixture(major)
 for (const args of [['start-admin', 'existing'], ['start-admin', '--superuser']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const restricted = await f.main(startArgs('start'))
 const admin = await f.main(startArgs('start-admin'))
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

test(`PG${major} migration fixture permits role creation without BYPASSRLS or access to an existing database`, async () => {
 const f = fixture(major)
 for (const args of [['start-migration', 'existing'], ['start-migration', '--superuser']]) await assert.rejects(f.main(args), /Usage/)
 const started = await f.main(startArgs('start-migration'))
 assert.equal(started.profile, 'migration')
 assert.match(started.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql' && call.options.cwd === started.path)
 assert.match(queries[0].options.input, /^CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '[a-f0-9]{48}';\n$/)
 assert.equal(queries[1].options.input, 'CREATE DATABASE toolkit_test OWNER toolkit_test;\n')
 assert.equal(fs.readFileSync(path.join(started.path, 'data/pg_hba.conf'), 'utf8'), 'local all all reject\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
 assert.equal((await f.main(['stop', started.id])).status, 'stopped')
})

test(`PG${major} failed setup preserves a controllable incomplete cluster without retrying or deleting it`, async () => {
 const f = fixture(major)
 f.failure = 'psql'
 await assert.rejects(f.main(startArgs('start')), /Files retained/)
 const [id] = fs.readdirSync(f.scratch)
 assert.equal((await f.main(['status', id])).status, 'incomplete')
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, 1)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'psql').length, 1)
 assert.equal((await f.main(['stop', id])).status, 'stopped')
 assert.ok(fs.existsSync(path.join(f.scratch, id, 'data/PG_VERSION')))
 f.longSocket = true
 const initialized = f.calls.filter(call => path.basename(call.file) === 'initdb').length
 await assert.rejects(f.main(startArgs('start')), /Files retained/)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, initialized)
})
}

test('PG18 selection refuses a missing installation or wrong binary without falling back to PG17', async () => {
 const missing = fixture('18')
 missing.missing = true
 await assert.rejects(missing.main(['start-admin', '--postgres-version', '18']), /Expected exactly one existing Homebrew PostgreSQL 18 installation/)
 assert.equal(missing.calls.length, 0)
 const wrong = fixture('18')
 wrong.serverMajor = '17'
 await assert.rejects(wrong.main(['start-admin', '--postgres-version', '18']), /failed during PostgreSQL version check/)
 assert.deepEqual(wrong.calls.map(call => path.basename(call.file)), ['postgres'])
})

test('PG18 lifecycle binds the resource ID to both the binary record and cluster version', async () => {
 const f = fixture('18')
 const started = await f.main(['start-admin', '--postgres-version', '18'])
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
