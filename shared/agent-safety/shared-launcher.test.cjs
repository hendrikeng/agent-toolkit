const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { parse } = require('smol-toml')
const { codexRules } = require('./development-policy.cjs')

test('managed launchers scope each session, preserve selected accounts, and refuse sandbox bypasses', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-launchers-')))
  const bin = path.join(home, 'bin')
  const managed = path.join(home, '.local/libexec/agent-toolkit')
  const cwd = path.join(home, 'Code/project')
  for (const relative of ['bin', 'Code/project', 'orca/workspaces', '.claude', '.codex/rules', '.local/bin', '.local/libexec/agent-toolkit', '.pi/agent/extensions/pi-permission-system', '.pi/agent/extensions/workspace-sandbox']) fs.mkdirSync(path.join(home, relative), { recursive: true })
  const install = (target, bytes) => {
    fs.writeFileSync(target, bytes, { mode: 0o700 })
    fs.writeFileSync(`${target}.agent-toolkit.sha256`, createHash('sha256').update(bytes).digest('hex'))
  }
  install(path.join(managed, 'AGENTS.md'), '# Shared fixture rules\n')
  install(path.join(managed, 'development-policy.cjs'), fs.readFileSync(path.join(__dirname, 'development-policy.cjs')))
  fs.writeFileSync(path.join(managed, 'development.rules'), codexRules(home))
  fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { example: true }, env: { EXAMPLE_API_KEY: 'fixture only', NODE_AUTH_TOKEN: 'fixture only' } }))
  fs.symlinkSync(path.join(managed, 'AGENTS.md'), path.join(home, '.pi/agent/AGENTS.md'))
  fs.writeFileSync(path.join(home, '.pi/agent/extensions/pi-permission-system/config.json'), fs.readFileSync(path.join(__dirname, 'pi-permission-system.json')))
  install(path.join(home, '.pi/agent/extensions/workspace-sandbox/index.ts'), fs.readFileSync(path.join(__dirname, '../../pi/extensions/workspace-sandbox/index.ts')))
  fs.writeFileSync(path.join(home, '.local/bin/pg-test'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const fake = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) console.log(process.argv[1].endsWith('/claude') ? '2.1.289' : 'codex-cli 0.160.0');
else {
  const args = process.argv.slice(2);
  const inline = args.find(value => value.startsWith('developer_instructions='));
  const promptFile = args[args.indexOf('--append-system-prompt-file') + 1];
  const rules = inline ? JSON.parse(inline.slice('developer_instructions='.length)) : fs.readFileSync(process.argv[1].endsWith('/pi') ? require('node:path').join(process.env.PI_CODING_AGENT_DIR, 'AGENTS.md') : promptFile, 'utf8');
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args, rules, owner: process.env.AGENT_TOOLKIT_ORCHESTRATION_HOST, account: process.env.CODEX_HOME, agentDir: process.env.PI_CODING_AGENT_DIR, workspace: process.env.AGENT_TOOLKIT_WORKSPACE, session: process.env.AGENT_TOOLKIT_SESSION_DIR, tmp: process.env.TMPDIR, cache: process.env.npm_config_cache, pgPid: process.env.AGENT_TOOLKIT_SESSION_PID, pgSession: process.env.AGENT_TOOLKIT_SESSION_ID }));
}
`
  fs.writeFileSync(path.join(bin, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', exports: { '.': { import: './sdk.mjs' } } }))
  fs.writeFileSync(path.join(bin, 'sdk.mjs'), 'export function createBashToolDefinition() {}\nexport function createLocalBashOperations() {}\n')
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: path.join(home, 'selected-account'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CAPTURE: path.join(home, 'capture.json'), NPM_TOKEN: 'fixture only' }
  for (const name of Object.keys(env)) if (name.startsWith('ORCA_') || name.startsWith('PASEO_')) delete env[name]
  delete env.AGENT_TOOLKIT_ORCHESTRATION_HOST
  delete env.AGENT_TOOLKIT_CODEX_PROFILE_HOME
  delete env.AGENT_TOOLKIT_CODEX_ACCOUNT_EMAIL_B64
  const launcher = fs.readFileSync(path.join(__dirname, 'agent-yolo'), 'utf8').replace(`system_home=$(node -p 'require("node:os").userInfo().homedir')`, 'system_home=$HOME')
  for (const host of ['codex', 'claude', 'pi']) {
    fs.writeFileSync(path.join(bin, host), fake, { mode: 0o700 })
    const executable = path.join(bin, `${host}-yolo`)
    fs.writeFileSync(executable, launcher, { mode: 0o700 })
    const result = spawnSync(executable, ['--model', 'fixture'], { cwd, env, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    const capture = JSON.parse(fs.readFileSync(env.CAPTURE))
    assert.equal(capture.workspace, cwd)
    assert.equal(capture.owner, 'none')
    assert.equal(capture.rules, 'Orchestration host: none\n\n# Shared fixture rules\n')
    assert.equal(capture.account, env.CODEX_HOME)
    assert.equal(capture.tmp, path.join(capture.session, 'tmp'))
    assert.equal(capture.cache, path.join(capture.session, 'cache/npm'))
    assert.equal(Number(capture.pgPid), result.pid)
    assert.match(capture.pgSession, /^[a-f0-9-]{36}$/)
    if (host === 'codex') {
      const override = capture.args.find(value => value.startsWith('permissions.agent_toolkit='))
      const profile = parse(override).permissions.agent_toolkit
      assert.equal(profile.filesystem[cwd], 'write')
      assert.equal(profile.filesystem[path.join(capture.session, 'AGENTS.md')], 'read')
      assert.equal(profile.filesystem[':root'], 'deny')
      assert.equal(profile.filesystem[path.join(home, 'Code')], undefined)
      assert.ok(capture.args.includes('--no-daemon'))
      assert.equal(fs.readFileSync(path.join(env.CODEX_HOME, 'rules/agent-toolkit-development.rules'), 'utf8'), codexRules(home))
      const blocked = spawnSync(executable, ['--sandbox', 'danger-full-access'], { cwd, env, encoding: 'utf8' })
      assert.notEqual(blocked.status, 0)
    } else if (host === 'claude') {
      assert.ok(capture.args.includes('--restricted'))
      assert.ok(!capture.args.includes('bypassPermissions'))
      const settingsFile = capture.args[capture.args.indexOf('--settings') + 1]
      const settings = JSON.parse(fs.readFileSync(settingsFile))
      assert.equal(settings.enabledPlugins.example, true)
      assert.equal(settings.disableAllHooks, true)
      assert.equal(settings.sandbox.allowUnsandboxedCommands, false)
      assert.equal(settings.sandbox.failIfUnavailable, true)
      assert.ok(settings.sandbox.filesystem.denyRead.includes(settingsFile))
      assert.ok(settings.sandbox.filesystem.denyWrite.includes(path.join(capture.session, 'AGENTS.md')))
      assert.ok(settings.sandbox.network.allowedDomains.includes('registry.npmjs.org'))
      assert.equal(settings.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1')
      for (const name of ['EXAMPLE_API_KEY', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) assert.ok(settings.sandbox.credentials.envVars.some(entry => entry.name === name && entry.mode === 'deny'), `${name} must not reach subprocesses`)
      assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600)
      assert.equal(spawnSync(executable, ['--permission-mode', 'bypassPermissions'], { cwd, env }).status, 2)
    } else {
      const policy = JSON.parse(fs.readFileSync(path.join(capture.agentDir, 'extensions/pi-permission-system/config.json')))
      assert.equal(policy.permission.bash['*'], 'allow')
      assert.equal(policy.permission.external_directory['*'], 'deny')
      assert.equal(policy.permission.external_directory[cwd], 'allow')
      assert.equal(policy.permission.path_write[path.join(capture.session, 'AGENTS.md')], 'deny')
      assert.ok(fs.existsSync(path.join(capture.agentDir, 'extensions/workspace-sandbox/index.ts')))
      assert.equal(spawnSync(executable, ['--no-extensions'], { cwd, env }).status, 2)
    }
    assert.notEqual(spawnSync(executable, [], { cwd: path.join(home, 'Code'), env }).status, 0)
    for (const [context, owner] of [
      [{ ORCA_WORKSPACE_ID: 'folder' }, 'orca'],
      [{ ORCA_WORKTREE_ID: 'worktree' }, 'orca'],
      [{ ORCA_TERMINAL_HANDLE: 'terminal' }, 'orca'],
      [{ PASEO_AGENT_ID: 'agent' }, 'paseo'],
      [{ ORCA_APP_VERSION: 'installed', PASEO_HOME: '/installed' }, 'none'],
      [{ ORCA_WORKTREE_ID: 'worktree', PASEO_AGENT_ID: 'agent' }, null],
      ...['orca', 'paseo', 'none'].map(owner => [{ ORCA_WORKTREE_ID: 'worktree', PASEO_AGENT_ID: 'agent', AGENT_TOOLKIT_ORCHESTRATION_HOST: owner }, owner]),
      [{ AGENT_TOOLKIT_ORCHESTRATION_HOST: 'unknown' }, null],
      [{ AGENT_TOOLKIT_ORCHESTRATION_HOST: '' }, null],
    ]) {
      fs.rmSync(env.CAPTURE, { force: true })
      const launched = spawnSync(executable, ['--model', 'fixture'], { cwd, env: { ...env, ...context }, encoding: 'utf8', timeout: 10000 })
      if (owner === null) {
        assert.notEqual(launched.status, 0, JSON.stringify(context))
        assert.match(launched.stderr, /AGENT_TOOLKIT_ORCHESTRATION_HOST/)
        assert.equal(fs.existsSync(env.CAPTURE), false, 'ambiguous or invalid owner must fail before launching an agent')
        continue
      }
      assert.equal(launched.status, 0, launched.stderr)
      const routed = JSON.parse(fs.readFileSync(env.CAPTURE))
      assert.equal(routed.owner, owner)
      const label = { orca: 'Orca', paseo: 'Paseo', none: 'none' }[owner]
      assert.equal(routed.rules, `Orchestration host: ${label}\n\n# Shared fixture rules\n`)
      assert.equal(routed.account, env.CODEX_HOME)
      assert.ok(routed.args.includes('fixture'), 'host routing must preserve model overrides')
    }
    install(path.join(managed, 'AGENTS.md'), '# Updated rules\n')
    assert.equal(fs.readFileSync(path.join(capture.session, 'AGENTS.md'), 'utf8'), capture.rules, 'a running session keeps its original rules and owner')
    install(path.join(managed, 'AGENTS.md'), '# Shared fixture rules\n')
  }
  fs.writeFileSync(path.join(bin, 'sdk.mjs'), 'export function createBashToolDefinition() {}\n')
  assert.notEqual(spawnSync(path.join(bin, 'pi-yolo'), [], { cwd, env }).status, 0)
  const reviewRoot = path.join(home, 'reviews')
  fs.mkdirSync(reviewRoot)
  const captureArguments = '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n'
  for (const [name, helper] of [['autoreview-yolo', 'autoreview'], ['pg18-fresh-yolo', 'pg18-fresh-yolo']]) {
    const executable = path.join(bin, name)
    fs.writeFileSync(executable, launcher, { mode: 0o700 })
    install(path.join(managed, helper), captureArguments)
    const helperEnv = { ...env, AGENT_TOOLKIT_REVIEW_ROOT: reviewRoot }
    assert.equal(spawnSync(executable, ['unexpected'], { cwd, env: helperEnv }).status, 2)
    const called = spawnSync(executable, [], { cwd, env: helperEnv, encoding: 'utf8' })
    assert.equal(called.status, 0, called.stderr)
    const args = JSON.parse(fs.readFileSync(env.CAPTURE))
    if (name === 'autoreview-yolo') {
      assert.deepEqual(args.slice(0, 2), ['--mode', 'local'])
      for (const flag of ['--output', '--json-output', '--status-output']) assert.ok(args[args.indexOf(flag) + 1].startsWith(reviewRoot + '/review-'))
    } else assert.deepEqual(args, [])
    fs.appendFileSync(path.join(managed, helper), '// changed helper\n')
    assert.notEqual(spawnSync(executable, [], { cwd, env: helperEnv }).status, 0)
  }
  console.log(`Retained launcher fixture: ${home}`)
})
