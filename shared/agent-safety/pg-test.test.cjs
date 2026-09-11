const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const test = require('node:test')

function fixture() {
 const base = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || path.join(os.homedir(), 'Code/.agent-toolkit-scratch')
 const home = fs.mkdtempSync(path.join(base, 'pg-test-fixture-'))
 const scratch = path.join(home, 'Code/.agent-toolkit-scratch')
 fs.mkdirSync(scratch, { recursive: true, mode: 0o700 })
 const bin = '/opt/homebrew/Cellar/postgresql@17/17.6/bin'
 const calls = [], processes = new Map()
 let nextPid = 43210, failure = '', foreign = false, longSocket = false
 const mockFs = { ...fs,
  existsSync: value => value === '/opt/homebrew/opt/postgresql@17/bin' ? true : value === '/usr/local/opt/postgresql@17/bin' ? false : fs.existsSync(value),
  realpathSync: value => value === '/opt/homebrew/opt/postgresql@17/bin' ? bin : value.startsWith(bin + '/') ? value : fs.realpathSync(value),
  statSync: value => value.startsWith(bin + '/') ? { isFile: () => true } : fs.statSync(value),
 }
 const execFileSync = (file, args, options) => {
  calls.push({ file, args: [...args], options })
  if (file === '/bin/ps') return foreign ? 'postgres -D /unrelated/database' : `${bin}/postgres -D ${processes.get(Number(args[args.indexOf('-p') + 1]))}`
  assert.equal(path.dirname(file), bin)
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR'])
  assert.ok(options.cwd.startsWith(scratch + '/pg17-'))
  assert.equal(options.env.HOME, options.cwd); assert.equal(options.env.TMPDIR, options.cwd)
  const program = path.basename(file)
  if (failure === program) throw Error('simulated executable failure')
  if (program === 'postgres') { assert.deepEqual(Array.from(args), ['--version']); return 'postgres (PostgreSQL) 17.6' }
  const data = args.includes('-D') ? args[args.indexOf('-D') + 1] : undefined
  if (program === 'initdb') {
   fs.mkdirSync(data)
   for (const name of ['postgresql.conf', 'pg_hba.conf']) fs.writeFileSync(path.join(data, name), '')
   fs.writeFileSync(path.join(data, 'PG_VERSION'), '17\n')
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
 const customRequire = name => name === 'node:fs' ? mockFs : name === 'node:os' ? { ...os, userInfo: () => ({ ...os.userInfo(), homedir: home }), homedir: () => { throw Error('Do not trust a HOME environment override') } } : name === 'node:child_process' ? { execFileSync } : require(name)
 // The fixture HOME is nested in scratch; model the normal installed HOME length for socket checks.
 const mockBuffer = { byteLength: value => longSocket ? 104 : Buffer.byteLength(value.replace(home, '/Users/test')) }
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pg-test.cjs'), 'utf8'), { require: customRequire, module, Buffer: mockBuffer, console })
 return { main: module.exports.main, calls, scratch, set longSocket(value) { longSocket = value }, set failure(value) { failure = value }, set foreign(value) { foreign = value } }
}

test('fixed scratch lifecycle isolates bootstrap credentials, retains files, and refuses arbitrary commands or foreign processes', async () => {
 const f = fixture()
 for (const args of [[], ['start', '-D', '/elsewhere'], ['psql', '-c', 'select 1'], ['stop', '../existing'], ['status', '/absolute']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const started = await f.main(['start'])
 assert.equal(started.status, 'running')
 assert.match(started.database_url, /^postgresql:\/\/toolkit_test:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 assert.equal(fs.statSync(started.path).mode & 0o777, 0o700)
 const record = fs.readFileSync(path.join(started.path, 'pg-test.json'), 'utf8')
 assert.ok(!record.includes(new URL(started.database_url).password))
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql')
 assert.equal(queries.length, 3)
 assert.match(queries[0].options.input, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/)
 assert.ok(queries.every(call => !call.args.includes('-c') && call.args.includes('-X') && call.args.includes('--no-password')))
 assert.match(queries[2].options.input, /toolkit_admin NOLOGIN/)
 const hba = fs.readFileSync(path.join(started.path, 'data/pg_hba.conf'), 'utf8')
 assert.ok(!hba.includes('trust')); assert.match(hba, /local all all reject/)
 assert.equal((await f.main(['status', started.id])).status, 'running')
 f.foreign = true
 const stops = () => f.calls.filter(call => call.args.at(-1) === 'stop').length
 await assert.rejects(f.main(['stop', started.id]), /outside this scratch cluster/)
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

test('fixture administration is a separate fresh cluster, never superuser or an existing-database upgrade', async () => {
 const f = fixture()
 for (const args of [['start-admin', 'existing'], ['start-admin', '--superuser']]) await assert.rejects(f.main(args), /Usage/)
 assert.equal(f.calls.length, 0)
 const restricted = await f.main(['start'])
 const admin = await f.main(['start-admin'])
 assert.notEqual(admin.id, restricted.id)
 assert.equal(admin.profile, 'fixture-admin')
 assert.match(admin.database_url, /^postgresql:\/\/toolkit_fixture_admin:[a-f0-9]{48}@127\.0\.0\.1:\d+\/toolkit_test$/)
 const queries = f.calls.filter(call => path.basename(call.file) === 'psql' && call.options.cwd === admin.path)
 assert.match(queries[0].options.input, /NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS/)
 assert.match(queries[2].options.input, /toolkit_admin NOLOGIN/)
 const hba = fs.readFileSync(path.join(admin.path, 'data/pg_hba.conf'), 'utf8')
 assert.match(hba, /host all all 127\.0\.0\.1\/32 scram-sha-256/)
 assert.ok(!hba.includes('trust'))
 assert.ok(!fs.readFileSync(path.join(admin.path, 'pg-test.json'), 'utf8').includes(new URL(admin.database_url).password))
 assert.equal((await f.main(['stop', admin.id])).status, 'stopped')
 assert.equal((await f.main(['status', restricted.id])).status, 'running')
 await f.main(['stop', restricted.id])
})

test('failed setup preserves a controllable incomplete cluster without retrying or deleting it', async () => {
 const f = fixture()
 f.failure = 'psql'
 await assert.rejects(f.main(['start']), /Files retained/)
 const [id] = fs.readdirSync(f.scratch)
 assert.equal((await f.main(['status', id])).status, 'incomplete')
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, 1)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'psql').length, 1)
 assert.equal((await f.main(['stop', id])).status, 'stopped')
 assert.ok(fs.existsSync(path.join(f.scratch, id, 'data/PG_VERSION')))
 f.longSocket = true
 const initialized = f.calls.filter(call => path.basename(call.file) === 'initdb').length
 await assert.rejects(f.main(['start']), /Files retained/)
 assert.equal(f.calls.filter(call => path.basename(call.file) === 'initdb').length, initialized)
})
