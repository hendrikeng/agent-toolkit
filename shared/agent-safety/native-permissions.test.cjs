const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const http = require('node:http')
const { parse } = require('smol-toml')
const policy = require('./development-policy.cjs')
const { configureCodex, configureClaude } = require('./configure.cjs')

function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-permissions-')))
  const root = path.join(home, 'Code/project')
  for (const relative of ['Code/project', 'Code/sibling', 'orca/workspaces', '.codex', '.ssh']) fs.mkdirSync(path.join(home, relative), { recursive: true })
  const session = policy.sessionDirectory(home)
  return { home, root, session }
}

test('workspace resolution rejects broad roots and symlink escapes, and selects the repository from a subdirectory', () => {
  const f = fixture()
  assert.equal(policy.workspace(f.root, f.home), f.root)
  assert.throws(() => policy.workspace(path.join(f.home, 'Code'), f.home), /Start in/)
  assert.throws(() => policy.workspace(f.home, f.home), /Start in/)
  fs.symlinkSync(f.home, path.join(f.home, 'Code/escape'))
  assert.throws(() => policy.workspace(path.join(f.home, 'Code/escape'), f.home), /Start in/)
  const result = spawnSync('/usr/bin/git', ['init', '-q'], { cwd: f.root })
  assert.equal(result.status, 0)
  fs.mkdirSync(path.join(f.root, 'src'))
  assert.equal(policy.workspace(path.join(f.root, 'src'), f.home), f.root)
})

test('installation removes old restrictions while preserving unrelated settings and modern TOML', () => {
  const codex = parse(configureCodex('sandbox_mode="workspace-write"\napproval_policy="untrusted"\nmodel="example"\nnote="""multiline\nvalue"""\n[sandbox_workspace_write]\nwritable_roots=["/broad"]\n[permissions.custom]\nextends=":read-only"\n'))
  assert.equal(codex.sandbox_mode, undefined)
  assert.equal(codex.sandbox_workspace_write, undefined)
  assert.equal(codex.default_permissions, ':workspace')
  assert.equal(parse(configureCodex('sandbox_mode="read-only"\n')).default_permissions, ':read-only')
  assert.equal(codex.approval_policy, 'on-request')
  assert.equal(codex.model, 'example')
  assert.equal(codex.permissions.custom.extends, ':read-only')
  const claude = JSON.parse(configureClaude(JSON.stringify({ permissions: { deny: ['Bash(rm *)', 'Read(./private/**)'], additionalDirectories: ['/fixture/Code', '/custom'] }, sandbox: { filesystem: { allowWrite: ['/fixture/orca/workspaces', '/custom'] } }, enabledPlugins: { example: true } }), '/fixture'))
  assert.deepEqual(claude.permissions.deny, ['Read(./private/**)'])
  assert.deepEqual(claude.permissions.additionalDirectories, ['/custom'])
  assert.deepEqual(claude.sandbox.filesystem.allowWrite, ['/custom'])
  assert.equal(claude.enabledPlugins.example, true)
  assert.deepEqual(JSON.parse(configureClaude('{// comment\n"permissions":{"deny":["Read(./private/**)",],},}')).permissions.deny, ['Read(./private/**)'])
  assert.throws(() => configureClaude('{"permissions":'), /Invalid Claude settings/)
})

test('managed sessions refuse configuration that would silently select the retired sandbox', () => {
  const f = fixture()
  const config = path.join(f.home, '.codex/config.toml')
  fs.writeFileSync(config, '"sandbox_mode"="workspace-write"\n')
  assert.throws(() => policy.assertModernCodex(f.root, f.home, path.join(f.home, '.codex')), /Retired sandbox settings/)
  fs.writeFileSync(config, configureCodex(fs.readFileSync(config, 'utf8')))
  policy.assertModernCodex(f.root, f.home, path.join(f.home, '.codex'))
  fs.mkdirSync(path.join(f.root, '.codex'))
  fs.writeFileSync(path.join(f.root, '.codex/config.toml'), '[sandbox_workspace_write]\nwritable_roots=["/other"]\n')
  assert.throws(() => policy.assertModernCodex(f.root, f.home, path.join(f.home, '.codex')), /Retired sandbox settings/)
})

test('only model overrides can reach the native Codex launcher', () => {
  policy.validateCodex(['--model', 'example', '-c', 'model_reasoning_effort="high"'])
  for (const args of [['--sandbox', 'danger-full-access'], ['-sdanger-full-access'], ['--add-dir=/other'], ['--remote', 'unix://other'], ['--config', 'approval_policy="never"'], ['-cpermissions.other={}'], ['--disable', 'network_proxy'], ['-C', '/other'], ['--profile', 'other'], ['--yolo'], ['--ignore-rules']]) assert.throws(() => policy.validateCodex(args), /overrides|Only model/)
})

