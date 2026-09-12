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

test('default root policy keeps only narrow secret, destructive, publication and administration blocks', () => {
  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'pi-permission-system.json'), 'utf8'))
  const result = buildDevelopmentPolicy(defaults, { home, scratchRoot: `${home}/Code/scratch`, reportRoot: `${home}/.pi/agent/review-results` }).policy.permission
  for (const root of roots) assert.equal(result.external_directory[`${root}/*`], 'allow')
  for (const pathRule of ['*.env', '*.env.*', '*.pem', '*.key']) assert.equal(result.path[pathRule], 'deny')
  for (const command of ['rm*', 'git clean *', 'git reset --hard', 'git push*', 'xcrun git*', 'npm *publish*', 'docker*', 'psql*', 'kubectl*']) assert.equal(result.bash[command], 'deny')
  assert.equal(result.bash['*'], 'allow')
  assert.equal(result.bash['*/git*'], undefined, 'test and script paths containing git are not blanket-denied')
})

test('scratch storage must remain inside an accepted development root', () => {
  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'pi-permission-system.json'), 'utf8'))
  assert.throws(() => buildDevelopmentPolicy(defaults, { home, scratchRoot: `${home}/private`, reportRoot: `${home}/.pi/agent/review-results` }), /outside accepted/)
  console.log(`Retained development policy fixture: ${fixture}`)
})
