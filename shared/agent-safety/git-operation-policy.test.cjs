const assert = require('node:assert/strict')
const test = require('node:test')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const guard = join(__dirname, 'git-yolo-guard')
function check(args, inspection = false, selected = false) {
 const env = { ...process.env, AGENT_TOOLKIT_GIT_INSPECTION_ONLY: inspection ? 'true' : 'false' }
 for (const key of Object.keys(env)) if (/^GIT_(?:CONFIG|DIR|WORK_TREE|COMMON_DIR|NAMESPACE|EXEC_PATH|SSH)/.test(key)) delete env[key]
 return spawnSync(guard, [selected ? '--agent-toolkit-selected' : '--agent-toolkit-check', ...args], { env, encoding: 'utf8' })
}
test('Git preflight never executes commands and keeps the operation boundary in each phase', () => {
 for (const phase of [false, true, false]) {
  for (const args of [['rev-parse', 'HEAD'], ['status'], ['log', '-5', '--oneline'], ['diff', '--stat'], ['rev-parse', '-q', '--verify', 'MERGE_HEAD']]) {
   const result = check(args, phase); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'inspection')
  }
 }
 for (const args of [
  ['clean', '-fd'], ['reset', '--hard'], ['reset', '--har'], ['push'], ['commit', '--amend'], ['commit', '-nm', 'bypass'],
  ['-c', 'core.hooksPath=/elsewhere', 'commit'], ['--git-dir=/elsewhere', 'status'], ['--work-tree=/elsewhere', 'status'],
  ['--namespace=other', 'status'], ['config', '--local', 'core.hooksPath', '/elsewhere'], ['log', '--output=file'],
  ['diff', '--ext-diff'], ['show', '--textconv'], ['worktree', 'remove', 'path'],
  ['rebase', 'HEAD~1'], ['update-ref', '-d', 'refs/heads/main'], ['branch', '-D', 'topic'], ['tag', '-d', 'v1'],
 ['checkout', 'other'], ['checkout', '-B', 'other'], ['checkout', '--', 'file'], ['switch', '-C', 'other'],
 ]) assert.equal(check(args).status, 126, args.join(' '))
 for (const args of [['add', '--', 'file'], ['switch', 'other'], ['branch', 'topic'], ['tag', 'v1'], ['worktree', 'repair']]) assert.equal(check(args).stdout.trim(), 'local', args.join(' '))
 assert.equal(check(['merge', 'topic']).stdout.trim(), 'integration')
 assert.equal(check(['add', '--', 'file'], true).status, 126)
 assert.equal(check(['merge', 'topic'], true).status, 126)
 assert.equal(check(['-C', '/other', 'status'], false, true).stdout.trim(), 'inspection')
 assert.equal(check(['-C', '/other', 'add', '--', 'file'], false, true).status, 126)
 assert.equal(check(['-C', '/other', 'merge', 'topic'], false, true).status, 126)
})
