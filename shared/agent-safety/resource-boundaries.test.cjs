const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { prepareResources, verifyResource, operateResource, validateResources } = require('./local-resources.cjs')
const declaration = { id: 'scan', type: 'scanner', image: `clamav/clamav:1.4@sha256:${'b'.repeat(64)}`, purpose: 'synthetic scan', memoryMiB: 64, storageMiB: 64, lifetimeSeconds: 600, targets: ['targets'], database: 'signatures' }
test('scanner scope verifies mounts, memory, expiry and shutdown without exposing host data', t => {
 const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'scanner-boundaries-')), home = path.join(root, 'home'), workspace = path.join(home, 'Code/project')
 for (const local of ['targets', 'signatures']) fs.mkdirSync(path.join(workspace, local), { recursive: true })
 fs.mkdirSync(path.join(home, 'orca/workspaces'), { recursive: true }); process.env.HOME = home
 const state = {}, id = 'c'.repeat(64)
 let item, calls = []
 const runtime = {
  engine: () => 'engine', list: () => item ? [id] : [], inspect: () => item,
  create(args) {
   const value = key => args[args.indexOf(key) + 1]
   const labels = Object.fromEntries(args.flatMap((word, index) => word === '--label' ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : []))
   item = { Id: id, Config: { Labels: labels, Image: declaration.image, Entrypoint: [value('--entrypoint')], Cmd: args.slice(args.indexOf(declaration.image) + 1) }, HostConfig: { Privileged: false, ReadonlyRootfs: true, Memory: 67108864, MemorySwap: 67108864, LogConfig: { Type: 'none' }, PidsLimit: 128, IpcMode: 'private', ShmSize: 16 * 1024 * 1024, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], NetworkMode: 'none', Tmpfs: { '/tmp': 'rw,size=16m', '/var/lib/clamav': 'rw,size=32m' } }, Mounts: [{ Type: 'bind', Source: path.join(workspace, 'signatures'), Destination: '/database', RW: false }, { Type: 'bind', Source: path.join(workspace, 'targets'), Destination: '/scan/0', RW: false }], NetworkSettings: { Ports: {} }, State: { Running: false } }
   return id
  },
  start() { calls.push('start'); item.State.Running = true }, stop() { calls.push('stop'); item.State.Running = false }, exec(_id, args) { calls.push(args); return args.includes('--version') ? 'ClamAV 1.4.2' : 'clean' },
 }
 const prepare = () => prepareResources('scope', [declaration], state, () => {}, workspace, path.join(root, 'evidence'), runtime)
 prepare()
 assert.equal(item.Config.Cmd[3], String(Math.floor(state.scan.createdAt / 1000) + 600))
 assert.deepEqual(item.Config.Cmd.slice(4), ['/bin/sleep', 'infinity'])
 assert.equal(operateResource(state.scan, 'scan', runtime), 'clean')
 assert.ok(calls.at(-1).includes('--follow-file-symlinks=0'))
 item.Mounts[0].Source = '/outside'
 assert.throws(() => verifyResource(state.scan, runtime))
 item.Mounts[0].Source = path.join(workspace, 'signatures')
 item.HostConfig.Tmpfs['/tmp'] = 'rw,size=4096m'
 assert.throws(() => verifyResource(state.scan, runtime))
 item.HostConfig.Tmpfs['/tmp'] = 'rw,size=16m'
 t.mock.method(Date, 'now', () => state.scan.createdAt + 601000); item.State.Running = false
 const before = calls.length
 assert.throws(prepare, /lifetime/)
 assert.equal(calls.length, before, 'expired resource never restarts')
 assert.throws(() => operateResource(state.scan, 'scan', runtime), /lifetime/)
 operateResource(state.scan, 'stop', runtime)
 assert.equal(calls.at(-1), 'stop'); assert.equal(runtime.list().length, 1)
 for (const target of ['../outside', 'dir,src=/outside', 'secret.pem', 'auth.json']) assert.throws(() => validateResources([{ ...declaration, targets: [target] }]))
 console.log(`Retained scanner fixture: ${root}`)
})
