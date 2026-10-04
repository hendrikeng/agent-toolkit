#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { parse, stringify } = require('smol-toml')

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
module.exports = { configureClaude, configureCodex }
if (require.main === module) {
  const [host, target] = process.argv.slice(2)
  try {
    if (!['claude', 'codex'].includes(host) || !target) throw Error('Usage: configure.cjs claude|codex <configuration file>')
    const text = fs.readFileSync(target, 'utf8')
    fs.writeFileSync(target, host === 'claude' ? configureClaude(text) : configureCodex(text))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
