const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { removeEmptyWorkspaceDirectory, profile } = require('./development-policy.cjs')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

test('Pi empty-directory cleanup removes only unprotected direct workspace children', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-directory-')))
  const root = path.join(home, 'workspace')
  const sibling = path.join(home, 'sibling')
  fs.mkdirSync(root)
  fs.mkdirSync(sibling)
  const remove = command => removeEmptyWorkspaceDirectory(command, root, root, home)
  for (const [command, name] of [['rmdir ./.managed-session-smoke.test', '.managed-session-smoke.test'], ['rmdir "./quoted"', 'quoted'], ["/bin/rmdir './single-quoted'", 'single-quoted']]) {
    fs.mkdirSync(path.join(root, name))
    fs.writeFileSync(path.join(root, name, 'script.js'), 'fixture')
    fs.unlinkSync(path.join(root, name, 'script.js'))
    assert.equal(remove(command), true)
    assert.equal(fs.existsSync(path.join(root, name)), false)
  }
  fs.mkdirSync(path.join(root, 'nonempty'))
  fs.writeFileSync(path.join(root, 'nonempty/keep'), 'keep')
  assert.throws(() => remove('rmdir ./nonempty'), error => error.code === 'ENOTEMPTY' || error.code === 'EEXIST')
  assert.equal(fs.readFileSync(path.join(root, 'nonempty/keep'), 'utf8'), 'keep')
  fs.symlinkSync(sibling, path.join(root, 'alias'))
  assert.throws(() => remove('rmdir ./alias'))
  assert.ok(fs.lstatSync(path.join(root, 'alias')).isSymbolicLink())
  assert.ok(fs.statSync(sibling).isDirectory())
  for (const name of ['.git', '.pi', '.claude', '.codex', '.env', 'private.pem', '.hidden.key']) {
    fs.mkdirSync(path.join(root, name))
    assert.throws(() => remove(`rmdir ./${name}`), /protected/)
    assert.throws(() => remove(`rmdir ./${name.toUpperCase()}`), /protected/)
    assert.ok(fs.statSync(path.join(root, name)).isDirectory())
  }
  fs.mkdirSync(path.join(home, '.pi/agent/extensions'), { recursive: true })
  fs.mkdirSync(path.join(root, 'installed'))
  fs.symlinkSync(path.join(root, 'installed'), path.join(home, '.pi/agent/extensions/fixture'))
  assert.throws(() => remove('rmdir ./installed'), /protected/)
  assert.throws(() => remove('rmdir ./INSTALLED'), /protected/)
  assert.ok(fs.statSync(path.join(root, 'installed')).isDirectory())
  for (const command of ['rmdir ..', 'rmdir .', 'rmdir ./nonempty/child', `rmdir ${sibling}`, 'rmdir --parents x', 'rmdir ./nonempty; touch marker', 'git status']) {
    if (command === 'rmdir ..' || command === 'rmdir .') assert.throws(() => remove(command), /protected/)
    else assert.equal(remove(command), false)
  }
  assert.equal(removeEmptyWorkspaceDirectory('rmdir ./installed', sibling, root, home), false)
  assert.equal(fs.existsSync(path.join(root, 'marker')), false)
})

test('Pi Bash removes the empty folder without launching a shell', { skip: process.platform !== 'darwin' }, async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-empty-directory-')))
  const root = path.join(home, 'Code/workspace')
  const session = path.join(home, 'Code/.agent-toolkit-scratch/development-test')
  const library = path.join(home, '.local/libexec/agent-toolkit')
  fs.mkdirSync(library, { recursive: true })
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(session, { recursive: true })
  fs.mkdirSync(path.join(root, '.managed-session-smoke.test'))
  fs.writeFileSync(path.join(library, 'package.json'), '{}')
  fs.copyFileSync(path.join(__dirname, 'development-policy.cjs'), path.join(library, 'development-policy.cjs'))
  fs.writeFileSync(path.join(session, 'native-profile.json'), JSON.stringify(profile(root, session, home)))
  const saved = { HOME: process.env.HOME, AGENT_TOOLKIT_WORKSPACE: process.env.AGENT_TOOLKIT_WORKSPACE, AGENT_TOOLKIT_SESSION_DIR: process.env.AGENT_TOOLKIT_SESSION_DIR }
  Object.assign(process.env, { HOME: home, AGENT_TOOLKIT_WORKSPACE: root, AGENT_TOOLKIT_SESSION_DIR: session })
  // The real filesystem operation must succeed even when the shell executor cannot.
  const sdk = 'data:text/javascript,' + encodeURIComponent('export const createBashToolDefinition = () => {}; export const createLocalBashOperations = () => ({ exec: async () => { throw Object.assign(new Error("Native sandbox: Operation not permitted"), { code: "EPERM" }) } });')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@earendil-works/pi-coding-agent' ? { url: sdk, shortCircuit: true } : next(specifier, context)
  } })
  try {
    const { createWorkspaceOperations } = await import(pathToFileURL(path.join(__dirname, '../../pi/extensions/workspace-sandbox/index.ts')).href)
    const operations = createWorkspaceOperations()
    assert.equal((await operations.exec('rmdir ./.managed-session-smoke.test', root, { onData() {} })).exitCode, 0)
    assert.equal(fs.existsSync(path.join(root, '.managed-session-smoke.test')), false)
    await assert.rejects(operations.exec('git status', root, { onData() {} }), error => error.code === 'EPERM')
  } finally {
    hooks.deregister()
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value
  }
})
