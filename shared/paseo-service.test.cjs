const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const helper = path.join(__dirname, 'paseo-service.cjs')

async function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-pairs-'))
 t.after(() => fs.rmSync(root, { recursive: true, force: true }))
 const bin = path.join(root, 'bin'), home = path.join(root, 'home'), stateFile = path.join(root, 'native.json')
 fs.mkdirSync(bin); fs.mkdirSync(home)
 const ids = ['wks_webA', 'wks_apiA', 'wks_webB', 'wks_apiB', 'wks_shared', 'wks_webOnly']
 const workspaces = ids.map(workspaceId => {
  const cwd = path.join(root, workspaceId)
  fs.mkdirSync(cwd)
  return { workspaceId, cwd, name: 'same-task-name' }
 })
 const state = { workspaces, services: {}, serverId: 'srv_test' }
 const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
 save()
 // Fixture the documented native CLI transport, not pairing or resolution logic.
 fs.writeFileSync(path.join(bin, 'paseo'), `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const args = process.argv.slice(2);
if (!args.includes('--json') || args[args.indexOf('--home')+1] !== ${JSON.stringify(home)}) process.exit(2);
let output;
if (args[0] === 'workspace' && args[1] === 'ls') output = state.workspaces;
else if (args[0] === 'daemon' && args[1] === 'status') output = {serverId:state.serverId,localDaemon:'running'};
else if (args[0] === 'script' && args[1] === 'ls') output = state.services[args[args.indexOf('--workspace')+1]] || [];
else process.exit(2);
console.log(JSON.stringify(output));
`, { mode: 0o700 })
 const env = { ...process.env, PASEO_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TRACN_API_PROXY_TARGET: 'http://wrong-api.invalid:3000' }
 delete env.PASEO_HOST
 const run = (args, id = 'wks_webA', prefix = []) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [...prefix, helper, ...args], { cwd: workspaces.find(item => item.workspaceId === id).cwd, env })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  child.once('error', reject); child.once('exit', code => resolve({ code, stdout, stderr }))
 })
 const server = async (id, answer) => {
  const service = http.createServer((_req, res) => res.end(answer))
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { if (service.listening) service.close(resolve); else resolve() }))
  const port = service.address().port
  state.services[id] = [{ scriptName: 'api', type: 'service', lifecycle: 'running', port, health: null, proxyUrl: 'http://native-proxy.localhost:6767' }]
  save()
  return { service, port }
 }
 const command = ['--', process.execPath, '-e', "fetch(process.env.TRACN_API_PROXY_TARGET).then(r=>r.text()).then(text=>console.log(text)).catch(()=>process.exit(9))"]
 const pair = (web, api) => run(['pair', web, api, 'api', 'TRACN_API_PROXY_TARGET'], web)
 return { root, home, state, save, run, server, pair, command, workspaces }
}

