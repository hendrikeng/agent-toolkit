#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

function directory(value) {
 assert.equal(fs.realpathSync(value), value, 'Fixture directories must not be symlinks')
 const stat = fs.lstatSync(value)
 assert.ok(stat.isDirectory() && stat.uid === os.userInfo().uid)
 return { dev: stat.dev, ino: stat.ino }
}
function fixtureRoot() {
 const root = path.join(fs.realpathSync(os.tmpdir()), 'agent-toolkit-fixtures')
 fs.mkdirSync(root, { recursive: true, mode: 0o700 })
 directory(root)
 fs.chmodSync(root, 0o700)
 return root
}
function git(root, args) {
 // This capability owns a newly created fixture. It is not a fallback for a
 // rejected ordinary Git command, and never selects an existing repository.
 return execFileSync('/usr/bin/git', ['--no-pager', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], {
  cwd: root, encoding: 'utf8', timeout: 30000,
  env: { PATH: '/usr/bin:/bin', HOME: root, LANG: 'C', LC_ALL: 'C',
   GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
   GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Toolkit fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
   GIT_COMMITTER_NAME: 'Toolkit fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
 }).trim()
}
function metadata(root) {
 const gitdir = path.join(root, '.git')
 const identity = { root: directory(root), git: directory(gitdir) }
 function inspect(directory) {
  for (const entry of fs.readdirSync(directory)) {
   const file = path.join(directory, entry), stat = fs.lstatSync(file)
   assert.ok(!stat.isSymbolicLink(), 'Fixture metadata must not contain symlinks')
   if (stat.isDirectory()) inspect(file)
   else assert.ok(stat.isFile() && stat.nlink === 1, 'Fixture metadata must be unshared regular files')
  }
 }
 inspect(gitdir)
 for (const name of ['commondir', 'gitdir', 'objects/info/alternates', 'objects/info/http-alternates']) assert.ok(!fs.existsSync(path.join(gitdir, name)), 'Shared Git metadata is forbidden')
 return { ...identity, config: fs.readFileSync(path.join(gitdir, 'config'), 'utf8') }
}
function argumentsFor(args) {
 const [command, ...rest] = args
 const operand = value => typeof value === 'string' && value.length > 0 && !value.startsWith('-') && !/[\x00-\x1f\x7f]/.test(value)
 if (command === 'tag') assert.ok(rest.length >= 1 && rest.length <= 2 && rest.every(operand), 'Use tag <name> [commit]; signing and deletion are not fixture operations')
 else if (command === 'checkout') {
  const offset = ['-b', '--orphan', '--detach'].includes(rest[0]) ? 1 : 0
  assert.ok(rest.length >= offset + 1 && rest.length <= (rest[0] === '-b' ? 3 : offset + 1) && rest.slice(offset).every(operand), 'Use checkout <ref>, --detach <ref>, --orphan <branch>, or -b <branch> [ref]')
 } else if (command === 'commit-tree') {
  assert.ok(operand(rest[0]) && rest.length >= 3 && rest.length % 2 === 1)
  for (let i = 1; i < rest.length; i += 2) assert.ok(['-p', '-m'].includes(rest[i]) && operand(rest[i + 1]), 'Only explicit parents and inline commit messages are allowed')
  assert.ok(rest.includes('-m'), 'An inline commit message is required')
 } else if (command === 'update-ref') {
  assert.ok((rest.length === 2 || rest.length === 3) && rest.every(operand))
  assert.ok(rest[0] === 'HEAD' || /^refs\/(heads|tags)\//.test(rest[0]), 'Only fixture HEAD, branch and tag refs may change')
 } else throw Error('Only fixture checkout, tag, commit-tree and update-ref are supported; ordinary Git remains guarded')
 return args
}
function main(args) {
 if (args[0] === 'create' && args.length === 1) {
  const container = fs.mkdtempSync(path.join(fixtureRoot(), 'git-test-'))
  fs.chmodSync(container, 0o700)
  const root = path.join(container, 'repository')
  fs.mkdirSync(root, { mode: 0o700 })
  git(root, ['init', '-b', 'main'])
  git(root, ['commit', '--allow-empty', '-m', 'Disposable fixture foundation'])
  const state = { version: 1, ...metadata(root) }
  fs.writeFileSync(path.join(container, 'fixture.json'), JSON.stringify(state), { flag: 'wx', mode: 0o600 })
  return { id: path.basename(container), path: root, files: 'retained; no cleanup or publishing authority' }
 }
 assert.ok(args[0] === 'run' && /^git-test-[A-Za-z0-9]{6}$/.test(args[1] ?? '') && args.length >= 4, 'Usage: git-test create | git-test run <id> <operation> <arguments>')
 const operation = argumentsFor(args.slice(2))
 const container = path.join(fixtureRoot(), args[1]), root = path.join(container, 'repository')
 directory(container); directory(root)
 const record = path.join(container, 'fixture.json'), stat = fs.lstatSync(record)
 assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === os.userInfo().uid && !(stat.mode & 0o077), 'Invalid fixture record')
 let stored
 try { stored = JSON.parse(fs.readFileSync(record, 'utf8')) }
 catch { throw Error('Invalid fixture record JSON') }
 // Do not include configuration contents in an assertion diff or diagnostic.
 assert.ok(JSON.stringify(stored) === JSON.stringify({ version: 1, ...metadata(root) }), 'Fixture identity or configuration changed')
 return { id: args[1], output: git(root, operation), files: 'retained' }
}
module.exports = { main }
if (require.main === module) {
 try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)) }
 catch (error) { console.error(error.message); process.exitCode = 1 }
}
