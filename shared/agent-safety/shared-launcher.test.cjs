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
 for (const local of ['bin', 'Code', 'orca/workspaces', '.claude', '.codex/rules', '.local/libexec/agent-toolkit']) fs.mkdirSync(path.join(home, local), { recursive: true })
 const guard = fs.readFileSync(path.join(__dirname, 'git-yolo-guard'))
 fs.writeFileSync(path.join(managed, 'git'), guard, { mode: 0o700 })
 fs.writeFileSync(path.join(managed, 'git.agent-toolkit.sha256'), createHash('sha256').update(guard).digest('hex'))
 fs.writeFileSync(path.join(home, '.codex/rules/agent-safety.rules'), 'synthetic policy fixture')
 fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true }, permissions: { deny: ['Bash(rm *)'] } }))
 const fake = `#!/usr/bin/env node
const fs=require('node:fs');
if(process.argv[2]==='execpolicy') console.log('{"decision":"forbidden"}');
else fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args:process.argv.slice(2),path:process.env.PATH,account:process.env.CODEX_HOME,configCount:process.env.GIT_CONFIG_COUNT}));
`
 const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CAPTURE: path.join(home, 'capture.json') }
 delete env.AGENT_TOOLKIT_PERMISSION_BUNDLE
 Object.assign(env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'credential.guiPrompt', GIT_CONFIG_VALUE_1: 'false' })
 for (const host of ['codex', 'claude']) {
  fs.writeFileSync(path.join(bin, host), fake, { mode: 0o700 })
  const launcher = path.join(bin, `${host}-yolo`)
  fs.copyFileSync(path.join(__dirname, 'agent-yolo'), launcher); fs.chmodSync(launcher, 0o700)
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
  } else {
   const config = JSON.parse(capture.args[capture.args.indexOf('--settings') + 1])
   assert.ok(config.permissions.deny.includes('Bash(dangerouslyDisableSandbox:true)'))
   assert.deepEqual(config.sandbox.network.allowedDomains, ['localhost', '127.0.0.1'])
  }
 }
 console.log(`Retained shared launcher fixture: ${home}`)
})
