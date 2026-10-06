const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { planInstall, install } = require('./install.cjs')
const repo = path.resolve(__dirname, '..')

function fixture(t, checkout = repo) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const put = (file, content) => {
    file = path.join(home, file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }
  return { home, put, plan: (options = { installPi: true }) => planInstall({ repo: checkout, home, ...options }) }
}
const noDownload = (command, args) => {
  assert.equal(command, 'npm')
  assert.deepEqual(args.slice(0, 2), ['ci', '--prefix'])
  assert.ok(args.includes('--ignore-scripts'))
}

test('default reviewer networking updates selected homes, preserves user configuration and creates no config backups', t => {
  const f = fixture(t)
  const original = '# Human configuration\nmodel="chosen"\n\n[plugins."user@local"]\nenabled=true\n'
  const config = f.put('.codex-work/config.toml', original)
  const other = f.put('.codex-accounts/other/config.toml', 'model="other"\n')
  const claudeConfig = f.put('.claude-work/settings.json', '{\n// Human sandbox policy\n"model":"chosen", "sandbox":{"enabled":true,"allowUnsandboxedCommands":false,"network":{"allowedDomains":["github.com"]}},"permissions":{"deny":["Bash(git push *)"]}\n}\n')
  const options = { installPi: false, codexHome: path.dirname(config), claudeDir: path.dirname(claudeConfig) }
  const backup = install(f.plan(options), noDownload)
  const once = fs.readFileSync(config, 'utf8')
  const parsed = require('smol-toml').parse(once)
  assert.equal(parsed.sandbox_mode, 'workspace-write')
  assert.equal(parsed.approval_policy, 'on-request')
  assert.equal(parsed.approvals_reviewer, 'auto_review')
  assert.equal(parsed.sandbox_workspace_write.network_access, true)
  assert.equal(parsed.default_permissions, undefined)
  assert.equal(parsed.model, 'chosen')
  assert.equal(parsed.plugins['user@local'].enabled, true)
  assert.ok(once.includes('# Human configuration'))
  assert.equal(fs.readFileSync(other, 'utf8'), 'model="other"\n')
  assert.equal(fs.existsSync(path.join(backup, '.codex-work/config.toml')), false)
  const claudeOnce = fs.readFileSync(claudeConfig, 'utf8')
  const claude = require('jsonc-parser').parse(claudeOnce)
  assert.equal(claude.sandbox.enabled, true)
  assert.equal(claude.sandbox.autoAllowBashIfSandboxed, true)
  assert.equal(claude.sandbox.network.allowLocalBinding, true)
  assert.equal(claude.sandbox.allowUnsandboxedCommands, false)
  assert.deepEqual(claude.sandbox.network.allowedDomains, ['github.com', 'api.openai.com', 'chatgpt.com', 'auth.openai.com', 'api.anthropic.com'])
  assert.deepEqual(claude.permissions.deny, ['Bash(git push *)'])
  assert.equal(claude.model, 'chosen')
  assert.ok(claudeOnce.includes('// Human sandbox policy'))
  assert.equal(fs.existsSync(path.join(backup, '.claude-work/settings.json')), false)
  assert.match(fs.readFileSync(path.join(path.dirname(config), 'AGENTS.md'), 'utf8'), /authorizes scoped advisers/)
  assert.match(fs.readFileSync(path.join(path.dirname(claudeConfig), 'CLAUDE.md'), 'utf8'), /normal model requests/)
  install(f.plan(options), noDownload)
  assert.equal(fs.readFileSync(config, 'utf8'), once)
  assert.equal(fs.readFileSync(claudeConfig, 'utf8'), claudeOnce)
  install(f.plan({ ...options, reviewNetwork: false }), noDownload)
  assert.equal(fs.readFileSync(config, 'utf8'), once)
  assert.match(fs.readFileSync(path.join(path.dirname(config), 'AGENTS.md'), 'utf8'), /authorizes scoped advisers/)
})

