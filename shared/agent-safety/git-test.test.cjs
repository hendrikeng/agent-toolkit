const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { main } = require('./git-test.cjs')

test('history capability operates only on its own fresh, unchanged repository identity', () => {
 const fixture = main(['create'])
 const run = (...args) => main(['run', fixture.id, ...args])
 assert.ok(fs.existsSync(path.join(fixture.path, '.git/HEAD')))
 assert.ok(!fs.existsSync(path.join(fixture.path, 'fixture.json')), 'checkout cannot remove the capability record')
 run('tag', 'v1', 'HEAD')
 run('checkout', '-b', 'feature')
 const second = run('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Second fixture commit').output
 assert.match(second, /^[a-f0-9]{40}$/)
 run('update-ref', 'HEAD', second)
 run('tag', 'v2', second)
 run('checkout', '--detach', 'v1')
 run('checkout', '--orphan', 'isolated-history')
 for (const args of [
  ['push', 'origin', 'HEAD'], ['config', 'core.worktree', '/elsewhere'], ['tag', '-s', 'signed'],
  ['commit-tree', second, '-F', '/secret'], ['update-ref', '--stdin'], ['checkout', '-f', 'main'],
 ]) assert.throws(() => run(...args))
 assert.throws(() => main(['run', '../existing', 'tag', 'bad']))
 assert.throws(() => main(['run', fixture.path, 'tag', 'bad']))
 const guard = spawnSync(path.join(__dirname, 'git-yolo-guard'), ['-C', fixture.path, 'tag', 'still-denied'], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: fixture.path },
 })
 assert.equal(guard.status, 126, guard.stderr)
 const config = path.join(fixture.path, '.git/config')
 fs.appendFileSync(config, '\n[core]\nworktree = /elsewhere\n[http]\nextraHeader = fixture-sensitive-sentinel\n')
 assert.throws(() => run('tag', 'no-config-redirection'), error => {
  assert.match(error.message, /identity or configuration changed/)
  assert.ok(!error.message.includes('fixture-sensitive-sentinel'), 'refusal must not print configuration contents')
  return true
 })
 const other = main(['create'])
 const refs = path.join(other.path, '.git/refs')
 fs.renameSync(refs, `${refs}-retained`)
 fs.symlinkSync(path.join(fixture.path, '.git/refs'), refs)
 const before = fs.readFileSync(path.join(fixture.path, '.git/refs/tags/v1'))
 assert.throws(() => main(['run', other.id, 'tag', 'no-shared-refs']), /symlinks/)
 assert.deepEqual(fs.readFileSync(path.join(fixture.path, '.git/refs/tags/v1')), before)
 const replaced = main(['create'])
 fs.renameSync(replaced.path, `${replaced.path}-retained`)
 fs.cpSync(`${replaced.path}-retained`, replaced.path, { recursive: true })
 assert.throws(() => main(['run', replaced.id, 'tag', 'no-replacement']), /identity or configuration changed/)
 fs.writeFileSync(path.join(replaced.path, '../fixture.json'), 'fixture-sensitive-sentinel')
 assert.throws(() => main(['run', replaced.id, 'tag', 'no-malformed-record']), error => error.message === 'Invalid fixture record JSON')
 console.log(`Retained Git fixtures: ${fixture.path}, ${other.path}, ${replaced.path}`)
})
