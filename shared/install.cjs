#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')

const begin = '<!-- agent-toolkit -->'
const end = '<!-- /agent-toolkit -->'
const exists = file => { try { return fs.lstatSync(file) } catch (e) { if (e.code !== 'ENOENT') throw e } }
const hash = data => createHash('sha256').update(data).digest('hex')
const read = file => fs.readFileSync(file, 'utf8')
const refuse = file => { throw Error(`Manual reconciliation required: ${file}. Compare ownership and backups in a trusted human terminal; no installed files changed.`) }

// Configuration parsers read native formats without rewriting user files.
function parseJsonc(text) {
  const errors = []
  const value = require('jsonc-parser').parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new SyntaxError(`Invalid JSONC at offset ${errors[0].offset}`)
  return value
}

function codexNetworkConfig(text) {
  const toml = require('smol-toml'), expected = toml.parse(text)
  if (expected.default_permissions !== undefined || (expected.sandbox_mode !== undefined && expected.sandbox_mode !== 'workspace-write')) throw Error('Codex has an existing filesystem policy. Use --preserve-permissions or reconcile it in your trusted terminal.')
  const boundary = text.search(/^\s*\[/m)
  let root = boundary < 0 ? text : text.slice(0, boundary)
  let tables = boundary < 0 ? '' : text.slice(boundary)
  for (const [key, value] of Object.entries({ sandbox_mode: 'workspace-write', approval_policy: 'on-request', approvals_reviewer: 'auto_review' })) {
    const line = new RegExp(`^${key}\\s*=.*(?:\\n|$)`, 'm')
    if (Object.hasOwn(expected, key) && !line.test(root)) throw Error(`Cannot safely update Codex ${key}; use a plain top-level setting in your trusted terminal.`)
    root = root.replace(line, '')
    root += `${root && !root.endsWith('\n') ? '\n' : ''}${key} = ${JSON.stringify(value)}\n`
    expected[key] = value
  }
  const table = /^\[sandbox_workspace_write\][^\n]*\n([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m
  if (table.test(tables)) tables = tables.replace(table, (whole, body) => {
    const line = /^network_access\s*=.*(?:\n|$)/m
    return whole.slice(0, whole.length - body.length) + body.replace(line, '') + `${body && !body.endsWith('\n') ? '\n' : ''}network_access = true\n`
  })
  else tables += '\n[sandbox_workspace_write]\nnetwork_access = true\n'
  expected.sandbox_workspace_write ??= Object.create(null)
  expected.sandbox_workspace_write.network_access = true
  const result = root + tables
  if (!isDeepStrictEqual(toml.parse(result), expected)) throw Error('Cannot safely update Codex network settings; no installed files changed.')
  return result
}

function claudeReviewNetworkConfig(text) {
  const jsonc = require('jsonc-parser'), settings = parseJsonc(text)
  const domains = ['api.openai.com', 'chatgpt.com', 'auth.openai.com', 'api.anthropic.com']
  const denied = [...(settings.sandbox?.network?.deniedDomains ?? []), ...(settings.permissions?.deny ?? []).flatMap(rule => {
    const domain = /^WebFetch\(domain:(.+)\)$/.exec(rule)?.[1]
    return domain ? [domain] : []
  })]
  for (const pattern of denied) {
    const port = /:(\d+)$/.exec(pattern)
    if (port && Number(port[1]) !== 443) continue
    const host = port ? pattern.slice(0, port.index) : pattern
    const match = new RegExp('^' + host.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
    if (domains.some(domain => match.test(domain))) throw Error(`Claude reviewer domain is explicitly denied by ${pattern}; reconcile it in your trusted terminal.`)
  }
  for (const [keys, value] of [
    [['sandbox', 'enabled'], true],
    [['sandbox', 'autoAllowBashIfSandboxed'], true],
    [['sandbox', 'network', 'allowLocalBinding'], true],
    [['sandbox', 'network', 'allowedDomains'], [...new Set([...(settings.sandbox?.network?.allowedDomains ?? []), ...domains])]],
  ]) text = jsonc.applyEdits(text, jsonc.modify(text, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  return text
}

function treeHash(root) {
  if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) refuse(root)
  const entries = []
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (['node_modules', '__pycache__', '.DS_Store'].includes(name)) continue
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw Error(`Unexpected installed resource symlink: ${file}`)
      if (stat.isDirectory()) walk(file)
      else if (stat.isFile()) entries.push([path.relative(root, file), stat.mode & 0o777, hash(fs.readFileSync(file))])
      else throw Error(`Unexpected resource type: ${file}`)
    }
  }
  walk(root)
  return hash(JSON.stringify(entries))
}

function planInstall(options) {
  options = { ...options, reviewNetwork: options.reviewNetwork ?? true }
  const { repo, home, codexHome = path.join(home, '.codex'), claudeDir = path.join(home, '.claude'), paseoHome = path.join(home, '.paseo'), dataRoot = path.join(home, '.local/share/agent-toolkit') } = options
  for (const directory of [repo, home, codexHome, claudeDir, paseoHome, dataRoot]) {
    if (!path.isAbsolute(directory)) throw Error(`Expected absolute path: ${directory}`)
  }
  const resources = path.join(dataRoot, 'resources')
  const receiptPath = path.join(dataRoot, 'installed.json')
  if (exists(receiptPath)?.isSymbolicLink()) refuse(receiptPath)
  const receipt = exists(receiptPath) ? JSON.parse(read(receiptPath)) : { links: {}, prompts: {} }
  if (options.reviewNetwork) receipt.reviewNetworkPrompts = [...new Set([...(receipt.reviewNetworkPrompts ?? []), path.join(codexHome, 'AGENTS.md'), path.join(claudeDir, 'CLAUDE.md')])]
  if (exists(resources) && (!receipt.resourcesHash || treeHash(resources) !== receipt.resourcesHash)) refuse(resources)
  const legacy = path.join(home, '.local/libexec/agent-toolkit')
  const retire = new Set(), links = new Map(), files = new Map()
  const accountHomes = exists(path.join(home, '.codex-accounts')) ? fs.readdirSync(path.join(home, '.codex-accounts'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(home, '.codex-accounts', e.name)) : []
  const codexHomes = new Set([codexHome, ...accountHomes])
  function ownedLink(file, oldSources = []) {
    const stat = exists(file)
    if (!stat || retire.has(file)) return
    if (!stat.isSymbolicLink()) refuse(file)
    const target = path.resolve(path.dirname(file), fs.readlinkSync(file))
    if (target !== receipt.links[file] && !oldSources.includes(target)) refuse(file)
    retire.add(file)
  }
  function marked(file) {
    const stat = exists(file), marker = `${file}.agent-toolkit.sha256`
    if (!stat && !exists(marker)) return
    if (!stat?.isFile() || stat.isSymbolicLink() || !exists(marker)?.isFile() || exists(marker).isSymbolicLink() || hash(fs.readFileSync(file)) !== read(marker).trim()) refuse(file)
    retire.add(file); retire.add(marker)
  }
  function link(file, target, oldSources = []) {
    ownedLink(file, oldSources)
    links.set(file, target)
  }
  function prompt(file) {
    let text = ''
    const stat = exists(file)
    if (stat?.isSymbolicLink()) refuse(file)
    if (stat) {
      if (!stat.isFile()) refuse(file)
      text = read(file)
    }
    let body = read(path.join(repo, 'shared/AGENTS.md')).replaceAll('%TOOLKIT%', resources).trimEnd()
    if (receipt.reviewNetworkPrompts?.includes(file)) body += '\n\n## Authorized review and adviser model requests\n\nThe user authorizes normal model requests for requested AutoReview runs and reviews required by the Toolkit publication policy.\nUse Codex by default for these reviews, regardless of the implementation provider.\nIf Codex is unavailable or cannot complete the review, the user authorizes the helper\'s Claude engine as the fallback.\nThis does not authorize fallback after permission denials, approval-review rejections, isolation failures, or explicit task prohibitions.\nThe user also authorizes scoped advisers to read task-relevant private repository files when their investigations are authorized.\nThis includes sending selected source and context through the chosen provider\'s normal model requests.\nUse the authorized provider and exact account alias. Keep adviser scope and publication limits intact.\nThis does not authorize Cloud tasks, unrelated files, credentials, production data, account changes, or other provider changes.\nDo not add a separate consent question for these authorized model requests. Obey native denials and explicit task-specific restrictions.\n'
    const block = `${begin}\n${body}\n${end}`
    const start = text.indexOf(begin), stop = text.indexOf(end)
    if (start >= 0 || stop >= 0) {
      const previous = receipt.prompts[file]
      if (!previous || text.slice(start, stop + end.length) !== previous || text.indexOf(begin, start + begin.length) >= 0 || text.indexOf(end, stop + end.length) >= 0) refuse(file)
      text = text.slice(0, start) + block + text.slice(stop + end.length)
    } else {
      if (text.includes('# Agent Toolkit defaults')) refuse(file)
      text += `${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`
    }
    files.set(file, text)
    receipt.prompts[file] = block
  }

  // No ownership receipt exists for old global permission/plugin edits. Never infer
  // ownership from a generic native setting such as sandbox.enabled or approval_policy.
  for (const file of [path.join(claudeDir, 'settings.json'), ...Array.from(codexHomes, directory => path.join(directory, 'config.toml')), path.join(paseoHome, 'config.json')]) {
    if (!exists(file)) continue
    const text = read(file)
    const ponytail = file.endsWith('.toml') ? require('smol-toml').parse(text).plugins?.['ponytail@ponytail'] : undefined
    const activePonytail = file.endsWith('.toml')
      ? ponytail !== undefined && ponytail.enabled !== false
      : parseJsonc(text).enabledPlugins?.['ponytail@ponytail'] === true
    if (activePonytail || /agent-toolkit:paseo|# Agent Toolkit defaults|permissions\.agent_toolkit|agent-toolkit-development|agent-safety\.rules/.test(text)) refuse(file)
  }
  const networkConfigPaths = new Set()
  if (options.reviewNetwork) {
    for (const [file, configure, empty] of [
      [path.join(codexHome, 'config.toml'), codexNetworkConfig, ''],
      [path.join(claudeDir, 'settings.json'), claudeReviewNetworkConfig, '{}\n'],
    ]) {
      if (exists(file)?.isSymbolicLink()) refuse(file)
      files.set(file, configure(exists(file) ? read(file) : empty))
      networkConfigPaths.add(file)
    }
  }

  for (const directory of codexHomes) {
    if (exists(path.join(directory, 'AGENTS.override.md'))) refuse(path.join(directory, 'AGENTS.override.md'))
    prompt(path.join(directory, 'AGENTS.md'))
    for (const name of ['agent-safety.rules', 'agent-toolkit-development.rules']) {
      const file = path.join(directory, 'rules', name)
      if (exists(file)?.isSymbolicLink()) ownedLink(file, [path.join(home, '.codex/rules', name)])
      else marked(file)
    }
  }
  prompt(path.join(claudeDir, 'CLAUDE.md'))
  for (const name of fs.readdirSync(path.join(repo, 'skills'))) {
    const oldSources = name === 'autoreview' ? [path.join(repo, 'codex/skills/autoreview'), path.join(legacy, 'resources/codex/skills/autoreview')] : []
    link(path.join(home, '.agents/skills', name), path.join(resources, 'skills', name), oldSources)
    link(path.join(claudeDir, 'skills', name), path.join(resources, 'skills', name), oldSources)
    for (const directory of codexHomes) ownedLink(path.join(directory, 'skills', name), oldSources)
  }
  for (const name of ['codex-yolo', 'claude-yolo', 'autoreview-yolo', 'pg18-fresh-yolo', 'repo-delete']) marked(path.join(home, '.local/bin', name))
  for (const name of ['autoreview', 'development-policy.cjs', 'development.rules', 'pg18-fresh-yolo', 'repository-trust.cjs', 'git', 'open', 'pg-test', 'package.json', 'package-lock.json']) marked(path.join(legacy, name))
  for (const [command, filename] of [['pg-test', 'shared/postgres/pg-test.cjs'], ['pg18-fresh', 'shared/postgres/pg18-fresh.cjs'], ['paseo-service', 'shared/paseo-service.cjs']]) {
    const file = path.join(home, '.local/bin', command)
    if (exists(file)?.isFile()) marked(file)
    link(file, path.join(resources, filename), [])
  }
  if (process.platform === 'darwin') for (const command of ['agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep', 'agent-display-off']) {
    const file = path.join(home, '.local/bin', command)
    if (exists(file)?.isFile()) marked(file)
    const script = command === 'agent-display-off' ? command : 'agent-awake'
    link(file, path.join(resources, 'shared/macos', script), script === 'agent-awake' ? [path.join(home, '.local/bin/agent-awake')] : [])
  }
  // Retire obsolete discovery links only in the folders this installation updates.
  const linkDirectories = new Set([
    path.join(home, '.agents/skills'), path.join(claudeDir, 'skills'), path.join(home, '.local/bin'),
    ...Array.from(codexHomes, directory => path.join(directory, 'skills')),
  ])
  for (const file of Object.keys(receipt.links)) {
    if (links.has(file) || (!retire.has(file) && !linkDirectories.has(path.dirname(file)))) continue
    ownedLink(file)
    delete receipt.links[file]
  }
  // Refuse symlink ancestors: copying through one can change another account or checkout.
  for (const file of [...retire, ...links.keys(), ...files.keys(), resources, receiptPath]) {
    for (let parent = path.dirname(file); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (exists(parent)?.isSymbolicLink()) refuse(parent)
    }
  }
  return { options, repo, home, dataRoot, resources, receiptPath, receipt, retire, links, files, networkConfigPaths }
}

function install(plan, run = execFileSync) {
  const { repo, resources, dataRoot, receiptPath } = plan
  fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const lock = path.join(dataRoot, 'install.lock')
  fs.mkdirSync(lock) // A crashed install requires inspection; never steal its lock.
  let stage
  const restored = [], created = []
  const configRollback = []
  let backup
  function writeNew(file, content) {
    const descriptor = fs.openSync(file, 'wx', 0o600)
    created.push(file)
    try { fs.writeFileSync(descriptor, content) }
    finally { fs.closeSync(descriptor) }
  }
  function transfer(source, target) {
    try { fs.renameSync(source, target) }
    catch (error) {
      if (error.code !== 'EXDEV') throw error
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, preserveTimestamps: true })
      fs.rmSync(source, { recursive: true })
    }
  }
  try {
    stage = fs.mkdtempSync(path.join(dataRoot, '.install-'))
    backup = path.join(dataRoot, 'backups', path.basename(stage).replace('.install-', `${Date.now()}-`))
    const copy = (source, target) => fs.cpSync(source, target, { recursive: true, filter: file => !['.git', 'node_modules', '__pycache__', '.DS_Store'].includes(path.basename(file)) })
    for (const directory of ['skills', 'shared/hosts', 'shared/postgres', 'shared/macos', 'paseo/tool-trust']) {
      copy(path.join(repo, directory), path.join(stage, directory))
    }
    fs.copyFileSync(path.join(repo, 'shared/AGENTS.md'), path.join(stage, 'shared/AGENTS.md'))
    fs.copyFileSync(path.join(repo, 'shared/paseo-service.cjs'), path.join(stage, 'shared/paseo-service.cjs'))
    fs.mkdirSync(path.join(stage, 'docs'), { recursive: true })
    fs.copyFileSync(path.join(repo, 'docs/paseo-worktrees.md'), path.join(stage, 'docs/paseo-worktrees.md'))
    run('npm', ['ci', '--prefix', path.join(stage, 'skills/react-doctor'), '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' })
    treeHash(stage) // Reject source symlinks before changing an installed resource.
    // Re-read after staging: preserve edits made while npm ran.
    plan = planInstall(plan.options)
    const { receipt, files, links, retire } = plan
    function move(file) {
      if (!exists(file)) return
      if (plan.networkConfigPaths.has(file)) {
        const original = { file, content: fs.readFileSync(file), mode: fs.statSync(file).mode & 0o777 }
        fs.unlinkSync(file)
        configRollback.push(original)
        return
      }
      const relative = path.relative(plan.home, file)
      const destination = path.join(backup, relative.startsWith('..') ? path.join('external', file.slice(1)) : relative)
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
      transfer(file, destination)
      restored.push([file, destination])
    }
    const replacements = new Set([...retire, ...links.keys(), resources, receiptPath])
    for (const [file, content] of files) if (!exists(file) || read(file) !== content) replacements.add(file)
    for (const file of replacements) move(file)
    fs.renameSync(stage, resources)
    created.push(resources)
    for (const [file, content] of files) {
      if (!replacements.has(file)) continue
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temporary = `${file}.agent-toolkit-${process.pid}`
      writeNew(temporary, content)
      fs.renameSync(temporary, file)
      created.push(file)
    }
    for (const [file, target] of links) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.symlinkSync(target, file)
      created.push(file)
    }
    receipt.links = { ...receipt.links, ...Object.fromEntries(links) }
    receipt.resourcesHash = treeHash(resources)
    writeNew(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
    return backup
  } catch (error) {
    try {
      for (const file of created.reverse()) fs.rmSync(file, { recursive: true, force: true })
      for (const { file, content, mode } of configRollback) fs.writeFileSync(file, content, { flag: 'wx', mode })
      for (const [file, destination] of restored.reverse()) transfer(destination, file)
    } catch (rollback) {
      throw Error(`Installation failed: ${error.message}. Recovery failed: ${rollback.message}. Inspect backups in ${backup} before retrying.`)
    }
    throw error
  } finally {
    if (stage && exists(stage)) fs.rmSync(stage, { recursive: true })
    fs.rmdirSync(lock)
  }
}

module.exports = { planInstall, install }
if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    if ((args.length && (args.length !== 1 || !['--review-network', '--preserve-permissions'].includes(args[0]))) || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run ./install.sh [--preserve-permissions] from a trusted human terminal.')
    if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node.js 24 is required.')
    const home = os.homedir(), repo = path.resolve(__dirname, '..')
    execFileSync('npm', ['ci', '--prefix', __dirname, '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' })
    const plan = planInstall({ repo, home, reviewNetwork: !args.includes('--preserve-permissions'), codexHome: process.env.CODEX_HOME, claudeDir: process.env.CLAUDE_CONFIG_DIR, paseoHome: process.env.PASEO_HOME })
    const backup = install(plan)
    console.log(`Installed copied resources. Backups: ${backup}\n${plan.options.reviewNetwork ? 'Codex workspace network access and automatic approval review enabled; Claude sandbox auto-allow, reviewer model domains and local test networking enabled. No persistent config backups created.' : 'Provider permissions were not changed.'}\nStart fresh sessions with your normal provider commands. Paseo settings were not changed.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
