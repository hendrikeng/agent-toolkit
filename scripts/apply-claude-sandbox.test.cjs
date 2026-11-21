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
function fixture(t, { darwinTmp = '/var/folders/zz/agent-toolkit-test/T/', sandbox = {}, config } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tmp.')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'), real = path.join(home, '.claude/settings.json'), paseo = path.join(home, '.paseo/claude-x')
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(path.join(root, 'bin/getconf'), `#!/bin/sh\nprintf '%s\\n' '${darwinTmp.replace('{home}', home)}'\n`, { mode: 0o755 })
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.mkdirSync(paseo, { recursive: true })
  if (config) {
    fs.mkdirSync(path.join(home, '.config/agent-toolkit'), { recursive: true })
    fs.writeFileSync(path.join(home, '.config/agent-toolkit/local.env'), config)
  }
  const original = JSON.stringify({
    model: 'fable', env: { KEEP: '1' }, permissions: { deny: ['Bash(git push -f*)'], ask: ['Bash(npm publish *)', 'Bash(ssh *old@prod.example*)'] }, skipDangerousModePermissionPrompt: true,
    sandbox: { enabled: false, network: { allowedDomains: ['example.org', 'api.openai.com'] }, filesystem: { allowWrite: [] },
      excludedCommands: ['node /x/app-capture/capture.mjs *', 'make release'], ...sandbox },
  }, null, 2) + '\n'
  fs.writeFileSync(real, original, { mode: 0o600 })
  fs.symlinkSync(real, path.join(paseo, 'settings.json'))
  const env = { PATH: `${root}/bin:${process.env.PATH}`, HOME: home, TMPDIR: root, CLAUDE_CONFIG_DIR: paseo, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig') }
  // script(1) supplies a terminal, as a human terminal does.
  const run = (...args) => spawnSync('script', ['-q', '/dev/null', 'bash', script, '--no-update', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // expect(1) supplies the terminal and types the answer only after the prompt appears. A fixed delay failed on a loaded machine.
  const expectScript = 'set timeout 60; spawn bash {*}[split $env(ARGS) "\\n"]; expect -exact {[y/N] }; send "[string trim $env(ANSWER)]\\r"; expect eof; exit [lindex [wait] 3]'
  const answer = (input, ...args) => spawnSync('expect', ['-c', expectScript], { env: { ...env, ANSWER: input, ARGS: [script, ...args].join('\n') }, encoding: 'utf8' })
  // Another rewrite value on the same key must survive apply and undo.
  spawnSync('git', ['config', '--global', 'url.https://github.com/.insteadOf', 'ssh://git@github.com/'], { env })
  const gitRule = () => spawnSync('git', ['config', '--global', '--get-all', 'url.https://github.com/.insteadOf'], { env, encoding: 'utf8' }).stdout.trim().split('\n').filter(value => value !== 'ssh://git@github.com/').join('\n')
  return { home, real, original, env, run, answer, gitRule }
}

test('the sandbox script previews, merges without dropping settings, repeats cleanly, turns off, and restores', terminal, t => {
  // The local config file supplies the personal values. It is data: a command in it must not run.
  const f = fixture(t, { config: ['# servers', 'SANDBOX_SSH_SERVERS="ops@prod.example.com ops@staging.example.com"', "SANDBOX_SSH_STAGING='ops@staging.example.com'",
    'SANDBOX_EXTRA_DOMAINS=*.example.app', 'TOOLKIT_PROJECT_ROOTS="~/Code/paseo-worktrees /x/$(touch${IFS}$HOME/pwned)"', ''].join('\n') })
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
  // The script also writes the user's force-push rule. It stays first and once.
  assert.deepEqual(settings.permissions.deny.filter(rule => rule === 'Bash(git push -f*)'), ['Bash(git push -f*)'])
  assert.equal(settings.permissions.deny[0], 'Bash(git push -f*)')
  // Ask rules are only added: existing rules stay, production servers ask, staging uses the reviewed escape.
  assert.deepEqual(settings.permissions.ask, ['Bash(npm publish *)', 'Bash(ssh *old@prod.example*)', ...['ops@prod.example.com']
    .flatMap(server => ['ssh', 'scp', 'rsync'].map(command => `Bash(${command} *${server}*)`))])
  assert.equal(settings.skipDangerousModePermissionPrompt, true)
  assert.deepEqual(settings.env, { KEEP: '1', SSL_CERT_FILE: '/etc/ssl/cert.pem' })
  assert.equal(settings.sandbox.enabled, true)
  assert.equal(settings.sandbox.allowUnsandboxedCommands, true)
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, true)
  assert.deepEqual(settings.sandbox.filesystem.denyRead, [`${f.home}/.ssh`])
  assert.deepEqual(settings.sandbox.network.allowedDomains.slice(0, 3), ['example.org', 'api.openai.com', 'github.com'])
  assert.equal(settings.sandbox.network.allowedDomains.filter(domain => domain === 'api.openai.com').length, 1)
  assert.equal(settings.sandbox.network.allowedDomains.at(-1), '*.example.app')
  assert.ok(settings.sandbox.filesystem.allowWrite.includes('/x/$(touch${IFS}$HOME/pwned)'), 'the config value stays text')
  assert.equal(fs.existsSync(path.join(f.home, 'pwned')), false)
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Library/pnpm/store`))
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Code/paseo-worktrees`), 'orchestrators write in worker worktrees')
  assert.ok(settings.sandbox.filesystem.allowWrite.some(dir => dir.startsWith('/var/folders/')), 'plain mktemp -d uses the macOS temporary directory')
  // capture.mjs goes, and no helper is excluded. The user entry stays.
  assert.deepEqual(settings.sandbox.excludedCommands, ['make release'])
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, [`${f.home}/.fly/fly-agent.sock`])
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

