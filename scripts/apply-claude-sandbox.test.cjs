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
// A fake getconf returns darwinTmp: the real macOS temporary directory may contain this fixture, and apply refuses that.
function fixture(t, { darwinTmp = '/var/folders/zz/agent-toolkit-test/T/', sandbox = {} } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tmp.')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), real = path.join(home, '.claude/settings.json'), paseo = path.join(home, '.paseo/claude-x')
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(path.join(root, 'bin/getconf'), `#!/bin/sh\nprintf '%s\\n' '${darwinTmp.replace('{home}', home)}'\n`, { mode: 0o755 })
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.mkdirSync(paseo, { recursive: true })
  const original = JSON.stringify({
    model: 'fable', env: { KEEP: '1' }, permissions: { deny: ['Bash(git push -f*)'], ask: ['Bash(npm publish *)', 'Bash(ssh *old@prod.example*)'] }, skipDangerousModePermissionPrompt: true,
    sandbox: { enabled: false, network: { allowedDomains: ['example.org', 'api.openai.com'] }, filesystem: { allowWrite: [] },
      excludedCommands: ['node /x/tracn-capture/capture.mjs *', 'make release'], ...sandbox },
  }, null, 2) + '\n'
  fs.writeFileSync(real, original, { mode: 0o600 })
  fs.symlinkSync(real, path.join(paseo, 'settings.json'))
  const env = { PATH: `${root}/bin:${process.env.PATH}`, HOME: home, TMPDIR: root, CLAUDE_CONFIG_DIR: paseo, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig') }
  // script(1) supplies a terminal, as a human terminal does.
  const run = (...args) => spawnSync('script', ['-q', '/dev/null', 'bash', script, '--no-update', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // The answer goes through the terminal that script(1) supplies. script(1) sends EOF first for input that is ready at once, so write it after the prompt.
  const answer = (input, ...args) => spawnSync('bash', ['-c', '(sleep 1; printf "%s" "$0") | script -q /dev/null bash "$@"', input, script, ...args], { env, encoding: 'utf8' })
  // Another rewrite value on the same key must survive apply and undo.
  spawnSync('git', ['config', '--global', 'url.https://github.com/.insteadOf', 'ssh://git@github.com/'], { env })
  const gitRule = () => spawnSync('git', ['config', '--global', '--get-all', 'url.https://github.com/.insteadOf'], { env, encoding: 'utf8' }).stdout.trim().split('\n').filter(value => value !== 'ssh://git@github.com/').join('\n')
  return { home, real, original, env, run, answer, gitRule }
}

test('the sandbox script previews, merges without dropping settings, repeats cleanly, turns off, and restores', terminal, t => {
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
  assert.deepEqual(settings.permissions.deny, ['Bash(git push -f*)'])
  // Ask rules are only added: existing rules stay, production servers ask, staging uses the reviewed escape.
  assert.deepEqual(settings.permissions.ask, ['Bash(npm publish *)', 'Bash(ssh *old@prod.example*)', ...['agawulum@sl90.web.hostpoint.ch', 'bonzanib@sl662.web.hostpoint.ch', 'wfw-prod@wfw.ch']
    .flatMap(server => ['ssh', 'scp', 'rsync'].map(command => `Bash(${command} *${server}*)`))])
  assert.equal(settings.skipDangerousModePermissionPrompt, true)
  assert.deepEqual(settings.env, { KEEP: '1', SSL_CERT_FILE: '/etc/ssl/cert.pem' })
  assert.equal(settings.sandbox.enabled, true)
  assert.equal(settings.sandbox.allowUnsandboxedCommands, true)
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, true)
  assert.deepEqual(settings.sandbox.filesystem.denyRead, [`${f.home}/.ssh`])
  assert.deepEqual(settings.sandbox.network.allowedDomains.slice(0, 3), ['example.org', 'api.openai.com', 'github.com'])
  assert.equal(settings.sandbox.network.allowedDomains.filter(domain => domain === 'api.openai.com').length, 1)
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Library/pnpm/store`))
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Code/paseo-worktrees`), 'orchestrators write in worker worktrees')
  assert.ok(settings.sandbox.filesystem.allowWrite.some(dir => dir.startsWith('/var/folders/')), 'plain mktemp -d uses the macOS temporary directory')
  assert.ok(!settings.sandbox.excludedCommands.some(command => command.includes('capture.mjs')))
  assert.deepEqual(settings.sandbox.excludedCommands.filter(command => !command.startsWith(`${f.home}/.local/bin/`)), ['make release', '/bin/ps *'], 'user entries stay')
  assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/pg-test *`))
  assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/agent-stop *`), 'agents stop their own background processes')
  for (const name of ['agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']) {
    assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/${name}`), name)
  }
  // Docker uses the socket in the sandbox.
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, [`${f.home}/.orbstack/run/docker.sock`, `${f.home}/.fly/fly-agent.sock`])
  // Only servers in SANDBOX_SSH_STAGING skip the ask rules. A host name with "staging" alone does not.
  const asks = (servers, staging) => JSON.parse(spawnSync('bash', [script, '--emit'], { env: { ...f.env, SANDBOX_SSH_SERVERS: servers, SANDBOX_SSH_STAGING: staging }, encoding: 'utf8' }).stdout)
    .permissions.ask.filter(rule => !settings.permissions.ask.includes(rule))
  const rules = server => ['ssh', 'scp', 'rsync'].map(command => `Bash(${command} *${server}*)`)
  assert.deepEqual(asks('stage@example.org new-staging@example.org', 'stage@example.org'), rules('new-staging@example.org'))
  assert.deepEqual(asks('', ''), [])
  assert.equal(fs.statSync(f.real).mode & 0o777, 0o600)
  assert.equal(f.gitRule(), 'git@github.com:')
  const backups = fs.readdirSync(path.dirname(f.real)).filter(name => /^settings\.json\.before-sandbox-\d{8}-\d{6}$/.test(name))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(path.dirname(f.real), backups[0]), 'utf8'), f.original)

  const merged = fs.readFileSync(f.real, 'utf8')
  spawnSync('sleep', ['1'])
  assert.equal(f.run().status, 0)
  assert.equal(fs.readFileSync(f.real, 'utf8'), merged)

  spawnSync('sleep', ['1'])
  const off = f.run('--off')
  assert.equal(off.status, 0, off.stdout)
  const offState = fs.readFileSync(f.real, 'utf8')
  assert.deepEqual(JSON.parse(offState), { ...JSON.parse(merged), sandbox: { ...JSON.parse(merged).sandbox, enabled: false } }, '--off changes only sandbox.enabled')

  const first = path.join(path.dirname(f.real), backups[0])
  const declined = f.answer('n\n', '--restore', first)
  assert.equal(declined.status, 0, declined.stdout)
  assert.equal(fs.readFileSync(f.real, 'utf8'), offState, 'a "no" changes nothing')
  const restored = f.answer('y\n', '--restore', first)
  assert.equal(restored.status, 0, restored.stdout)
  assert.equal(fs.readFileSync(f.real, 'utf8'), f.original)
  assert.equal(fs.readFileSync(first, 'utf8'), f.original, 'the backup stays')
  assert.equal(f.gitRule(), '', 'the first run added the Git rule, so its restore removes it')
  assert.match(spawnSync('git', ['config', '--global', '--get-all', 'url.https://github.com/.insteadOf'], { env: f.env, encoding: 'utf8' }).stdout, /^ssh:\/\/git@github\.com\/\n$/)
  assert.equal(f.run('--restore').status, 2, 'restore needs an explicit file')
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

test('the sandbox script keeps explicit stricter values and removes old bare-name exclusions', t => {
  const old = ['pg-test *', 'pg18-fresh', 'agent-stop *', 'agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']
  const f = fixture(t, { sandbox: { allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false, excludedCommands: ['make release', ...old] } })
  const settings = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout)
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false)
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false)
  assert.ok(!settings.sandbox.excludedCommands.some(command => old.includes(command)))
  assert.ok(settings.sandbox.excludedCommands.includes('make release'))
  assert.ok(settings.sandbox.excludedCommands.includes(`${f.home}/.local/bin/pg-test *`))
  const preview = spawnSync('bash', [script, '--dry-run', '--no-update'], { env: f.env, encoding: 'utf8' })
  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /Keeping the existing sandbox\.allowUnsandboxedCommands = false\./)
})

test('the sandbox script refuses a settings file inside a sandbox write root', t => {
  const f = fixture(t, { darwinTmp: '{home}' })
  const preview = spawnSync('bash', [script, '--dry-run', '--no-update'], { env: f.env, encoding: 'utf8' })
  assert.equal(preview.status, 1)
  assert.match(preview.stderr, /Refusing .*settings\.json: it is inside the sandbox write root/)
  assert.equal(fs.readFileSync(f.real, 'utf8'), f.original)
})
