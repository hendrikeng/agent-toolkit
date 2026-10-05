#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { parse, stringify } = require('smol-toml')
const { createHash } = require('node:crypto')
const jsonc = require('jsonc-parser')

// Installation cleanup only: these old Toolkit rules must not survive the rewrite.
const retired = new Set()
for (const command of ['rm *', 'rmdir *', 'unlink *', 'shred *', 'truncate *', 'dd *', 'sudo *', 'find * -delete*', 'git clean *', 'git reset --hard', 'git reset --hard *', 'git checkout -- *', 'git restore *', 'git branch -D *', 'git branch -d*', 'git branch --delete*', 'git push *--force*', 'git push -f*', 'git push * -f*', 'git push -*', 'git -* clean*', 'git -* reset --hard*', 'git -* checkout -- *', 'git -* restore *', 'git -* branch -D *', 'git -* branch -d*', 'git -* branch --delete*', 'git -* push *--force*', 'git -* push -f*', 'git -* push * -f*', 'env *', 'bash -c *', 'sh -c *', 'zsh -c *']) {
  retired.add(`Bash(${command})`)
  retired.add(`Bash(*/${command})`)
}
for (const command of ['command *', 'exec *', 'builtin *', 'git -*', '*/git *', 'dangerouslyDisableSandbox:true']) retired.add(`Bash(${command})`)
function configureClaude(text, home = os.homedir()) {
  const errors = []
  const settings = text.trim() ? require('jsonc-parser').parse(text, errors, { allowTrailingComma: true }) : {}
  if (errors.length) throw Error('Invalid Claude settings JSON')
  const oldRoots = [path.join(home, 'Code'), path.join(home, 'orca/workspaces')]
  const permissions = settings.permissions || {}
  for (const surface of ['allow', 'ask', 'deny']) if (permissions[surface]) permissions[surface] = permissions[surface].filter(rule => !retired.has(rule))
  if (permissions.additionalDirectories) permissions.additionalDirectories = permissions.additionalDirectories.filter(value => !oldRoots.includes(value))
  settings.permissions = permissions
  const sandbox = settings.sandbox || {}
  if (sandbox.filesystem?.allowWrite) sandbox.filesystem.allowWrite = sandbox.filesystem.allowWrite.filter(value => !oldRoots.includes(value))
  settings.sandbox = { ...sandbox, enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true, allowUnsandboxedCommands: false }
  settings.attribution = { ...settings.attribution, commit: '' }
  return JSON.stringify(settings, null, 2) + '\n'
}
function configureCodex(text) {
  const settings = parse(text)
  const permissions = settings.sandbox_mode === 'read-only' ? ':read-only' : ':workspace'
  delete settings.sandbox_mode
  delete settings.sandbox_workspace_write
  if (!settings.default_permissions) settings.default_permissions = permissions
  if (!settings.approval_policy || ['never', 'untrusted'].includes(settings.approval_policy)) settings.approval_policy = 'on-request'
  return stringify(settings)
}
function configurePaseo(text, rules, home = os.homedir()) {
  const errors = []
  const settings = jsonc.parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings) || settings.version !== undefined && settings.version !== 1) throw Error('Invalid Paseo config; use an existing version 1 daemon home')
  const prompt = settings.daemon?.appendSystemPrompt ?? ''
  if (typeof prompt !== 'string' || !rules.trim()) throw Error('Paseo prompt and shared rules must be strings with nonempty rules')
  const pattern = /<!-- agent-toolkit:paseo sha256:([a-f0-9]{64}) -->\n([\s\S]*?)\n<!-- \/agent-toolkit:paseo -->/g
  const blocks = [...prompt.matchAll(pattern)]
  const hash = value => createHash('sha256').update(value).digest('hex')
  if (blocks.length > 1 || (prompt.match(/<!-- agent-toolkit:paseo/g) ?? []).length !== blocks.length || (prompt.match(/<!-- \/agent-toolkit:paseo -->/g) ?? []).length !== blocks.length || blocks.some(match => hash(match[2]) !== match[1])) throw Error('Refusing to overwrite a changed or malformed Toolkit Paseo instruction block')
  const unmanaged = blocks.length ? prompt.replace(blocks[0][0], '') : prompt
  if (unmanaged.includes('# Agent Toolkit defaults') || unmanaged.includes(rules.trim())) throw Error('Toolkit rules already appear outside the managed Paseo block; reconcile the duplicate instructions before installation')
  const body = `Orchestration host: Paseo\n\nThis daemon configuration explicitly selects Paseo for native agent launches. It supplies coding guidance, not the managed terminal launchers' sandbox or private session directories. Keep Paseo's provider permissions; never broaden access or invent managed-session paths. Do not import or resume an Orca-owned provider session here without an explicit user handoff.\n\n${rules}`
  const block = `<!-- agent-toolkit:paseo sha256:${hash(body)} -->\n${body}\n<!-- /agent-toolkit:paseo -->`
  const appended = blocks.length ? prompt.slice(0, blocks[0].index) + block + prompt.slice(blocks[0].index + blocks[0][0].length) : prompt + (prompt ? '\n\n' : '') + block
  const edit = (keys, value) => { text = jsonc.applyEdits(text, jsonc.modify(text, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })) }
  edit(['daemon', 'appendSystemPrompt'], appended)
  edit(['daemon', 'mcp', 'enabled'], true)
  edit(['daemon', 'mcp', 'injectIntoAgents'], true)
  // Provider commands, models, accounts, permissions, profiles, and tool restrictions remain host-owned.
  const providers = settings.agents?.providers ?? {}
  for (const id of new Set(['claude', 'codex', ...Object.keys(providers).filter(id => ['claude', 'codex'].includes(providers[id]?.extends))])) {
    const owner = providers[id]?.env?.AGENT_TOOLKIT_ORCHESTRATION_HOST
    if (owner !== undefined && owner !== 'paseo') throw Error(`Conflicting orchestration owner for Paseo provider ${id}; choose Paseo explicitly before installation`)
    edit(['agents', 'providers', id, 'env', 'AGENT_TOOLKIT_ORCHESTRATION_HOST'], 'paseo')
  }
  if (settings.worktrees?.root === undefined) edit(['worktrees', 'root'], path.join(home, 'Code/paseo-worktrees'))
  return text
}
module.exports = { configureClaude, configureCodex, configurePaseo }
if (require.main === module) {
  const [host, target, check] = process.argv.slice(2)
  try {
    if (!['claude', 'codex', 'paseo'].includes(host) || !target || check !== undefined && check !== '--check') throw Error('Usage: configure.cjs claude|codex|paseo <configuration file> [--check]')
    const text = fs.readFileSync(target, 'utf8')
    const updated = host === 'claude' ? configureClaude(text) : host === 'codex' ? configureCodex(text) : configurePaseo(text, fs.readFileSync(path.join(__dirname, '../../pi/AGENTS.md'), 'utf8'))
    if (check !== '--check') fs.writeFileSync(target, updated)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
