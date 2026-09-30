const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
test('shared Codex and Claude launchers retain sandbox, account environment and Git safeguards', () => {
 const home = fs.mkdtempSync(path.join(tmpdir(), 'shared-launchers-'))
 const bin = path.join(home, 'bin'), managed = path.join(home, '.local/libexec/agent-toolkit')
 for (const local of ['bin', 'Code', 'orca/workspaces', '.claude', '.codex/rules', '.local/bin', '.local/libexec/agent-toolkit']) fs.mkdirSync(path.join(home, local), { recursive: true })
 const guard = fs.readFileSync(path.join(__dirname, 'git-yolo-guard'))
 fs.writeFileSync(path.join(managed, 'git'), guard, { mode: 0o700 })
 fs.writeFileSync(path.join(managed, 'git.agent-toolkit.sha256'), createHash('sha256').update(guard).digest('hex'))
 const agentRules = '# Shared fixture rules\n'
 fs.writeFileSync(path.join(managed, 'AGENTS.md'), agentRules)
 fs.writeFileSync(path.join(managed, 'AGENTS.md.agent-toolkit.sha256'), createHash('sha256').update(agentRules).digest('hex'))
 const reviewHelper = '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CAPTURE.review"\nprintf \'%s\' "${TMPDIR-unset}${TMP-}${TEMP-}" > "$CAPTURE.review-tmp"\n'
 fs.writeFileSync(path.join(managed, 'autoreview'), reviewHelper, { mode: 0o700 })
 fs.writeFileSync(path.join(managed, 'autoreview.agent-toolkit.sha256'), createHash('sha256').update(reviewHelper).digest('hex'))
 const pg18Helper = '#!/bin/sh\nprintf pg18 > "$CAPTURE.pg18"\n'
 fs.writeFileSync(path.join(managed, 'pg18-fresh-yolo'), pg18Helper, { mode: 0o700 })
 fs.writeFileSync(path.join(managed, 'pg18-fresh-yolo.agent-toolkit.sha256'), createHash('sha256').update(pg18Helper).digest('hex'))
 const pgTestHelper = '#!/bin/sh\ntest "$1" = watch-session || exit 2\nwhile kill -0 "$AGENT_TOOLKIT_SESSION_PID" 2>/dev/null; do sleep 0.05; done\nprintf \'%s\\n%s\\n\' "$AGENT_TOOLKIT_SESSION_ID" "$AGENT_TOOLKIT_SESSION_PID" >> "$CAPTURE.pg-test"\n'
 fs.writeFileSync(path.join(home, '.local/bin/pg-test'), pgTestHelper, { mode: 0o700 })
 fs.mkdirSync(path.join(home, 'Code/.agent-toolkit-reports'))
 fs.writeFileSync(path.join(home, '.codex/rules/agent-safety.rules'), 'synthetic policy fixture')
 fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true }, permissions: { deny: ['Bash(rm *)'] } }))
 const fake = `#!/usr/bin/env node
const fs=require('node:fs');
if(process.argv[2]==='execpolicy') console.log('{"decision":"forbidden"}');
else fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args:process.argv.slice(2),path:process.env.PATH,account:process.env.CODEX_HOME,configCount:process.env.GIT_CONFIG_COUNT}));
`
 const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), AGENT_TOOLKIT_REVIEW_ROOT: path.join(home, 'Code/.agent-toolkit-reports'), CAPTURE: path.join(home, 'capture.json') }
 const launcherFixture = fs.readFileSync(path.join(__dirname, 'agent-yolo'), 'utf8').replace(`system_home=$(node -p 'require("node:os").userInfo().homedir')`, 'system_home=$HOME')
 assert.match(launcherFixture, /system_home=\$HOME/)
 Object.assign(env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'credential.guiPrompt', GIT_CONFIG_VALUE_1: 'false' })
 for (const host of ['codex', 'claude']) {
  fs.writeFileSync(path.join(bin, host), fake, { mode: 0o700 })
  const launcher = path.join(bin, `${host}-yolo`)
  fs.writeFileSync(launcher, launcherFixture, { mode: 0o700 })
  const result = spawnSync(launcher, ['--model', 'fixture'], { cwd: home, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const capture = JSON.parse(fs.readFileSync(env.CAPTURE))
  assert.ok(capture.path.startsWith(managed + ':'))
  assert.equal(capture.account, env.CODEX_HOME)
  assert.equal(capture.configCount, undefined, 'fixed transport credentials remain in the Git guard rather than inherited overrides')
  assert.deepEqual(capture.args.slice(-2), ['--model', 'fixture'])
  if (host === 'codex') {
   assert.ok(capture.args.includes('workspace-write'))
   assert.ok(capture.args.includes(path.join(home, 'orca/workspaces')))
   assert.equal(capture.args[capture.args.indexOf('-c') + 1], `developer_instructions=${JSON.stringify(agentRules)}`)
  } else {
   const config = JSON.parse(capture.args[capture.args.indexOf('--settings') + 1])
   assert.ok(config.permissions.deny.includes('Bash(dangerouslyDisableSandbox:true)'))
   assert.equal(config.sandbox.allowUnsandboxedCommands, false)
   assert.deepEqual(config.sandbox.excludedCommands, [
  'autoreview-yolo', 'pg18-fresh-yolo',
  'pg-test start', 'pg-test start --postgres-version 17', 'pg-test start --postgres-version 18',
  'pg-test start-migration', 'pg-test start-migration --postgres-version 17', 'pg-test start-migration --postgres-version 18',
  'pg-test start-admin', 'pg-test start-admin --postgres-version 17', 'pg-test start-admin --postgres-version 18',
  'pg-test status *', 'pg-test stop *', 'pg-test gc',
 ])
   assert.equal(config.sandbox.filesystem.disabled, false)
   assert.deepEqual(config.sandbox.network.allowedDomains, ['localhost', '127.0.0.1'])
   assert.equal(config.sandbox.network.allowLocalBinding, true)
   assert.deepEqual(config.env, process.platform === 'darwin' ? { SSL_CERT_FILE: '/etc/ssl/cert.pem' } : {})
   if (process.platform === 'darwin') assert.ok(config.sandbox.network.allowUnixSockets.includes(`/private/tmp/claude-${process.getuid()}/tsx-${process.getuid()}`))
   assert.equal(capture.args[capture.args.indexOf('--append-system-prompt-file') + 1], path.join(managed, 'AGENTS.md'))
   assert.deepEqual(capture.args.slice(capture.args.indexOf('--effort'), capture.args.indexOf('--effort') + 2), ['--effort', 'medium'])
  }
 }
 const orcaRules = path.join(home, 'orca-codex-home/rules/agent-safety.rules')
 fs.mkdirSync(path.dirname(orcaRules), { recursive: true })
 fs.symlinkSync(path.join(home, '.codex/rules/agent-safety.rules'), orcaRules)
 const orcaRun = spawnSync(path.join(bin, 'codex-yolo'), [], { cwd: home, env: { ...env, CODEX_HOME: path.join(home, 'orca-codex-home') }, encoding: 'utf8' })
 assert.equal(orcaRun.status, 0, orcaRun.stderr)
 assert.ok(fs.lstatSync(orcaRules).isFile(), 'Codex rule discovery skips symlinks')
 assert.equal(fs.readFileSync(orcaRules, 'utf8'), 'synthetic policy fixture')
 const cleanupSessions = fs.readFileSync(`${env.CAPTURE}.pg-test`, 'utf8').trim().split('\n')
 assert.equal(cleanupSessions.length, 6)
 for (let index = 0; index < cleanupSessions.length; index += 2) {
  assert.match(cleanupSessions[index], /^[a-f0-9-]{36}$/)
  assert.match(cleanupSessions[index + 1], /^\d+$/)
 }
 const reviewer = path.join(bin, 'autoreview-yolo')
 fs.writeFileSync(reviewer, launcherFixture, { mode: 0o700 })
 const review = spawnSync(reviewer, [], { cwd: home, env: { ...env, TMPDIR: '/tmp/claude-shared', TMP: '/tmp', TEMP: '/tmp' }, encoding: 'utf8' })
 assert.equal(review.status, 0, review.stderr)
 const privateTmp = process.platform === 'darwin' ? spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).stdout.trim() : 'unset'
 assert.equal(fs.readFileSync(`${env.CAPTURE}.review-tmp`, 'utf8'), privateTmp)
 const reviewArgs = fs.readFileSync(`${env.CAPTURE}.review`, 'utf8').trim().split('\n')
 assert.deepEqual(reviewArgs.filter(argument => !argument.startsWith(path.join(home, 'Code/.agent-toolkit-reports/review-'))), ['--mode', 'local', '--output', '--json-output', '--status-output'])
 assert.equal(spawnSync(reviewer, ['--mode', 'local'], { cwd: home, env, encoding: 'utf8' }).status, 2)
 const pg18 = path.join(bin, 'pg18-fresh-yolo')
 fs.writeFileSync(pg18, launcherFixture, { mode: 0o700 })
 assert.equal(spawnSync(pg18, [], { cwd: home, env, encoding: 'utf8' }).status, 0)
 assert.equal(fs.readFileSync(`${env.CAPTURE}.pg18`, 'utf8'), 'pg18')
 assert.equal(spawnSync(pg18, ['anything'], { cwd: home, env, encoding: 'utf8' }).status, 2)
 console.log(`Retained shared launcher fixture: ${home}`)
})
