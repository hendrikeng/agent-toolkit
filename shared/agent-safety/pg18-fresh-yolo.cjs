#!/usr/bin/env node
const childProcess = require('node:child_process')
const { randomBytes } = require('node:crypto')
const defaultFs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const IMAGE = 'agent-toolkit-pg18-node24:1'
const INVENTORY = 'tests/fixtures/fresh-install-security-inventory.json'
const WORKSPACE_CONFIG = "packages:\n  - .\nautoInstallPeers: false\nverifyDepsBeforeRun: false\n"
// Exact strings only. The TMPDIR=/tmp form keeps the macOS host socket path under 104 bytes; /tmp is a tmpfs in the container.
const REVIEWED_BUILT_SCRIPTS = [
  'vitest run --config vitest.pg18-fresh.config.ts',
  'TMPDIR=/tmp vitest run --config vitest.pg18-fresh.config.ts',
]

function chownTree(filesystem, target, uid, gid, root = target) {
  const stat = filesystem.lstatSync(target)
  if (stat.isSymbolicLink()) {
    filesystem.lchownSync(target, uid, gid)
    return
  }
  filesystem.chownSync(target, uid, gid)
  if (!stat.isDirectory()) return
  for (const entry of filesystem.readdirSync(target, { withFileTypes: true })) {
    if (target === root && entry.name === 'node_modules') continue
    chownTree(filesystem, path.join(target, entry.name), uid, gid, root)
  }
}

