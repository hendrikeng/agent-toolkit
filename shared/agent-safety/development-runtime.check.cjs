// Source integration: real patched parser/matcher and extension, simulated Pi SDK.
// Never an installed-session acceptance claim.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks, createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { inventory, verifyBundle, activate, stage } = require('./permission-bundle.cjs')
const { buildDevelopmentPolicy } = require('./development-policy.cjs')
exports.check = async function ({ root: packageRoot, fixture, service, defaults }) {
 const before = { ...process.env }
 const home = path.join(fixture, 'runtime-home'), cwd = path.join(home, 'Code/project'), selected = path.join(home, 'orca/workspaces/new-project')
 const bundle = path.join(home, '.local/libexec/agent-toolkit/permission-bundles/release-fixture'), runtime = path.join(home, 'Code/session'), reports = path.join(home, 'Code/reports')
 for (const directory of [cwd, selected, bundle, reports, path.join(runtime, 'extensions/pi-permission-system')]) fs.mkdirSync(directory, { recursive: true })
 for (const name of ['permission-bundle.cjs', 'development-policy.cjs', 'patch-permission-tool-visibility.cjs', 'permission-shell.ts', 'local-resources.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(bundle, name))
 fs.copyFileSync(path.join(__dirname, 'pi-yolo-dispatch'), path.join(bundle, 'dispatch'))
 fs.copyFileSync(path.join(__dirname, 'agent-yolo'), path.join(bundle, 'pi-yolo'))
 fs.copyFileSync(path.join(__dirname, 'git-yolo-guard'), path.join(bundle, 'git'))
 for (const name of ['git', 'pi-yolo', 'dispatch']) fs.chmodSync(path.join(bundle, name), 0o700)
 fs.writeFileSync(path.join(bundle, 'git.agent-toolkit.sha256'), createHash('sha256').update(fs.readFileSync(path.join(bundle, 'git'))).digest('hex'))
 for (const name of ['development-access', 'task-graph']) fs.cpSync(path.join(__dirname, '../../pi/extensions', name), path.join(bundle, 'extensions', name), { recursive: true })
 fs.cpSync(packageRoot, path.join(bundle, 'node_modules/@gotgenes/pi-permission-system'), { recursive: true })
 const config = buildDevelopmentPolicy(defaults, { home, scratchRoot: path.join(home, 'Code/scratch'), reportRoot: reports })
 fs.writeFileSync(path.join(bundle, 'policy.json'), JSON.stringify(config.policy))
 fs.writeFileSync(path.join(runtime, 'extensions/pi-permission-system/config.json'), JSON.stringify(config.policy))
 const manifest = { version: config.version, roots: config.roots, permissionPackage: '20.7.3', graphVersion: 4, piVersion: '0.79.1', files: inventory(bundle) }
 fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify(manifest))
 Object.assign(process.env, { HOME: home, AGENT_TOOLKIT_PERMISSION_BUNDLE: bundle, PI_CODING_AGENT_DIR: runtime, AGENT_TOOLKIT_REVIEW_ROOT: reports, AGENT_TOOLKIT_SCRATCH_ROOT: path.join(home, 'Code/scratch') })
 let executed, confirmations = 0, allowConfirmation = false, nativeDecision = 'allow', nativeOrigin
 const native = { checkPermission: () => ({ state: nativeDecision, origin: nativeOrigin }) }
 service.publishPermissionsService(native)
 globalThis.__developmentBash = location => ({ execute: async () => { executed = location; return { content: [] } } })
 const extensionUrl = pathToFileURL(path.join(__dirname, '../../pi/extensions/development-access/index.ts')).href
 const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL !== extensionUrl) return next(specifier, context)
  if (specifier === '@gotgenes/pi-permission-system') return { url: pathToFileURL(path.join(packageRoot, 'src/service.ts')).href, shortCircuit: true }
  const modules = { '@earendil-works/pi-coding-agent': 'export const createBashTool=cwd=>globalThis.__developmentBash(cwd);', '@earendil-works/pi-ai': 'export const StringEnum=()=>({});', typebox: 'export const Type=new Proxy({}, {get:()=>()=>({})});' }
  return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context)
 } })
 try {
  verifyBundle(bundle)
  require('./patch-permission-tool-visibility.cjs').install(path.join(bundle, 'node_modules/@gotgenes/pi-permission-system'))
  verifyBundle(bundle) // Reapplying the current patch does not change any byte.
  const pointer = path.join(home, 'Code/current')
  activate(bundle, pointer); assert.equal(fs.realpathSync(pointer), path.join(bundle, 'dispatch'))
  const damaged = path.join(path.dirname(bundle), 'damaged')
  fs.cpSync(bundle, damaged, { recursive: true }); fs.writeFileSync(path.join(damaged, 'git'), 'damaged')
  assert.throws(() => activate(damaged, pointer), /bytes differ/)
  assert.equal(fs.realpathSync(pointer), path.join(bundle, 'dispatch'), 'failed candidate leaves old bundle selected')
  const nextBundle = path.join(path.dirname(bundle), 'next'); fs.cpSync(bundle, nextBundle, { recursive: true })
  activate(nextBundle, pointer)
  assert.equal(process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE, bundle, 'running session remains pinned')
  verifyBundle(bundle); verifyBundle(nextBundle)
  fs.symlinkSync('/outside', path.join(damaged, 'escape'))
  assert.throws(() => inventory(damaged), /ENOENT|escape/)
  const bin = path.join(home, 'Code/bin'), agent = path.join(home, 'Code/managed-agent')
  fs.mkdirSync(bin); fs.mkdirSync(path.join(agent, 'extensions'), { recursive: true })
  fs.mkdirSync(path.join(agent, 'node_modules'))
  fs.writeFileSync(path.join(agent, 'settings.json'), '{}')
  fs.writeFileSync(path.join(agent, 'auth.json'), '{}')
  fs.writeFileSync(path.join(bin, 'pi'), `#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');\nif(process.argv[2]==='--version') console.log('0.79.1');\nelse fs.writeFileSync(process.env.CAPTURE,JSON.stringify({bundle:process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE,runtime:process.env.PI_CODING_AGENT_DIR,config:JSON.parse(fs.readFileSync(path.join(process.env.PI_CODING_AGENT_DIR,'extensions/pi-permission-system/config.json'),'utf8'))}));\n`, { mode: 0o700 })
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho simulated-dependency-failure >&2\nexit 9\n', { mode: 0o700 })
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath}`
  assert.throws(() => stage(path.join(__dirname, '../..'), path.join(home, 'Code/staged'), home, '', 'not-accepted'), /acceptance/)
  assert.equal(fs.existsSync(path.join(home, 'Code/staged')), false)
  assert.throws(() => stage(path.join(__dirname, '../..'), path.join(home, 'Code/staged'), home), /Command failed/)
  assert.equal(fs.realpathSync(pointer), path.join(nextBundle, 'dispatch'), 'interrupted staging did not change selection')
  process.env.PATH = oldPath
  const launcher = path.join(home, '.local/bin/pi-yolo')
  fs.mkdirSync(path.dirname(launcher), { recursive: true }); activate(bundle, launcher)
  const env = { ...process.env, PATH: `${bin}:${oldPath}`, AGENT_TOOLKIT_PI_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent, AGENT_TOOLKIT_PI_WEB_CONFIG_DIR: path.join(home, 'Code/web-config'), CAPTURE: path.join(home, 'Code/launcher-result.json') }
  for (const key of Object.keys(env)) if (key.startsWith('AGENT_TOOLKIT_CODEX') || key === 'CODEX_HOME') delete env[key]
  const launched = spawnSync(launcher, [], { cwd, env, encoding: 'utf8' })
  assert.equal(launched.status, 0, launched.stderr)
  const captured = JSON.parse(fs.readFileSync(env.CAPTURE, 'utf8'))
  assert.equal(captured.bundle, bundle)
  assert.equal(fs.realpathSync(path.join(captured.runtime, 'node_modules')), path.join(bundle, 'node_modules'))
  const fromSession = createRequire(path.join(captured.runtime, 'extensions/development-access/index.ts'))
  assert.equal(fs.realpathSync(fromSession.resolve('@gotgenes/pi-permission-system')), path.join(bundle, 'node_modules/@gotgenes/pi-permission-system/src/service.ts'))
  assert.equal(captured.config.yoloMode, false)
  assert.equal(captured.config.permission.bash['*'], 'allow')
  assert.equal(captured.config.permission.write[`${captured.runtime}/*`], 'deny')
 assert.equal(captured.config.permission.edit[`${captured.runtime}/*`], 'deny')
 assert.equal(captured.config.permission.bash[`*${captured.runtime}*`], 'deny')
  assert.equal(captured.config.permission.path[`${captured.runtime}/auth.json`], 'deny')
  assert.ok(fs.existsSync(captured.runtime), 'session artifacts are retained')
  assert.ok(captured.runtime.startsWith(`${home}/Code/.agent-toolkit-scratch/`))
  const { default: extension } = await import(extensionUrl)
  const events = new Map(), tools = new Map()
  extension({ registerTool: tool => tools.set(tool.name, tool), on: (name, handler) => events.set(name, handler) })
  const ctx = { cwd, hasUI: true, ui: { notify() {}, confirm: async () => { confirmations++; return allowConfirmation } } }
  const callBash = async (repository) => tools.get('bash').execute('bash', { command: 'node --version', ...(repository ? { repository } : {}) }, undefined, undefined, ctx)
  assert.equal(events.has('tool_call'), false, 'ordinary development has no second permission gate')
  await callBash(); assert.equal(executed, cwd)
  await callBash(selected); assert.equal(executed, selected)
  const newWorktree = path.join(home, 'orca/workspaces/created-after-session-start')
  fs.mkdirSync(newWorktree, { recursive: true })
  await callBash(newWorktree); assert.equal(executed, newWorktree)
  assert.equal(confirmations, 0, 'ordinary development never asks for checkout trust')
  const resources = require(path.join(bundle, 'local-resources.cjs'))
  const originals = { ...resources }, previousURL = process.env.RESOURCE_CACHE_URL
  try {
   Object.assign(resources, {
    dockerRuntime: () => ({}),
    prepareResources: (_scope, _declarations, state) => { state.cache = { id: 'synthetic', stopped: false } },
    resourceEnvironment: state => state.cache.stopped ? {} : { RESOURCE_CACHE_URL: 'synthetic-fixture-url' },
    operateResource: record => { record.stopped = true; return 'stopped' },
   })
   allowConfirmation = true
   await tools.get('prepare_local_resources').execute('prepare', { declarations: [{ id: 'cache', type: 'storage', image: `redis:7@sha256:${'a'.repeat(64)}`, purpose: 'synthetic', memoryMiB: 64, storageMiB: 64, lifetimeSeconds: 600 }] }, undefined, undefined, ctx)
   assert.ok(process.env.RESOURCE_CACHE_URL === 'synthetic-fixture-url')
   await tools.get('operate_local_resource').execute('stop', { resource_id: 'cache', operation: 'stop' })
   assert.ok(process.env.RESOURCE_CACHE_URL === previousURL, 'shutdown restores the previous environment')
   await callBash(selected)
  } finally { Object.assign(resources, originals) }
  service.unpublishPermissionsService(native)
  assert.equal(tools.has('propose_task_graph'), false, 'ordinary root access has no graph dependency')
  console.log(`Source extension and retained-bundle checks passed: ${home}`)
 } finally {
  service.unpublishPermissionsService(native); hook.deregister(); delete globalThis.__developmentBash
  for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]
  Object.assign(process.env, before)
 }
}
