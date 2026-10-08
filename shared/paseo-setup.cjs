#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const { createInterface } = require('node:readline/promises')
const begin = '<!-- agent-toolkit-paseo-context -->'
const end = '<!-- /agent-toolkit-paseo-context -->'
const modes = {
  codex: { auto: 'Default Permissions', 'auto-review': 'Auto-review' },
  claude: { default: 'Always Ask', acceptEdits: 'Accept File Edits', auto: 'Auto mode' },
}
function parse(text) {
  try {
    const errors = []
    const value = require('jsonc-parser').parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true })
    if (errors.length) throw Error('Invalid JSONC')
    return value
  }
  catch { throw Error('Invalid JSON configuration or resource. Inspect it privately; setup does not print its contents.') }
}
const json = file => parse(fs.readFileSync(file, 'utf8'))

function native(args) {
  try { return JSON.parse(execFileSync('paseo', [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })) }
  catch (error) { throw Error(`Paseo command failed (${error.code ?? error.status ?? 'invalid JSON'}). Stop and inspect the selected daemon; no retry or permission bypass was attempted.`) }
}

function prepareSetup({ config, presets, context, resources, previousPrompt, selections, providers, models, installContext = false }) {
  const profiles = config.daemon?.agentProfiles ?? []
  if (!Array.isArray(profiles) || profiles.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string')) throw Error('Invalid existing profile list.')
  if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw Error('Duplicate existing profile IDs require reconciliation.')
  const next = [...profiles], added = [], preserved = [], updated = []
  for (const preset of presets) {
    const matches = profiles.filter(p => p.name === preset.name)
    if (matches.length > 1) throw Error(`Ambiguous profile name: ${preset.name}`)
    if (matches.length) {
      const existing = matches[0], selection = selections.codex
      // 7f58ade/0f0d570 delivered Sol/High with these notes and either
      // supported mode. Older saved profiles can omit fast_mode. Receipts
      // own context only: main must explicitly confirm this candidate update.
      const legacy = {
        id: 'toolkit-codex-adviser', name: 'Toolkit Codex Adviser',
        provider: selection?.provider, model: 'gpt-6.1-sol', thinkingOptionId: 'high',
        modeId: existing.modeId, featureValues: existing.featureValues,
        notes: 'Use for a completed recommendation or second opinion on a bounded question. Require an analysis-only assignment with evidence, alternatives, and uncertainty. Do not edit, approve implementation, delegate, or publish.',
      }
      const features = isDeepStrictEqual(existing.featureValues, { plan_mode: false }) ||
        isDeepStrictEqual(existing.featureValues, { plan_mode: false, fast_mode: false })
      if (selection && preset.name === legacy.name && features &&
          Object.hasOwn(modes.codex, existing.modeId) && isDeepStrictEqual(existing, legacy)) {
        const provider = providers.find(p => p.provider === existing.provider)
        if (!provider || provider.status !== 'available' || provider.enabled !== 'Enabled' ||
            (existing.provider !== 'codex' && config.agents?.providers?.[existing.provider]?.extends !== 'codex') ||
            typeof provider.modes !== 'string' || !provider.modes.includes(modes.codex[existing.modeId]) ||
            !models[existing.provider]?.find(m => m.id === existing.model)?.thinkingOptionIds?.includes('medium')) {
          throw Error('Cannot validate the existing Toolkit Codex Adviser account/model/mode for Medium. No changes saved.')
        }
        next[next.indexOf(existing)] = { ...existing, thinkingOptionId: 'medium' }
        updated.push(existing.name)
      } else preserved.push(preset.name)
      continue
    }
    const family = preset.provider, selection = selections[family]
    if (!selection) continue
    if (!Object.hasOwn(modes[family] ?? {}, selection.modeId)) throw Error(`Select an explicit supported ${family} permission mode.`)
    const provider = providers.find(p => p.provider === selection.provider)
    if (!provider || provider.status !== 'available' || provider.enabled !== 'Enabled') throw Error(`Selected provider unavailable: ${selection.provider}`)
    if (selection.provider !== family && config.agents?.providers?.[selection.provider]?.extends !== family) throw Error(`Selected alias must extend ${family}: ${selection.provider}`)
    const modeId = preset.modeId === 'plan' ? 'plan' : selection.modeId
    const label = modeId === 'plan' ? 'Plan' : modes[family][modeId]
    if (typeof provider.modes !== 'string' || !provider.modes.includes(label)) throw Error(`Required mode unavailable for ${selection.provider}: ${modeId}`)
    const model = models[selection.provider]?.find(m => m.id === preset.model)
    if (!model?.thinkingOptionIds?.includes(preset.thinkingOptionId)) throw Error(`Required model/thinking unavailable for ${selection.provider}: ${preset.model}/${preset.thinkingOptionId}`)
    const id = preset.name.toLowerCase().replaceAll(' ', '-')
    if (next.some(p => p.id === id)) throw Error(`Profile ID collision: ${id}`)
    next.push({ ...preset, id, provider: selection.provider, modeId })
    added.push(preset.name)
  }
  const text = config.daemon?.appendSystemPrompt ?? ''
  if (typeof text !== 'string') throw Error('Invalid existing System Prompt.')
  if (!installContext) return { profiles: next, prompt: text, block: null, added, preserved, updated }
  const block = `${begin}\n${context.replaceAll('%TOOLKIT%', resources).trimEnd()}\n${end}`
  const start = text.indexOf(begin), stop = text.indexOf(end)
  let prompt
  if (start >= 0 || stop >= 0) {
    if (start < 0 || stop < start || text.indexOf(begin, start + begin.length) >= 0 || text.indexOf(end, stop + end.length) >= 0 || text.slice(start, stop + end.length) !== previousPrompt) throw Error('Changed or unowned Toolkit System Prompt block requires reconciliation.')
    prompt = text.slice(0, start) + block + text.slice(stop + end.length)
  } else prompt = text + (text ? '\n\n' : '') + block + '\n'
  return { profiles: next, prompt, block, added, preserved, updated }
}

function applySetup({ paseoHome, dataRoot, original, plan }, run = native) {
  const configPath = path.join(paseoHome, 'config.json')
  const receiptPath = path.join(dataRoot, `paseo-${createHash('sha256').update(paseoHome).digest('hex').slice(0, 16)}.json`)
  const unchanged = expected => {
    if (fs.readFileSync(configPath, 'utf8') !== expected) throw Error('Paseo configuration changed during setup. Stop without overwriting concurrent edits.')
  }
  const old = parse(original)
  const changeProfiles = !isDeepStrictEqual(old.daemon?.agentProfiles ?? [], plan.profiles)
  const changePrompt = (old.daemon?.appendSystemPrompt ?? '') !== plan.prompt
  unchanged(original)
  if (!changeProfiles && !changePrompt) return { added: [], updated: [], preserved: plan.preserved, backup: null }
  fs.mkdirSync(path.join(dataRoot, 'backups'), { recursive: true, mode: 0o700 })
  const backup = fs.mkdtempSync(path.join(dataRoot, 'backups/paseo-'))
  fs.writeFileSync(path.join(backup, 'config.json'), original, { mode: 0o600, flag: 'wx' })
  if (fs.existsSync(receiptPath)) fs.copyFileSync(receiptPath, path.join(backup, 'receipt.json'))
  let expected = original
  function save(field, value) {
    unchanged(expected)
    const before = parse(expected)
    // ponytail: native CLI has no compare-and-swap; keep the profile editor idle during setup.
    const result = run(['daemon', 'config', 'set', field, JSON.stringify(value), '--home', paseoHome])
    if (result?.applied === false || result?.overrideControlledPaths?.includes(field) || result?.restartRequiredPaths?.includes(field)) throw Error(`Saved ${field}, but its runtime application needs human inspection. No restart was attempted.`)
    expected = fs.readFileSync(configPath, 'utf8')
    const current = parse(expected)
    const key = field.slice('daemon.'.length)
    if (!isDeepStrictEqual(current.daemon?.[key], value)) throw Error(`Paseo did not persist the requested ${field}.`)
    before.daemon ??= {}
    before.daemon[key] = value
    if (!isDeepStrictEqual(before, current)) throw Error('Other configuration changed during the native save. Stop before further writes and inspect the backup.')
  }
  try {
    if (changeProfiles) save('daemon.agentProfiles', plan.profiles)
    if (changePrompt) save('daemon.appendSystemPrompt', plan.prompt)
    return { added: plan.added, updated: plan.updated, preserved: plan.preserved, backup }
  } catch (error) {
    throw Error(`${error.message} Setup can be partially saved. Inspect ${configPath} and private backup ${backup}; no automatic rollback or restart was attempted.`)
  } finally {
    // A native set can persist successfully and then fail while reloading. Retain
    // ownership only when the exact context is actually present, even on that path.
    try {
      if (plan.block !== null && json(configPath).daemon?.appendSystemPrompt === plan.prompt) {
        const temporary = `${receiptPath}.${process.pid}.tmp`
        fs.writeFileSync(temporary, JSON.stringify({ paseoHome, prompt: plan.block }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
        fs.renameSync(temporary, receiptPath)
      }
    } catch { throw Error(`Setup receipt could not be saved. Inspect ${configPath} and private backup ${backup} before retrying.`) }
  }
}

function installToolTrust({ paseoHome, resources }, run = native) {
  const id = 'agent-toolkit-paseo-tool-trust', source = path.join(resources, 'paseo/tool-trust')
  const installed = run(['plugin', 'ls', '--home', paseoHome])
  if (!Array.isArray(installed)) throw Error('Unexpected plugin discovery response.')
  const existing = installed.find(plugin => plugin.id === id)
  if (existing && (typeof existing.path !== 'string' || path.resolve(existing.path) !== source)) throw Error('Existing Paseo tool-trust plugin has another source. Reconcile it in your trusted terminal; nothing changed.')
  const enabled = run(['daemon', 'config', 'get', 'pluginsEnabled', '--home', paseoHome])
  if (enabled.path !== 'pluginsEnabled' || typeof enabled.set !== 'boolean') throw Error('Unexpected plugin trust configuration response.')
  if (!enabled.set || enabled.value !== true) {
    const result = run(['daemon', 'config', 'set', 'pluginsEnabled', 'true', '--home', paseoHome])
    if (result?.applied === false || result?.restartRequiredPaths?.includes('pluginsEnabled') || result?.overrideControlledPaths?.includes('pluginsEnabled')) throw Error('Plugin enablement needs human inspection; no restart attempted.')
  }
  if (!existing) run(['plugin', 'install', source, '--home', paseoHome])
  else if (existing.enabled !== true) run(['plugin', 'enable', id, '--home', paseoHome])
  else run(['plugin', 'reload', id, '--home', paseoHome])
  const plugins = run(['plugin', 'ls', '--home', paseoHome])
  if (!Array.isArray(plugins) || !plugins.some(plugin => plugin.id === 'agent-toolkit-paseo-tool-trust' && plugin.status === 'running')) throw Error('Paseo tool trust did not reach running status. Inspect native plugin logs; no retry attempted.')
}

async function main() {
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run ./setup-paseo.sh without arguments from a trusted human terminal.')
  const paseoHome = path.resolve(process.env.PASEO_HOME ?? path.join(os.homedir(), '.paseo'))
  const dataRoot = path.join(os.homedir(), '.local/share/agent-toolkit')
  const resources = path.join(dataRoot, 'resources')
  const configPath = path.join(paseoHome, 'config.json')
  for (const file of [paseoHome, configPath, dataRoot, resources]) if (fs.lstatSync(file).isSymbolicLink()) throw Error(`Refusing a symlink setup target: ${file}`)
  const presets = json(path.join(resources, 'shared/hosts/paseo-profiles.json'))
  const context = fs.readFileSync(path.join(resources, 'shared/hosts/paseo-context.md'), 'utf8')
  const original = fs.readFileSync(configPath, 'utf8'), config = parse(original)
  const saved = native(['daemon', 'config', 'get', 'daemon.agentProfiles', '--home', paseoHome])
  if (saved.path !== 'daemon.agentProfiles' || typeof saved.set !== 'boolean' || !isDeepStrictEqual(saved.set ? saved.value : [], config.daemon?.agentProfiles ?? [])) throw Error('Native profile discovery does not match the selected configuration. Stop before saving.')
  const providers = native(['provider', 'ls', '--home', paseoHome])
  if (!Array.isArray(providers)) throw Error('Unexpected provider discovery response.')
  const receiptPath = path.join(dataRoot, `paseo-${createHash('sha256').update(paseoHome).digest('hex').slice(0, 16)}.json`)
  if (fs.existsSync(receiptPath) && fs.lstatSync(receiptPath).isSymbolicLink()) throw Error('Refusing a symlink setup receipt.')
  const previousPrompt = fs.existsSync(receiptPath) ? json(receiptPath).prompt : undefined
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`Selected local Paseo home: ${paseoHome}\nUses installed resource copies. Customized profiles and human System Prompt text stay intact.\nDo not edit profiles in Paseo during setup. No worker is launched; existing provider security configuration stays intact.`)
    console.log('Available provider IDs: ' + providers.filter(p => p.status === 'available' && p.enabled === 'Enabled').map(p => p.provider).join(', '))
    const selections = {}, models = {}
    for (const family of ['codex', 'claude']) {
      const provider = (await terminal.question(`${family} provider/account alias (or - to skip) [${family}]: `)).trim() || family
      if (provider === '-') continue
      if (provider !== provider.toLowerCase()) throw Error('The inspected native model command lowercases provider IDs. This alias cannot be validated safely through that route; use the native profile editor without changing accounts.')
      const defaultMode = family === 'codex' ? 'auto-review' : 'auto'
      const modeId = (await terminal.question(`${family} permission mode (${Object.keys(modes[family]).join(', ')}) [${defaultMode}]: `)).trim() || defaultMode
      selections[family] = { provider, modeId }
      models[provider] = native(['provider', 'models', provider, '--thinking', '--home', paseoHome])
      if (!Array.isArray(models[provider])) throw Error(`Unexpected model discovery response: ${provider}`)
    }
    const installContext = (await terminal.question('Add/update compact Paseo context for default primary orchestration and Toolkit guidance references? [y/N]: ')).trim().toLowerCase() === 'y'
    const trustChoice = (await terminal.question('Trust all Paseo MCP calls for Codex/Claude? Enables trusted, unsandboxed plugins on this daemon. Shell and other MCP approvals stay unchanged. [Y/n]: ')).trim().toLowerCase()
    if (!['', 'y', 'n'].includes(trustChoice)) throw Error('Enter y or n for Paseo tool trust; no changes saved.')
    const trustTools = trustChoice !== 'n'
    const plan = prepareSetup({ config, presets, context, resources, previousPrompt, selections, providers, models, installContext })
    if (plan.updated.length) console.log('Review candidate: Toolkit Codex Adviser matches the legacy Sol/High preset. Receipts do not prove profile ownership. Save only if High was the Toolkit default, not your deliberate choice. Only Thinking changes to Medium; all other fields stay intact.')
    console.log(`Add: ${plan.added.join(', ') || 'none'}\nPreserve existing: ${plan.preserved.join(', ') || 'none'}\n${installContext ? 'Add/update only the owned, compact Paseo context in System Prompt.' : 'Leave the System Prompt unchanged.'}\n${trustTools ? 'Enable plugins and install Paseo MCP tool trust.' : 'Leave plugin trust unchanged.'} Provider modes and tool-injection settings stay unchanged.`)
    if ((await terminal.question(`Save these changes${plan.updated.length ? ', including Toolkit Codex Adviser High to Medium' : ''} through the native Paseo CLI? [y/N]: `)).trim().toLowerCase() !== 'y') { console.log('Cancelled. No changes saved.'); return }
    const result = applySetup({ paseoHome, dataRoot, original, plan })
    if (trustTools) installToolTrust({ paseoHome, resources })
    console.log(`Added ${result.added.length} profiles. Updated ${result.updated.length} profiles. ${result.backup ? `Private backup: ${result.backup}` : 'Profiles already configured.'}\nStart fresh Paseo sessions and verify effective settings, features, and skill loading. Tool injection still needs your deliberate host selection.`)
  } finally { terminal.close() }
}

module.exports = { prepareSetup, applySetup, installToolTrust }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
