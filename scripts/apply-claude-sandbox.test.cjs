const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const script = path.join(__dirname, 'apply-claude-sandbox.sh')
// The apply tests use script(1) as a terminal. The Claude sandbox denies openpty, so they cannot run there.
const pty = process.platform === 'darwin' && spawnSync('script', ['-q', '/dev/null', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] }).status === 0
const terminal = { skip: process.platform !== 'darwin' ? 'macOS only' : !pty && 'openpty is denied, for example in the Claude sandbox' }

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

test('the sandbox script previews, merges without dropping settings, repeats cleanly, and undoes', terminal, t => {
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
  assert.equal(settings.permissions.deny[0], 'Bash(git push -f*)', 'existing deny rules stay first')
  assert.equal(new Set(settings.permissions.deny).size, settings.permissions.deny.length, 'no duplicate deny rules')
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
  assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/agent-stop *`), 'agents stop their own background processes')
  for (const name of ['agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']) {
    assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/${name}`), name)
  }
  // Docker uses the socket in the sandbox; the earlier exclusion is removed.
  assert.ok(!settings.sandbox.excludedCommands.includes('docker *'))
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, [`${f.home}/.orbstack/run/docker.sock`, `${f.home}/.fly/fly-agent.sock`])
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

test('the sandbox script refuses changes without a terminal and refuses invalid JSON', terminal, t => {
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

test('the sandbox write roots for projects are the allowed roots of agent-stop', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const settings = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout)
  const projects = settings.sandbox.filesystem.allowWrite.filter(dir => dir.startsWith(`${f.home}/Code/`)).map(dir => dir.slice(`${f.home}/Code/`.length))
  const stop = fs.readFileSync(path.join(__dirname, '../shared/agent-stop.pl'), 'utf8').match(/"\$home\/Code\/\$_" \} qw\(([^)]*)\)/)
  assert.ok(stop, 'agent-stop defines its project roots with qw()')
  assert.deepEqual(projects.sort(), stop[1].split(/\s+/).sort())
  assert.ok(projects.includes('envest'))
})

test('the sandbox script removes any CLAUDE_CODE_TMPDIR value and the docker exclusion from earlier versions', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  // The live file had a value with a trailing slash, which an exact match missed.
  fs.writeFileSync(f.real, JSON.stringify({ env: { CLAUDE_CODE_TMPDIR: `${f.home}/.agent-tmp/`, KEEP: '1' }, sandbox: { excludedCommands: ['docker *', 'make release'] } }))
  const settings = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout)
  assert.deepEqual(settings.env, { KEEP: '1', SSL_CERT_FILE: '/etc/ssl/cert.pem' })
  assert.ok(!settings.sandbox.excludedCommands.includes('docker *'))
  assert.ok(settings.sandbox.excludedCommands.includes('make release'))
})

// A model of the Claude Code rule match: * matches any text. It shows which commands the rules catch.
test('the deny rules catch actions that cannot be undone and leave normal commands alone', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t)
  const rules = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout).permissions.deny
    .map(rule => new RegExp('^' + rule.slice(5, -1).split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'))
  const denied = command => rules.some(rule => rule.test(command))
  for (const command of ['git push --force-with-lease origin main', 'git push origin +main', 'git -C /x push -f', '/usr/bin/git push --force',
    'git clean -fdx', 'git clean -fX', 'git stash clear', 'git reflog expire --expire=now --all', 'git gc --prune=now',
    'fly apps destroy demo', 'flyctl machine destroy 123 --force', 'supabase projects delete abc', 'supabase db reset --linked',
    'vercel remove demo --yes', 'vercel rm demo']) {
    assert.ok(denied(command), command)
  }
  for (const command of ['git push origin main', 'git push -u origin HEAD', 'git clean -fd', 'git stash list', 'git gc',
    'git reset --hard', 'git branch -D old', 'fly deploy', 'fly status', 'fly ssh console', 'supabase db reset', 'vercel deploy']) {
    assert.ok(!denied(command), command)
  }
})