test('explicit independent pairs and shared API resolve current ports after environment loading and API restart', async t => {
 const f = await fixture(t)
 const apiA = await f.server('wks_apiA', 'API-A')
 await f.server('wks_apiB', 'API-B')
 await f.server('wks_shared', 'SHARED')
 for (const [web, api] of [['wks_webA','wks_apiA'], ['wks_webB','wks_apiB'], ['wks_webOnly','wks_shared']]) assert.equal((await f.pair(web, api)).code, 0)
 const loader = path.join(f.root, 'environment-loader.cjs')
 fs.writeFileSync(loader, `const {spawnSync}=require('node:child_process'); process.env.TRACN_API_PROXY_TARGET='http://secret-loader-overwrite.invalid'; const r=spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit',env:process.env}); process.exit(r.status??1);`)
 for (const [web, expected, api] of [['wks_webA','API-A','wks_apiA'], ['wks_webB','API-B','wks_apiB'], ['wks_webOnly','SHARED','wks_shared']]) {
  const result = await f.run(['run', 'TRACN_API_PROXY_TARGET', ...f.command], web, [loader])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.trim(), expected)
  assert.match(result.stderr, new RegExp(`${web} -> ${api}/api at http://127\\.0\\.0\\.1:`))
 }
 await new Promise(resolve => apiA.service.close(resolve))
 const restarted = await f.server('wks_apiA', 'API-A-RESTARTED')
 assert.notEqual(restarted.port, apiA.port)
 const result = await f.run(['run', 'wks_webA', 'TRACN_API_PROXY_TARGET', ...f.command])
 assert.equal(result.code, 0, result.stderr)
 assert.equal(result.stdout.trim(), 'API-A-RESTARTED')
 assert.ok(result.stderr.includes(`:${restarted.port}`))
 const peer = await f.run(['run', 'TRACN_API_PROXY_TARGET', ...f.command], 'wks_webB')
 assert.equal(peer.stdout.trim(), 'API-B')
 assert.equal((await f.run(['run', 'TRACN_API_PROXY_TARGET', '--', process.execPath, '-e', 'process.exit(7)'])).code, 7)
 assert.equal((await f.run(['run', 'TRACN_API_PROXY_TARGET', '--', 'missing-consumer-executable'])).code, 1)
 assert.equal((await f.pair('wks_webA', 'wks_shared')).code, 0)
 assert.equal((await f.run(['run', 'TRACN_API_PROXY_TARGET', ...f.command])).stdout.trim(), 'SHARED')
 assert.equal((await f.run(['run', 'TRACN_API_PROXY_TARGET', ...f.command], 'wks_webOnly')).stdout.trim(), 'SHARED')
})

test('missing, stopped, archived, ambiguous and unavailable pair targets fail before the consumer starts', async t => {
 const f = await fixture(t)
 const api = await f.server('wks_apiA', 'API-A')
 const run = () => f.run(['run', 'TRACN_API_PROXY_TARGET', ...f.command])
 assert.match((await run()).stderr, /No valid explicit pairing/)
 assert.equal((await f.pair('wks_webA', 'wks_apiA')).code, 0)
 const current = f.state.services.wks_apiA[0]
 for (const mutation of [{ lifecycle: 'stopped' }, { health: 'unhealthy' }, { port: null }]) {
  f.state.services.wks_apiA = [{ ...current, ...mutation }]; f.save()
  const result = await run()
  assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /not running and available/)
 }
 f.state.services.wks_apiA = []; f.save()
 assert.match((await run()).stderr, /missing or ambiguous/)
 f.state.services.wks_apiA = [current, current]; f.save()
 assert.match((await run()).stderr, /missing or ambiguous/)
 f.state.services.wks_apiA = [current]
 const target = f.state.workspaces.find(item => item.workspaceId === 'wks_apiA')
 target.archivedAt = '2026-10-06'; f.save()
 assert.match((await run()).stderr, /missing, archived, or ambiguous/)
 delete target.archivedAt
 f.state.workspaces.push({ ...target }); f.save()
 assert.match((await run()).stderr, /missing, archived, or ambiguous/)
 f.state.workspaces.pop()
 f.state.workspaces.push({ workspaceId: 'wks_other', cwd: f.workspaces[0].cwd }); f.save()
 assert.match((await run()).stderr, /no unique active workspace/)
 f.state.workspaces.pop(); f.save()
 await new Promise(resolve => api.service.close(resolve))
 assert.match((await run()).stderr, /unavailable at its assigned port/)
 f.state.serverId = 'srv_other'; f.save()
 assert.match((await run()).stderr, /another daemon/)
 assert.equal((await f.run(['unpair', 'wks_webA', 'TRACN_API_PROXY_TARGET'])).code, 0)
 assert.equal((await f.run(['unpair', 'wks_webA', 'TRACN_API_PROXY_TARGET'])).code, 0)
 assert.match((await run()).stderr, /No valid explicit pairing/)
 assert.equal(fs.readdirSync(path.join(f.home, 'toolkit-service-pairs')).length, 0)
})
