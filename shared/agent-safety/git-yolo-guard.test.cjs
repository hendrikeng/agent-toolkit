const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

test('allows explicit config reads and GitHub CLI repository resolution without config writes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'git-guard-config-'))
  const guard = join(__dirname, 'git-yolo-guard')
  const run = (...args) => spawnSync(guard, args, { cwd, encoding: 'utf8' })
  try {
    assert.equal(run('init').status, 0)
    const config = join(cwd, '.git/config')
    const content = readFileSync(config, 'utf8') + '\n[remote "origin"]\n\turl = https://github.com/example/project.git\n\tgh-resolved = base\n[test]\n\tvalue = first\n\tvalue = second\n'
    writeFileSync(config, content)
    for (const args of [
      ['--get', 'remote.origin.url'], ['--local', '--get-all', 'test.value'],
      ['--get-regexp', '^remote\\..*\\.gh-resolved$'], ['--null', '--get-regexp', 'remote.*.url'],
      ['--get', 'test.value', 'second'], ['--get-all', 'test.value', 'first'],
      ['--get-urlmatch', 'http.proxy', 'https://github.com'],
      ['--list'], ['-l', '--show-origin'], ['get', 'remote.origin.url'], ['list', '--local'],
    ]) {
      const result = run('config', ...args)
      assert.ok(result.status === 0 || result.status === 1, result.stderr)
      assert.equal(result.stderr, '')
    }
    assert.equal(run('config', '--get', 'remote.origin.url').stdout.trim(), 'https://github.com/example/project.git')
    assert.equal(run('config', '--get-regexp', '^remote\\..*\\.gh-resolved$').stdout.trim(), 'remote.origin.gh-resolved base')
    for (const args of [
      [], ['test.value', 'replacement'], ['--get', 'test.value', 'first', 'extra'],
      ['test.single', '--get'], ['test.single', '--get-all'], ['test.single', '--get-regexp'],
      ['--local', 'test.single', '--get'], ['test.single', 'replacement', '--get-urlmatch'],
      ['--get', 'test.value', '--replace-all', 'test.value', 'replacement'],
      ['--list', '--unset', 'test.value'], ['--get', '--get-all', 'test.value'],
      ['--add', 'test.value', 'third'], ['--unset-all', 'test.value'],
      ['--rename-section', 'test', 'other'], ['--remove-section', 'test'], ['--edit'], ['-e'],
      ['set', 'test.value', 'replacement'], ['unset', 'test.value'], ['edit'],
      ['get', 'test.value', '--append', 'replacement'], ['list', '--file', config],
      ['--file', config, '--get', 'test.value'], ['--get', 'test.value', '--unknown'],
    ]) assert.equal(run('config', ...args).status, 126, JSON.stringify(args))
    // No network or account needed: gh resolves the marked default repository through Git.
    if (!spawnSync('gh', ['--version']).error) {
      const bin = join(cwd, 'bin')
      mkdirSync(bin)
      symlinkSync(guard, join(bin, 'git'))
      const result = spawnSync('gh', ['repo', 'set-default', '--view'], {
        cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'fixture-token', GH_HOST: 'github.com', GH_REPO: '', GH_CONFIG_DIR: join(cwd, 'gh-config') },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), 'example/project')
    }
    assert.equal(readFileSync(config, 'utf8'), content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

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
