// Real Pi loader, temporary dependencies and synthetic session paths. No live session.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
async function check(packageRoot) {
 const modules = path.resolve(packageRoot, '../..')
 const root = fs.mkdtempSync(path.join(tmpdir(), 'extension-loader-'))
 const bundle = path.join(root, 'bundle'), session = path.join(root, 'session'), home = path.join(root, 'home')
 for (const dir of [bundle, home, path.join(session, 'extensions')]) fs.mkdirSync(dir, { recursive: true })
 process.env.HOME = home
 process.env.PI_CODING_AGENT_DIR = session
 process.env.AGENT_TOOLKIT_PI_AGENT_DIR = session
 process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE = bundle
 process.env.JITI_FS_CACHE = 'false'
 // Reuse the temporary dependency graph. This check does not claim manifest acceptance.
 fs.symlinkSync(modules, path.join(bundle, 'node_modules'))
 fs.symlinkSync(path.join(bundle, 'node_modules'), path.join(session, 'node_modules'))
 const paths = [path.join(packageRoot, 'src/index.ts')]
 for (const name of ['development-access', 'task-graph']) {
  const target = path.join(bundle, 'extensions', name)
  fs.cpSync(path.join(__dirname, '../../pi/extensions', name), target, { recursive: true, filter: file => !file.split(path.sep).includes('tests') })
  fs.symlinkSync(target, path.join(session, 'extensions', name))
  paths.push(path.join(session, 'extensions', name, 'index.ts'))
 }
 const sdk = path.join(modules, '@earendil-works/pi-coding-agent')
 const { loadExtensions } = await import(pathToFileURL(path.join(sdk, 'dist/core/extensions/loader.js')))
 const { createEventBus } = await import(pathToFileURL(path.join(sdk, 'dist/core/event-bus.js')))
 const result = await loadExtensions(paths, home, createEventBus())
 assert.deepEqual(result.errors, [], 'Real Pi loader rejected the session dependency layout')
 assert.equal(result.extensions.length, 3)
 assert.ok(result.extensions.some(extension => extension.tools.has('bash')))
 assert.ok(result.extensions.some(extension => extension.tools.has('propose_task_graph')))
 console.log(`Real Pi ${JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'))).version} extension loader passed: ${root}`)
}
check(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
