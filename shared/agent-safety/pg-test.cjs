#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const process = require('node:process')
const { randomBytes } = require('node:crypto')
const { execFileSync } = require('node:child_process')

function directory(value) {
 const absolute = path.resolve(value)
 if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isDirectory()) throw Error('Database paths must be physical directories without symlinks.')
 return absolute
}
function fixtureRoot() {
 const root = path.join(os.userInfo().homedir, 'Code/.agent-toolkit-scratch/agent-toolkit-fixtures')
 fs.mkdirSync(root, { recursive: true, mode: 0o700 })
 directory(root)
 fs.chmodSync(root, 0o700)
 return root
}
function fixtureRoots(primary) {
 const roots = [primary]
 const add = value => {
  try { roots.push(path.join(fs.realpathSync(value), 'agent-toolkit-fixtures')) } catch {}
 }
 add(os.tmpdir())
 if (os.platform() === 'darwin') {
  try { add(execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8', timeout: 5000 }).trim()) } catch {}
 }
 try {
  const temporary = fs.realpathSync('/tmp')
  for (const name of fs.readdirSync(temporary).filter(name => /^claude-[A-Za-z0-9._-]+$/.test(name))) {
   const candidate = path.join(temporary, name)
   try {
    if (fs.realpathSync(candidate) === candidate && fs.lstatSync(candidate).isDirectory()) roots.push(path.join(candidate, 'agent-toolkit-fixtures'))
   } catch {}
  }
 } catch {}
 return [...new Set(roots)]
}
function fixturePath(candidates, id) {
 const matches = []
 for (const fixtures of candidates) {
  const root = path.join(fixtures, id)
  if (fs.existsSync(root)) matches.push(directory(root))
 }
 if (matches.length !== 1) throw Error(matches.length ? 'Fixture ID is ambiguous across fixture roots.' : 'Fixture ID does not exist.')
 return matches[0]
}
function binaries(major) {
 const candidates = [`/opt/homebrew/opt/postgresql@${major}/bin`, `/usr/local/opt/postgresql@${major}/bin`].filter(fs.existsSync)
 if (candidates.length !== 1) throw Error(`Expected exactly one existing Homebrew PostgreSQL ${major} installation. This helper never installs or upgrades it.`)
 const bin = fs.realpathSync(candidates[0])
 const prefix = candidates[0].split(`/opt/postgresql@${major}/`)[0]
 if (!bin.startsWith(`${prefix}/Cellar/postgresql@${major}/`) || !bin.endsWith('/bin')) throw Error('PostgreSQL installation resolves outside its Homebrew formula.')
 for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql']) {
  const file = path.join(bin, name)
  if (fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) throw Error(`Expected regular PostgreSQL ${major} executables.`)
 }
 return bin
}
function environment(root) {
 // Do not inherit PG*, loader overrides, shell startup files, or credential locations.
 return { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
}
function run(bin, name, args, root, input) {
 return execFileSync(path.join(bin, name), args, { cwd: root, env: environment(root), input, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function file(root, name) {
 const target = path.join(root, name)
 if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) throw Error('Database records must be regular files.')
 return target
}
function save(root, state) {
 const temporary = path.join(root, `state-${randomBytes(8).toString('hex')}.json`)
 fs.writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
 fs.renameSync(temporary, path.join(root, 'pg-test.json'))
}
function ps(root, pid, field) {
 try {
  return execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', `${field}=`], { encoding: 'utf8', timeout: 5000, env: environment(root) }).trim()
 } catch (error) {
  if (error.code === 'EPERM') throw Error('The sandbox blocked /bin/ps. Run pg-test as a command on its own, not inside a script, pipeline, && chain, or $(...).')
  throw error
 }
}
function identity(root, state, major) {
 if (!fs.existsSync(path.join(root, 'data')) && !state.pid) return false
 const data = directory(path.join(root, 'data'))
 const version = path.join(data, 'PG_VERSION')
 if (!fs.existsSync(version) && !state.pid) return false
 if (fs.readFileSync(file(data, 'PG_VERSION'), 'utf8').trim() !== major) throw Error(`Not a PostgreSQL ${major} test cluster.`)
 const pidFile = path.join(data, 'postmaster.pid')
 if (!fs.existsSync(pidFile)) return false
 let lines
 try {
  lines = fs.readFileSync(file(data, 'postmaster.pid'), 'utf8').split('\n')
 } catch (error) {
  if (error.code === 'ENOENT') return false
  throw error
 }
 if (!/^\d+$/.test(lines[0]) || lines[1] !== data || !/^\d+$/.test(lines[2]) || lines[3] !== String(state.port)) throw Error('Postmaster identity does not match this test cluster.')
 const pid = Number(lines[0])
 if (pid <= 1 || state.pid && (state.pid !== pid || state.started !== lines[2])) throw Error('Postmaster identity changed; preserve the cluster for inspection.')
 let command
 try {
  command = ps(root, pid, 'command')
 } catch (error) {
  if (error.status === 1) return false
  throw error
 }
 if (command !== `${state.bin}/postgres -D ${data}`) throw Error('Refusing to control a process outside this test cluster.')
 return { pid, started: lines[2] }
}
function processStarted(root, pid) {
 try {
  return ps(root, pid, 'lstart') || undefined
 } catch (error) {
  if (error.status === 1) return undefined
  throw error
 }
}
function sessionOwner(root) {
 const session = process.env.AGENT_TOOLKIT_SESSION_ID
 const pidText = process.env.AGENT_TOOLKIT_SESSION_PID
 if (!session && !pidText) return undefined
 if (!/^[a-f0-9-]{36}$/.test(session ?? '') || !/^\d+$/.test(pidText ?? '')) throw Error('Invalid managed agent session identity.')
 const pid = Number(pidText)
 const started = processStarted(root, pid)
 if (!started) throw Error('Managed agent session is no longer running.')
 return { session, pid, started }
}
function validState(state, major) {
 const owner = state.owner
 return state.version === 1 && state.bin === binaries(major) && Number.isInteger(state.port) && state.port >= 1024 && state.port <= 65535 && (state.socket === undefined || typeof state.socket === 'string' && path.isAbsolute(state.socket)) && (owner === undefined || typeof owner === 'object' && (owner.session === undefined || /^[a-f0-9-]{36}$/.test(owner.session)) && Number.isInteger(owner.pid) && owner.pid > 1 && typeof owner.started === 'string' && owner.started.length > 0)
}
function ownerIsRunning(root, owner) {
 return processStarted(root, owner.pid) === owner.started
}
function stop(root, state, major) {
 if (!identity(root, state, major)) return
 let stopError
 try {
  run(state.bin, 'pg_ctl', ['-D', path.join(root, 'data'), '-w', '-t', '30', '-m', 'fast', 'stop'], root)
 } catch (error) {
  stopError = error
 }
 const deadline = Date.now() + 30_000
 while (identity(root, state, major)) {
  if (Date.now() >= deadline) throw stopError ?? Error('PostgreSQL did not stop. Preserve its files.')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
 }
}
function garbageCollect(candidates) {
 const summary = { status: 'complete', checked: 0, stopped: [], deleted: [], preserved: [] }
 const socketRoots = new Set(candidates.map(fixtures => path.resolve(path.dirname(fixtures))))
 for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue
  let fixtures
  try { fixtures = directory(candidate) } catch (error) {
   summary.preserved.push({ path: candidate, error: error.message })
   continue
  }
  let ids
  try { ids = fs.readdirSync(fixtures).filter(name => /^pg(?:17|18)-[A-Za-z0-9]{6}$/.test(name)) } catch (error) {
   summary.preserved.push({ path: fixtures, error: error.message })
   continue
  }
  for (const id of ids) {
   summary.checked += 1
   const candidateRoot = path.join(fixtures, id)
   try {
    const root = directory(candidateRoot)
    const record = path.join(root, 'pg-test.json')
    if (!fs.existsSync(record)) throw Error('Missing test database record.')
    const major = id.slice(2, 4)
    const state = JSON.parse(fs.readFileSync(file(root, 'pg-test.json'), 'utf8'))
    if (!validState(state, major)) throw Error('Invalid or changed test database record.')
    const running = identity(root, state, major)
    if (running) {
     let reclaim = state.owner ? !ownerIsRunning(root, state.owner) : false
     if (!state.owner) {
      if (!/^\d+$/.test(running.started)) throw Error('Postmaster start time is invalid.')
      reclaim = Date.now() - Number(running.started) * 1000 > 2 * 60 * 60 * 1000
     }
     if (reclaim) {
      stop(root, state, major)
      delete state.owner
      save(root, state)
      summary.stopped.push({ id, path: root })
     }
     continue
    }
    if (state.owner) {
     if (ownerIsRunning(root, state.owner)) continue
     delete state.owner
     save(root, state)
     continue
    }
    if (Date.now() - fs.statSync(record).mtimeMs <= 3 * 24 * 60 * 60 * 1000) continue
    const socketName = `agent-pg-${id.slice(5)}`
    const socket = path.resolve(state.socket ?? path.join(path.dirname(fixtures), socketName))
    if (fs.existsSync(socket)) {
     if (path.basename(socket) !== socketName || !socketRoots.has(path.dirname(socket))) throw Error('Socket directory is outside the fixture roots.')
     directory(socket)
     fs.rmSync(socket, { recursive: true })
    }
    fs.rmSync(root, { recursive: true })
    summary.deleted.push({ id, path: root })
   } catch (error) {
    summary.preserved.push({ id, path: candidateRoot, error: error.message })
   }
  }
 }
 return summary
}
function freePort() {
 return new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
   const port = server.address().port
   server.close(error => error ? reject(error) : resolve(port))
  })
 })
}
const quote = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
async function main(args) {
 const [action, id] = args
 const starting = action === 'start' || action === 'start-admin' || action === 'start-migration'
 const watching = action === 'watch-session'
 const collecting = action === 'gc'
 if (!['start', 'start-admin', 'start-migration', 'status', 'stop', 'watch-session', 'gc'].includes(action) || (starting ? !(args.length === 1 || args.length === 3 && id === '--postgres-version' && ['17', '18'].includes(args[2])) : watching || collecting ? args.length !== 1 : args.length !== 2 || !/^pg(?:17|18)-[A-Za-z0-9]{6}$/.test(id))) throw Error('Usage: pg-test start|start-admin|start-migration [--postgres-version 17|18] | pg-test status <id> | pg-test stop <id> | pg-test gc. No raw commands, paths, SQL or server options.')
 const fixtures = fixtureRoot()
 const roots = fixtureRoots(fixtures)
 if (collecting) return garbageCollect(roots)
 if (watching) {
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM']) process.on(signal, () => {})
  const owner = sessionOwner(fixtures)
  if (!owner) throw Error('Managed agent session identity is required.')
  while (ownerIsRunning(fixtures, owner)) await new Promise(resolve => setTimeout(resolve, 250))
  const summary = garbageCollect(roots)
  return { status: 'stopped', resources: summary.stopped.map(item => item.id), preserved: summary.preserved }
 }
 const major = starting ? args[2] ?? '17' : id.slice(2, 4)
 if (!starting) {
  const root = fixturePath(roots, id)
  let state = JSON.parse(fs.readFileSync(file(root, 'pg-test.json'), 'utf8'))
  if (!validState(state, major)) throw Error('Invalid or changed test database record. Preserve it for inspection.')
  if (action === 'stop') {
   stop(root, state, major)
   delete state.owner
   save(root, state)
   return { id, status: 'stopped', path: root, files: 'retained' }
  }
  const running = identity(root, state, major)
  return { id, status: !running ? 'stopped' : state.ready ? 'running' : 'incomplete', path: root, files: 'retained' }
 }
 garbageCollect(roots)
 const bin = binaries(major)
 const owner = sessionOwner(fixtures)
 const root = fs.mkdtempSync(path.join(fixtures, `pg${major}-`))
 fs.chmodSync(root, 0o700)
 const data = path.join(root, 'data'), socket = path.join(fs.realpathSync(os.tmpdir()), `agent-pg-${path.basename(root).slice(5)}`)
 const administrative = action === 'start-admin'
 const migration = action === 'start-migration'
 const role = 'toolkit_test'
 const state = { version: 1, bin, port: await freePort(), ready: false, profile: administrative ? 'admin' : migration ? 'migration' : 'restricted', socket, owner }
 save(root, state)
 let operation = 'PostgreSQL version check'
 try {
  if (!run(bin, 'postgres', ['--version'], root).startsWith(`postgres (PostgreSQL) ${major}.`)) throw Error(`Expected PostgreSQL major version ${major}.`)
  operation = 'socket path check'
  if (Buffer.byteLength(path.join(socket, `.s.PGSQL.${state.port}`)) > 103) throw Error('Temporary socket path is too long for this platform.')
  fs.mkdirSync(socket, { mode: 0o700 })
  operation = 'initdb'
  run(bin, 'initdb', ['-D', data, '--username=toolkit_admin', '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--no-locale'], root)
  fs.appendFileSync(file(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${state.port}\nunix_socket_directories = ${quote(socket)}\nunix_socket_permissions = 0700\nssl = off\nlogging_collector = off\n`)
  // ponytail: release the temporary port reservation before pg_ctl; a collision fails closed, with no automatic retry.
  operation = 'pg_ctl start'
  run(bin, 'pg_ctl', ['-D', data, '-w', '-t', '30', '-l', path.join(root, 'postgres.log'), 'start'], root)
  Object.assign(state, identity(root, state, major))
  if (!state.pid) throw Error('PostgreSQL started without a verifiable identity.')
  save(root, state)
  const password = randomBytes(24).toString('hex')
  const client = ['-X', '--no-password', '-h', socket, '-p', String(state.port), '-U', 'toolkit_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
  operation = 'database bootstrap'
  run(bin, 'psql', client, root, `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB ${administrative ? 'CREATEROLE NOREPLICATION BYPASSRLS' : migration ? 'CREATEROLE NOREPLICATION NOBYPASSRLS' : 'NOCREATEROLE NOREPLICATION NOBYPASSRLS'} PASSWORD '${password}';\n`)
  run(bin, 'psql', client, root, `CREATE DATABASE toolkit_test OWNER ${role};\n`)
  run(bin, 'psql', client, root, 'ALTER ROLE toolkit_admin NOLOGIN;\n')
  // The admin profile gives the fixture owner only the extra attributes required to create migration roles.
  fs.writeFileSync(file(data, 'pg_hba.conf'), `local all all reject\nhost ${administrative || migration ? 'all all' : 'toolkit_test toolkit_test'} 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n`)
  operation = 'pg_ctl reload'
  run(bin, 'pg_ctl', ['-D', data, 'reload'], root)
  state.ready = true
  save(root, state)
  operation = 'owner process check'
  if (state.owner && !ownerIsRunning(root, state.owner)) {
   stop(root, state, major)
   delete state.owner
   save(root, state)
   throw Error('Fixture owner process ended during setup.')
  }
  // The URL is returned once, not stored in the lifecycle record or logged by the helper.
  return { id: path.basename(root), status: 'running', path: root, profile: state.profile, database_url: `postgresql://${role}:${password}@127.0.0.1:${state.port}/toolkit_test`, files: 'retained until age-based garbage collection after stop' }
 } catch (error) {
  // Never delete an interrupted cluster or try another executable after an error.
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : ''
  throw Error(`Test database setup failed during ${operation}${code}. Files retained at ${root}. Use pg-test status ${path.basename(root)} or pg-test stop ${path.basename(root)}. No automatic restart or immediate deletion.`)
 }
}
module.exports = { main }
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error.message); process.exitCode = 1 })
