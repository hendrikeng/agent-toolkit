const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')

test('guard rejects adjacent metadata selectors, hook bypasses, output writes and inherited executable overrides', () => {
 const cwd = mkdtempSync(join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT || tmpdir(), 'git-graph-boundaries-'))
 const guard = join(__dirname, 'git-yolo-guard')
 const environment = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' }
 const run = (args, env = {}) => spawnSync(guard, args, { cwd, encoding: 'utf8', env: { ...environment, ...env } })
 assert.equal(run(['init', '--quiet']).status, 0)
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
 ]) assert.equal(run(args).status, 126, args.join(' '))
 for (const name of ['GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_EXTERNAL_DIFF', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH']) assert.equal(run(['status', '--short'], { [name]: 'fixture-override' }).status, 126, name)
 assert.equal(run(['rev-parse', 'HEAD']).stdout, head)
 assert.equal(readFileSync(configPath, 'utf8'), config)
 assert.deepEqual(readFileSync(join(cwd, '.git/index')), index)
 assert.equal(readFileSync(join(cwd, 'file'), 'utf8'), 'changed for driver checks\n')
 assert.equal(existsSync(join(cwd, 'forbidden-driver')), false)
 assert.equal(existsSync(join(cwd, 'forbidden')), false)
})
