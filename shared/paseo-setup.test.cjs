const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { prepareSetup, applySetup, installToolTrust } = require('./paseo-setup.cjs')
const presets = JSON.parse(fs.readFileSync(path.join(__dirname, 'hosts/paseo-profiles.json'), 'utf8'))

test('tool trust uses the selected daemon, preserves an enabled switch, and requires a running plugin', () => {
  for (const enabled of [true, false]) {
   for (const existing of [undefined, { enabled: true }, { enabled: false }]) {
    const calls = []
    let listed = false
    installToolTrust({ paseoHome: '/selected/paseo', resources: '/installed' }, args => {
      calls.push(args)
      assert.deepEqual(args.slice(-2), ['--home', '/selected/paseo'])
      if (args[2] === 'get') return { path: 'pluginsEnabled', set: enabled, value: enabled }
      if (args[1] === 'ls') {
        const result = !listed && !existing ? [] : [{ id: 'agent-toolkit-paseo-tool-trust', path: '/installed/paseo/tool-trust', status: 'running', ...existing }]
        listed = true
        return result
      }
      return { applied: true }
    })
    assert.equal(calls.some(args => args[2] === 'set'), !enabled)
    const action = existing ? existing.enabled ? 'reload' : 'enable' : 'install'
    assert.deepEqual(calls.find(args => args[1] === action), ['plugin', action, existing ? 'agent-toolkit-paseo-tool-trust' : '/installed/paseo/tool-trust', '--home', '/selected/paseo'])
    assert.equal(calls.some(args => args[1] === 'install'), !existing)
   }
  }
  assert.throws(() => installToolTrust({ paseoHome: '/selected', resources: '/installed' }, args => {
    if (args[2] === 'get') return { path: 'pluginsEnabled', set: true, value: true }
    if (args[1] === 'ls') return [{ id: 'agent-toolkit-paseo-tool-trust', path: '/installed/paseo/tool-trust', enabled: true, status: 'failed' }]
  }), /did not reach running/)
  assert.throws(() => installToolTrust({ paseoHome: '/selected', resources: '/installed' }, args => {
    if (args[1] === 'ls') return []
    if (args[2] === 'get') return { path: 'pluginsEnabled', set: false }
    if (args[2] === 'set') return { applied: false }
    assert.fail('Must not install after a rejected enablement')
  }), /enablement needs human inspection/)
  assert.throws(() => installToolTrust({ paseoHome: '/selected', resources: '/installed' }, args => {
    if (args[1] === 'ls') return [{ id: 'agent-toolkit-paseo-tool-trust', path: '/unrelated' }]
    assert.fail('Must not change global trust or replace another source')
  }), /another source/)
})

function input(config = {}) {
  return {
    config, presets, installContext: true, resources: '/fixture/installed-resources', context: fs.readFileSync(path.join(__dirname, 'hosts/paseo-context.md'), 'utf8'),
    selections: { codex: { provider: 'codex-work', modeId: 'auto-review' }, claude: { provider: 'claude-work', modeId: 'acceptEdits' } },
    providers: [
      { provider: 'codex-work', status: 'available', enabled: 'Enabled', modes: 'Default Permissions, Auto-review, Full Access' },
      { provider: 'claude-work', status: 'available', enabled: 'Enabled', modes: 'Plan Mode, Always Ask, Accept File Edits, Auto mode, Bypass' },
    ],
    models: {
      'codex-work': [{ id: 'gpt-6.1-sol', thinkingOptionIds: ['medium', 'high'] }, { id: 'gpt-6-astra', thinkingOptionIds: ['medium', 'high'] }],
      'claude-work': [{ id: 'claude-opus-5-5', thinkingOptionIds: ['medium', 'high'] }],
    },
  }
}
const configuration = () => ({
  version: 1,
  agents: { providers: { 'codex-work': { extends: 'codex', env: { CODEX_HOME: '/fixture/account' }, options: { sandbox_mode: 'read-only' } }, 'claude-work': { extends: 'claude' } } },
  daemon: { appendSystemPrompt: 'Human instructions.', mcp: { injectIntoAgents: false } },
})

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-paseo-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paseoHome = path.join(root, 'paseo'), dataRoot = path.join(root, 'toolkit')
  fs.mkdirSync(paseoHome)
  const file = path.join(paseoHome, 'config.json')
  const original = JSON.stringify(configuration())
  fs.writeFileSync(file, original)
  return { paseoHome, dataRoot, file, original }
}