test('failed default network installation restores config bytes and permissions without a persistent config backup', t => {
  const f = fixture(t)
  const original = 'model="chosen"\n[sandbox_workspace_write]\nnetwork_access=false\nwritable_roots=["/chosen"]\n'
  const config = f.put('.codex/config.toml', original)
  const claudeOriginal = '{"sandbox":{"enabled":true,"network":{"allowedDomains":["github.com"]}}}'
  const claude = f.put('.claude/settings.json', claudeOriginal)
  fs.chmodSync(config, 0o640)
  const symlink = fs.symlinkSync
  fs.symlinkSync = () => { throw Error('Fixture deployment failure') }
  try {
    assert.throws(() => install(f.plan({ installPi: false }), noDownload), /Fixture deployment failure/)
    assert.equal(fs.readFileSync(config, 'utf8'), original)
    assert.equal(fs.statSync(config).mode & 0o777, 0o640)
    assert.equal(fs.readFileSync(claude, 'utf8'), claudeOriginal)
  } finally { fs.symlinkSync = symlink }
})

test('an explicit Claude model-domain denial stops default setup before changing either provider', t => {
  const f = fixture(t)
  const config = f.put('.codex/config.toml', 'model="chosen"\n')
  for (const original of ['{"sandbox":{"network":{"deniedDomains":["*.openai.com"]}}}', '{"permissions":{"deny":["WebFetch(domain:api.openai.com)"]}}', '{"sandbox":{"network":{"deniedDomains":["api.openai.com:443"]}}}', '{"sandbox":{"network":{"deniedDomains":["*:443"]}}}']) {
    const claude = f.put('.claude/settings.json', original)
    assert.throws(() => f.plan({ installPi: false }), /explicitly denied/)
    assert.equal(fs.readFileSync(config, 'utf8'), 'model="chosen"\n')
    assert.equal(fs.readFileSync(claude, 'utf8'), original)
    assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit')), false)
  }
  f.put('.claude/settings.json', '{"sandbox":{"network":{"deniedDomains":["*:80"]}}}')
  assert.doesNotThrow(() => f.plan({ installPi: false }))
})

test('default setup refuses to replace existing Codex filesystem policies; permission-preserving setup leaves them intact', t => {
  const f = fixture(t)
  for (const original of ['sandbox_mode="read-only"\n', 'sandbox_mode="danger-full-access"\n', 'default_permissions="project-edit"\n[permissions.project-edit]\nextends=":workspace"\n[permissions.project-edit.filesystem.":workspace_roots"]\n"**/*.env"="deny"\n']) {
    const config = f.put('.codex/config.toml', original)
    assert.throws(() => f.plan({ installPi: false }), /existing filesystem policy/)
    assert.equal(fs.readFileSync(config, 'utf8'), original)
    assert.equal(fs.existsSync(path.join(f.home, '.claude/settings.json')), false)
    const plan = f.plan({ installPi: false, reviewNetwork: false })
    assert.equal(plan.files.has(config), false)
  }
})

test('legacy Pi skill preferences survive installation and obsolete directories still require reconciliation', t => {
  const f = fixture(t)
  const settings = f.put('.pi/agent/settings.json', JSON.stringify({ skills: { enableSkillCommands: false, customDirectories: ['~/my-skills'] } }))
  install(f.plan(), noDownload)
  const installed = JSON.parse(fs.readFileSync(settings, 'utf8'))
  assert.deepEqual(installed.skills, ['~/my-skills'])
  assert.equal(installed.enableSkillCommands, false)
  fs.writeFileSync(settings, JSON.stringify({ skills: { customDirectories: ['~/.codex/skills/autoreview'] } }))
  assert.throws(f.plan, /reconcile obsolete explicit paths/)
})

