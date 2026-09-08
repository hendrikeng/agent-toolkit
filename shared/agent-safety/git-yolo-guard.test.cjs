const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

test('allows read-only ancestry queries and new-branch switch while preserving local work', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'git-guard-test-'))
  const guard = join(__dirname, 'git-yolo-guard')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } }).trim()
  const run = (...args) => spawnSync(guard, args, { cwd, encoding: 'utf8' })
  try {
    git('init')
    writeFileSync(join(cwd, 'tracked'), 'original\n')
    git('add', 'tracked')
    git('commit', '-m', 'initial')
    writeFileSync(join(cwd, 'tracked'), 'staged\n')
    git('add', 'tracked')
    writeFileSync(join(cwd, 'tracked'), 'unstaged\n')
    writeFileSync(join(cwd, 'untracked'), 'keep\n')
    const before = git('status', '--porcelain')
    const head = git('rev-parse', 'HEAD')
    git('remote', 'add', 'origin', cwd)
    git('fetch', 'origin', 'HEAD:refs/remotes/origin/dev')
    git('fetch', 'origin', 'HEAD:refs/remotes/origin/main')
    for (const prefix of [[], ['-C', cwd], ['-c', 'diff.suppressBlankEmpty=false']]) {
      for (const refs of [['HEAD', 'origin/dev'], ['HEAD', 'origin/main'], ['origin/main', 'HEAD'], ['--all', 'HEAD', 'HEAD'], ['--octopus', 'HEAD', 'origin/main']]) {
        const result = run(...prefix, 'merge-base', ...refs)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout.trim(), head)
      }
      const ancestor = run(...prefix, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main')
      assert.equal(ancestor.status, 0, ancestor.stderr)
      const commitDiff = run(...prefix, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD')
      assert.equal(commitDiff.status, 0, commitDiff.stderr)
      assert.equal(commitDiff.stdout.trim(), 'tracked')
    }
    assert.notEqual(run('merge-base', 'HEAD', 'missing-ref').status, 0)
    for (const args of [
      ['-c', 'core.hooksPath=/tmp/unapproved', 'merge-base', 'HEAD', 'origin/dev'],
      ['reset', '--hard'], ['clean', '-fd'], ['checkout', '--', 'tracked']
    ]) assert.equal(run(...args).status, 126, JSON.stringify(args))
    assert.equal(git('status', '--porcelain'), before)
    assert.equal(git('rev-parse', 'HEAD'), head)
    assert.equal(run('switch', '-c', 'slice/new').status, 0)
    assert.equal(git('branch', '--show-current'), 'slice/new')
    assert.equal(git('rev-parse', 'HEAD'), head)
    assert.equal(git('status', '--porcelain'), before)
    assert.equal(git('show', ':tracked'), 'staged')
    assert.equal(readFileSync(join(cwd, 'tracked'), 'utf8'), 'unstaged\n')
    assert.equal(readFileSync(join(cwd, 'untracked'), 'utf8'), 'keep\n')
    assert.notEqual(run('switch', '-c', 'slice/new').status, 0)
    for (const args of [[], ['slice/new'], ['-c'], ['-c', ''], ['-C', 'slice/new'], ['--discard-changes', '-c', 'other'], ['-c', 'other', '--force'], ['-c', '--discard-changes'], ['-c', 'other', 'HEAD~1'], ['--detach']]) {
      assert.equal(run('switch', ...args).status, 126, JSON.stringify(args))
    }
    assert.equal(run('-C', cwd, 'switch', '-c', 'slice/second').status, 0)
    assert.equal(git('status', '--porcelain'), before)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
