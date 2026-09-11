const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { homedir } = require('node:os')
const { physicalPath, developmentRoots, assertDevelopmentPath, buildDevelopmentPolicy } = require('./development-policy.cjs')

const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || path.join(homedir(), 'Code/.agent-toolkit-scratch')
assert.equal(fs.lstatSync(scratch).isSymbolicLink(), false)
const fixture = fs.mkdtempSync(path.join(scratch, 'development-policy-'))
const home = path.join(fixture, 'home')
for (const local of ['Code', 'orca/workspaces', 'private/child', '.pi/agent/review-results']) fs.mkdirSync(path.join(home, local), { recursive: true })
const roots = developmentRoots(home)

test('physical roots cover future non-Git directories and reject symlink/traversal escapes', () => {
  for (const root of roots) assert.equal(assertDevelopmentPath(`${root}/new/non-git/file`, roots), `${root}/new/non-git/file`)
  fs.symlinkSync(path.join(home, 'private/child'), path.join(home, 'Code/escape'))
  for (const target of ['Code/escape/file', 'Code/escape/../file', 'Code/../../outside', 'Code-sibling/file']) {
    assert.throws(() => assertDevelopmentPath(`${home}/${target}`, roots), /outside accepted development roots/)
  }
  fs.symlinkSync(path.join(home, 'absent'), path.join(home, 'Code/dangling'))
  assert.throws(() => physicalPath(path.join(home, 'Code/dangling/new')), /ENOENT/)
  assert.equal(physicalPath(`${home}/Code/escape/../file`), `${home}/private/file`)
  assert.throws(() => developmentRoots(`${home}/Code/escape/..`), /physical directories/)
})

test('root policy preserves secrets and human restrictions without ask-to-allow conversion', () => {
  const defaults = { permission: { bash: { '*': 'allow', 'rm *': 'deny' }, path: { '*': 'allow', '*.key': 'deny' }, read: 'allow', write: 'allow', edit: 'allow' } }
  const before = JSON.stringify(defaults)
  const restrictions = { bash: { 'node *': 'deny', 'rm *': 'ask' }, path: { '*.key': 'ask' }, read: 'ask', external_directory: { [`${home}/Code/private/*`]: 'deny' } }
  const options = { home, scratchRoot: `${home}/Code/scratch`, reportRoot: `${home}/.pi/agent/review-results`, restrictions }
  const result = buildDevelopmentPolicy(defaults, options)
  assert.equal(JSON.stringify(defaults), before)
  assert.equal(result.policy.yoloMode, false)
  assert.equal(result.policy.permission.bash['*'], 'allow')
  assert.equal(result.policy.permission.bash['node *'], 'deny')
  assert.equal(result.policy.permission.bash['rm *'], 'deny')
  assert.equal(result.policy.permission.path['*.key'], 'deny')
  assert.equal(result.policy.permission.read['*'], 'ask')
  assert.equal(result.policy.permission.external_directory['*'], 'deny')
  assert.equal(result.policy.permission.external_directory[`${home}/.pi/agent/review-results/*`], 'allow')
  assert.equal(result.policy.permission.external_directory[`${home}/.pi/agent/*`], undefined)
  assert.throws(() => buildDevelopmentPolicy(defaults, { ...options, restrictions: { bash: 'allow' } }), /narrow/)
  assert.throws(() => buildDevelopmentPolicy(defaults, { ...options, restrictions: { external_directory: 'ask' } }), /exact existing root grant/)
  const prompted = buildDevelopmentPolicy(defaults, { ...options, restrictions: { external_directory: { [`${home}/Code/*`]: 'ask' } } })
  assert.equal(prompted.policy.permission.external_directory[`${home}/Code/*`], 'ask')
  assert.equal(prompted.policy.permission.external_directory['*'], 'deny')
  assert.throws(() => buildDevelopmentPolicy(defaults, { ...options, scratchRoot: `${home}/private` }), /outside accepted/)
  console.log(`Retained development policy fixture: ${fixture}`)
})
