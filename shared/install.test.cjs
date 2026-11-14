const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
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
  return { home, put, plan: (options = {}) => planInstall({ repo: checkout, home, ...options }) }
}
// A Git checkout copy: the installer reads the tracked skill list from Git.
function checkout(f) {
  const directory = path.join(f.home, 'checkout')
  for (const entry of ['skills', 'shared', 'paseo/tool-trust', 'docs/paseo-worktrees.md', 'docs/claude-sandbox.md', 'docs/code-review.md']) {
    fs.cpSync(path.join(repo, entry), path.join(directory, entry), { recursive: true, filter: file => !['node_modules', '__pycache__', '.git'].includes(path.basename(file)) })
  }
  const git = (...args) => spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' })
  git('init', '-q')
  return { directory, track: () => assert.equal(git('add', '-A').status, 0) }
}

test('default reviewer networking updates selected homes, preserves user configuration and backs up each changed config once', t => {
  const f = fixture(t)
  const original = '# Human configuration\nmodel="chosen"\n\n[plugins."user@local"]\nenabled=true\n'
  const config = f.put('.codex-work/config.toml', original)
  const other = f.put('.codex-accounts/other/config.toml', 'model="other"\n')
  const claudeOriginal = '{\n// Human sandbox policy\n"model":"chosen", "sandbox":{"enabled":true,"allowUnsandboxedCommands":false,"network":{"allowedDomains":["github.com"]}},"permissions":{"deny":["Bash(git push *)"]}\n}\n'
  const claudeConfig = f.put('.claude-work/settings.json', claudeOriginal)
  const options = { codexHome: path.dirname(config), claudeDir: path.dirname(claudeConfig) }
  const backup = install(f.plan(options))
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
  assert.equal(fs.readFileSync(path.join(backup, '.codex-work/config.toml'), 'utf8'), original)
  const claudeOnce = fs.readFileSync(claudeConfig, 'utf8')
  const claude = require('jsonc-parser').parse(claudeOnce)
  // Only scripts/apply-claude-sandbox.sh sets sandbox switches; the installer adds reviewer domains.
  assert.deepEqual(Object.keys(claude.sandbox), ['enabled', 'allowUnsandboxedCommands', 'network'])
  assert.deepEqual(Object.keys(claude.sandbox.network), ['allowedDomains'])
  assert.deepEqual(claude.sandbox.network.allowedDomains, ['github.com', 'api.openai.com', 'chatgpt.com', 'auth.openai.com', 'api.anthropic.com'])
  assert.deepEqual(claude.permissions.deny, ['Bash(git push *)'])
  assert.equal(claude.model, 'chosen')
  assert.ok(claudeOnce.includes('// Human sandbox policy'))
  assert.equal(fs.readFileSync(path.join(backup, '.claude-work/settings.json'), 'utf8'), claudeOriginal)
  assert.match(fs.readFileSync(path.join(path.dirname(config), 'AGENTS.md'), 'utf8'), /authorizes scoped advisers/)
  assert.match(fs.readFileSync(path.join(path.dirname(claudeConfig), 'CLAUDE.md'), 'utf8'), /normal model requests/)
  for (const prompt of [path.join(path.dirname(config), 'AGENTS.md'), path.join(path.dirname(claudeConfig), 'CLAUDE.md')]) {
    const content = fs.readFileSync(prompt, 'utf8')
    assert.match(content, /Switching a review to another provider needs explicit user authorization/)
    assert.doesNotMatch(content, /AutoReview/)
    assert.doesNotMatch(content, /regardless of the implementation provider/)
  }
  const repeat = install(f.plan(options))
  assert.equal(fs.readFileSync(config, 'utf8'), once)
  assert.equal(fs.readFileSync(claudeConfig, 'utf8'), claudeOnce)
  assert.equal(fs.existsSync(path.join(repeat, '.codex-work/config.toml')), false)
  assert.equal(fs.existsSync(path.join(repeat, '.claude-work/settings.json')), false)
  install(f.plan({ ...options, reviewNetwork: false }))
  assert.equal(fs.readFileSync(config, 'utf8'), once)
  assert.match(fs.readFileSync(path.join(path.dirname(config), 'AGENTS.md'), 'utf8'), /authorizes scoped advisers/)
})

