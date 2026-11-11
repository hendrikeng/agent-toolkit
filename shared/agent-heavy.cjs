#!/usr/bin/env node
'use strict'
// Machine-wide semaphore for heavy local checks. Local resource policy only: it never changes a result.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const usage = 'Usage: agent-heavy -- <program> [args...]'
const GRACE_MS = 30000 // A slot without owner.json belongs to a wrapper that died between mkdir and write.

function slotCount() {
 const value = process.env.AGENT_HEAVY_SLOTS
 if (/^[1-9]\d*$/.test(value ?? '')) return Number(value)
 return Math.max(1, Math.min(Math.floor(os.totalmem() / 2 ** 30 / 20), Math.floor(os.availableParallelism() / 6)))
}
function lockDirectory() {
 if (process.env.AGENT_HEAVY_DIR) return path.resolve(process.env.AGENT_HEAVY_DIR)
 // Not $TMPDIR: agents can get different values, and the lock must be one per machine user.
 if (os.platform() === 'darwin') return path.join(execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8', timeout: 5000 }).trim(), 'agent-heavy')
 return path.join(process.env.XDG_RUNTIME_DIR || '/tmp', `agent-heavy-${os.userInfo().uid}`)
}
function prepare(dir) {
 fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
 const stat = fs.lstatSync(dir)
 if (!stat.isDirectory() || stat.uid !== process.getuid()) throw Error(`${dir} is not a directory that this user owns`)
 fs.chmodSync(dir, 0o700)
}
const dead = pid => {
 if (!Number.isInteger(pid) || pid <= 0) return true
 try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' }
}
function owner(slot) {
 try { return JSON.parse(fs.readFileSync(path.join(slot, 'owner.json'), 'utf8')) } catch (error) {
  if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
  throw error
 }
}
const generation = slot => { const stat = fs.statSync(slot); return `${stat.ino}-${Math.round(stat.birthtimeMs)}` }
function stale(slot) {
 const record = owner(slot)
 return record ? dead(record.pid) && dead(record.childPid) : Date.now() - fs.statSync(slot).mtimeMs > GRACE_MS
}
// Only the waiter that creates the marker for this exact slot generation may remove it.
// A late waiter gets the marker after the first one finishes, sees a new generation, and stops.
// ponytail: a reclaimer killed inside this millisecond window keeps that slot busy until someone clears the lock directory.
function reclaim(dir, index) {
 const slot = path.join(dir, `slot-${index}`)
 let id
 try {
  id = generation(slot)
  if (!stale(slot)) return
 } catch (error) { if (error.code === 'ENOENT') return; throw error }
 const marker = path.join(dir, `reclaim-${index}-${id}`)
 try { fs.mkdirSync(marker) } catch (error) { if (error.code === 'EEXIST') return; throw error }
 try {
  if (generation(slot) !== id || !stale(slot)) return
  const tomb = path.join(dir, `tomb-${index}-${id}`)
  fs.renameSync(slot, tomb)
  fs.rmSync(tomb, { recursive: true, force: true })
 } catch (error) { if (error.code !== 'ENOENT') throw error } finally { fs.rmdirSync(marker) }
}
function writeOwner(slot, record) {
 const temporary = path.join(slot, 'owner.json.tmp')
 fs.writeFileSync(temporary, JSON.stringify(record) + '\n', { mode: 0o600 })
 fs.renameSync(temporary, path.join(slot, 'owner.json'))
}
function tryAcquire(dir, count, record) {
 for (let index = 0; index < count; index++) {
  const slot = path.join(dir, `slot-${index}`)
  try { fs.mkdirSync(slot, { mode: 0o700 }) } catch (error) {
   if (error.code !== 'EEXIST') throw error
   reclaim(dir, index)
   continue
  }
  try { writeOwner(slot, record) } catch (error) { fs.rmSync(slot, { recursive: true, force: true }); throw error }
  return slot
 }
}
function busy(dir, count) {
 const holders = []
 for (let index = 0; index < count; index++) {
  const slot = path.join(dir, `slot-${index}`)
  try {
   if (!fs.existsSync(slot)) continue
   const record = owner(slot)
   holders.push(record ? `${record.cwd} ${record.command.join(' ')}` : 'starting')
  } catch {}
 }
 return `${holders.length}/${count} busy: ${holders.join(', ')}`
}
async function acquire(dir, count, record) {
 let notice = Date.now() + 30000
 for (;;) {
  const slot = tryAcquire(dir, count, record)
  if (slot) return slot
  if (Date.now() >= notice) {
   console.error(`agent-heavy: waiting for a slot (${busy(dir, count)})`)
   notice = Date.now() + 30000
  }
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000))
 }
}
function run(command, env, onSpawn) {
 return new Promise(resolve => {
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env })
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const forward = signal => child.kill(signal)
  for (const signal of signals) process.on(signal, forward)
  let done = false
  const finish = code => {
   if (done) return
   done = true
   for (const signal of signals) process.removeListener(signal, forward)
   resolve(code)
  }
  child.once('error', error => { console.error(`agent-heavy: could not start ${command[0]}: ${error.message}`); finish(127) })
  child.once('exit', (code, signal) => finish(code ?? 128 + (os.constants.signals[signal] ?? 0)))
  if (child.pid) onSpawn(child.pid)
 })
}
async function main(args) {
 if (args[0] !== '--' || !args[1]) { console.error(usage); return 2 }
 const command = args.slice(1)
 if (process.env.AGENT_HEAVY === '0' || process.env.AGENT_HEAVY_HELD === '1') return run(command, process.env, () => {})
 const record = { pid: process.pid, childPid: null, cwd: process.cwd(), command, started: new Date().toISOString() }
 let slot, env = process.env
 try { // Fail open: the throttle must never fail the command.
  const count = slotCount()
  env = { ...process.env, AGENT_HEAVY_HELD: '1', AGENT_HEAVY_WORKERS: String(Math.max(1, Math.floor(os.availableParallelism() / count))) }
  const dir = lockDirectory()
  prepare(dir)
  slot = await acquire(dir, count, record)
 } catch (error) {
  console.error(`agent-heavy: throttle unavailable, running without a slot (${error.message})`)
  return run(command, env, () => {})
 }
 // Release once: after release, another wrapper can own the same slot path.
 let held = true
 const release = () => { if (held) fs.rmSync(slot, { recursive: true, force: true }); held = false }
 process.once('exit', release)
 try {
  return await run(command, env, childPid => {
   try { writeOwner(slot, { ...record, childPid }) } catch {} // The wrapper pid still protects the slot.
  })
 } finally { release() }
}
main(process.argv.slice(2)).then(code => { process.exitCode = code })
