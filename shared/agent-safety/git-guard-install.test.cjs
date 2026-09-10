const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')

test('guard-only installation updates managed copies without replacing local policy', (t) => {
  const home = mkdtempSync(join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT || tmpdir(), 'git-guard-install-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const repo = resolve(__dirname, '../..')
  const target = join(home, '.local/libexec/agent-toolkit/git')
  const marker = `${target}.agent-toolkit.sha256`
  const source = readFileSync(join(__dirname, 'git-yolo-guard'), 'utf8')
  const digest = (text) => createHash('sha256').update(text).digest('hex')
  const install = (...args) => spawnSync(join(repo, 'install.sh'), ['--git-guard-only', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, 'data') },
  })

  let result = install()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(target, 'utf8'), source)
  assert.equal(readFileSync(marker, 'utf8').trim(), digest(source))
  assert.equal(statSync(target).mode & 0o777, 0o700)

  writeFileSync(target, 'previous managed policy\n')
  writeFileSync(marker, `${digest('previous managed policy\n')}\n`)
  result = install()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(target, 'utf8'), source)
  assert.match(result.stdout, /backed up/)

  writeFileSync(target, 'user policy\n')
  result = install()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /refusing to replace user-managed policy/)
  assert.equal(readFileSync(target, 'utf8'), 'user policy\n')
  assert.equal(install('unexpected').status, 2)
})