// Native persistence is substituted. These checks own Toolkit's merge, backup,
// refusal, and partial-save contracts, not Paseo's implementation or live security.
function writer(file, writes) {
  return args => {
    assert.deepEqual(args.slice(0, 3), ['daemon', 'config', 'set'])
    assert.equal(args[5], '--home')
    assert.equal(args[6], path.dirname(file))
    const key = args[3].slice('daemon.'.length)
    assert.ok(['agentProfiles', 'appendSystemPrompt'].includes(key))
    const config = require('jsonc-parser').parse(fs.readFileSync(file, 'utf8'))
    config.daemon ??= {}
    config.daemon[key] = JSON.parse(args[4])
    fs.writeFileSync(file, JSON.stringify(config))
    writes.push(key)
    return { action: 'saved', applied: true }
  }
}

test('setup fills the catalog, preserves existing choices, backs up original bytes, and repeats without writes', t => {
  const f = fixture(t), config = configuration()
  const existing = { id: 'human-ui', name: 'Toolkit Codex UI Worker', provider: 'another-account', model: 'human-choice', featureValues: { fast_mode: true }, notes: 'Human specialty' }
  const unrelated = { id: 'user-profile', name: 'My preset', provider: 'user-provider', featureValues: { custom: false } }
  config.daemon.agentProfiles = [existing, unrelated]
  const original = '// Human configuration comment\n' + JSON.stringify(config, null, 2).replace(/\n}$/, ',\n}')
  fs.writeFileSync(f.file, original)
  const plan = prepareSetup(input(config)), writes = []
  assert.equal(plan.added.length, 9)
  assert.deepEqual(plan.profiles[0], existing)
  assert.deepEqual(plan.profiles[1], unrelated)
  const worker = plan.profiles.find(p => p.name === 'Toolkit Codex Worker')
  assert.equal(worker.provider, 'codex-work')
  assert.equal(worker.modeId, 'auto-review')
  assert.equal(worker.featureValues.plan_mode, false)
  const adviser = plan.profiles.find(p => p.name === 'Toolkit Codex Adviser')
  assert.equal(adviser.model, 'gpt-6.1-sol')
  assert.equal(adviser.thinkingOptionId, 'medium')
  const planner = plan.profiles.find(p => p.name === 'Toolkit Claude Planner')
  assert.equal(planner.modeId, 'plan')
  assert.equal(planner.thinkingOptionId, 'high')
  assert.equal(plan.profiles.find(p => p.name === 'Toolkit Claude UI Worker').featureValues.fast_mode, false)
  const result = applySetup({ ...f, original, plan }, writer(f.file, writes))
  assert.deepEqual(writes, ['agentProfiles', 'appendSystemPrompt'])
  assert.equal(fs.readFileSync(path.join(result.backup, 'config.json'), 'utf8'), original)
  assert.equal(fs.statSync(path.join(result.backup, 'config.json')).mode & 0o777, 0o600)
  const current = JSON.parse(fs.readFileSync(f.file, 'utf8'))
  assert.deepEqual(current.agents, config.agents)
  assert.deepEqual(current.daemon.mcp, config.daemon.mcp)
  assert.ok(current.daemon.appendSystemPrompt.startsWith('Human instructions.\n\n'))
  assert.ok(current.daemon.appendSystemPrompt.includes('/fixture/installed-resources/shared/AGENTS.md'))
  const receipt = JSON.parse(fs.readFileSync(path.join(f.dataRoot, fs.readdirSync(f.dataRoot).find(n => n.endsWith('.json')))))
  const repeat = prepareSetup({ ...input(current), previousPrompt: receipt.prompt })
  const repeated = applySetup({ ...f, original: fs.readFileSync(f.file, 'utf8'), plan: repeat }, () => assert.fail('Repeat must not save configuration'))
  assert.equal(repeated.backup, null)
  assert.equal(repeat.profiles.length, 11)
  assert.deepEqual(repeat.profiles[0], existing)
})

test('unsupported choices and ambiguous ownership refuse before mutation; an omitted family is skipped', () => {
  const base = input(configuration())
  for (const mutate of [
    v => { v.providers[0].status = 'unavailable' },
    v => { v.models['codex-work'][0].thinkingOptionIds = ['low'] },
    v => { v.config.agents.providers['codex-work'].extends = 'claude' },
    v => { v.selections.codex.modeId = 'full-access' },
    v => { v.config.daemon.agentProfiles = [{ id: 'a', name: 'Toolkit Codex Worker' }, { id: 'b', name: 'Toolkit Codex Worker' }] },
    v => { v.config.daemon.agentProfiles = [{ id: 'toolkit-codex-worker', name: 'Unrelated preset' }] },
    v => { v.config.daemon.appendSystemPrompt = '<!-- agent-toolkit-paseo-context -->\nUser edit\n<!-- /agent-toolkit-paseo-context -->' },
  ]) {
    const value = structuredClone(base)
    mutate(value)
    assert.throws(() => prepareSetup(value))
  }
  const oneFamily = structuredClone(base)
  delete oneFamily.selections.claude
  const plan = prepareSetup(oneFamily)
  assert.equal(plan.profiles.length, 5)
  assert.ok(plan.profiles.every(p => p.provider === 'codex-work'))
})

