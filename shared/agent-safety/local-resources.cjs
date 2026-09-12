// Bounded Docker test resources. No enclosing-resource deletion or host administration.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { physicalPath, within, developmentRoots, assertDevelopmentPath } = require('./development-policy.cjs')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const types = {
 postgres: { image: /^postgres:17(?:\.[0-9]+)?@sha256:[a-f0-9]{64}$/, port: 5432, reset: 'schema:public', command: [] },
 storage: { image: /^redis:7(?:\.[0-9]+)*@sha256:[a-f0-9]{64}$/, port: 6379, reset: 'database:0', command: ['redis-server', '--save', '', '--appendonly', 'no', '--databases', '1'] },
 scanner: { image: /^clamav\/clamav:1\.[0-9]+(?:\.[0-9]+)?@sha256:[a-f0-9]{64}$/, reset: undefined, command: ['infinity'] },
}
function validateResources(declarations = []) {
 assert.ok(Array.isArray(declarations) && declarations.length <= 4, 'At most four declared resources are supported')
 const ids = new Set()
 for (const item of declarations) {
  assert.ok(item && typeof item === 'object' && !Array.isArray(item), 'Resource declarations must be objects')
  assert.ok(Object.keys(item).every(key => ['id', 'type', 'image', 'purpose', 'memoryMiB', 'storageMiB', 'lifetimeSeconds', 'reset', 'targets', 'database', 'downloads'].includes(key)), 'Unknown resource scope field')
  assert.ok(/^[a-z][a-z0-9-]{0,30}$/.test(item.id) && !ids.has(item.id), 'Resource IDs must be unique')
  ids.add(item.id)
  const type = types[item.type]
  assert.ok(type && type.image.test(item.image), 'Use a supported version and immutable image digest')
  assert.ok(typeof item.purpose === 'string' && item.purpose.trim(), 'Resource purpose is required')
  for (const [key, max] of [['memoryMiB', 2048], ['storageMiB', 1024], ['lifetimeSeconds', 86400]]) assert.ok(Number.isInteger(item[key]) && item[key] >= 64 && item[key] <= max, `Invalid resource limit: ${key}`)
  if (item.type === 'postgres') assert.ok(item.memoryMiB >= 256 && item.storageMiB >= 128, 'PostgreSQL setup requires at least 256 MiB memory and 128 MiB storage')
  assert.ok(item.reset === undefined || item.reset === type.reset, 'Fixture resets cannot delete enclosing resources')
  assert.ok(Array.isArray(item.downloads ?? []) && (item.downloads ?? []).every(image => image === item.image), 'Only the declared immutable image download is supported')
  if (item.type === 'scanner') {
   assert.ok(Array.isArray(item.targets) && item.targets.length > 0 && item.targets.length <= 16, 'Scanner targets are required')
   assert.ok(typeof item.database === 'string' && item.database.length > 0, 'Declare a workspace-relative scanner signature database')
   for (const target of [...item.targets, item.database]) assert.ok(typeof target === 'string' && !path.isAbsolute(target) && target.split('/').every(part => part && part !== '..' && part !== '.' && !part.startsWith('.') && !/[\x00-\x1f,:]/.test(part) && !/(?:\.(?:pem|key)$|credentials|^auth\.json$)/i.test(part)), 'Use literal workspace-relative scanner targets without protected credentials')
  } else assert.ok(!item.targets?.length, 'Only scanners accept scan targets')
 }
}
function credential(file) {
 const stat = fs.lstatSync(file)
 assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && !(stat.mode & 0o077) && physicalPath(file) === file, 'Credential file identity or permissions changed')
 const secret = JSON.parse(fs.readFileSync(file, 'utf8')).password
 assert.ok(typeof secret === 'string' && /^[a-f0-9]{48}$/.test(secret), 'Invalid synthetic credential; preserve evidence')
 return secret
}
// Fixed script, never caller-supplied shell. Round down and reserve one second
// because date reports whole seconds. Expired containers never start the service.
const DEADLINE_SCRIPT = 'now=$(date +%s) || exit 125; remaining=$(($1 - now - 1)); shift; [ "$remaining" -gt 0 ] || exit 124; exec timeout -s KILL "$remaining" "$@"'
function resourceCommand(declaration, secret, createdAt) {
 const disabled = ['FLUSHALL', 'SHUTDOWN', 'CONFIG', 'ACL', 'MODULE', 'DEBUG', 'REPLICAOF', 'SLAVEOF', 'MIGRATE', 'CLUSTER', 'SWAPDB', 'SAVE', 'BGSAVE', ...(declaration.reset ? [] : ['FLUSHDB'])]
 const command = declaration.type === 'postgres' ? ['/usr/local/bin/docker-entrypoint.sh', 'postgres'] : declaration.type === 'scanner' ? ['/bin/sleep', 'infinity'] : [...types.storage.command, '--requirepass', secret, ...disabled.flatMap(name => ['--rename-command', name, ''])]
 return ['-c', DEADLINE_SCRIPT, 'resource-deadline', String(Math.floor(createdAt / 1000) + declaration.lifetimeSeconds), ...command]
}
function privateTmpfs(declaration) {
 return { '/tmp': 'rw,size=16m', ...(declaration.type === 'postgres' ? { '/var/lib/postgresql/data': `rw,size=${declaration.storageMiB - 48}m,uid=999,gid=999`, '/var/run/postgresql': 'rw,size=16m,uid=999,gid=999' } : declaration.type === 'storage' ? { '/data': `rw,size=${declaration.storageMiB - 32}m,uid=999,gid=999` } : { '/var/lib/clamav': `rw,size=${declaration.storageMiB - 32}m` }) }
}
function dockerRuntime(binary = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/usr/bin/docker'].find(file => fs.existsSync(file))) {
 assert.ok(['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/usr/bin/docker'].includes(binary), 'Unsupported local runtime')
 const config = path.join(fs.realpathSync(os.tmpdir()), `agent-toolkit-docker-${process.pid}`)
 fs.mkdirSync(config, { recursive: true, mode: 0o700 })
 assert.equal(physicalPath(config), config, 'Docker configuration directory identity changed')
 const file = path.join(config, 'config.json')
 try { fs.writeFileSync(file, '{}\n', { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
 assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink())
 assert.equal(fs.readFileSync(file, 'utf8'), '{}\n', 'Only credential-free local runtime configuration is supported')
 const run = (args, input) => {
  try { return execFileSync(binary, ['--host', 'unix:///var/run/docker.sock', ...args], { input, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, DOCKER_CONFIG: config } }).trim() }
  catch { throw new Error('Local resource runtime failed; ownership/loss is uncertain. Preserve records and inspect the local Docker runtime.') }
 }
 return {
  engine: () => run(['info', '--format', '{{.ID}}']),
  list: () => run(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}']).split('\n').filter(Boolean),
  inspect: id => JSON.parse(run(['container', 'inspect', id]))[0],
  create: args => run(['container', 'create', ...args]),
  pull: image => run(['image', 'pull', image]),
  start: id => run(['container', 'start', id]),
  stop: id => run(['container', 'stop', '--time', '10', id]),
  exec: (id, args, input) => run(['container', 'exec', '-i', id, ...args], input),
 }
}
function prepareResources(scope, declarations, state, persist, workspace, root, runtime) {
 validateResources(declarations)
 assertDevelopmentPath(workspace, developmentRoots(process.env.HOME))
 assert.equal(physicalPath(root), root, 'Resource evidence directory must be physical')
 assert.equal(physicalPath(workspace), workspace, 'Resource workspace must be physical')
 assert.ok(!/[\x00-\x1f,]/.test(workspace), 'Unsupported runtime mount path')
 fs.mkdirSync(root, { recursive: true, mode: 0o700 })
 const engine = runtime.engine()
 assert.ok(engine && typeof engine === 'string', 'Runtime identity missing')
 for (const declaration of declarations) {
  let record = Object.hasOwn(state, declaration.id) ? state[declaration.id] : undefined
  if (!record) {
   record = state[declaration.id] = { scope, declaration, engine, token: randomUUID(), createdAt: Date.now(), previous: [] }
   persist() // Durable reservation before any runtime operation.
  }
  assert.ok(/^[a-f0-9-]{36}$/.test(record.token) && Number.isFinite(record.createdAt) && Array.isArray(record.previous), 'Resource receipt is invalid; preserve it')
  assert.ok(Date.now() < record.createdAt + declaration.lifetimeSeconds * 1000, 'Resource lifetime exceeded; only verified shutdown remains authorized')
  assert.equal(record.engine, engine, 'Runtime identity changed')
  assert.equal(record.scope, scope)
  assert.equal(hash(record.declaration), hash(declaration), 'Resource scope changed; approve only the expanded declaration first')
  const ids = runtime.list() // Successful complete inventory is authoritative; connection failure never means loss.
  const found = ids.map(id => runtime.inspect(id)).filter(item => item.Config?.Labels?.['agent-toolkit.token'] === record.token)
  assert.ok(found.length <= 1, 'Duplicate resource ownership; preserve both')
  if (record.id && !ids.includes(record.id)) {
   assert.equal(found.length, 0, 'A different resource carries the old ownership token')
   record.previous.push({ id: record.id, token: record.token, loss: { engine, inventoryHash: hash(ids), observedAt: Date.now() } })
   record.id = undefined; record.token = randomUUID(); record.ready = false; record.configHash = undefined; record.port = undefined
   persist() // Retain old identity, authoritative loss and new creation intent.
  }
  if (!record.id && found.length) {
   assert.ok(record.recipeHash, 'No recorded creation intent for this resource')
   record.id = found[0].Id
  }
  const credentials = path.join(root, `${record.token}.credentials.json`)
  if (!fs.existsSync(credentials)) {
   assert.ok(!record.id, 'Missing credentials are not evidence of resource loss')
   fs.writeFileSync(credentials, JSON.stringify({ password: randomBytes(24).toString('hex') }), { flag: 'wx', mode: 0o600 })
  }
  assert.ok(fs.lstatSync(credentials).isFile() && !fs.lstatSync(credentials).isSymbolicLink() && !(fs.statSync(credentials).mode & 0o077))
  record.credentials = credentials
  const secret = credential(credentials)
  if (!record.id) {
   const type = types[declaration.type]
   if (declaration.downloads?.includes(declaration.image)) runtime.pull(declaration.image)
   const args = ['--entrypoint', '/bin/sh', '--name', `toolkit-${record.token}`, '--label', `agent-toolkit.scope=${scope}`, '--label', `agent-toolkit.token=${record.token}`, '--label', `agent-toolkit.contract=${hash(declaration)}`, '--read-only', '--ipc', 'private', '--shm-size', '16m', '--memory', `${declaration.memoryMiB}m`, '--memory-swap', `${declaration.memoryMiB}m`, '--log-driver', 'none', '--pids-limit', '128', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--network', declaration.type === 'scanner' ? 'none' : 'bridge']
   if (type.port) args.push('--publish', `127.0.0.1::${type.port}`)
   for (const [destination, options] of Object.entries(privateTmpfs(declaration))) args.push('--tmpfs', `${destination}:${options}`)
   if (declaration.type === 'postgres') args.push('--user', '999:999', '-e', `POSTGRES_PASSWORD=${secret}`, '-e', 'POSTGRES_USER=bootstrap')
   if (declaration.type === 'storage') args.push('--user', '999:999')
   if (declaration.type === 'scanner') {
    const database = physicalPath(`${workspace}/${declaration.database}`)
    assert.equal(database, `${workspace}/${declaration.database}`, 'Scanner database path escaped its workspace')
    args.push('--mount', `type=bind,src=${database},dst=/database,readonly`)
   }
   record.workspace = workspace
   if (declaration.type === 'scanner') for (const [index, local] of declaration.targets.entries()) {
    const target = physicalPath(`${workspace}/${local}`)
    assert.ok(within(target, [workspace]) && target === `${workspace}/${local}`, 'Scanner target escaped its approved workspace')
    args.push('--mount', `type=bind,src=${target},dst=/scan/${index},readonly`)
   }
   record.recipeHash = hash(args); persist()
   record.id = runtime.create([...args, declaration.image, ...resourceCommand(declaration, secret, record.createdAt)]); persist()
  }
  verifyResource(record, runtime, true, true); persist()
  const details = runtime.inspect(record.id)
  if (!details.State.Running) { record.ready = false; persist(); runtime.start(record.id) }
  verifyResource(record, runtime, false, true); persist()
  if (!record.ready && declaration.type === 'postgres') {
   // Only the new isolated server has bootstrap authority. Test clients receive a
   // non-superuser role, never bootstrap credentials or host administration.
   // The entrypoint's temporary bootstrap server has no TCP listener. Do not
   // disable its login while the image is still initializing its own databases.
   runtime.exec(record.id, ['pg_isready', '-h', '127.0.0.1', '-p', '5432'])
   let bootstrapped = false
   try { bootstrapped = runtime.exec(record.id, ['psql', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'toolkit_test', '-d', 'toolkit_test', '-Atc', "SELECT 'ready' FROM pg_roles WHERE rolname='bootstrap' AND NOT rolcanlogin"]) === 'ready' } catch {}
   if (!bootstrapped) runtime.exec(record.id, ['psql', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'bootstrap', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='toolkit_test') THEN CREATE ROLE toolkit_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'; END IF; END $$;\nSELECT 'CREATE DATABASE toolkit_test OWNER bootstrap' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='toolkit_test')\\gexec\nREVOKE ALL ON DATABASE toolkit_test FROM PUBLIC; GRANT CONNECT, CREATE, TEMPORARY ON DATABASE toolkit_test TO toolkit_test;\n\\connect toolkit_test\nALTER SCHEMA public OWNER TO toolkit_test;\nALTER ROLE bootstrap NOLOGIN;\n`)
  }
  if (declaration.type === 'postgres') assert.equal(runtime.exec(record.id, ['psql', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'toolkit_test', '-d', 'toolkit_test', '-Atc', "SELECT current_setting('server_version_num')::integer / 10000"]), '17', 'PostgreSQL version differs from the declared class')
  if (declaration.type === 'storage') {
   const client = ['redis-cli', '-h', '127.0.0.1', '-p', '6379', '--no-auth-warning', '-a', secret]
   assert.equal(runtime.exec(record.id, [...client, 'PING']), 'PONG', 'Owned storage process is not ready; retry the same scope')
   assert.match(runtime.exec(record.id, [...client, 'INFO', 'server']), /^redis_version:7\./m, 'Storage version differs from the declared class')
  }
  if (declaration.type === 'scanner') {
   const required = declaration.image.split(':')[1].split('@')[0]
   const version = runtime.exec(record.id, ['clamscan', '--version']).match(/^ClamAV ([0-9.]+)/)?.[1]
   assert.ok(version === required || version?.startsWith(required + '.'), 'Scanner version differs from its declaration')
  }
  record.ready = true; record.stopped = false; persist()
 }
 return state
}
function verifyResource(record, runtime, enforceLifetime = true, recordEndpoint = false) {
 assert.equal(runtime.engine(), record.engine, 'Resource runtime identity mismatch')
 assert.ok(/^[a-f0-9]{64}$/.test(record.id) && runtime.list().includes(record.id), 'Resource absent or unverified; use recorded reconciliation, not name adoption')
 const item = runtime.inspect(record.id)
 assert.equal(item.Id, record.id)
 assert.equal(item.Config.Labels['agent-toolkit.scope'], record.scope)
 assert.equal(item.Config.Labels['agent-toolkit.token'], record.token)
 assert.equal(item.Config.Labels['agent-toolkit.contract'], hash(record.declaration))
 assert.equal(item.Config.Image, record.declaration.image)
 assert.equal(item.HostConfig.Privileged, false)
 assert.equal(item.HostConfig.ReadonlyRootfs, true)
 assert.equal(item.HostConfig.Memory, record.declaration.memoryMiB * 1024 * 1024)
 assert.equal(item.HostConfig.PidsLimit, 128)
 assert.equal(item.HostConfig.IpcMode, 'private')
 assert.equal(item.HostConfig.ShmSize, 16 * 1024 * 1024)
 assert.equal(item.HostConfig.MemorySwap, record.declaration.memoryMiB * 1024 * 1024)
 assert.equal(item.HostConfig.LogConfig.Type, 'none')
 assert.deepEqual(item.HostConfig.Tmpfs, privateTmpfs(record.declaration))
 assert.deepEqual(item.Config.Entrypoint, ['/bin/sh'])
 const secret = credential(record.credentials)
 assert.ok(JSON.stringify(item.Config.Cmd) === JSON.stringify(resourceCommand(record.declaration, secret, record.createdAt)), 'Resource command changed')
 assert.deepEqual(item.HostConfig.CapDrop, ['ALL'])
 assert.ok(item.HostConfig.SecurityOpt.includes('no-new-privileges'))
 assert.equal(item.HostConfig.NetworkMode, record.declaration.type === 'scanner' ? 'none' : 'bridge')
 assert.ok((item.Mounts ?? []).every(mount => mount.Type === 'tmpfs' || record.declaration.type === 'scanner' && mount.Type === 'bind' && mount.RW === false && (/^\/scan\/\d+$/.test(mount.Destination) || mount.Destination === '/database')), 'Unapproved resource mount')
 for (const endpoints of Object.values(item.NetworkSettings.Ports ?? {})) for (const endpoint of endpoints ?? []) assert.equal(endpoint.HostIp, '127.0.0.1', 'Public resource exposure is forbidden')
 const published = Object.entries(item.NetworkSettings.Ports ?? {}).filter(([, endpoints]) => endpoints?.length)
 const port = types[record.declaration.type].port
 if (item.State.Running) {
  assert.equal(published.length, port ? 1 : 0, 'Unexpected published resource port')
  if (port) {
   assert.equal(published[0][0], `${port}/tcp`)
   assert.equal(published[0][1].length, 1)
   const actualPort = published[0][1][0].HostPort
   assert.ok(/^[0-9]+$/.test(actualPort) && Number(actualPort) > 0 && Number(actualPort) <= 65535, 'Invalid loopback port')
   if (record.port && record.port !== actualPort) {
    assert.ok(recordEndpoint, 'Recorded endpoint changed; resume the resource scope before use')
    record.previousPorts ??= []; record.previousPorts.push(record.port)
   }
   record.port = actualPort
  }
 }
 const host = structuredClone(item.HostConfig)
 for (const endpoints of Object.values(host.PortBindings ?? {})) for (const endpoint of endpoints ?? []) endpoint.HostPort = '<allocated>'
 const actual = hash({ config: item.Config, host, mounts: item.Mounts.filter(mount => mount.Type === 'bind').map(({ Type, Source, Destination, RW }) => ({ Type, Source, Destination, RW })) })
 if (record.configHash) assert.equal(actual, record.configHash, 'Resource configuration changed')
 else record.configHash = actual
 if (enforceLifetime) assert.ok(Date.now() < record.createdAt + record.declaration.lifetimeSeconds * 1000, 'Resource lifetime exceeded; only verified shutdown remains authorized')
 if (record.declaration.type === 'scanner') {
  for (const mount of item.Mounts.filter(mount => mount.Type === 'bind')) {
   const local = mount.Destination === '/database' ? record.declaration.database : record.declaration.targets[Number(mount.Destination.split('/').at(-1))]
   const expected = `${record.workspace}/${local}`
   assert.equal(mount.Source, expected, 'Unapproved scanner source')
   assert.equal(physicalPath(expected), expected, 'Scanner source now escapes its approved path')
  }
 }
 return item
}
function operateResource(record, operation, runtime) {
 verifyResource(record, runtime, operation !== 'stop')
 if (operation === 'stop') {
  const result = runtime.stop(record.id)
  record.stopped = true; record.ready = false
  return result
 }
 if (operation === 'scan') {
  assert.equal(record.declaration.type, 'scanner')
  return runtime.exec(record.id, ['clamscan', '--recursive', '--database=/database', '--follow-dir-symlinks=0', '--follow-file-symlinks=0', '--exclude-dir=/\\.', '--exclude=(^|/)(\\.env([^/]*$)|[^/]*\\.(pem|key)$|[^/]*credentials[^/]*$|auth\\.json$)', '--', ...record.declaration.targets.map((_, index) => `/scan/${index}`)])
 }
 assert.equal(operation, 'reset', 'No enclosing-resource deletion operation exists')
 const type = types[record.declaration.type]
 assert.ok(type.reset && record.declaration.reset === type.reset, 'Fixture reset was not approved')
 if (record.declaration.type === 'storage') {
  const secret = credential(record.credentials)
  return runtime.exec(record.id, ['redis-cli', '-h', '127.0.0.1', '-p', '6379', '--no-auth-warning', '-a', secret, '-n', '0', 'FLUSHDB'])
 }
 return runtime.exec(record.id, ['psql', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'toolkit_test', '-d', 'toolkit_test', '-v', 'ON_ERROR_STOP=1'], 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n')
}
function resourceEnvironment(state, runtime) {
 const env = {}
 for (const record of Object.values(state)) {
  if (record.stopped || Date.now() >= record.createdAt + record.declaration.lifetimeSeconds * 1000) continue
  const details = verifyResource(record, runtime)
  assert.ok(record.ready && details.State.Running, 'Resource is not ready')
  const port = types[record.declaration.type].port
  if (!port) continue
  const endpoints = details.NetworkSettings.Ports[`${port}/tcp`]
  assert.equal(endpoints.length, 1)
  const target = `127.0.0.1:${endpoints[0].HostPort}`
  if (record.declaration.type === 'postgres') {
   const file = record.credentials
   assert.ok(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() && !(fs.statSync(file).mode & 0o077))
   const secret = credential(file)
   env[`RESOURCE_${record.declaration.id.replaceAll('-', '_').toUpperCase()}_URL`] = `postgresql://toolkit_test:${secret}@${target}/toolkit_test`
  } else {
   const secret = credential(record.credentials)
   env[`RESOURCE_${record.declaration.id.replaceAll('-', '_').toUpperCase()}_URL`] = `redis://:${secret}@${target}/0`
  }
 }
 return env
}
const RESOURCE_RUNTIME = { engine: 'Local Docker Unix socket; no remote contexts or host installation', configuration: 'Private credential-free Docker configuration in the system temporary directory', storage: 'Bounded tmpfs only; no persistent or shared volumes; temporary evidence only', privileges: 'No host privilege escalation; all container capabilities dropped; non-root database and storage processes', pidsPerResource: 128, network: 'Loopback published data ports; scanner networking disabled', lifetime: 'Fixed absolute deadline across restarts and replacements; timeout uses SIGKILL; containers and evidence remain retained', downloads: 'Only explicitly declared immutable images', deletion: 'Not authorized' }
module.exports = { RESOURCE_RUNTIME, validateResources, dockerRuntime, prepareResources, verifyResource, operateResource, resourceEnvironment }
