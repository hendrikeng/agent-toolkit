const assert = require('node:assert/strict')
const test = require('node:test')
const { containerRunner, main } = require('./pg18-fresh-yolo.cjs')

const root = '/Users/test/Code/project'
const inventory = `${root}/tests/fixtures/fresh-install-security-inventory.json`
const lockfile = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n  excludeLinksFromLockfile: false\n\nimporters:\n"
const manifest = JSON.stringify({
  packageManager: 'pnpm@11.22.0',
  dependencies: { pg: '8.22.0' },
  devDependencies: { vitest: '4.1.10' },
  scripts: {
    'test:pg18-fresh': 'pnpm run build && pnpm run test:pg18-fresh:built',
    'test:pg18-fresh:built': 'vitest run --config vitest.pg18-fresh.config.ts',
  },
})

function fixture(overrides = {}) {
  const calls = []
  const writes = []
  const renames = []
  const filesystem = {
    realpathSync: value => value,
    readFileSync: value => {
      if (value.endsWith('package.json')) return manifest
      if (value.endsWith('inventory.json')) return Buffer.from('{}\n')
      return lockfile
    },
    statSync: value => ({
      isFile: () => ['/usr/local/bin/docker', `${root}/package.json`, `${root}/pnpm-lock.yaml`, `${root}/pnpm-workspace.yaml`, inventory].includes(value),
      mode: 0o100644,
    }),
    mkdtempSync: () => '/tmp/pg18-fresh-export',
    lstatSync: () => ({ isFile: () => true, size: 3 }),
    writeFileSync: (...args) => writes.push(args),
    renameSync: (...args) => renames.push(args),
    rmSync: () => {},
  }
  const spawn = (executable, args, options) => {
    calls.push({ executable, args, options })
    return { status: args[0] === 'image' ? 1 : 0, stdout: args.includes('/bin/cat') ? Buffer.from('{}\n') : '' }
  }
  return {
    calls, renames, writes,
    options: {
      argv: [], cwd: root, filesystem, home: '/Users/test', now: () => 0,
      pause: () => {}, platform: 'darwin', spawn, uid: 501, gid: 20, ...overrides,
    },
  }
}

test('runs the PostgreSQL host suite in a resource-bounded container', () => {
  const { calls, options, renames, writes } = fixture()
  main(options)
  const build = calls.find(call => call.args[0] === 'build')
  assert.match(build.options.input, /FROM postgres:18-bookworm/)

  const install = calls.find(call => call.args.includes('install'))
  assert.ok(install.args.includes('--ignore-pnpmfile'))
  assert.ok(install.args.includes('--ignore-scripts'))
  assert.ok(install.args.includes('--registry=https://registry.npmjs.org/'))
  assert.ok(install.args.includes('bridge'))
  assert.ok(install.args.includes('--read-only'))
  assert.ok(install.args.includes('4g'))
  assert.equal(install.options.timeout, 20 * 60 * 1000)
  assert.ok(install.args.includes(`${root}/package.json:/workspace/package.json:ro`))
  assert.ok(install.args.includes(`${root}/pnpm-lock.yaml:/workspace/pnpm-lock.yaml:ro`))
  assert.ok(install.args.includes('/tmp/pg18-fresh-export/pnpm-workspace.yaml:/workspace/pnpm-workspace.yaml:ro'))
  assert.ok(!install.args.some(argument => argument.includes(`${root}/pnpm-workspace.yaml`)))
  assert.ok(install.args.some(argument => /^\/workspace:rw,.*mode=1777/.test(argument)))
  assert.deepEqual(install.args.slice(-2), ['--store-dir', '/pnpm/store'])
  assert.ok(!install.args.some(argument => argument.includes(`${root}:/workspace`)))

  const enable = calls.find(call => call.args.includes('enable'))
  assert.deepEqual(enable.args.slice(-4), ['enable', '--install-directory', '/pnpm', 'pnpm'])

  const detached = calls.find(call => call.args.includes('--container-runner'))
  assert.ok(detached.args.includes('--init'))
  assert.ok(detached.args.includes('--read-only'))
  assert.deepEqual(detached.args.slice(detached.args.indexOf('--log-driver'), detached.args.indexOf('--log-driver') + 2), ['--log-driver', 'none'])
  for (const value of ['none', '4g', '512', '/workspace:rw,exec,nosuid,nodev,size=2147483648', '/control:rw,noexec,nosuid,nodev,size=16777216,mode=0700', '/workspace/node_modules/.vite-temp:rw,exec,nosuid,nodev,size=67108864,mode=1777', `${root}:/source:ro`, '--container-runner']) {
    assert.ok(detached.args.includes(value), value)
  }
  assert.ok(detached.args.some(argument => /^agent-toolkit-pg18-modules-[a-f0-9]+:\/workspace\/node_modules:ro$/.test(argument)))
  assert.ok(detached.args.includes('PATH=/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'))
  assert.ok(!detached.args.some(argument => argument.includes('docker.sock')))

  const exportCall = calls.find(call => call.args.includes('/bin/cat'))
  assert.deepEqual(exportCall.args.slice(-2), ['/bin/cat', '/control/inventory.json'])
  const inventoryWrite = writes.find(write => write[2].flag === 'wx')
  assert.equal(writes.length, 2)
  assert.ok(inventoryWrite)
  assert.deepEqual(renames[0].slice(1), [inventory])
  assert.equal(calls.filter(call => call.args[0] === 'volume' && call.args[1] === 'rm').length, 3)
  assert.equal(calls.filter(call => call.args[0] === 'rm' && call.args[1] === '--force').length, 3)
  for (const create of calls.filter(call => call.args[0] === 'volume' && call.args[1] === 'create')) {
    assert.ok(create.args.includes('type=tmpfs'))
    assert.ok(create.args.some(argument => argument.startsWith('o=size=')))
  }
})