test('the sandbox write roots for projects and agent-stop use the same config key and default', t => {
  const f = fixture(t)
  const settings = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout)
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(`${f.home}/Code`), 'default project root')
  assert.deepEqual(settings.permissions.ask, JSON.parse(f.original).permissions.ask, 'no servers by default')
})

test('the Bash and Perl config readers return the same project roots, and agent-stop ignores an unsafe file', t => {
  const f = fixture(t)
  const home = os.userInfo().homedir // agent-stop takes the home folder from the user database.
  const config = path.join(f.home, '.config/agent-toolkit/local.env')
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
  fs.writeFileSync(config, ['# TOOLKIT_PROJECT_ROOTS=/comment', '  TOOLKIT_PROJECT_ROOTS =/spaced-key',
    `  TOOLKIT_PROJECT_ROOTS= " ~/a /abs/ rel ~ / ~/ /x/../y /g* ~/b// "  \r`, 'TOOLKIT_PROJECT_ROOTS=/second', ''].join('\n'), { mode: 0o600 })
  const bash = () => spawnSync('bash', ['-c', 'source "$1"; toolkit_project_roots "$2" "$3"', '_', path.join(__dirname, '../shared/local-config.sh'), config, home], { encoding: 'utf8' })
  const perl = () => spawnSync(path.join(__dirname, '../shared/agent-stop.pl'), ['--print-roots', config], { encoding: 'utf8' })
  const warning = `Ignoring invalid project roots in ${config}: rel ~ / ~/ /x/../y /g*\n`
  for (const reader of [bash(), perl()]) {
    assert.equal(reader.stdout, `${home}/a\n/abs\n${home}/b\n`)
    assert.equal(reader.stderr, warning)
  }
  // The roots come only from the file, also for the sandbox settings.
  const emitted = JSON.parse(spawnSync('bash', [script, '--emit'], { env: { ...f.env, TOOLKIT_PROJECT_ROOTS: '/from-env' }, encoding: 'utf8' }).stdout)
  assert.ok(!emitted.sandbox.filesystem.allowWrite.includes('/from-env'))
  assert.ok(emitted.sandbox.filesystem.allowWrite.includes('/abs'))
  // Another user could write the file, so agent-stop falls back to the default roots.
  fs.chmodSync(config, 0o620)
  const unsafe = perl()
  assert.equal(unsafe.stdout, `${home}/Code\n`)
  assert.match(unsafe.stderr, /ignoring .*local\.env: it must be a regular file of this user/)
})

test('the configured project roots replace the earlier generated roots and keep other user entries', t => {
  const f = fixture(t, { config: 'TOOLKIT_PROJECT_ROOTS=~/Code/new\n' })
  const old = JSON.parse(f.original)
  old.sandbox.filesystem.allowWrite = [`${f.home}/Code`, `${f.home}/Code/old`, '/user/dir', `${f.home}/Codex`]
  fs.writeFileSync(f.real, JSON.stringify(old))
  const allowWrite = JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout).sandbox.filesystem.allowWrite
  assert.deepEqual(allowWrite.slice(0, 2), ['/user/dir', `${f.home}/Codex`])
  assert.ok(allowWrite.includes(`${f.home}/Code/new`))
  assert.ok(!allowWrite.includes(`${f.home}/Code`) && !allowWrite.includes(`${f.home}/Code/old`))
})

test('the sandbox script keeps explicit stricter values and user entries, and removes the entries that earlier versions wrote', t => {
  const f = fixture(t, { sandbox: { allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false } })
  const helpers = ['pg-test *', 'pg18-fresh', 'agent-stop *', 'agent-awake', 'agent-sleep', 'paseo-awake', 'paseo-sleep']
  const old = JSON.parse(f.original)
  old.sandbox.excludedCommands = ['make release', ...helpers, ...helpers.map(name => `${f.home}/.local/bin/${name}`), '/bin/ps *']
  old.sandbox.network.allowUnixSockets = [`${f.home}/.orbstack/run/docker.sock`, '/x/user.sock']
  old.sandbox.filesystem.denyWrite = ['**/.env']
  fs.writeFileSync(f.real, JSON.stringify(old))
  const emit = () => JSON.parse(spawnSync('bash', [script, '--emit'], { env: f.env, encoding: 'utf8' }).stdout)
  const settings = emit()
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false)
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false)
  assert.deepEqual(settings.sandbox.excludedCommands, ['make release'])
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, ['/x/user.sock', `${f.home}/.fly/fly-agent.sock`])
  // Helpers and shell startup files run outside the sandbox later, so sandboxed commands must not change them.
  assert.deepEqual(settings.sandbox.filesystem.denyWrite, ['**/.env', ...['.local/bin', '.local/share/agent-toolkit', '.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile'].map(name => `${f.home}/${name}`)])
  // The user rule stays. A + refspec and --force-with-lease are also denied, also with git options and git by path.
  for (const rule of ['Bash(git push -f*)', 'Bash(git push * +*)', 'Bash(git push +*)', 'Bash(git push *--force*)', 'Bash(git -* push *--force*)', 'Bash(*/git push * +*)']) {
    assert.ok(settings.permissions.deny.includes(rule), rule)
  }
  assert.equal(settings.hooks, undefined, 'the script adds no hooks')
  fs.writeFileSync(f.real, JSON.stringify(settings))
  assert.deepEqual(emit(), settings, 'a second merge adds nothing')
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
