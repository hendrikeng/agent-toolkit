#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { randomBytes } = require('node:crypto')
const { execFileSync } = require('node:child_process')

function directory(value) {
 const absolute = path.resolve(value)
 if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isDirectory()) throw Error('Database paths must be physical directories without symlinks.')
 return absolute
}
function scratchRoot() {
 const root = directory(path.join(os.userInfo().homedir, 'Code/.agent-toolkit-scratch'))
 if (fs.statSync(root).mode & 0o077) throw Error('Private scratch must already exist with mode 700. Start through pi-yolo.')
 return root
}
function binaries() {
 const candidates = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin'].filter(fs.existsSync)
 if (candidates.length !== 1) throw Error('Expected exactly one existing Homebrew PostgreSQL 17 installation. This helper never installs or upgrades it.')
 const bin = fs.realpathSync(candidates[0])
 const prefix = candidates[0].split('/opt/postgresql@17/')[0]
 if (!bin.startsWith(`${prefix}/Cellar/postgresql@17/`) || !bin.endsWith('/bin')) throw Error('PostgreSQL installation resolves outside its Homebrew formula.')
 for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql']) {
  const file = path.join(bin, name)
  if (fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) throw Error('Expected regular PostgreSQL 17 executables.')
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
function identity(root, state) {
 if (!fs.existsSync(path.join(root, 'data')) && !state.pid) return false
 const data = directory(path.join(root, 'data'))
 if (fs.readFileSync(file(data, 'PG_VERSION'), 'utf8').trim() !== '17') throw Error('Not a PostgreSQL 17 test cluster.')
 const pidFile = path.join(data, 'postmaster.pid')
 if (!fs.existsSync(pidFile)) return false
 const lines = fs.readFileSync(file(data, 'postmaster.pid'), 'utf8').split('\n')
 if (!/^\d+$/.test(lines[0]) || lines[1] !== data || !/^\d+$/.test(lines[2]) || lines[3] !== String(state.port)) throw Error('Postmaster identity does not match this scratch cluster.')
 const pid = Number(lines[0])
 if (pid <= 1 || state.pid && (state.pid !== pid || state.started !== lines[2])) throw Error('Postmaster identity changed; preserve the cluster for inspection.')
 const command = execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000, env: environment(root) }).trim()
 if (command !== `${state.bin}/postgres -D ${data}`) throw Error('Refusing to control a process outside this scratch cluster.')
 return { pid, started: lines[2] }
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
 const starting = action === 'start' || action === 'start-admin'
 if (!['start', 'start-admin', 'status', 'stop'].includes(action) || args.length !== (starting ? 1 : 2) || !starting && !/^pg17-[A-Za-z0-9]{6}$/.test(id)) throw Error('Usage: pg-test start | pg-test start-admin | pg-test status <id> | pg-test stop <id>. No raw commands, paths, SQL or server options.')
 const scratch = scratchRoot()
 if (!starting) {
  const root = directory(path.join(scratch, id))
  const state = JSON.parse(fs.readFileSync(file(root, 'pg-test.json'), 'utf8'))
  if (state.version !== 1 || state.bin !== binaries() || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) throw Error('Invalid or changed test database record. Preserve it for inspection.')
  const running = identity(root, state)
  if (action === 'stop' && running) {
   run(state.bin, 'pg_ctl', ['-D', path.join(root, 'data'), '-w', '-t', '30', '-m', 'fast', 'stop'], root)
   if (identity(root, state)) throw Error('PostgreSQL did not stop. Preserve its files.')
  }
  return { id, status: action === 'stop' || !running ? 'stopped' : state.ready ? 'running' : 'incomplete', path: root, files: 'retained' }
 }
 const bin = binaries()
 const root = fs.mkdtempSync(path.join(scratch, 'pg17-'))
 fs.chmodSync(root, 0o700)
 const data = path.join(root, 'data'), socket = path.join(root, 's')
 const administrative = action === 'start-admin'
 const role = administrative ? 'toolkit_fixture_admin' : 'toolkit_test'
 const state = { version: 1, bin, port: await freePort(), ready: false, profile: administrative ? 'fixture-admin' : 'restricted' }
 save(root, state)
 let operation = 'PostgreSQL version check'
 try {
  if (!/^postgres \(PostgreSQL\) 17\./.test(run(bin, 'postgres', ['--version'], root))) throw Error('Expected PostgreSQL major version 17.')
  operation = 'socket path check'
  if (Buffer.byteLength(path.join(socket, `.s.PGSQL.${state.port}`)) > 103) throw Error('Scratch socket path is too long for this platform.')
  fs.mkdirSync(socket, { mode: 0o700 })
  operation = 'initdb'
  run(bin, 'initdb', ['-D', data, '--username=toolkit_admin', '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--no-locale'], root)
  fs.appendFileSync(file(data, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${state.port}\nunix_socket_directories = ${quote(socket)}\nunix_socket_permissions = 0700\nssl = off\nlogging_collector = off\n`)
  // ponytail: release the temporary port reservation before pg_ctl; a collision fails closed, with no automatic retry.
  operation = 'pg_ctl start'
  run(bin, 'pg_ctl', ['-D', data, '-w', '-t', '30', '-l', path.join(root, 'postgres.log'), 'start'], root)
  Object.assign(state, identity(root, state))
  if (!state.pid) throw Error('PostgreSQL started without a verifiable identity.')
  save(root, state)
  const password = randomBytes(24).toString('hex')
  const client = ['-X', '--no-password', '-h', socket, '-p', String(state.port), '-U', 'toolkit_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
  operation = 'database bootstrap'
  run(bin, 'psql', client, root, `CREATE ROLE ${role} LOGIN NOSUPERUSER ${administrative ? 'CREATEDB CREATEROLE' : 'NOCREATEDB NOCREATEROLE'} NOREPLICATION NOBYPASSRLS PASSWORD '${password}';\n`)
  run(bin, 'psql', client, root, `CREATE DATABASE toolkit_test OWNER ${role};\n`)
  run(bin, 'psql', client, root, 'ALTER ROLE toolkit_admin NOLOGIN;\n')
  // Fixture administrators can create password-authenticated test roles and databases,
  // but never gain superuser or server-file/program access through this helper.
  fs.writeFileSync(file(data, 'pg_hba.conf'), `local all all reject\nhost ${administrative ? 'all all' : 'toolkit_test toolkit_test'} 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n`)
  operation = 'pg_ctl reload'
  run(bin, 'pg_ctl', ['-D', data, 'reload'], root)
  state.ready = true
  save(root, state)
  // The URL is returned once, not stored in the lifecycle record or logged by the helper.
  return { id: path.basename(root), status: 'running', path: root, profile: state.profile, database_url: `postgresql://${role}:${password}@127.0.0.1:${state.port}/toolkit_test`, files: 'retained until separately authorized cleanup' }
 } catch (error) {
  // Never delete an interrupted cluster or try another executable after an error.
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : ''
  throw Error(`Test database setup failed during ${operation}${code}. Files retained at ${root}. Use pg-test status ${path.basename(root)} or pg-test stop ${path.basename(root)}. No automatic restart or deletion.`)
 }
}
module.exports = { main }
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error.message); process.exitCode = 1 })
