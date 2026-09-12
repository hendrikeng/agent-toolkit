const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')

test('guard rejects adjacent metadata selectors, hook bypasses, output writes and inherited executable overrides', () => {
 const cwd = JSON.parse(execFileSync('git-test', ['create'], { encoding: 'utf8' })).path
 const guard = join(__dirname, 'git-yolo-guard')
 const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
 const run = (args, env = {}) => spawnSync(guard, args, { cwd, encoding: 'utf8', env: { ...environment, ...env } })
 writeFileSync(join(cwd, 'file'), 'keep\n')
 assert.equal(run(['add', '--', 'file']).status, 0)
 assert.equal(run(['commit', '-m', 'fixture']).status, 0)
 const configPath = join(cwd, '.git/config')
 const driver = join(cwd, '.git/fixture-driver')
 writeFileSync(driver, '#!/bin/sh\nprintf ran > forbidden-driver\n', { mode: 0o755 })
 writeFileSync(join(cwd, '.gitattributes'), 'file diff=fixture\n')
 writeFileSync(configPath, readFileSync(configPath, 'utf8') + `\n[alias]\n\tx = !touch forbidden\n[diff "fixture"]\n\tcommand = ${JSON.stringify(driver)}\n\ttextconv = ${JSON.stringify(driver)}\n`)
 writeFileSync(join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nset -e\ngit diff --cached --name-only > .git/hook-index\ngit rev-parse --git-dir > .git/hook-repo\n', { mode: 0o755 })
 writeFileSync(join(cwd, 'file'), 'scoped hook fixture\n')
 const scoped = run(['commit', '-m', 'scoped hook fixture', '--', 'file'])
 assert.equal(scoped.status, 0, scoped.stderr)
 assert.equal(readFileSync(join(cwd, '.git/hook-index'), 'utf8'), 'file\n')
 assert.equal(readFileSync(join(cwd, '.git/hook-repo'), 'utf8'), '.git\n')
 writeFileSync(join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf ran > .git/hook-ran\nexit 7\n', { mode: 0o755 })
 for (const option of ['-amnormal', '-mnormal']) {
  const result = run(['commit', '--allow-empty', option])
  assert.notEqual(result.status, 126); assert.notEqual(result.status, 0)
  assert.equal(readFileSync(join(cwd, '.git/hook-ran'), 'utf8'), 'ran')
 }
 writeFileSync(join(cwd, 'file'), 'changed for driver checks\n')
 const head = run(['rev-parse', 'HEAD']).stdout
 const config = readFileSync(configPath, 'utf8'), index = readFileSync(join(cwd, '.git/index'))
 for (const args of [
  ['status', '--short'], ['-C', cwd, 'status', '--short'], ['--no-pager', '-C', cwd, 'log', '-1', '--oneline'],
  ['config', '--local', '--get', 'alias.x'], ['config', '--get', '--local', 'alias.x'],
  ['diff', '--stat'], ['show', '--stat', 'HEAD'], ['blame', 'file'], ['worktree', 'list', '--porcelain'], ['branch', '--show-current'],
 ]) { const result = run(args); assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`) }
 for (const args of [
  ['config', '--get', 'alias.x', '--local'], ['x'], ['-c', 'alias.x=!touch forbidden', 'x'], ['-C', cwd, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'no'],
  ['--git-dir', join(cwd, '.git'), 'status'], ['--work-tree=' + cwd, 'status'], ['--namespace=other', 'status'],
  ['--config-env=core.hooksPath=EVIL', 'status'], ['--exec-path=/elsewhere', 'status'], ['-C'],
  ['branch', '--show-current', '-D', 'main'], ['worktree', 'repair'], ['worktree', 'move', 'a', 'b'], ['worktree', 'rm', 'a'],
  ['commit', '-nm', 'no'], ['commit', '-qnm', 'no'], ['commit', '-an', '-m', 'no'],
  ['commit', '--amen', '--no-edit'], ['commit', '--no-ver', '-m', 'no'], ['commit', '--no-no-amend', '--no-edit'],
  ['commit', '--amend', '-m', 'no'], ['commit', '-n', '-m', 'no'], ['commit', '--no-verify', '-m', 'no'],
  ['diff', '--textcon'], ['diff', '--ext-dif'], ['diff', '--out=forbidden'],
  ['diff', '--output=forbidden'], ['log', '--output', 'forbidden'], ['show', '--ext-diff'], ['diff', '--textconv'],
  ['push', '--dry-run'], ['-C', cwd, 'push', '--force'], ['clean', '-fdx'], ['reset', '--hard'],
  ['rebase'], ['rebase', '--exec', driver], ['rebase', '-x', driver],
  ['init', '--template=elsewhere'], ['init', '--separate-git-dir=elsewhere'],
  ['remote', 'set-url', 'origin', cwd], ['remote', '-v', 'set-url', 'origin', cwd],
  ['remote', '--verbose', 'remove', 'origin'], ['remote', 'add', 'other', cwd],
  ['clone', '-c', 'core.hooksPath=elsewhere', cwd, 'clone'],
  ['clone', '-qcprotocol.file.allow=always', cwd, 'clone'],
  ['clone', '--conf=core.hooksPath=elsewhere', cwd, 'clone'],
  ['clone', '--tem=elsewhere', cwd, 'clone'], ['clone', '--separate-git-dir=elsewhere', cwd, 'clone'],
  ['clone', '-u', driver, cwd, 'clone'], ['clone', '-qu' + driver, cwd, 'clone'],
  ['fetch', '--upload-pack', driver, cwd], ['fetch', '--upload-p=' + driver, cwd],
  ['fetch', '--exec=' + driver, cwd], ['fetch', '--update-head-ok', cwd],
 ]) assert.equal(run(args).status, 126, args.join(' '))
 for (const name of ['GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_GRAFT_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXTERNAL_DIFF', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH']) assert.equal(run(['status', '--short'], { [name]: 'fixture-override' }).status, 126, name)
 const reviewEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_GRAFT_FILE: '/dev/null' }
 for (const args of [['status', '--short'], ['diff'], ['config', '--local', '--path', '--get', 'alias.x']]) {
  const result = run(args, reviewEnv)
  assert.equal(result.status, 0, result.stderr)
 }
 assert.equal(run(['status'], { ...reviewEnv, GIT_CONFIG_GLOBAL: configPath }).status, 126)
 assert.equal(run(['status'], { ...reviewEnv, GIT_CONFIG_NOSYSTEM: '0' }).status, 126)
 assert.equal(run(['status'], { ...reviewEnv, GIT_CONFIG_COUNT: '0' }).status, 0)
 assert.equal(run(['status'], { GIT_CONFIG_COUNT: '0', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: driver }).status, 126)
 for (const keys of [['credential.interactive', 'credential.guiPrompt'], ['credential.guiPrompt', 'credential.interactive']]) {
  const transport = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: keys[0], GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: keys[1], GIT_CONFIG_VALUE_1: 'false' }
  assert.equal(run(['status', '--short'], transport).status, 0, 'safe settings injected after launcher startup must work')
  for (const key of keys) {
   const result = run(['config', '--get', key], transport)
   assert.equal(result.status, 0, result.stderr)
   assert.equal(result.stdout.trim(), 'false', 'the guard must retain fixed non-interactive credentials')
  }
  for (const extra of [
   { GIT_CONFIG_COUNT: '3' }, { GIT_CONFIG_VALUE_0: 'true' }, { GIT_CONFIG_KEY_0: 'core.sshCommand' },
   { GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: driver }, { GIT_CONFIG_PARAMETERS: 'unsafe' },
  ]) assert.equal(run(['status'], { ...transport, ...extra }).status, 126, 'other inherited configuration remains denied')
 }
 assert.equal(run(['rev-parse', 'HEAD']).stdout, head)
 assert.equal(readFileSync(configPath, 'utf8'), config)
 assert.deepEqual(readFileSync(join(cwd, '.git/index')), index)
 assert.equal(readFileSync(join(cwd, 'file'), 'utf8'), 'changed for driver checks\n')
 assert.equal(existsSync(join(cwd, 'forbidden-driver')), false)
 assert.equal(existsSync(join(cwd, 'forbidden')), false)
 const clone = join(cwd, 'clone')
 const result = run(['clone', '--no-hardlinks', '-b', run(['branch', '--show-current']).stdout.trim(), cwd, clone])
 assert.equal(result.status, 0, result.stderr)
 assert.equal(run(['-C', clone, 'rev-parse', 'HEAD']).stdout, head)
 assert.equal(run(['fetch', cwd]).status, 0)
})