test('default setup never creates a Claude sandbox or settings file', t => {
  const f = fixture(t)
  // A WebFetch denial without a sandbox object changes nothing, so it does not stop setup.
  const withoutSandbox = '{"model":"chosen","permissions":{"deny":["WebFetch(domain:api.openai.com)"]}}\n'
  const claude = f.put('.claude/settings.json', withoutSandbox)
  install(f.plan({}))
  assert.equal(fs.readFileSync(claude, 'utf8'), withoutSandbox)
  const other = path.join(f.home, '.claude-other')
  install(f.plan({ claudeDir: other }))
  assert.equal(fs.existsSync(path.join(other, 'settings.json')), false)
})

test('failed default network installation restores config bytes and permissions', t => {
  const f = fixture(t)
  const original = 'model="chosen"\n[sandbox_workspace_write]\nnetwork_access=false\nwritable_roots=["/chosen"]\n'
  const config = f.put('.codex/config.toml', original)
  const claudeOriginal = '{"sandbox":{"enabled":true,"network":{"allowedDomains":["github.com"]}}}'
  const claude = f.put('.claude/settings.json', claudeOriginal)
  fs.chmodSync(config, 0o640)
  const symlink = fs.symlinkSync
  fs.symlinkSync = () => { throw Error('Fixture deployment failure') }
  try {
    assert.throws(() => install(f.plan({})), /Fixture deployment failure/)
    assert.equal(fs.readFileSync(config, 'utf8'), original)
    assert.equal(fs.statSync(config).mode & 0o777, 0o640)
    assert.equal(fs.readFileSync(claude, 'utf8'), claudeOriginal)
  } finally { fs.symlinkSync = symlink }
})

test('an explicit Claude model-domain denial stops default setup before changing either provider', t => {
  const f = fixture(t)
  const config = f.put('.codex/config.toml', 'model="chosen"\n')
  for (const original of ['{"sandbox":{"network":{"deniedDomains":["*.openai.com"]}}}', '{"sandbox":{},"permissions":{"deny":["WebFetch(domain:api.openai.com)"]}}', '{"sandbox":{"network":{"deniedDomains":["api.openai.com:443"]}}}', '{"sandbox":{"network":{"deniedDomains":["*:443"]}}}']) {
    const claude = f.put('.claude/settings.json', original)
    assert.throws(() => f.plan({}), /explicitly denied/)
    assert.equal(fs.readFileSync(config, 'utf8'), 'model="chosen"\n')
    assert.equal(fs.readFileSync(claude, 'utf8'), original)
    assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit')), false)
  }
  f.put('.claude/settings.json', '{"sandbox":{"network":{"deniedDomains":["*:80"]}}}')
  assert.doesNotThrow(() => f.plan({}))
})

test('default setup refuses to replace existing Codex filesystem policies; permission-preserving setup leaves them intact', t => {
  const f = fixture(t)
  for (const original of ['sandbox_mode="read-only"\n', 'sandbox_mode="danger-full-access"\n', 'default_permissions="project-edit"\n[permissions.project-edit]\nextends=":workspace"\n[permissions.project-edit.filesystem.":workspace_roots"]\n"**/*.env"="deny"\n']) {
    const config = f.put('.codex/config.toml', original)
    assert.throws(() => f.plan({}), /existing filesystem policy/)
    assert.equal(fs.readFileSync(config, 'utf8'), original)
    assert.equal(fs.existsSync(path.join(f.home, '.claude/settings.json')), false)
    const plan = f.plan({ reviewNetwork: false })
    assert.equal(plan.files.has(config), false)
  }
})