function containerRunner({
  filesystem = defaultFs,
  hold = () => setTimeout(() => {}, 10 * 60 * 1000),
  spawn = childProcess.spawnSync,
} = {}) {
  const root = '/source'
  filesystem.cpSync(root, '/workspace', {
    recursive: true,
    filter: source => {
      const parts = path.relative(root, source).split(path.sep)
      return !parts.some(part => ['.git', '.tmp', 'coverage', 'dist', 'node_modules'].includes(part))
    },
  })
  filesystem.writeFileSync('/workspace/pnpm-workspace.yaml', WORKSPACE_CONFIG)
  const postgres = filesystem.statSync('/var/lib/postgresql')
  chownTree(filesystem, '/workspace', postgres.uid, postgres.gid)
  const run = (args, extraEnvironment = {}) => {
    const result = spawn('/usr/local/bin/corepack', args, {
      cwd: '/workspace',
      env: { ...process.env, ...extraEnvironment },
      gid: postgres.gid,
      stdio: 'inherit',
      uid: postgres.uid,
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
  run(['pnpm', 'run', 'test:pg18-fresh'], { UPDATE_FRESH_INSTALL_SECURITY_INVENTORY: '1' })
  run(['pnpm', 'run', 'test:pg18-fresh:built'])
  const generated = `/workspace/${INVENTORY}`
  const generatedStat = filesystem.lstatSync(generated)
  if (!generatedStat.isFile() || generatedStat.size > 10 * 1024 * 1024) throw new Error('generated security inventory is not a bounded regular file')
  filesystem.copyFileSync(generated, '/control/inventory.json', filesystem.constants.COPYFILE_EXCL)
  filesystem.writeFileSync('/control/complete', 'ok\n')
  hold()
}

function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  filesystem = defaultFs,
  home = os.homedir(),
  now = () => Date.now(),
  pause = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
  platform = process.platform,
  spawn = childProcess.spawnSync,
  uid = process.getuid?.(),
  gid = process.getgid?.(),
} = {}) {
  const fail = message => { throw new Error(`pg18-fresh-yolo: ${message}`) }
  const run = (executable, args, options = {}) => {
    const result = spawn(executable, args, { stdio: 'inherit', ...options })
    if (result.error) fail(result.error.message)
    if (result.status !== 0) {
      const error = new Error(`pg18-fresh-yolo: command failed with status ${result.status ?? 1}`)
      error.exitCode = result.status ?? 1
      throw error
    }
    return result
  }

  if (argv.length !== 0) fail('arguments are disabled')
  if ((platform !== 'darwin' && platform !== 'linux') || uid === undefined || gid === undefined) fail('unsupported platform')

  const root = filesystem.realpathSync(cwd)
  const realHome = filesystem.realpathSync(home)
  if (!root.startsWith(`${realHome}/Code/`) && !root.startsWith(`${realHome}/orca/workspaces/`)) {
    fail('start inside ~/Code or ~/orca/workspaces')
  }
  const packagePath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'pnpm-lock.yaml')
  const inventoryPath = path.join(root, INVENTORY)
  for (const file of [packagePath, lockPath, inventoryPath]) {
    if (filesystem.realpathSync(file) !== file || !filesystem.statSync(file).isFile()) {
      fail(`${path.basename(file)} must be a regular file inside the repository`)
    }
  }
  const manifest = JSON.parse(filesystem.readFileSync(packagePath, 'utf8'))
  if (
    manifest.scripts?.['test:pg18-fresh'] !== 'pnpm run build && pnpm run test:pg18-fresh:built' ||
    !REVIEWED_BUILT_SCRIPTS.includes(manifest.scripts?.['test:pg18-fresh:built'])
  ) fail('the repository does not expose the reviewed PostgreSQL 18 test scripts')
  if (manifest.packageManager !== 'pnpm@11.22.0') fail('the reviewed pnpm version is required')
  const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const version of Object.values(manifest[section] ?? {})) {
      if (typeof version !== 'string' || !exactVersion.test(version)) fail('dependency URLs and version ranges are disabled')
    }
  }
  const lockfile = filesystem.readFileSync(lockPath, 'utf8')
  if (!lockfile.startsWith("lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n  excludeLinksFromLockfile: false\n\nimporters:\n")) {
    fail('the reviewed pnpm lockfile settings are required')
  }
  if (/\\|(?:https?:\/\/|git:\/\/|ssh:\/\/|git\+|git@|(?:^|[^A-Za-z0-9_-])(?:file|link|workspace|github|gitlab|bitbucket):)/i.test(lockfile)) {
    fail('external dependency locations are disabled')
  }

  const docker = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/usr/bin/docker'].find(candidate => {
    try { return filesystem.statSync(candidate).isFile() } catch { return false }
  })
  if (!docker) fail('Docker is unavailable')

  if (spawn(docker, ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status !== 0) {
    const dockerfile = 'FROM node:24-bookworm-slim AS node\nFROM postgres:18-bookworm\nCOPY --from=node /usr/local/ /usr/local/\n'
    run(docker, ['build', '--tag', IMAGE, '-'], {
      input: dockerfile,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  }

  const invocation = randomBytes(8).toString('hex')
  const container = `agent-toolkit-pg18-test-${invocation}`
  const holder = `agent-toolkit-pg18-holder-${invocation}`
  const installer = `agent-toolkit-pg18-install-${invocation}`
  const modules = `agent-toolkit-pg18-modules-${invocation}`
  const pnpm = `agent-toolkit-pg18-pnpm-${invocation}`
  const corepack = `agent-toolkit-pg18-corepack-${invocation}`
  const volumes = [modules, pnpm, corepack]
  let supportRoot
  let temporary
  try {
    supportRoot = filesystem.mkdtempSync(path.join(os.tmpdir(), 'pg18-fresh-support-'))
    const workspaceConfig = path.join(supportRoot, 'pnpm-workspace.yaml')
    filesystem.writeFileSync(workspaceConfig, WORKSPACE_CONFIG, { mode: 0o600 })
    for (const [volume, size] of [[modules, '1g'], [pnpm, '1g'], [corepack, '256m']]) {
      run(docker, [
        'volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
        '--opt', `o=size=${size},mode=0755`, volume,
      ], { stdio: ['ignore', 'ignore', 'inherit'] })
    }
    run(docker, [
      'run', '--detach', '--name', holder, '--network', 'none', '--read-only', '--log-driver', 'none',
      '--memory', '4g', '--cpus', '0.25', '--pids-limit', '32',
      '--volume', `${modules}:/hold/modules`, '--volume', `${pnpm}:/hold/pnpm`,
      '--volume', `${corepack}:/hold/corepack`, '--entrypoint', '/bin/sleep', IMAGE, '1800',
    ])
    run(docker, [
      'run', '--rm', '--network', 'none', '--entrypoint', '/usr/bin/chown',
      '--volume', `${modules}:/workspace/node_modules`,
      '--volume', `${pnpm}:/pnpm`,
      '--volume', `${corepack}:/tmp/home`,
      IMAGE, '-R', 'postgres:postgres', '/workspace/node_modules', '/pnpm', '/tmp/home',
    ])

    // The only networked phase sees the manifest and lockfile, not repository source.
    run(docker, [
      'run', '--name', installer, '--user', 'postgres', '--network', 'bridge', '--workdir', '/workspace',
      '--read-only', '--log-driver', 'none',
      '--memory', '4g', '--cpus', '4', '--pids-limit', '512',
      '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=536870912',
      '--tmpfs', '/workspace:rw,nosuid,nodev,mode=1777,size=67108864',
      '--volume', `${packagePath}:/workspace/package.json:ro`,
      '--volume', `${lockPath}:/workspace/pnpm-lock.yaml:ro`,
      '--volume', `${workspaceConfig}:/workspace/pnpm-workspace.yaml:ro`,
      '--volume', `${modules}:/workspace/node_modules`,
      '--volume', `${pnpm}:/pnpm`,
      '--volume', `${corepack}:/tmp/home`,
      '--env', 'CI=1', '--env', 'HOME=/tmp/home',
      '--env', 'COREPACK_HOME=/tmp/home/corepack', '--env', 'PNPM_HOME=/pnpm',
      '--entrypoint', '/usr/local/bin/corepack', IMAGE,
      'pnpm', 'install', '--frozen-lockfile', '--ignore-pnpmfile', '--ignore-scripts',
      '--registry=https://registry.npmjs.org/', '--store-dir', '/pnpm/store',
    ], { timeout: 20 * 60 * 1000 })

    run(docker, [
      'run', '--rm', '--user', 'postgres', '--network', 'none',
      '--volume', `${modules}:/workspace/node_modules`, '--entrypoint', '/bin/mkdir', IMAGE,
      '-p', '/workspace/node_modules/.vite-temp',
    ])
    run(docker, [
      'run', '--rm', '--user', 'postgres', '--network', 'none',
      '--volume', `${pnpm}:/pnpm`, '--volume', `${corepack}:/tmp/home`,
      '--env', 'HOME=/tmp/home', '--env', 'COREPACK_HOME=/tmp/home/corepack',
      '--entrypoint', '/usr/local/bin/corepack', IMAGE,
      'enable', '--install-directory', '/pnpm', 'pnpm',
    ])

    run(docker, [
      'run', '--detach', '--init', '--name', container, '--network', 'none',
      '--read-only', '--log-driver', 'none',
      '--memory', '4g', '--cpus', '4', '--pids-limit', '512',
      '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=536870912',
      '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=2147483648',
      '--tmpfs', '/control:rw,noexec,nosuid,nodev,size=16777216,mode=0700',
      '--tmpfs', '/workspace/node_modules/.vite-temp:rw,exec,nosuid,nodev,size=67108864,mode=1777',
      '--volume', `${root}:/source:ro`,
      '--volume', `${modules}:/workspace/node_modules:ro`,
      '--volume', `${pnpm}:/pnpm:ro`,
      '--volume', `${corepack}:/tmp/home:ro`,
      '--volume', `${__filename}:/runner.cjs:ro`,
      '--env', 'CI=1', '--env', 'HOME=/tmp/home',
      '--env', 'COREPACK_HOME=/tmp/home/corepack', '--env', 'PNPM_HOME=/pnpm',
      '--env', 'PATH=/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--env', 'TRACN_PG_CONFIG=/usr/lib/postgresql/18/bin/pg_config',
      '--entrypoint', '/usr/local/bin/node', IMAGE, '/runner.cjs', '--container-runner',
    ])

    const deadline = now() + 20 * 60 * 1000
    while (true) {
      if (spawn(docker, ['exec', container, '/usr/bin/test', '-f', '/control/complete'], { stdio: 'ignore' }).status === 0) break
      const state = spawn(docker, ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', container], { encoding: 'utf8' })
      if (state.status !== 0 || !state.stdout.startsWith('true ')) {
        spawn(docker, ['logs', container], { stdio: 'inherit' })
        fail(`isolated test container exited before completion${state.stdout ? ` (${state.stdout.trim()})` : ''}`)
      }
      if (now() >= deadline) fail('isolated test container exceeded 20 minutes')
      pause(1000)
    }

    const inventory = run(docker, ['exec', container, '/bin/cat', '/control/inventory.json'], {
      encoding: null,
      maxBuffer: 11 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }).stdout
    if (!Buffer.isBuffer(inventory) || inventory.length > 10 * 1024 * 1024) fail('generated security inventory exceeds 10 MiB')
    JSON.parse(inventory.toString('utf8'))
    temporary = path.join(path.dirname(inventoryPath), `.fresh-install-security-inventory.${invocation}.tmp`)
    filesystem.writeFileSync(temporary, inventory, { flag: 'wx', mode: filesystem.statSync(inventoryPath).mode & 0o777 })
    filesystem.renameSync(temporary, inventoryPath)
    temporary = undefined
    console.log('PostgreSQL 18 fresh-install inventory and verification passed in the isolated container.')
  } finally {
    for (const name of [container, installer, holder]) spawn(docker, ['rm', '--force', name], { stdio: 'ignore' })
    for (const volume of volumes) spawn(docker, ['volume', 'rm', '--force', volume], { stdio: 'ignore' })
    if (supportRoot) filesystem.rmSync(supportRoot, { recursive: true, force: true })
    if (temporary) filesystem.rmSync(temporary, { force: true })
  }
}

module.exports = { chownTree, containerRunner, main }
if (require.main === module) {
  try {
    if (process.argv[2] === '--container-runner') containerRunner()
    else main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.exitCode ?? 1
  }
}
