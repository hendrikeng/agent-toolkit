#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { execFileSync, spawn } = require('node:child_process')

const usage = 'Usage: paseo-service pair <consumer-workspace> <target-workspace> <service> <env> | unpair <consumer-workspace> <env> | run [consumer-workspace] <env> -- <command> [args...]'
const workspaceId = value => /^wks_[a-zA-Z0-9_-]+$/.test(value ?? '')
const envName = value => /^[A-Z][A-Z0-9_]*$/.test(value ?? '')

function cli(home, args) {
 let output
 try { output = execFileSync('paseo', [...args, '--home', home, '--json'], { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }
 catch { throw Error(`Paseo discovery failed (${args.slice(0, 2).join(' ')}). Check the selected local daemon.`) }
 try { return JSON.parse(output) } catch { throw Error('Paseo returned invalid JSON. Update the CLI and daemon together.') }
}
function workspace(workspaces, id) {
 const matches = workspaces.filter(item => item.workspaceId === id && !item.archivedAt)
 if (matches.length !== 1) throw Error(`Workspace ${id} is missing, archived, or ambiguous.`)
 return matches[0]
}
function service(home, id, name) {
 const scripts = cli(home, ['script', 'ls', '--workspace', id])
 if (!Array.isArray(scripts)) throw Error('Paseo returned an unsupported script list.')
 const matches = scripts.filter(item => item.scriptName === name && item.type === 'service')
 if (matches.length !== 1) throw Error(`Service ${name} in ${id} is missing or ambiguous.`)
 return matches[0]
}
async function available(port) {
 await new Promise((resolve, reject) => {
  const socket = net.connect({ host: '127.0.0.1', port })
  socket.setTimeout(2000)
  socket.once('connect', () => { socket.destroy(); resolve() })
  socket.once('timeout', () => { socket.destroy(); reject(Error('Paired service did not accept a local connection.')) })
  socket.once('error', () => { socket.destroy(); reject(Error('Paired service is unavailable at its assigned port.')) })
 })
}
async function main(args) {
 if (process.env.PASEO_HOST) throw Error('Run this helper on the daemon machine with a local PASEO_HOME; remote endpoints are unsupported.')
 const home = path.resolve(process.env.PASEO_HOME || path.join(os.homedir(), '.paseo'))
 const [action, ...rest] = args
 let consumer, variable, target, name, command
 if (action === 'pair' && rest.length === 4) [consumer, target, name, variable] = rest
 else if (action === 'unpair' && rest.length === 2) [consumer, variable] = rest
 else if (action === 'run') {
  const separator = rest.indexOf('--')
  if (![1, 2].includes(separator) || !rest[separator + 1]) throw Error(usage)
  if (separator === 2) [consumer, variable] = rest
  else variable = rest[0]
  command = rest.slice(separator + 1)
 } else throw Error(usage)
 if (!envName(variable) || consumer && !workspaceId(consumer) || action === 'pair' && (!workspaceId(target) || !/^[a-zA-Z0-9_-]+$/.test(name))) throw Error(usage)
 const directory = path.join(home, 'toolkit-service-pairs')
 const file = id => path.join(directory, `${id}--${variable}.json`)
 if (action === 'unpair') {
  fs.rmSync(file(consumer), { force: true })
  console.error(`Removed pairing for ${consumer}: ${variable}.`)
  return 0
 }
 const workspaces = cli(home, ['workspace', 'ls'])
 if (!Array.isArray(workspaces)) throw Error('Paseo returned an unsupported workspace list.')
 if (!consumer) {
  const cwd = fs.realpathSync(process.cwd())
  const matches = workspaces.filter(item => {
   try { return !item.archivedAt && fs.realpathSync(item.cwd) === cwd } catch { return false }
  })
  if (matches.length !== 1) throw Error('Current directory has no unique active workspace. Pass the exact consumer workspace ID.')
  consumer = matches[0].workspaceId
 }
 if (!workspaceId(consumer)) throw Error('Paseo returned an invalid workspace ID.')
 const source = workspace(workspaces, consumer)
 const status = cli(home, ['daemon', 'status'])
 if (!status.serverId || status.localDaemon !== 'running') throw Error('The selected local daemon is unavailable.')
 if (action === 'pair') {
  workspace(workspaces, target)
  service(home, target, name) // Pairing is allowed before the service starts.
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${file(consumer)}.${process.pid}.tmp`
  try {
   fs.writeFileSync(temporary, JSON.stringify({ version: 1, serverId: status.serverId, consumer, target, service: name, env: variable }) + '\n', { flag: 'wx', mode: 0o600 })
   fs.renameSync(temporary, file(consumer))
  } finally { fs.rmSync(temporary, { force: true }) }
  console.error(`Paired ${consumer} -> ${target}/${name} for ${variable}.`)
  return 0
 }
 if (fs.realpathSync(source.cwd) !== fs.realpathSync(process.cwd())) throw Error('Consumer workspace does not match the launch directory.')
 let pair
 try { pair = JSON.parse(fs.readFileSync(file(consumer), 'utf8')) } catch { throw Error(`No valid explicit pairing for ${consumer}: ${variable}. Run paseo-service pair first.`) }
 if (pair.version !== 1 || pair.serverId !== status.serverId || pair.consumer !== consumer || pair.env !== variable || !workspaceId(pair.target) || !/^[a-zA-Z0-9_-]+$/.test(pair.service ?? '')) throw Error('Pairing is invalid or belongs to another daemon. Pair the exact workspace IDs again.')
 workspace(workspaces, pair.target)
 const current = service(home, pair.target, pair.service)
 if (current.lifecycle !== 'running' || current.health === 'unhealthy' || !Number.isInteger(current.port) || current.port < 1 || current.port > 65535) throw Error(`Paired service ${pair.target}/${pair.service} is not running and available. Start it in Paseo first.`)
 await available(current.port)
 const address = `http://127.0.0.1:${current.port}`
 console.error(`Paseo service: ${consumer} -> ${pair.target}/${pair.service} at ${address} (${variable}).`)
 return await new Promise(resolve => {
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, [variable]: address } })
  const forward = signal => child.kill(signal)
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM')
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  child.once('error', () => { console.error('Could not start the consumer command. Check its executable and PATH.') })
  child.once('close', (code, signal) => {
   process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate)
   resolve(code >= 0 && code !== null ? code : signal ? 128 + (os.constants.signals[signal] ?? 1) : 1)
  })
 })
}
main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => { console.error(error.message); process.exitCode = 1 })
