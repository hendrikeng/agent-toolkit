#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
  const result = spawnSync('/usr/bin/git', ['--no-pager', '-c', 'core.fsmonitor=false', '--literal-pathspecs', ...args], { cwd, env })
  if (result.status !== 0) throw Error(`Git ${args[0]} failed: ${result.stderr?.toString().trim() || result.error?.message || 'file is not tracked and unchanged'}`)
  return result.stdout
}

function deleteFiles(paths, cwd = process.cwd(), roots = [path.join(os.homedir(), 'Code'), path.join(os.homedir(), 'orca/workspaces')]) {
  if (!paths.length) throw Error('Usage: repo-delete -- <relative tracked file> [more files]')
  const root = fs.realpathSync(git(cwd, 'rev-parse', '--show-toplevel').toString().trim())
  if (!roots.some(base => { if (!fs.existsSync(base)) return false; const relative = path.relative(fs.realpathSync(base), root); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) })) {
    throw Error('Repository is outside owned development roots')
  }
  const targets = paths.map(name => {
    if (!name || path.isAbsolute(name) || name.split(path.sep).some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || name.startsWith('-')) throw Error(`Unsafe file path: ${name}`)
    const target = path.resolve(cwd, name)
    const relative = path.relative(root, target)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error(`File is outside repository: ${name}`)
    if (relative.split(path.sep).some(part => part.startsWith('.'))) throw Error(`Hidden repository path: ${name}`)
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || fs.realpathSync(target) !== target) throw Error(`Not a regular, non-symlink file: ${name}`)
    const tree = git(root, 'ls-tree', '-z', 'HEAD', '--', relative).toString()
    const entry = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]*)\0$/.exec(tree)
    if (!entry || entry[3] !== relative) throw Error(`File is not a tracked regular file: ${name}`)
    if (git(root, 'ls-files', '--stage', '-z', '--', relative).toString() !== `${entry[1]} ${entry[2]} 0\t${relative}\0`) throw Error(`File has staged changes: ${name}`)
    // ponytail: raw blob equality rejects clean CRLF/filtered worktrees; support normalization only when needed.
    const blob = git(root, 'cat-file', 'blob', entry[2])
    if (!blob.equals(fs.readFileSync(target)) || Boolean(stat.mode & 0o111) !== (entry[1] === '100755')) throw Error(`File has local changes: ${name}`)
    return { target, stat, blob }
  })
  if (new Set(targets.map(({ target }) => target)).size !== targets.length) throw Error('Duplicate file path')
  for (const { target, stat, blob } of targets) {
    const current = fs.lstatSync(target)
    // ponytail: recheck just before unlink; concurrent replacement after this check still needs OS-level isolation.
    if (!current.isFile() || fs.realpathSync(target) !== target || current.dev !== stat.dev || current.ino !== stat.ino || current.mode !== stat.mode || !blob.equals(fs.readFileSync(target))) throw Error(`File changed before deletion: ${target}`)
    fs.unlinkSync(target)
  }
}

if (require.main === module) {
  try {
    if (process.argv[2] !== '--') throw Error('Usage: repo-delete -- <relative tracked file> [more files]')
    deleteFiles(process.argv.slice(3))
  } catch (error) {
    console.error(`repo-delete: ${error.message}`)
    process.exitCode = 1
  }
}
module.exports = { deleteFiles }