test('container runner performs both checks before signaling completion', () => {
  const calls = []
  const writes = []
  const copies = []
  const chowns = []
  let filter
  containerRunner({
    filesystem: {
      constants: { COPYFILE_EXCL: 1 },
      chownSync: (...args) => chowns.push(args),
      cpSync: (_source, _target, options) => { filter = options.filter },
      copyFileSync: (...args) => copies.push(args),
      lchownSync: () => {},
      lstatSync: value => ({
        isDirectory: () => value === '/workspace',
        isFile: () => value !== '/workspace',
        isSymbolicLink: () => false,
        size: 3,
      }),
      readdirSync: () => [{ name: 'node_modules' }, { name: 'package.json' }],
      statSync: () => ({ uid: 999, gid: 999 }),
      writeFileSync: (...args) => writes.push(args),
    },
    hold: () => {},
    spawn: (_executable, args, options) => {
      calls.push({ args, options })
      return { status: 0 }
    },
  })
  assert.equal(filter('/source/.git/config'), false)
  assert.equal(filter('/source/node_modules/pkg'), false)
  assert.equal(filter('/source/packages/api/node_modules/pkg'), false)
  assert.equal(filter('/source/.tmp/old-cluster/base/1'), false)
  assert.equal(filter('/source/src/index.ts'), true)
  assert.deepEqual(chowns, [['/workspace', 999, 999], ['/workspace/package.json', 999, 999]])
  assert.deepEqual(calls.map(call => call.args), [
    ['pnpm', 'run', 'test:pg18-fresh'],
    ['pnpm', 'run', 'test:pg18-fresh:built'],
  ])
  assert.equal(calls[0].options.env.UPDATE_FRESH_INSTALL_SECURITY_INVENTORY, '1')
  assert.equal(calls[1].options.env.UPDATE_FRESH_INSTALL_SECURITY_INVENTORY, undefined)
  assert.equal(calls[0].options.uid, 999)
  assert.deepEqual(copies, [['/workspace/tests/fixtures/fresh-install-security-inventory.json', '/control/inventory.json', 1]])
  assert.equal(writes[0][0], '/workspace/pnpm-workspace.yaml')
  assert.deepEqual(writes.at(-1), ['/control/complete', 'ok\n'])
})

test('rejects arguments and repositories without the exact reviewed scripts', () => {
  const withArgument = fixture({ argv: ['anything'] })
  assert.throws(() => main(withArgument.options), /arguments are disabled/)
  assert.equal(withArgument.calls.length, 0)

  const wrongManifest = fixture()
  wrongManifest.options.filesystem = {
    ...wrongManifest.options.filesystem,
    readFileSync: value => value.endsWith('package.json') ? '{}' : lockfile,
  }
  assert.throws(() => main(wrongManifest.options), /does not expose the reviewed PostgreSQL 18 test scripts/)
  assert.equal(wrongManifest.calls.length, 0)

  const incompatibleSettings = fixture()
  const settingsRead = incompatibleSettings.options.filesystem.readFileSync
  incompatibleSettings.options.filesystem = {
    ...incompatibleSettings.options.filesystem,
    readFileSync: value => value.endsWith('pnpm-lock.yaml') ? lockfile.replace('autoInstallPeers: false', 'autoInstallPeers: true') : settingsRead(value),
  }
  assert.throws(() => main(incompatibleSettings.options), /reviewed pnpm lockfile settings are required/)

  for (const resolution of ['https://example.com/package.tgz', 'git://example.com/repo', "'file:../package'", '"h\\x74tps://example.com/package.tgz"']) {
    const externalDependency = fixture()
    const readFile = externalDependency.options.filesystem.readFileSync
    externalDependency.options.filesystem = {
      ...externalDependency.options.filesystem,
      readFileSync: value => value.endsWith('pnpm-lock.yaml') ? `${lockfile}resolution: ${resolution}` : readFile(value),
    }
    assert.throws(() => main(externalDependency.options), /external dependency locations are disabled/)
    assert.equal(externalDependency.calls.length, 0)
  }
})
