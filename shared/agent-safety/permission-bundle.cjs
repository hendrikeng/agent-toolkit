// Human installer only. Sessions verify an immutable, retained bundle and never repair it.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { POLICY_VERSION, developmentRoots, buildDevelopmentPolicy } = require('./development-policy.cjs')
const digest = value => createHash('sha256').update(value).digest('hex')
function inventory(root, prefix = '') {
 const entries = {}
 for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
  const local = path.join(prefix, name)
  if (local === 'manifest.json') continue
  const file = path.join(root, local), stat = fs.lstatSync(file)
  if (stat.isDirectory()) Object.assign(entries, inventory(root, local))
  else if (stat.isSymbolicLink()) {
   const target = fs.realpathSync(file)
   assert.ok(target.startsWith(root + path.sep), `Bundle symlink escape: ${local}`)
   entries[local] = { link: fs.readlinkSync(file) }
  } else {
   assert.ok(stat.isFile(), `Unexpected bundle resource: ${local}`)
   entries[local] = { hash: digest(fs.readFileSync(file)), mode: stat.mode & 0o777 }
  }
 }
 return entries
}
function verifyBundle(root) {
 assert.equal(fs.realpathSync(root), root, 'Select a physical retained bundle')
 assert.ok(fs.lstatSync(path.join(root, 'manifest.json')).isFile(), 'Manifest must be a regular file')
 const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
 assert.equal(manifest.version, POLICY_VERSION, 'Installation version mismatch; reviewed installation required')
 assert.equal(manifest.permissionPackage, '20.7.3')
 assert.equal(manifest.graphVersion, 4)
 assert.match(manifest.piVersion, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
 for (const file of ['dispatch', 'pi-yolo', 'git', 'policy.json', 'development-policy.cjs', 'local-resources.cjs', 'extensions/development-access/index.ts', 'extensions/task-graph/index.ts']) assert.ok(manifest.files?.[file]?.hash, `Missing bundle component: ${file}`)
 assert.deepEqual(inventory(root), manifest.files, 'Installation bytes differ; do not repair a running session')
 const prefix = 'node_modules/@gotgenes/pi-permission-system/'
 require('./patch-permission-tool-visibility.cjs').checkInstallation(path.join(root, prefix), Object.fromEntries(Object.entries(manifest.files).filter(([name, entry]) => name.startsWith(prefix) && entry.hash).map(([name, entry]) => [name.slice(prefix.length), entry.hash])))
 assert.deepEqual(developmentRoots(process.env.HOME), manifest.roots, 'Accepted development roots changed')
 return manifest
}
function stage(source, parent, home) {
 const roots = developmentRoots(home)
 fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
 assert.equal(fs.realpathSync(parent), parent)
 const root = path.join(parent, `release-${randomUUID()}`)
 fs.mkdirSync(root, { mode: 0o700 })
 const safety = path.join(source, 'shared/agent-safety')
 const files = ['development-policy.cjs', 'permission-bundle.cjs', 'patch-permission-tool-visibility.cjs', 'permission-shell.ts', 'local-resources.cjs']
 for (const file of files) fs.copyFileSync(path.join(safety, file), path.join(root, file))
 for (const [from, to] of [['agent-yolo', 'pi-yolo'], ['pi-yolo-dispatch', 'dispatch'], ['git-yolo-guard', 'git']]) {
  fs.copyFileSync(path.join(safety, from), path.join(root, to)); fs.chmodSync(path.join(root, to), 0o700)
 }
 fs.writeFileSync(path.join(root, 'git.agent-toolkit.sha256'), digest(fs.readFileSync(path.join(root, 'git'))))
 fs.mkdirSync(path.join(root, 'extensions'))
 for (const name of ['development-access', 'task-graph']) fs.cpSync(path.join(source, 'pi/extensions', name), path.join(root, 'extensions', name), { recursive: true, filter: file => !file.split(path.sep).includes('tests') })
 const piVersion = execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim()
 assert.match(piVersion, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/)
 execFileSync('npm', ['install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '@gotgenes/pi-permission-system@20.7.3', `@earendil-works/pi-coding-agent@${piVersion}`], { stdio: 'inherit' })
 const packageRoot = path.join(root, 'node_modules/@gotgenes/pi-permission-system')
 require('./patch-permission-tool-visibility.cjs').install(packageRoot)
 const defaults = JSON.parse(fs.readFileSync(path.join(safety, 'pi-permission-system.json'), 'utf8'))
 const config = buildDevelopmentPolicy(defaults, { home, reportRoot: path.join(home, 'Code/.agent-toolkit-reports') })
 fs.writeFileSync(path.join(root, 'policy.json'), JSON.stringify(config.policy, null, 2) + '\n')
 const manifest = { version: POLICY_VERSION, roots, acceptedAt: new Date().toISOString(), permissionPackage: '20.7.3', graphVersion: 4, piVersion, files: inventory(root) }
 fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 })
 verifyBundle(root)
 return root
}
function activate(root, pointer) {
 verifyBundle(root)
 assert.ok(root.startsWith(path.join(process.env.HOME, '.local/libexec/agent-toolkit/permission-bundles') + path.sep), 'Bundle is outside the supported installation location')
 const next = `${pointer}.${randomUUID()}`
 fs.symlinkSync(path.join(root, 'dispatch'), next)
 fs.renameSync(next, pointer) // Atomic selection; old bundles and running sessions remain intact.
}
module.exports = { inventory, verifyBundle, stage, activate }
if (require.main === module) {
 const [action, ...args] = process.argv.slice(2)
 if (action === 'verify') { const result = verifyBundle(args[0]); console.log(JSON.stringify({ version: result.version, roots: result.roots, piVersion: result.piVersion })) }
 else if (action === 'stage') console.log(stage(...args))
 else if (action === 'activate') activate(...args)
 else throw new Error('Usage: permission-bundle.cjs stage|verify|activate')
}