test('native Pi saves during resource deployment survive installer rollback', t => {
  const f = fixture(t)
  const settings = f.put('.pi/agent/settings.json', '{"theme":"before","packages":[]}')
  const plan = f.plan()
  const { execFileSync } = require('node:child_process')
  const sdk = path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent/dist/index.js')
  const rename = fs.renameSync
  fs.renameSync = (source, target) => {
    if (target === plan.resources) {
      const lock = settings + '.lock'
      if (fs.existsSync(lock)) fs.utimesSync(lock, new Date(0), new Date(0)) // Simulate deployment exceeding native lock expiry.
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {pathToFileURL} from 'node:url'; const {SettingsManager}=await import(pathToFileURL(process.argv[1]).href); const s=SettingsManager.create(process.argv[2],process.argv[3]); s.setTheme('during-deployment'); await s.flush(); if(s.drainErrors().length) process.exit(1);`, sdk, f.home, path.dirname(settings)], { encoding: 'utf8', timeout: 10000 })
      assert.equal(result.status, 0, result.stderr)
    }
    return rename(source, target)
  }
  try {
    assert.throws(() => install(plan, noDownload), /Pi settings changed during installation/)
    assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).theme, 'during-deployment')
    assert.equal(fs.existsSync(plan.resources), false)
    assert.equal(fs.existsSync(plan.receiptPath), false)
    assert.equal(fs.existsSync(settings + '.lock'), false)
  } finally { fs.renameSync = rename }
})

test('permission-preserving install and repeat install preserve configuration, instructions, accounts and both hosts', t => {
  const f = fixture(t)
  const piSettings = { defaultModel: 'chosen', defaultThinkingLevel: 'high', packages: ['npm:user-extension@1.0.0'], markdown: { codeBlockIndent: 'user' }, theme: 'chosen' }
  f.put('.pi/agent/settings.json', JSON.stringify(piSettings))
  const untouched = {
    '.codex/config.toml': 'model="selected"\napproval_policy="untrusted"\nsandbox_mode="read-only"\n',
    '.claude/settings.json': '{"model":"selected","permissions":{"deny":["Read(private)"]},"sandbox":{"enabled":true}}',
    '.paseo/config.json': '{"agents":{"providers":{"work":{"extends":"codex","env":{"CODEX_HOME":"/chosen"}}}},"daemon":{"appendSystemPrompt":"user"}}',
    '.agents/skills/paseo/SKILL.md': 'Official Paseo skill',
    '.claude/skills/paseo/SKILL.md': 'Official Claude Paseo skill',
    '.codex-accounts/work/auth.json': '{"tokens":{"refresh_token":"fixture-keep"}}',
    '.codex-accounts/work/config.toml': 'model="selected-account-model"\n',
    '.pi/agent/auth.json': '{"user":{"key":"fixture-keep"}}',
    '.pi/agent/auth-profiles/work/auth.json': '{"openai-codex":{"refresh":"fixture-keep"}}',
    '.pi/agent/extensions/orca-user.ts': 'user-owned Orca integration',
  }
  for (const [file, content] of Object.entries(untouched)) f.put(file, content)
  f.put('.codex/AGENTS.md', 'Human Codex instructions\n')
  f.put('.claude/CLAUDE.md', 'Human Claude instructions\n')
  f.put('.pi/agent/AGENTS.md', 'Human Pi instructions\n')
  f.put('.pi/web-search.json', '{"apiKey":"fixture-keep","allowBrowserCookies":true}')
  const backup = install(f.plan({ installPi: true, reviewNetwork: false }), noDownload)
  const resources = path.join(f.home, '.local/share/agent-toolkit/resources')
  const installedSkill = path.join(resources, 'skills/ponytail/SKILL.md')
  assert.ok(fs.statSync(installedSkill).isFile())
  assert.equal(fs.realpathSync(path.join(f.home, '.agents/skills/ponytail')), fs.realpathSync(path.join(f.home, '.claude/skills/ponytail')))
  assert.notEqual(fs.realpathSync(installedSkill), path.join(repo, 'skills/ponytail/SKILL.md'))
  for (const file of ['.codex/AGENTS.md', '.claude/CLAUDE.md', '.pi/agent/AGENTS.md', '.codex-accounts/work/AGENTS.md']) {
    const content = fs.readFileSync(path.join(f.home, file), 'utf8')
    assert.equal(content.split('<!-- agent-toolkit -->').length, 2)
    assert.ok(content.includes('reviews:off'))
    assert.ok(content.includes('hosts/paseo.md'))
    assert.ok(!content.includes('codex-yolo'))
  }
  assert.equal(fs.readFileSync(path.join(backup, '.codex/AGENTS.md'), 'utf8'), 'Human Codex instructions\n')
  const once = fs.readFileSync(path.join(f.home, '.pi/agent/settings.json'), 'utf8')
  install(f.plan({ installPi: true, reviewNetwork: false }), noDownload)
  assert.equal(fs.readFileSync(path.join(f.home, '.pi/agent/settings.json'), 'utf8'), once)
  const settings = JSON.parse(once)
  for (const [key, value] of Object.entries(piSettings)) if (key !== 'packages') assert.deepEqual(settings[key], value)
  assert.ok(settings.packages.includes('npm:user-extension@1.0.0'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, '.pi/web-search.json'), 'utf8')), { apiKey: 'fixture-keep', allowBrowserCookies: true, workflow: 'none' })
  for (const [file, content] of Object.entries(untouched)) assert.equal(fs.readFileSync(path.join(f.home, file), 'utf8'), content, file)
  assert.equal(fs.existsSync(path.join(f.home, '.local/bin/pi-yolo')), false)
  for (const command of ['pg-test', 'pg18-fresh']) assert.ok(fs.statSync(path.join(f.home, '.local/bin', command)).mode & 0o111, command + ' must be executable')
  assert.equal(fs.readFileSync(path.join(f.home, '.local/bin/pg-test'), 'utf8'), fs.readFileSync(path.join(repo, 'shared/postgres/pg-test.cjs'), 'utf8'))
  fs.appendFileSync(installedSkill, '\nUser installed edit\n')
  assert.throws(f.plan, /Manual reconciliation/)
  assert.ok(fs.readFileSync(installedSkill, 'utf8').endsWith('User installed edit\n'))

})

for (const provider of [
  { option: 'claudeDir', first: '.claude', second: '.claude-work', prompt: 'CLAUDE.md', directory: 'skills', source: 'skills', entry: 'SKILL.md', active: 'ponytail/SKILL.md' },
  { option: 'piDir', first: '.pi/agent', second: '.pi-work', prompt: 'AGENTS.md', directory: 'extensions', source: 'pi/extensions', entry: 'index.ts', active: 'review-mode/index.ts' },
]) test(`switching ${provider.option} preserves other installed homes and scopes obsolete-link cleanup`, t => {
  const f = fixture(t)
  const checkout = path.join(f.home, 'checkout')
  for (const directory of ['skills', 'pi/extensions', 'shared', 'vendor/agent-project-blueprint']) {
    fs.cpSync(path.join(repo, directory), path.join(checkout, directory), { recursive: true, filter: file => !['node_modules', '__pycache__', '.git'].includes(path.basename(file)) })
  }
  const obsoleteSource = f.put(`checkout/${provider.source}/retired-fixture/${provider.entry}`, provider.entry === 'SKILL.md' ? '---\nname: retired-fixture\ndescription: Fixture skill\n---\nFixture body\n' : 'export default function () {}\n')
  const first = path.join(f.home, provider.first), second = path.join(f.home, provider.second)
  f.put(`${provider.first}/${provider.prompt}`, 'Human first-home instructions\n')
  f.put(`${provider.second}/${provider.prompt}`, 'Human second-home instructions\n')
  const options = { repo: checkout, home: f.home, installPi: true }
  const deploy = directory => install(planInstall({ ...options, [provider.option]: directory }), noDownload)
  const receipt = () => JSON.parse(fs.readFileSync(path.join(f.home, '.local/share/agent-toolkit/installed.json')))
  deploy(first)
  const originalPrompt = fs.readFileSync(path.join(first, provider.prompt), 'utf8')
  const originalLinks = Object.entries(receipt().links).filter(([file]) => path.dirname(file) === path.join(first, provider.directory))
  assert.ok(originalLinks.length > 1)
  deploy(second)
  for (const [file, target] of originalLinks) {
    assert.equal(fs.readlinkSync(file), target)
    assert.equal(receipt().links[file], target)
  }
  assert.equal(fs.readFileSync(path.join(first, provider.prompt), 'utf8'), originalPrompt)
  assert.equal(fs.readFileSync(path.join(first, provider.directory, provider.active), 'utf8'), fs.readFileSync(path.join(second, provider.directory, provider.active), 'utf8'))
  const oldLink = path.join(first, provider.directory, 'retired-fixture')
  const currentLink = path.join(second, provider.directory, 'retired-fixture')
  fs.rmSync(path.dirname(obsoleteSource), { recursive: true })
  deploy(second)
  assert.equal(fs.lstatSync(oldLink).isSymbolicLink(), true)
  assert.equal(receipt().links[oldLink], originalLinks.find(([file]) => file === oldLink)[1])
  assert.equal(Object.hasOwn(receipt().links, currentLink), false)
  assert.throws(() => fs.lstatSync(currentLink), { code: 'ENOENT' })
  assert.equal(fs.readFileSync(path.join(first, provider.prompt), 'utf8'), originalPrompt)
  if (provider.option === 'piDir') {
    install(planInstall({ ...options, installPi: false, piDir: path.join(f.home, '.pi-third') }), noDownload)
    for (const directory of [first, second]) assert.ok(fs.statSync(path.join(directory, provider.directory, provider.active)).isFile())
    assert.ok(receipt().links[oldLink])
  }
  deploy(first)
  assert.equal(Object.hasOwn(receipt().links, oldLink), false)
  assert.throws(() => fs.lstatSync(oldLink), { code: 'ENOENT' })
  const secondLink = path.dirname(path.join(second, provider.directory, provider.active))
  assert.equal(receipt().links[secondLink], fs.readlinkSync(secondLink))
  assert.ok(fs.statSync(path.join(second, provider.directory, provider.active)).isFile())
  const firstLink = path.dirname(path.join(first, provider.directory, provider.active))
  const ownedTarget = receipt().links[firstLink]
  const userTarget = path.dirname(f.put(`user-${provider.option}/${path.basename(provider.active)}`, 'User replacement\n'))
  fs.unlinkSync(firstLink)
  fs.symlinkSync(userTarget, firstLink)
  deploy(second)
  assert.equal(fs.readlinkSync(firstLink), userTarget)
  assert.equal(receipt().links[firstLink], ownedTarget)
  assert.throws(() => deploy(first), /Manual reconciliation/)
})

test('migration retires only proven files with backups and stops before changing ambiguous settings or resources', t => {
  const f = fixture(t)
  const old = f.put('.local/bin/autoreview-yolo', '#!/bin/sh\nold Toolkit launcher\n')
  const marker = `${old}.agent-toolkit.sha256`
  fs.writeFileSync(marker, createHash('sha256').update(fs.readFileSync(old)).digest('hex') + '\n')
  f.put('.local/libexec/agent-toolkit/resources/user-note.txt', 'Keep ambiguous old snapshot')
  const unrelated = f.put('.local/bin/user-command', 'keep')
  const config = f.put('.pi/agent/settings.json', '{"packages":["git:github.com/DietrichGebert/ponytail@v4.9.0"]}')
  assert.throws(f.plan, /Manual reconciliation/)
  assert.ok(fs.existsSync(old))
  assert.ok(!fs.existsSync(path.join(f.home, '.local/share/agent-toolkit/resources')))
  fs.writeFileSync(config, '{}') // Explicit trusted reconciliation represented by the fixture owner.
  const backup = install(f.plan(), noDownload)
  assert.equal(fs.existsSync(old), false)
  assert.equal(fs.readFileSync(path.join(backup, '.local/bin/autoreview-yolo'), 'utf8'), '#!/bin/sh\nold Toolkit launcher\n')
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep')
  assert.equal(fs.readFileSync(path.join(f.home, '.local/libexec/agent-toolkit/resources/user-note.txt'), 'utf8'), 'Keep ambiguous old snapshot')
  f.put('.local/bin/codex-yolo', 'unverified')
  assert.throws(f.plan, /Manual reconciliation/)
})

test('changed instruction blocks and unrelated symlinks fail without overwriting the user', t => {
  const f = fixture(t)
  const original = f.put('user-skill/SKILL.md', 'user skill')
  fs.mkdirSync(path.join(f.home, '.claude/skills'), { recursive: true })
  fs.symlinkSync(path.dirname(original), path.join(f.home, '.claude/skills/python'))
  assert.throws(f.plan, /Manual reconciliation/)
  assert.equal(fs.readFileSync(original, 'utf8'), 'user skill')
  fs.unlinkSync(path.join(f.home, '.claude/skills/python'))
  install(f.plan(), noDownload)
  const prompt = path.join(f.home, '.codex/AGENTS.md')
  fs.writeFileSync(prompt, fs.readFileSync(prompt, 'utf8').replace('reviews:off', 'user change'))
  assert.throws(f.plan, /Manual reconciliation/)
  assert.ok(fs.readFileSync(prompt, 'utf8').includes('user change'))
})

test('installation from a noninteractive agent terminal refuses before deployment', () => {
  const result = spawnSync('/bin/bash', [path.join(repo, 'install.sh')], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /trusted human terminal/)
})

test('every Codex account being updated is checked before deployment', t => {
  const f = fixture(t)
  const config = f.put('.codex-accounts/work/config.toml', '[plugins."ponytail@ponytail"]\nenabled=true\n')
  for (const text of [
    '[plugins."ponytail@ponytail"]\nenabled=true\n',
    'model="chosen"\n  [plugins."ponytail@ponytail"]\n  enabled=true\n',
    'model="chosen"\nplugins = {"ponytail@ponytail" = {enabled = true}}\n',
    'plugins."ponytail@ponytail".enabled = true\n',
    '[plugins]\n"ponytail@ponytail" = {enabled = true}\n',
    '[plugins."ponytail@ponytail"]\n', // A registration without explicit disablement requires reconciliation.
  ]) {
    fs.writeFileSync(config, text)
    assert.throws(f.plan, error => /Manual reconciliation/.test(error.message) && error.message.includes(config), text)
    assert.equal(fs.readFileSync(config, 'utf8'), text)
  }
  assert.equal(fs.existsSync(path.join(f.home, '.codex-accounts/work/AGENTS.md')), false)
  assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit')), false)
  for (const text of [
    '  [plugins."ponytail@ponytail"]\n enabled=false # disabled by owner\n',
    'model="chosen"\nplugins = {"ponytail@ponytail" = {enabled = false}}\n',
    'plugins."ponytail@ponytail".enabled = false\n',
    'note = "ponytail@ponytail" # No active registration\n',
  ]) {
    fs.writeFileSync(config, text)
    assert.doesNotThrow(f.plan)
  }
  install(f.plan(), noDownload)
  assert.ok(fs.existsSync(path.join(f.home, '.codex-accounts/work/AGENTS.md')))
})

test('commented Claude and Paseo settings are checked without changing their bytes', t => {
  const f = fixture(t)
  const content = '{\n// user comment\n"url":"https://example.test/*keep*/",\n"quoted":"escaped \\" // keep",\n"items":[1, /* keep */],\n"enabledPlugins":{"ponytail@ponytail":false,},\n}\n'
  const configs = ['.claude/settings.json', '.paseo/config.json'].map(file => f.put(file, content))
  install(f.plan({ installPi: true, reviewNetwork: false }), noDownload)
  for (const config of configs) assert.equal(fs.readFileSync(config, 'utf8'), content)
  fs.writeFileSync(configs[0], content.replace(':false,', ':true,'))
  assert.throws(f.plan, /Manual reconciliation/)
  for (const invalid of ['{,}', '{"items":[,]}', '{"key":,}', '{"key":1,,}', '{} /* unfinished']) {
    fs.writeFileSync(configs[0], invalid)
    assert.throws(f.plan, SyntaxError)
  }
})

test('missing Pi permits shared installation and repeat installation without touching Pi state', t => {
  const f = fixture(t)
  const config = f.put('.pi/agent/settings.json', '{"packages":["user-owned-unsupported-package"]}')
  const before = fs.readFileSync(config, 'utf8')
  const previousPath = process.env.PATH
  let plan
  try {
    process.env.PATH = f.home // No Pi executable; use the real executable lookup.
    plan = f.plan({})
  } finally { process.env.PATH = previousPath }
  install(plan, noDownload)
  install(planInstall(plan.options), noDownload)
  assert.ok(fs.existsSync(path.join(f.home, '.codex/AGENTS.md')))
  assert.ok(fs.existsSync(path.join(f.home, '.claude/CLAUDE.md')))
  assert.ok(fs.existsSync(path.join(f.home, '.agents/skills/ponytail/SKILL.md')))
  assert.equal(fs.readFileSync(config, 'utf8'), before)
  for (const file of ['.pi/agent/AGENTS.md', '.pi/agent/extensions', '.pi/agent/settings.json.lock', '.pi/web-search.json']) assert.equal(fs.existsSync(path.join(f.home, file)), false, file)
  // Losing the CLI later must also preserve previously installed Pi links/ownership.
  install(f.plan(), noDownload)
  const installedSettings = fs.readFileSync(config, 'utf8')
  const extension = path.join(f.home, '.pi/agent/extensions/review-mode')
  const target = fs.readlinkSync(extension)
  install(planInstall(plan.options), noDownload)
  assert.equal(fs.readFileSync(config, 'utf8'), installedSettings)
  assert.equal(fs.readlinkSync(extension), target)
  const receipt = JSON.parse(fs.readFileSync(path.join(f.home, '.local/share/agent-toolkit/installed.json')))
  assert.equal(receipt.links[extension], target)
  install(f.plan(), noDownload) // Retained ownership still allows Pi installation later.
})


test('a deployed executable is a copy; changes made during staging are preserved; failed replacement restores original files', t => {
  const f = fixture(t)
  const checkout = path.join(f.home, 'checkout')
  for (const directory of ['skills', 'pi/extensions', 'shared', 'vendor/agent-project-blueprint']) {
    fs.cpSync(path.join(repo, directory), path.join(checkout, directory), { recursive: true, filter: file => !['node_modules', '__pycache__', '.git'].includes(path.basename(file)) })
  }
  const options = { repo: checkout, home: f.home, installPi: true }
  const initial = planInstall(options)
  install(initial, (command, args) => {
    noDownload(command, args)
    f.put('.pi/agent/settings.json', '{"theme":"changed-during-staging"}')
  })
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, '.pi/agent/settings.json'))).theme, 'changed-during-staging')
  const executable = path.join(f.home, '.local/bin/pg-test')
  const deployed = fs.readFileSync(executable, 'utf8')
  fs.appendFileSync(path.join(checkout, 'shared/postgres/pg-test.cjs'), '\n// checkout edit\n')
  assert.equal(fs.readFileSync(executable, 'utf8'), deployed)
  const piExtension = path.join(f.home, '.pi/agent/extensions/review-mode/index.ts')
  const piCode = fs.readFileSync(piExtension, 'utf8')
  const piSource = path.join(checkout, 'pi/extensions/review-mode/index.ts')
  fs.appendFileSync(piSource, '\n// new Pi extension code\n')
  const piDependency = f.put('.local/share/agent-toolkit/resources/pi/extensions/review-mode/node_modules/local-runtime/index.js', 'module.exports = "installed dependency"\n')
  const blueprint = path.join(f.home, '.local/share/agent-toolkit/resources/vendor/agent-project-blueprint/distribution/bootstrap-questionnaire.json')
  const blueprintCode = fs.readFileSync(blueprint, 'utf8')
  fs.appendFileSync(path.join(checkout, 'vendor/agent-project-blueprint/distribution/bootstrap-questionnaire.json'), '\n ')
  for (let repeat = 0; repeat < 2; repeat++) {
    install(planInstall({ ...options, installPi: false }), noDownload)
    assert.equal(fs.readFileSync(piExtension, 'utf8'), piCode, 'skipping Pi must preserve executable bytes behind discovery links')
    assert.equal(fs.readFileSync(piDependency, 'utf8'), 'module.exports = "installed dependency"\n', 'skipping Pi also preserves installed extension dependencies')
    assert.equal(fs.readFileSync(blueprint, 'utf8'), blueprintCode, 'skipping Pi also preserves its project blueprint')
  }
  const updated = fs.readFileSync(executable, 'utf8')
  assert.notEqual(updated, deployed, 'shared helpers still update when Pi is skipped')
  install(planInstall(options), noDownload)
  assert.equal(fs.readFileSync(piExtension, 'utf8'), fs.readFileSync(piSource, 'utf8'), 'a Pi installation updates the interface normally')
  const receipt = path.join(f.home, '.local/share/agent-toolkit/installed.json')
  const before = fs.readFileSync(receipt, 'utf8')
  const instructions = path.join(f.home, '.claude/CLAUDE.md')
  const previous = fs.readFileSync(instructions, 'utf8')
  fs.appendFileSync(path.join(checkout, 'shared/AGENTS.md'), '\nUpdated guidance\n')
  const temporary = `${instructions}.agent-toolkit-${process.pid}`
  f.put(path.relative(f.home, temporary), 'user file colliding with temporary output')
  assert.throws(() => install(planInstall(options), noDownload), /EEXIST/)
  assert.equal(fs.readFileSync(executable, 'utf8'), updated)
  assert.equal(fs.readFileSync(receipt, 'utf8'), before)
  assert.equal(fs.readFileSync(instructions, 'utf8'), previous)
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'user file colliding with temporary output')
  assert.equal(fs.existsSync(path.join(f.home, '.pi/agent/settings.json.lock')), false)
})

test('external provider homes can be backed up, reinstalled and restored across filesystems', t => {
  const f = fixture(t)
  const claudeDir = path.join(f.home, 'external-claude')
  f.put('external-claude/CLAUDE.md', 'Human instructions\n')
  const rename = fs.renameSync, symlink = fs.symlinkSync
  const crosses = (source, target) => source.startsWith(claudeDir + path.sep) !== target.startsWith(claudeDir + path.sep)
  fs.renameSync = (source, target) => {
    if (crosses(source, target)) throw Object.assign(Error('Cross-device rename'), { code: 'EXDEV' })
    return rename(source, target)
  }
  try {
    const options = { claudeDir, installPi: false }
    install(f.plan(options), noDownload)
    install(f.plan(options), noDownload)
    const prompt = path.join(claudeDir, 'CLAUDE.md'), skill = path.join(claudeDir, 'skills/ponytail')
    const before = fs.readFileSync(prompt, 'utf8'), target = fs.readlinkSync(skill)
    const receipt = path.join(f.home, '.local/share/agent-toolkit/installed.json')
    const ownership = fs.readFileSync(receipt, 'utf8')
    fs.symlinkSync = (source, file, ...args) => {
      if (file === skill) throw Error('Fixture replacement failure')
      return symlink(source, file, ...args)
    }
    assert.throws(() => install(f.plan(options), noDownload), /Fixture replacement failure/)
    assert.equal(fs.readFileSync(prompt, 'utf8'), before)
    assert.equal(fs.readlinkSync(skill), target)
    assert.equal(fs.readFileSync(receipt, 'utf8'), ownership)
    assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit/install.lock')), false)
  } finally { fs.renameSync = rename; fs.symlinkSync = symlink }
})