test('profile-only setup preserves all prompt bytes and creates no context receipt; skipping both families is a no-op', t => {
  const f = fixture(t), config = configuration()
  config.daemon.appendSystemPrompt = 'Human text\n<!-- agent-toolkit-paseo-context -->\nUnowned custom context\n<!-- /agent-toolkit-paseo-context -->\n'
  const original = JSON.stringify(config)
  fs.writeFileSync(f.file, original)
  const value = input(config)
  delete value.installContext
  const plan = prepareSetup(value), writes = []
  assert.equal(plan.block, null)
  applySetup({ ...f, original, plan }, writer(f.file, writes))
  assert.deepEqual(writes, ['agentProfiles'])
  const current = JSON.parse(fs.readFileSync(f.file, 'utf8'))
  assert.equal(current.daemon.appendSystemPrompt, config.daemon.appendSystemPrompt)
  assert.equal(fs.readdirSync(f.dataRoot).filter(n => n.endsWith('.json')).length, 0)
  const skipped = prepareSetup({ ...value, config: current, selections: {} })
  const result = applySetup({ ...f, original: fs.readFileSync(f.file, 'utf8'), plan: skipped }, () => assert.fail('Skipped setup must not save'))
  assert.equal(result.backup, null)
})

test('concurrent edits stop writes; a failed native save stops the next phase and retains its backup', t => {
  const f = fixture(t), plan = prepareSetup(input(configuration()))
  fs.writeFileSync(f.file, '{"version":1,"human":"concurrent"}')
  assert.throws(() => applySetup({ ...f, plan }, () => assert.fail('No command after a concurrent edit')), /changed during setup/)
  fs.writeFileSync(f.file, f.original)
  const writes = [], save = writer(f.file, writes)
  assert.throws(() => applySetup({ ...f, plan }, args => { save(args); throw Error('Native reload failed after persistence') }), /partially saved.*private backup/)
  assert.deepEqual(writes, ['agentProfiles'])
  const current = JSON.parse(fs.readFileSync(f.file, 'utf8'))
  assert.equal(current.daemon.agentProfiles.length, 10)
  assert.equal(current.daemon.appendSystemPrompt, 'Human instructions.')
  assert.equal(fs.readdirSync(path.join(f.dataRoot, 'backups')).length, 1)
  fs.writeFileSync(f.file, f.original)
  const concurrentWrites = [], concurrentSave = writer(f.file, concurrentWrites)
  assert.throws(() => applySetup({ ...f, plan }, args => {
    concurrentSave(args)
    const changed = JSON.parse(fs.readFileSync(f.file, 'utf8'))
    changed.daemon.appendSystemPrompt = 'Human edit after profile persistence'
    fs.writeFileSync(f.file, JSON.stringify(changed))
  }), /Other configuration changed/)
  assert.deepEqual(concurrentWrites, ['agentProfiles'])
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).daemon.appendSystemPrompt, 'Human edit after profile persistence')
  fs.writeFileSync(f.file, f.original)
  const fileOnlyWrites = [], fileOnlySave = writer(f.file, fileOnlyWrites)
  assert.throws(() => applySetup({ ...f, plan }, args => {
    fileOnlySave(args)
    return { action: 'saved', applied: false }
  }), /runtime application needs human inspection/)
  assert.deepEqual(fileOnlyWrites, ['agentProfiles'])
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).daemon.appendSystemPrompt, 'Human instructions.')
})

test('prompt persistence followed by reload failure retains ownership for deliberate recovery', t => {
  const f = fixture(t), plan = prepareSetup(input(configuration())), writes = [], save = writer(f.file, writes)
  assert.throws(() => applySetup({ ...f, plan }, args => {
    save(args)
    if (args[3] === 'daemon.appendSystemPrompt') throw Error('Native reload failed after persistence')
  }), /partially saved/)
  const receipt = JSON.parse(fs.readFileSync(path.join(f.dataRoot, fs.readdirSync(f.dataRoot).find(n => n.endsWith('.json')))))
  const config = JSON.parse(fs.readFileSync(f.file, 'utf8'))
  const recovered = prepareSetup({ ...input(config), previousPrompt: receipt.prompt })
  assert.equal(recovered.prompt, config.daemon.appendSystemPrompt)
  config.daemon.appendSystemPrompt = config.daemon.appendSystemPrompt.replace(receipt.prompt, receipt.prompt.replace('\n', '\nHuman edit inside the owned block\n'))
  assert.throws(() => prepareSetup({ ...input(config), previousPrompt: receipt.prompt }), /reconciliation/)
})

test('the entry point rejects noninteractive execution before using any native host controls', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'paseo-setup.cjs')], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /trusted human terminal/)
})