test('permission-preserving install and repeat install preserve configuration, instructions, accounts and Paseo', t => {
  const f = fixture(t)
  const untouched = {
    '.codex/config.toml': 'model="selected"\napproval_policy="untrusted"\nsandbox_mode="read-only"\n',
    '.claude/settings.json': '{"model":"selected","permissions":{"deny":["Read(private)"]},"sandbox":{"enabled":true}}',
    '.paseo/config.json': '{"agents":{"providers":{"work":{"extends":"codex","env":{"CODEX_HOME":"/chosen"}}}},"daemon":{"appendSystemPrompt":"user"}}',
    '.agents/skills/paseo/SKILL.md': 'Official Paseo skill',
    '.claude/skills/paseo/SKILL.md': 'Official Claude Paseo skill',
    '.codex-accounts/work/auth.json': '{"tokens":{"refresh_token":"fixture-keep"}}',
    '.codex-accounts/work/config.toml': 'model="selected-account-model"\n',
  }
  for (const [file, content] of Object.entries(untouched)) f.put(file, content)
  f.put('.codex/AGENTS.md', 'Human Codex instructions\n')
  f.put('.claude/CLAUDE.md', 'Human Claude instructions\n')
  const backup = install(f.plan({ reviewNetwork: false }))
  const resources = path.join(f.home, '.local/share/agent-toolkit/resources')
  const installedSkill = path.join(resources, 'skills/ponytail/SKILL.md')
  assert.ok(fs.statSync(installedSkill).isFile())
  assert.equal(fs.realpathSync(path.join(f.home, '.agents/skills/ponytail')), fs.realpathSync(path.join(f.home, '.claude/skills/ponytail')))
  assert.notEqual(fs.realpathSync(installedSkill), path.join(repo, 'skills/ponytail/SKILL.md'))
  for (const file of ['.codex/AGENTS.md', '.claude/CLAUDE.md', '.codex-accounts/work/AGENTS.md']) {
    const content = fs.readFileSync(path.join(f.home, file), 'utf8')
    assert.equal(content.split('<!-- agent-toolkit -->').length, 2)
    assert.ok(content.includes('reviews:off'))
    assert.ok(content.includes('hosts/paseo.md'))
  }
  assert.equal(fs.readFileSync(path.join(backup, '.codex/AGENTS.md'), 'utf8'), 'Human Codex instructions\n')
  const repeat = install(f.plan({ reviewNetwork: false }))
  // Unchanged resources are verified against the receipt, so the old copy is removed, not backed up.
  assert.equal(fs.existsSync(path.join(repeat, '.local/share/agent-toolkit/resources')), false)
  assert.deepEqual(fs.readdirSync(path.join(f.home, '.local/share/agent-toolkit')).filter(name => name.startsWith('.install-')), [])
  for (const [file, content] of Object.entries(untouched)) assert.equal(fs.readFileSync(path.join(f.home, file), 'utf8'), content, file)
  for (const command of ['pg-test', 'pg18-fresh', 'paseo-service', 'agent-heavy', 'agent-stop']) assert.ok(fs.statSync(path.join(f.home, '.local/bin', command)).mode & 0o111, command + ' must be executable')
  assert.equal(fs.readFileSync(path.join(f.home, '.local/bin/pg-test'), 'utf8'), fs.readFileSync(path.join(repo, 'shared/postgres/pg-test.cjs'), 'utf8'))
  const pairing = spawnSync(process.execPath, [path.join(f.home, '.local/bin/paseo-service')], { encoding: 'utf8', env: { PATH: process.env.PATH } })
  assert.equal(pairing.status, 1)
  assert.match(pairing.stderr, /Usage: paseo-service/)
  assert.equal(fs.readFileSync(path.join(f.home, '.local/share/agent-toolkit/resources/docs/paseo-worktrees.md'), 'utf8'), fs.readFileSync(path.join(repo, 'docs/paseo-worktrees.md'), 'utf8'))
  fs.appendFileSync(installedSkill, '\nUser installed edit\n')
  assert.throws(f.plan, /Manual reconciliation/)
  assert.ok(fs.readFileSync(installedSkill, 'utf8').endsWith('User installed edit\n'))

})

