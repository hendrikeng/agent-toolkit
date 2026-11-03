const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const script = path.join(__dirname, 'apply-claude-sandbox.sh')

// A copy of the live layout: settings.json is a link to the real file, as in the Paseo homes.
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tmp.')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), real = path.join(home, '.claude/settings.json'), paseo = path.join(home, '.paseo/claude-x')
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.mkdirSync(paseo, { recursive: true })
  const original = JSON.stringify({
    model: 'fable', env: { CLAUDE_CODE_TMPDIR: `${home}/.agent-tmp` }, permissions: { deny: ['Bash(git push -f*)'] }, skipDangerousModePermissionPrompt: true,
    sandbox: { enabled: false, network: { allowedDomains: ['example.org', 'api.openai.com'] }, filesystem: { allowWrite: [] },
      excludedCommands: ['node /x/tracn-capture/capture.mjs *', 'docker *', 'make release'] },
  }, null, 2) + '\n'
  fs.writeFileSync(real, original, { mode: 0o600 })
  fs.symlinkSync(real, path.join(paseo, 'settings.json'))
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root, CLAUDE_CONFIG_DIR: paseo, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig') }
  // script(1) supplies a terminal, as a human terminal does.
  const run = (...args) => spawnSync('script', ['-q', '/dev/null', 'bash', script, '--no-update', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // Another rewrite value on the same key must survive apply and undo.
  spawnSync('git', ['config', '--global', 'url.https://github.com/.insteadOf', 'ssh://git@github.com/'], { env })
  const gitRule = () => spawnSync('git', ['config', '--global', '--get-all', 'url.https://github.com/.insteadOf'], { env, encoding: 'utf8' }).stdout.trim().split('\n').filter(value => value !== 'ssh://git@github.com/').join('\n')
  return { home, real, original, env, run, gitRule }
}

test('the sandbox script previews, merges without dropping settings, repeats cleanly, and undoes', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const preview = f.run('--dry-run')
  assert.equal(preview.status, 0, preview.stdout)
  assert.match(preview.stdout, /"enabled": true/)
  assert.match(preview.stdout, /Dry run: nothing changed/)
  assert.equal(fs.readFileSync(f.real, 'utf8'), f.original)
  assert.equal(f.gitRule(), '')

  const applied = f.run()
  assert.equal(applied.status, 0, applied.stdout)
  const settings = JSON.parse(fs.readFileSync(f.real, 'utf8'))
  assert.equal(settings.model, 'fable')
  assert.deepEqual(settings.permissions, { deny: ['Bash(git push -f*)'] })
  assert.equal(settings.skipDangerousModePermissionPrompt, true)
  assert.deepEqual(settings.env, { SSL_CERT_FILE: '/etc/ssl/cert.pem' }, 'the earlier CLAUDE_CODE_TMPDIR value is removed')
  assert.equal(settings.sandbox.enabled, true)
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false)
  assert.deepEqual(settings.sandbox.network.allowedDomains.slice(0, 3), ['example.org', 'api.openai.com', 'github.com'])
  assert.equal(settings.sandbox.network.allowedDomains.filter(domain => domain === 'api.openai.com').length, 1)
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Library/pnpm/store`))
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Code/paseo-worktrees`), 'orchestrators write in worker worktrees')
  assert.ok(settings.sandbox.filesystem.allowWrite.some(dir => dir.startsWith('/var/folders/')), 'plain mktemp -d uses the macOS temporary directory')
  assert.ok(!settings.sandbox.excludedCommands.some(command => command.includes('capture.mjs')))
  assert.ok(settings.sandbox.excludedCommands.includes('make release'))
  assert.ok(settings.sandbox.excludedCommands.includes('pg-test *'))
  // Docker uses the socket in the sandbox; the earlier exclusion is removed.
  assert.ok(!settings.sandbox.excludedCommands.includes('docker *'))
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, [`${f.home}/.orbstack/run/docker.sock`])
  for (const entry of ['ssh agawulum@sl90.web.hostpoint.ch *', 'scp * agawulum@sl90.web.hostpoint.ch:*', 'rsync * bonzanib@sl662.web.hostpoint.ch:*', 'ssh wfw-prod@wfw.ch *']) {
    assert.ok(settings.sandbox.excludedCommands.includes(entry), entry)
  }
  // A shorter server list replaces the generated entries; an empty list removes them.
  const servers = list => JSON.parse(spawnSync('bash', [script, '--emit'], { env: { ...f.env, SANDBOX_SSH_SERVERS: list }, encoding: 'utf8' }).stdout)
    .sandbox.excludedCommands.filter(command => /^(ssh|scp|rsync) /.test(command))
  assert.deepEqual(servers('wfw-prod@wfw.ch'), ['ssh wfw-prod@wfw.ch *', 'scp * wfw-prod@wfw.ch:*', 'rsync * wfw-prod@wfw.ch:*'])
  assert.deepEqual(servers(''), [])
  assert.equal(fs.statSync(f.real).mode & 0o777, 0o600)
  assert.equal(f.gitRule(), 'git@github.com:')
  const backups = fs.readdirSync(path.dirname(f.real)).filter(name => /^settings\.json\.before-sandbox-\d{8}-\d{6}$/.test(name))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(path.dirname(f.real), backups[0]), 'utf8'), f.original)

  const merged = fs.readFileSync(f.real, 'utf8')
  spawnSync('sleep', ['1'])
  assert.equal(f.run().status, 0)
  assert.equal(fs.readFileSync(f.real, 'utf8'), merged)

  const undone = f.run('--undo')
  assert.equal(undone.status, 0, undone.stdout)
  assert.equal(fs.readFileSync(f.real, 'utf8'), merged, 'undo restores the latest backup, which is the second run')
  assert.equal(f.gitRule(), 'git@github.com:', 'the second run did not add the Git rule')
  assert.equal(f.run('--undo').status, 0)
  assert.equal(fs.readFileSync(f.real, 'utf8'), f.original)
  assert.equal(f.gitRule(), '')
  assert.match(spawnSync('git', ['config', '--global', '--get-all', 'url.https://github.com/.insteadOf'], { env: f.env, encoding: 'utf8' }).stdout, /^ssh:\/\/git@github\.com\/\n$/)
  assert.equal(f.run('--undo').status, 1, 'no backup remains')
})

test('the sandbox script refuses changes without a terminal and refuses invalid JSON', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const agent = spawnSync('bash', [script, '--no-update'], { env: f.env, encoding: 'utf8', input: '' })
  assert.equal(agent.status, 1)
  assert.match(agent.stderr, /trusted human terminal/)
  // --emit only prints the merged settings for a one-off claude --settings test.
  const emitted = spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' })
  assert.equal(JSON.parse(emitted.stdout).sandbox.enabled, true)
  assert.equal(fs.readFileSync(f.real, 'utf8'), f.original)
  fs.writeFileSync(f.real, '{"model": ')
  const invalid = f.run()
  assert.equal(invalid.status, 1)
  assert.match(invalid.stdout, /Cannot parse/)
  assert.equal(fs.readFileSync(f.real, 'utf8'), '{"model": ')
  assert.equal(fs.readdirSync(path.dirname(f.real)).filter(name => name.includes('before-sandbox')).length, 0)
})
