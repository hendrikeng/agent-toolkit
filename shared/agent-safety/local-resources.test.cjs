const test = require('node:test')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { prepareResources, verifyResource, operateResource, validateResources, resourceEnvironment } = require('./local-resources.cjs')
const base = { id: 'cache', type: 'storage', image: `redis:7@sha256:${'a'.repeat(64)}`, purpose: 'synthetic fixtures', memoryMiB: 64, storageMiB: 64, lifetimeSeconds: 600, reset: 'database:0' }
function fixture(declaration = base) {
 const root = fs.mkdtempSync(path.join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT, 'resource-contract-'))
 const containers = new Map(), calls = [], saves = []
 let sequence = 0, loseCreate = false, unavailable = false
 const runtime = {
  engine: () => { if (unavailable) throw Error('unavailable'); return 'owned-engine' },
  list: () => [...containers.keys()], inspect: id => containers.get(id),
  create(args) {
   calls.push(['create', args]); assert.ok(saves.length, 'intent must precede creation')
   const value = key => args[args.indexOf(key) + 1]
   const labels = Object.fromEntries(args.flatMap((word, index) => word === '--label' ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : []))
   const id = String(++sequence).padStart(64, '0')
   const tmpfs = Object.fromEntries(args.flatMap((arg, index) => arg === '--tmpfs' ? [args[index + 1].split(':')] : []))
   const mounts = args.flatMap((arg, index) => {
    if (arg !== '--mount') return []
    const parts = Object.fromEntries(args[index + 1].split(',').map(field => field.split('=')))
    return [{ Type: parts.type, Source: parts.src, Destination: parts.dst, RW: false }]
   })
   containers.set(id, { Id: id, Config: { Labels: labels, Image: declaration.image, Entrypoint: [value('--entrypoint')], Cmd: args.slice(args.indexOf(declaration.image) + 1) }, HostConfig: { Privileged: false, ReadonlyRootfs: true, Memory: declaration.memoryMiB * 1024 * 1024, MemorySwap: declaration.memoryMiB * 1024 * 1024, LogConfig: { Type: 'none' }, Tmpfs: tmpfs, PidsLimit: 128, IpcMode: 'private', ShmSize: 16 * 1024 * 1024, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: value('--network') }, Mounts: mounts, NetworkSettings: { Ports: { [declaration.type === 'postgres' ? '5432/tcp' : '6379/tcp']: [{ HostIp: '127.0.0.1', HostPort: '45678' }] } }, State: { Running: false } })
   if (loseCreate) { loseCreate = false; throw Error('lost response') }
   return id
  },
  start(id) { calls.push(['start', id]); containers.get(id).State.Running = true },
  stop(id) { calls.push(['stop', id]); containers.get(id).State.Running = false },
  exec(id, args, input) { calls.push(['exec', id, args, input]); return args.at(-1) === 'PING' ? 'PONG' : args.at(-2) === 'INFO' ? 'redis_version:7.4.0\n' : args.at(-1)?.includes('server_version_num') ? '17' : 'OK' },
 }
 const state = {}
 const prepare = () => prepareResources('scope', [declaration], state, () => saves.push(JSON.stringify(state)), root, path.join(root, 'evidence'), runtime)
 return { root, containers, state, saves, calls, runtime, prepare, lose() { loseCreate = true }, unavailable(value) { unavailable = value } }
}
test('one resource scope covers creation, interrupted response, resets and verified shutdown', () => {
 const f = fixture(); f.lose()
 assert.throws(f.prepare, /lost response/)
 f.prepare()
 const record = f.state.cache
 assert.equal(f.calls.filter(call => call[0] === 'create').length, 1)
 assert.equal(record.ready, true)
 assert.ok(!f.saves.join('').includes('POSTGRES_PASSWORD'))
 operateResource(record, 'reset', f.runtime)
 assert.equal(f.calls.at(-1)[2].at(-1), 'FLUSHDB')
 assert.throws(() => operateResource(record, 'delete', f.runtime), /No enclosing-resource deletion/)
 record.declaration = { ...record.declaration, reset: undefined }
 assert.throws(() => operateResource(record, 'reset', f.runtime))
 record.declaration = base
 assert.ok(resourceEnvironment(f.state, f.runtime).RESOURCE_CACHE_URL)
 operateResource(record, 'stop', f.runtime)
 assert.deepEqual(resourceEnvironment(f.state, f.runtime), {})
 assert.equal(f.containers.size, 1)
 f.prepare()
 assert.ok(resourceEnvironment(f.state, f.runtime).RESOURCE_CACHE_URL)
 console.log(`Retained bounded-resource fixture: ${f.root}`)
})
test('authoritative loss permits linked replacement; uncertain state and identity changes do not', () => {
 const f = fixture(); f.prepare()
 const first = f.state.cache.id
 f.unavailable(true)
 assert.throws(f.prepare, /unavailable/)
 assert.equal(f.state.cache.id, first)
 f.unavailable(false)
 f.containers.delete(first) // Dry-runtime simulation only; no real resource deletion.
 f.prepare()
 assert.notEqual(f.state.cache.id, first)
 assert.equal(f.state.cache.previous[0].id, first)
 assert.equal(f.state.cache.previous[0].loss.engine, 'owned-engine')
 const actual = f.containers.get(f.state.cache.id)
 actual.NetworkSettings.Ports['6379/tcp'][0].HostIp = '0.0.0.0'
 assert.throws(() => verifyResource(f.state.cache, f.runtime), /Public/)
 actual.NetworkSettings.Ports['6379/tcp'][0].HostIp = '127.0.0.1'
 actual.Config.Labels['agent-toolkit.token'] = 'foreign'
 assert.throws(() => operateResource(f.state.cache, 'stop', f.runtime))
})
test('PostgreSQL initialization retries the same identity and grants schema ownership, not database deletion', () => {
 const declaration = { ...base, id: 'db', type: 'postgres', image: `postgres:17@sha256:${'a'.repeat(64)}`, memoryMiB: 256, storageMiB: 128, reset: 'schema:public' }
 const f = fixture(declaration), original = f.runtime.exec
 let interrupt = true
 f.runtime.exec = (id, args, input) => { if (args[0] === 'pg_isready' && interrupt) { interrupt = false; throw Error('not ready yet') }; return original(id, args, input) }
 assert.throws(f.prepare, /not ready/)
 const identity = f.state.db.id
 f.prepare()
 assert.equal(f.state.db.id, identity)
 assert.equal(f.calls.filter(call => call[0] === 'create').length, 1)
 const sql = f.calls.find(call => typeof call[3] === 'string')[3]
 assert.ok(sql.includes('CREATE DATABASE toolkit_test OWNER bootstrap'))
 assert.ok(sql.includes('ALTER SCHEMA public OWNER TO toolkit_test'))
 assert.ok(sql.includes('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'))
 assert.ok(sql.includes('ALTER ROLE bootstrap NOLOGIN'))
 operateResource(f.state.db, 'reset', f.runtime)
 assert.equal(f.calls.at(-1)[3], 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n')
 assert.ok(f.calls.at(-1)[2].includes('/var/run/postgresql'))
 operateResource(f.state.db, 'stop', f.runtime)
 let initialized = false
 f.runtime.exec = (id, args, input) => {
  if (input?.includes('CREATE ROLE toolkit_test')) initialized = true
  if (args.at(-1)?.includes('server_version_num')) assert.ok(initialized, 'restart must initialize the empty tmpfs before readiness')
  return original(id, args, input)
 }
 const start = f.runtime.start
 f.runtime.start = id => { start(id); throw Error('lost start response') }
 assert.throws(f.prepare, /lost start response/)
 assert.equal(f.state.db.ready, false)
 assert.equal(JSON.parse(f.saves.at(-1)).db.ready, false, 'restart intent survives a lost response')
 f.runtime.start = start
 f.prepare()
 assert.equal(f.state.db.id, identity)
 assert.equal(f.state.db.ready, true)
 assert.equal(f.calls.filter(call => call[0] === 'create').length, 1)
})

test('storage clients cannot administer the service or reset other databases', () => {
 const f = fixture(); f.prepare()
 const args = f.containers.get(f.state.cache.id).Config.Cmd
 for (const operation of ['FLUSHALL', 'SHUTDOWN', 'CONFIG', 'ACL', 'MODULE', 'MIGRATE']) {
  const index = args.indexOf(operation)
  assert.equal(args[index - 1], '--rename-command'); assert.equal(args[index + 1], '')
 }
 assert.equal(args[args.indexOf('--databases') + 1], '1')
 assert.equal(args.includes('FLUSHDB'), false, 'only the declared database reset remains available')
 const other = fixture({ ...base, reset: undefined }); other.prepare()
 assert.ok(other.containers.get(other.state.cache.id).Config.Cmd.includes('FLUSHDB'))
})

test('restart and replacement preserve the absolute deadline and expired wrappers start no service', t => {
 let now = 1700000000000
 t.mock.method(Date, 'now', () => now)
 const f = fixture(); f.prepare()
 const createdAt = f.state.cache.createdAt, first = f.state.cache.id
 const initial = [...f.containers.get(first).Config.Cmd]
 const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin)
 fs.writeFileSync(path.join(bin, 'date'), '#!/bin/sh\nprintf "%s\\n" "$TEST_NOW"\n', { mode: 0o700 })
 fs.writeFileSync(path.join(bin, 'timeout'), '#!/bin/sh\n[ "$1" = -s ] && [ "$2" = KILL ] || exit 99\nprintf "%s\\n" "$3"\n', { mode: 0o700 })
 const runWrapper = () => spawnSync('/bin/sh', f.containers.get(f.state.cache.id).Config.Cmd, { env: { PATH: bin, TEST_NOW: String(now / 1000) }, encoding: 'utf8' })
 assert.equal(runWrapper().stdout.trim(), '599')
 now += 590000
 operateResource(f.state.cache, 'stop', f.runtime); f.prepare()
 assert.deepEqual(f.containers.get(first).Config.Cmd, initial)
 assert.equal(runWrapper().stdout.trim(), '9', 'restart receives only the remaining time')
 f.containers.delete(first) // Authoritative loss in the dry runtime only.
 f.prepare()
 assert.notEqual(f.state.cache.id, first)
 assert.equal(f.state.cache.createdAt, createdAt)
 assert.equal(f.containers.get(f.state.cache.id).Config.Cmd[3], initial[3])
 assert.equal(runWrapper().stdout.trim(), '9', 'replacement cannot renew the deadline')
 now += 10000
 const calls = f.calls.length
 assert.throws(f.prepare, /lifetime/)
 assert.equal(f.calls.length, calls)
 const expired = runWrapper()
 assert.equal(expired.status, 124)
 assert.equal(expired.stdout, '', 'expired wrapper never reaches timeout or the service')
 assert.deepEqual(resourceEnvironment(f.state, f.runtime), {}, 'expired credentials are not exposed')
 operateResource(f.state.cache, 'stop', f.runtime)
})

test('declarations reject mutable images, broad resets, scan escapes, downloads and oversized scope', () => {
 for (const change of [{ image: 'redis:latest' }, { reset: 'database:all' }, { storageMiB: 100000 }, { downloads: ['https://example.com'] }, { type: 'scanner', image: `clamav/clamav:1.4@sha256:${'a'.repeat(64)}`, targets: ['../source'] }]) assert.throws(() => validateResources([{ ...base, ...change }]))
 assert.throws(() => validateResources([base, base]), /unique/)
})