for (const provider of [
  { option: 'claudeDir', first: '.claude', second: '.claude-work', prompt: 'CLAUDE.md', directory: 'skills', source: 'skills', entry: 'SKILL.md', active: 'ponytail/SKILL.md' },
]) test(`switching ${provider.option} preserves other installed homes and scopes obsolete-link cleanup`, t => {
  const f = fixture(t)
  const { directory: checkoutDirectory, track } = checkout(f)
  const obsoleteSource = f.put(`checkout/${provider.source}/retired-fixture/${provider.entry}`, provider.entry === 'SKILL.md' ? '---\nname: retired-fixture\ndescription: Fixture skill\n---\nFixture body\n' : 'export default function () {}\n')
  const first = path.join(f.home, provider.first), second = path.join(f.home, provider.second)
  f.put(`${provider.first}/${provider.prompt}`, 'Human first-home instructions\n')
  f.put(`${provider.second}/${provider.prompt}`, 'Human second-home instructions\n')
  track()
  const options = { repo: checkoutDirectory, home: f.home }
  const deploy = directory => install(planInstall({ ...options, [provider.option]: directory }))
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
  track()
  deploy(second)
  assert.equal(fs.lstatSync(oldLink).isSymbolicLink(), true)
  assert.equal(receipt().links[oldLink], originalLinks.find(([file]) => file === oldLink)[1])
  assert.equal(Object.hasOwn(receipt().links, currentLink), false)
  assert.throws(() => fs.lstatSync(currentLink), { code: 'ENOENT' })
  assert.equal(fs.readFileSync(path.join(first, provider.prompt), 'utf8'), originalPrompt)
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

test('changed instruction blocks and unrelated symlinks fail without overwriting the user', t => {
  const f = fixture(t)
  const original = f.put('user-skill/SKILL.md', 'user skill')
  fs.mkdirSync(path.join(f.home, '.claude/skills'), { recursive: true })
  fs.symlinkSync(path.dirname(original), path.join(f.home, '.claude/skills/python'))
  assert.throws(f.plan, /Manual reconciliation/)
  assert.equal(fs.readFileSync(original, 'utf8'), 'user skill')
  fs.unlinkSync(path.join(f.home, '.claude/skills/python'))
  install(f.plan())
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
  install(f.plan())
  assert.ok(fs.existsSync(path.join(f.home, '.codex-accounts/work/AGENTS.md')))
})

test('commented Claude and Paseo settings are checked without changing their bytes', t => {
  const f = fixture(t)
  const content = '{\n// user comment\n"url":"https://example.test/*keep*/",\n"quoted":"escaped \\" // keep",\n"items":[1, /* keep */],\n"enabledPlugins":{"ponytail@ponytail":false,},\n}\n'
  const configs = ['.claude/settings.json', '.paseo/config.json'].map(file => f.put(file, content))
  install(f.plan({ reviewNetwork: false }))
  for (const config of configs) assert.equal(fs.readFileSync(config, 'utf8'), content)
  fs.writeFileSync(configs[0], content.replace(':false,', ':true,'))
  assert.throws(f.plan, /Manual reconciliation/)
  for (const invalid of ['{,}', '{"items":[,]}', '{"key":,}', '{"key":1,,}', '{} /* unfinished']) {
    fs.writeFileSync(configs[0], invalid)
    assert.throws(f.plan, SyntaxError)
  }
})

test('a deployed executable is a copy; only tracked skills install; edits after planning are preserved; failed replacement restores original files', t => {
  const f = fixture(t)
  const { directory: checkoutDirectory, track } = checkout(f)
  track()
  f.put('checkout/skills/untracked-fixture/SKILL.md', 'Untracked local skill\n')
  const options = { repo: checkoutDirectory, home: f.home }
  const initial = planInstall(options)
  f.put('.claude/CLAUDE.md', 'Human edit after planning\n')
  install(initial)
  assert.ok(fs.readFileSync(path.join(f.home, '.claude/CLAUDE.md'), 'utf8').startsWith('Human edit after planning\n'))
  assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit/resources/skills/untracked-fixture')), false)
  assert.throws(() => fs.lstatSync(path.join(f.home, '.claude/skills/untracked-fixture')), { code: 'ENOENT' })
  assert.ok(fs.statSync(path.join(f.home, '.claude/skills/ponytail/SKILL.md')).isFile())
  const executable = path.join(f.home, '.local/bin/pg-test')
  const deployed = fs.readFileSync(executable, 'utf8')
  fs.appendFileSync(path.join(checkoutDirectory, 'shared/postgres/pg-test.cjs'), '\n// checkout edit\n')
  assert.equal(fs.readFileSync(executable, 'utf8'), deployed)
  install(planInstall(options))
  const updated = fs.readFileSync(executable, 'utf8')
  assert.notEqual(updated, deployed)
  const receipt = path.join(f.home, '.local/share/agent-toolkit/installed.json')
  const before = fs.readFileSync(receipt, 'utf8')
  const instructions = path.join(f.home, '.claude/CLAUDE.md')
  const previous = fs.readFileSync(instructions, 'utf8')
  fs.appendFileSync(path.join(checkoutDirectory, 'shared/AGENTS.md'), '\nUpdated guidance\n')
  const temporary = `${instructions}.agent-toolkit-${process.pid}`
  f.put(path.relative(f.home, temporary), 'user file colliding with temporary output')
  assert.throws(() => install(planInstall(options)), /EEXIST/)
  assert.equal(fs.readFileSync(executable, 'utf8'), updated)
  assert.equal(fs.readFileSync(receipt, 'utf8'), before)
  assert.equal(fs.readFileSync(instructions, 'utf8'), previous)
  assert.equal(fs.readFileSync(temporary, 'utf8'), 'user file colliding with temporary output')
})

test('a failed cleanup of the old resources warns but keeps the install and later installs working', t => {
  const f = fixture(t)
  install(f.plan({ reviewNetwork: false }))
  const { dataRoot, resources } = f.plan()
  const locked = path.join(resources, 'shared/hosts')
  fs.chmodSync(locked, 0o500) // Directory modes are not in the resource hash; this blocks deleting its files.
  const warn = t.mock.method(console, 'warn', () => {})
  let previous
  try {
    install(f.plan({ reviewNetwork: false }))
    previous = fs.readdirSync(dataRoot).filter(name => name.endsWith('-previous')).map(name => path.join(dataRoot, name))
    assert.equal(previous.length, 1)
    assert.match(warn.mock.calls[0].arguments[0], new RegExp(`Remove ${previous[0]} by hand`))
    install(f.plan({ reviewNetwork: false }))
  } finally {
    for (const directory of [locked, ...(previous ?? []).map(file => path.join(file, 'shared/hosts'))]) fs.chmodSync(directory, 0o700)
  }
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
    const options = { claudeDir, }
    install(f.plan(options))
    install(f.plan(options))
    const prompt = path.join(claudeDir, 'CLAUDE.md'), skill = path.join(claudeDir, 'skills/ponytail')
    const before = fs.readFileSync(prompt, 'utf8'), target = fs.readlinkSync(skill)
    const receipt = path.join(f.home, '.local/share/agent-toolkit/installed.json')
    const ownership = fs.readFileSync(receipt, 'utf8')
    fs.symlinkSync = (source, file, ...args) => {
      if (file === skill) throw Error('Fixture replacement failure')
      return symlink(source, file, ...args)
    }
    assert.throws(() => install(f.plan(options)), /Fixture replacement failure/)
    assert.equal(fs.readFileSync(prompt, 'utf8'), before)
    assert.equal(fs.readlinkSync(skill), target)
    assert.equal(fs.readFileSync(receipt, 'utf8'), ownership)
    assert.equal(fs.existsSync(path.join(f.home, '.local/share/agent-toolkit/install.lock')), false)
  } finally { fs.renameSync = rename; fs.symlinkSync = symlink }
})