test('Pi policy permits ordinary shell syntax but confines file tools and protects its own runtime', () => {
  const f = fixture()
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'pi-permission-system.json'), 'utf8'))
  const scoped = policy.piPolicy(base, f.root, f.session, f.home)
  assert.equal(scoped.permission.bash['*'], 'allow')
  for (const pattern of ['git push*', 'git reset --hard*', 'git clean *', 'git branch -D *']) assert.equal(scoped.permission.bash[pattern], 'ask')
  assert.equal(scoped.permission.external_directory['*'], 'deny')
  assert.equal(scoped.permission.external_directory[path.join(f.home, 'Code')], undefined)
  assert.equal(scoped.permission.external_directory[f.root], 'allow')
  assert.equal(scoped.permission.path[path.join(f.session, 'pi/extensions/*')], 'deny')
  assert.equal(scoped.permission.path[path.join(f.home, '.ssh')], 'deny')
  assert.equal(fs.statSync(f.session).mode & 0o777, 0o700)
})

test('the real native sandbox allows development, but denies sibling writes, secret reads, and symlink escapes', { skip: !['darwin', 'linux'].includes(process.platform) }, () => {
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  assert.equal(version.status, 0, 'Codex CLI 0.160+ is required for this boundary test')
  const f = fixture()
  assert.equal(spawnSync('/usr/bin/git', ['init', '-q'], { cwd: f.root }).status, 0)
  fs.writeFileSync(path.join(f.home, '.gitconfig'), '[user]\nname=Fixture\nemail=fixture@example.invalid\n[http]\nextraHeader=fixture-secret-header\n')
  const gitConfig = policy.gitConfiguration(f.session, f.home)
  assert.doesNotMatch(fs.readFileSync(gitConfig, 'utf8'), /fixture-secret-header/)
  fs.writeFileSync(path.join(f.home, '.ssh/key'), 'fixture credential')
  fs.writeFileSync(path.join(f.home, 'Code/sibling/keep'), 'keep')
  for (const name of ['.env', '.env.custom', '.env.e', '.env.example.local', 'private.pem', 'private.key', '.npmrc', '.pypirc', '.netrc', '.git-credentials']) fs.writeFileSync(path.join(f.root, name), 'fixture secret')
  fs.writeFileSync(path.join(f.root, '.env.example'), 'example')
  fs.symlinkSync(path.join(f.home, '.ssh/key'), path.join(f.root, 'escape'))
  const extension = path.join(f.root, 'installed-extension.js')
  fs.writeFileSync(extension, 'fixture installed code')
  fs.mkdirSync(path.join(f.home, '.pi/agent/extensions'), { recursive: true })
  fs.symlinkSync(extension, path.join(f.home, '.pi/agent/extensions/fixture'))
  fs.mkdirSync(path.join(f.session, 'pi/extensions'), { recursive: true })
  fs.writeFileSync(path.join(f.session, 'pi/settings.json'), '{}')
  const child = path.join(f.root, 'boundary.cjs')
  fs.writeFileSync(child, `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const deny = operation => assert.throws(operation, error => ['EPERM', 'EACCES'].includes(error.code));
fs.writeFileSync('generated', 'ok');
fs.rmSync('generated');
fs.writeFileSync('development.txt', 'fixture development');
for (const args of [['add', 'development.txt'], ['commit', '-qm', 'fixture']]) { const result = spawnSync('/usr/bin/git', args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
assert.equal(fs.readFileSync('.env.example', 'utf8'), 'example');
for (const name of ['.env', '.env.custom', '.env.e', '.env.example.local', 'private.pem', 'private.key', '.npmrc', '.pypirc', '.netrc', '.git-credentials']) deny(() => fs.readFileSync(name));
deny(() => fs.readFileSync(${JSON.stringify(path.join(f.home, '.ssh/key'))}));
deny(() => fs.readFileSync('escape'));
deny(() => fs.writeFileSync('installed-extension.js', 'bad'));
deny(() => fs.writeFileSync(${JSON.stringify(path.join(f.session, 'pi/extensions/escape.ts'))}, 'bad'));
deny(() => fs.writeFileSync(${JSON.stringify(path.join(f.session, 'pi/settings.json'))}, 'bad'));
deny(() => fs.renameSync(${JSON.stringify(path.join(f.session, 'pi'))}, ${JSON.stringify(path.join(f.session, 'pi-moved'))}));
const temporary = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'build-'));
fs.writeFileSync(require('node:path').join(temporary, 'output'), 'ok');
fs.rmSync(temporary, { recursive: true });
deny(() => fs.writeFileSync(${JSON.stringify(path.join(f.home, 'Code/sibling/keep'))}, 'bad'));
const nested = spawnSync(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "bad")', ${JSON.stringify(path.join(f.home, 'Code/sibling/keep'))}], { encoding: 'utf8' });
assert.notEqual(nested.status, 0);
assert.match(nested.stderr, /EPERM|EACCES/);
console.log('native boundary passed');
`)
  const env = { ...process.env, HOME: f.home, CODEX_HOME: path.join(f.home, '.codex'), TMPDIR: path.join(f.session, 'tmp'), xcrun_nocache: '1' }
  for (const name of Object.keys(env)) if (/^(GIT_|AGENT_TOOLKIT_CODEX)/.test(name)) delete env[name]
  Object.assign(env, { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' })
  const result = spawnSync('codex', ['sandbox', '-P', policy.PROFILE, '-C', f.root, ...policy.codexArgs(f.root, f.session, f.home), '--sandbox-state-disable-network', '--', process.execPath, child], { cwd: f.root, env, encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /native boundary passed/)
  assert.equal(fs.readFileSync(path.join(f.home, 'Code/sibling/keep'), 'utf8'), 'keep')
  fs.writeFileSync(path.join(f.session, 'native-profile.json'), JSON.stringify(policy.profile(f.root, f.session, f.home)))
  const sibling = path.join(f.home, 'Code/sibling')
  assert.equal(spawnSync('/usr/bin/git', ['init', '-q'], { cwd: sibling }).status, 0)
  fs.renameSync(path.join(f.root, '.git'), path.join(f.root, '.git-original'))
  fs.writeFileSync(path.join(f.root, '.git'), `gitdir: ${sibling}/.git\n`)
  const escalation = path.join(f.root, 'metadata.cjs')
  fs.writeFileSync(escalation, `const assert = require('node:assert/strict'); const fs = require('node:fs'); assert.throws(() => fs.writeFileSync(${JSON.stringify(path.join(sibling, '.git/HEAD'))}, 'bad'), error => ['EPERM','EACCES'].includes(error.code)); assert.throws(() => fs.unlinkSync(${JSON.stringify(path.join(f.session, 'native-profile.json'))}), error => ['EPERM','EACCES'].includes(error.code));`)
  const oldWorkspace = process.env.AGENT_TOOLKIT_WORKSPACE
  process.env.AGENT_TOOLKIT_WORKSPACE = f.root
  try {
    const command = policy.sandboxCommand(`${JSON.stringify(process.execPath)} ${JSON.stringify(escalation)}`, f.root, f.session, f.home)
    const pinned = spawnSync('/bin/bash', ['-c', command], { cwd: f.root, env, encoding: 'utf8', timeout: 30000 })
    assert.equal(pinned.status, 0, pinned.stderr || pinned.stdout)
  } finally {
    if (oldWorkspace === undefined) delete process.env.AGENT_TOOLKIT_WORKSPACE
    else process.env.AGENT_TOOLKIT_WORKSPACE = oldWorkspace
  }
  console.log(`Retained native boundary fixture: ${f.home}`)
})

test('the native network proxy admits the owned development server and blocks an unlisted host', { skip: !['darwin', 'linux'].includes(process.platform) }, async () => {
  const f = fixture()
  let requests = 0
  const server = http.createServer((request, response) => { requests++; response.end('fixture response') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const child = path.join(f.root, 'network.cjs')
    fs.writeFileSync(child, `
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
assert.ok(process.env.HTTP_PROXY || process.env.http_proxy);
const request = host => new Promise((resolve, reject) => {
  http.get('http://' + host + ':${port}/', response => {
    let body = ''; response.on('data', data => body += data); response.on('end', () => resolve({ status: response.statusCode, body }));
  }).on('error', reject);
});
(async () => {
  assert.deepEqual(await request('127.0.0.1'), { status: 200, body: 'fixture response' });
  await new Promise((resolve, reject) => {
    const bound = net.createServer(); bound.on('error', reject); bound.listen(0, '127.0.0.1', () => bound.close(resolve));
  });
  await new Promise((resolve, reject) => {
    const socket = net.connect(${port}, '127.0.0.1', () => socket.end('GET / HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n'));
    let body = ''; socket.on('data', data => body += data); socket.on('error', reject); socket.on('end', () => { try { assert.match(body, /fixture response/); resolve(); } catch (error) { reject(error); } });
  });
  const denied = await request('not-allowed.invalid');
  assert.equal(denied.status, 403, JSON.stringify(denied));
  console.log('native network boundary passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
`)
    const env = { ...process.env, HOME: f.home, CODEX_HOME: path.join(f.home, '.codex'), TMPDIR: path.join(f.session, 'tmp') }
    const result = await promisify(execFile)('codex', ['sandbox', '-P', policy.PROFILE, '-C', f.root, ...policy.codexArgs(f.root, f.session, f.home), '--', process.execPath, child], { cwd: f.root, env, timeout: 15000 })
    assert.match(result.stdout, /native network boundary passed/)
    assert.equal(requests, 2)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
