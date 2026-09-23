const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { deleteFiles } = require('./repo-delete.cjs')

test('only unchanged tracked regular files inside an owned worktree can be deleted', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-delete-test-'))
  const repo = path.join(base, 'project')
  fs.mkdirSync(repo)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } })
    assert.equal(result.status, 0, result.stderr)
  }
  try {
    git('init', '-q')
    for (const name of ['first.ts', 'second.ts', 'modified.ts', '.hidden']) fs.writeFileSync(path.join(repo, name), name)
    fs.mkdirSync(path.join(repo, 'src'))
    fs.mkdirSync(path.join(repo, '.private'))
    fs.writeFileSync(path.join(repo, '.private', 'file.ts'), 'hidden parent')
    fs.writeFileSync(path.join(repo, 'src', 'nested.ts'), 'nested')
    git('add', '.')
    git('commit', '-qm', 'fixture')
    git('update-index', '--assume-unchanged', 'modified.ts')
    fs.writeFileSync(path.join(repo, 'modified.ts'), 'changed')
    fs.writeFileSync(path.join(repo, 'untracked.ts'), 'new')
    fs.writeFileSync(path.join(repo, 'second.ts'), 'staged')
    git('add', 'second.ts')
    fs.symlinkSync('first.ts', path.join(repo, 'linked.ts'))
    const reject = (...names) => assert.throws(() => deleteFiles(names, repo, [base]))
    reject('modified.ts')
    reject('second.ts')
    reject('untracked.ts')
    const fakeBin = path.join(base, 'fake-bin')
    fs.mkdirSync(fakeBin)
    const marker = path.join(base, 'fake-git-ran')
    fs.writeFileSync(path.join(fakeBin, 'git'), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, { mode: 0o700 })
    const originalPath = process.env.PATH
    try {
      process.env.PATH = `${fakeBin}:${originalPath}`
      reject('untracked.ts')
      assert.equal(fs.existsSync(marker), false)
    } finally {
      process.env.PATH = originalPath
    }
    reject('.hidden')
    assert.throws(() => deleteFiles(['file.ts'], path.join(repo, '.private'), [base]), /Hidden repository path/)
    reject('linked.ts')
    reject('src')
    reject('../outside.ts')
    reject('first.ts', 'modified.ts')
    reject('first.ts', 'first.ts')
    const first = path.join(repo, 'first.ts')
    const nested = path.join(repo, 'src/nested.ts')
    const originalRead = fs.readFileSync
    let raced = false
    fs.readFileSync = function (file, ...args) {
      if (file === nested && !raced) { raced = true; fs.writeFileSync(first, 'raced') }
      return originalRead.call(this, file, ...args)
    }
    try { assert.throws(() => deleteFiles(['first.ts', 'src/nested.ts'], repo, [base]), /File changed before deletion/) }
    finally { fs.readFileSync = originalRead }
    assert.ok(fs.existsSync(first))
    fs.writeFileSync(first, 'first.ts')
    const originalRename = fs.renameSync
    fs.renameSync = function (source, destination) {
      if (source === first) fs.writeFileSync(first, 'replacement')
      return originalRename.call(this, source, destination)
    }
    try { assert.throws(() => deleteFiles(['first.ts'], repo, [base]), /File changed before deletion/) }
    finally { fs.renameSync = originalRename }
    assert.equal(fs.readFileSync(first, 'utf8'), 'replacement')
    fs.writeFileSync(first, 'first.ts')
    fs.renameSync = function (source, destination) {
      const result = originalRename.call(this, source, destination)
      if (source === first) fs.writeFileSync(first, 'new occupant')
      return result
    }
    try { deleteFiles(['first.ts'], repo, [base]) }
    finally { fs.renameSync = originalRename }
    assert.equal(fs.readFileSync(first, 'utf8'), 'new occupant')
    fs.writeFileSync(first, 'first.ts')
    deleteFiles(['first.ts', 'src/nested.ts'], repo, [base])
    assert.equal(fs.existsSync(path.join(repo, 'first.ts')), false)
    assert.equal(fs.existsSync(path.join(repo, 'src/nested.ts')), false)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
