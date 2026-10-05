#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PROFILE = 'agent_toolkit'
const DOMAINS = ['localhost', '127.0.0.1', 'registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org', 'github.com', '*.github.com', '*.githubusercontent.com', 'nodejs.org', 'crates.io', '*.crates.io', 'static.rust-lang.org', 'proxy.golang.org', 'sum.golang.org', 'dl.google.com', '*.playwright.dev', '*.playwright.microsoft.com', 'storage.googleapis.com']
const SECRET_PATHS = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.config/gcloud', '.docker/config.json', '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'Library/Keychains', '.claude/.credentials.json', '.codex/auth.json', '.codex-accounts', '.pi/agent/auth.json', '.pi/agent/auth-profiles']
const TOOL_PATHS = ['.local/bin', '.local/libexec/agent-toolkit', '.local/share/fnm', '.local/share/uv/python', '.nvm/versions', '.rustup/toolchains', '.cargo/bin', '.local/share/pnpm', '.agents/skills', '.claude/skills', '.codex/skills', '.pi/agent/skills', '.pi/agent/extensions', '.config/git/ignore', '.config/git/attributes']
// Native deny globs override exact grants. Exclude only the public .env.example name.
const ENV_DENIES = ['**/.env', '**/.env.', ...Array.from('example').flatMap((letter, index) => [...(index ? [`**/.env.${'example'.slice(0, index)}`] : []), `**/.env.${'example'.slice(0, index)}[!${letter}]*`]), '**/.env.example?*']
const SECRET_FILE_DENIES = [...ENV_DENIES, '**/*.pem', '**/*.key', '**/*.credentials.json', ...['.npmrc', '.pypirc', '.netrc', '.git-credentials'].map(name => `**/${name}`)]
const SYSTEM_PATHS = ['/System/Library', '/Library/Developer', '/usr', '/bin', '/sbin', '/opt/homebrew', '/private/etc/ssl', '/private/etc/resolv.conf', '/etc/ssl', '/etc/resolv.conf']
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const toml = value => Array.isArray(value) ? `[${value.map(toml).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}` : JSON.stringify(value)
const within = (root, target) => target === root || target.startsWith(root + path.sep)
function canonical(value) {
  let target = path.resolve(value)
  const suffix = []
  while (!fs.existsSync(target)) { suffix.unshift(path.basename(target)); const parent = path.dirname(target); if (parent === target) throw Error('Cannot resolve path'); target = parent }
  return path.join(fs.realpathSync(target), ...suffix)
}
function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' })
  return spawnSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env, encoding: 'utf8', timeout: 5000 })
}
function workspace(cwd = process.cwd(), home = os.homedir()) {
  const selected = canonical(cwd)
  const result = git(selected, 'rev-parse', '--show-toplevel')
  const root = result.status === 0 ? canonical(result.stdout.trim()) : selected
  if (/[*?\[\]{}]/.test(root + home)) throw Error('Workspace and home paths cannot contain permission glob characters')
  if (![path.join(home, 'Code'), path.join(home, 'orca/workspaces')].some(base => fs.existsSync(base) && root !== canonical(base) && within(canonical(base), root))) throw Error('Start in a repository or folder under ~/Code or ~/orca/workspaces, not in a development root itself')
  return root
}
function readRoots(home = os.homedir()) {
  const roots = [...TOOL_PATHS.map(value => path.join(home, value)), process.execPath]
  for (const relative of ['.agents/skills', '.claude/skills', '.codex/skills', '.pi/agent/skills', '.pi/agent/extensions']) {
    const directory = path.join(home, relative)
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
      const entry = path.join(directory, name)
      if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) roots.push(entry)
    }
  }
  return [...new Set(roots.filter(value => fs.existsSync(value)).map(canonical))]
}
function secretPaths(home) {
  return [...new Set([...SECRET_PATHS.map(value => canonical(path.join(home, value))), ...[process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR, process.env.AGENT_TOOLKIT_CODEX_PROFILE_HOME].filter(Boolean).map(canonical)])]
}
function orchestrationHost(env = process.env) {
  const selected = env.AGENT_TOOLKIT_ORCHESTRATION_HOST
  if (selected !== undefined) {
    if (!['orca', 'paseo', 'none'].includes(selected)) throw Error('AGENT_TOOLKIT_ORCHESTRATION_HOST must be orca, paseo, or none')
    return selected
  }
  const paseo = Boolean(env.PASEO_AGENT_ID)
  const orca = Boolean(env.ORCA_WORKSPACE_ID || env.ORCA_WORKTREE_ID || env.ORCA_TERMINAL_HANDLE)
  if (paseo && orca) throw Error('Both Orca and Paseo launch contexts are present; set AGENT_TOOLKIT_ORCHESTRATION_HOST explicitly before launch')
  return paseo ? 'paseo' : orca ? 'orca' : 'none'
}
function sessionDirectory(home = os.homedir()) {
  const root = path.join(home, 'Code/.agent-toolkit-scratch')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  if (canonical(root) !== path.resolve(root)) throw Error('Scratch root must not contain symlinks')
  const session = fs.mkdtempSync(path.join(root, 'development-'))
  fs.chmodSync(session, 0o700)
  for (const name of ['tmp', 'cache', 'reviews']) fs.mkdirSync(path.join(session, name), { mode: 0o700 })
  fs.writeFileSync(path.join(session, 'reviews/.read-probe.txt'), 'Pi review results read access is available.\n', { mode: 0o600 })
  return session
}
function gitConfiguration(session, home = os.homedir()) {
  const target = path.join(session, 'gitconfig')
  fs.writeFileSync(target, '', { mode: 0o600, flag: 'wx' })
  // ponytail: copy only public identity and initial branch settings; extend if other settings are required.
  for (const key of ['user.name', 'user.email', 'init.defaultBranch']) {
    let value = git(session, 'config', '--file', path.join(home, '.gitconfig'), '--get', key)
    if (value.status !== 0) value = git(session, 'config', '--file', path.join(home, '.config/git/config'), '--get', key)
    if (value.status !== 0) continue
    const written = git(session, 'config', '--file', target, key, value.stdout.trim())
    if (written.status !== 0) throw Error('Cannot prepare the private Git configuration')
  }
  return target
}
function gitMetadata(root, home) {
  const directories = []
  for (const args of [['rev-parse', '--absolute-git-dir'], ['rev-parse', '--path-format=absolute', '--git-common-dir']]) {
    const result = git(root, ...args)
    if (result.status !== 0) continue
    const metadata = canonical(result.stdout.trim())
    if (/[*?\[\]{}]/.test(metadata)) throw Error('Git metadata paths cannot contain permission glob characters')
    if (![path.join(home, 'Code'), path.join(home, 'orca/workspaces')].some(base => within(canonical(base), metadata))) throw Error('Git metadata is outside the development roots')
    directories.push(metadata)
  }
  return [...new Set(directories)]
}
function profile(root, session, home = os.homedir()) {
  root = workspace(root, home)
  session = canonical(session)
  if (!within(canonical(path.join(home, 'Code/.agent-toolkit-scratch')), session) || path.basename(session) === '.agent-toolkit-scratch') throw Error('Invalid private session directory')
  const filesystem = { glob_scan_max_depth: 64, ':root': 'deny', ':minimal': 'read', ':tmpdir': 'write', ':slash_tmp': 'deny', ':workspace_roots': { '.': 'write', '.git': 'write', '.git/config': 'read', '.git/hooks': 'read', '.codex': 'read', '.claude': 'read', '.pi': 'read', ...Object.fromEntries(SECRET_FILE_DENIES.map(pattern => [pattern, 'deny'])) }, [root]: 'write', [session]: 'write' }
  for (const value of [...SYSTEM_PATHS, ...readRoots(home)]) if (fs.existsSync(value)) filesystem[canonical(value)] = 'read'
  for (const value of secretPaths(home)) {
    if (within(value, root)) throw Error('Credential storage must remain separate from the workspace')
    filesystem[value] = 'deny'
  }
  filesystem[path.join(session, 'pi')] = 'read'
  filesystem[path.join(session, 'pi/auth.json')] = 'deny'
  filesystem[path.join(session, 'pi/codex-runtimes')] = 'deny'
  filesystem[path.join(session, 'claude.json')] = 'deny'
  filesystem[path.join(session, 'native-profile.json')] = 'read'
  filesystem[path.join(session, 'gitconfig')] = 'read'
  filesystem[path.join(session, 'AGENTS.md')] = 'read'
  filesystem['/Library/Keychains'] = 'deny'
  // Linked worktrees share Git metadata, not write access to the other checkout.
  for (const metadata of gitMetadata(root, home)) {
    filesystem[metadata] = 'write'
    filesystem[path.join(metadata, 'config')] = 'read'
    filesystem[path.join(metadata, 'hooks')] = 'read'
  }
  return { extends: ':workspace', filesystem, network: { enabled: true, allow_local_binding: true, domains: Object.fromEntries(DOMAINS.map(domain => [domain, 'allow'])) } }
}
function codexArgs(root, session, home = os.homedir(), selected = profile(root, session, home)) {
  return ['-c', `default_permissions=${toml(PROFILE)}`, '-c', `permissions.${PROFILE}=${toml(selected)}`, '-c', 'features.network_proxy=true', '-c', 'shell_environment_policy.exclude=["*TOKEN*","*PASSWORD*","*SECRET*","*API_KEY*","*CREDENTIAL*","DATABASE_URL","PGHOST","PGPORT","PGUSER","PGDATABASE","SSH_AUTH_SOCK","DOCKER_HOST","DOCKER_CONTEXT"]']
}
function sandboxCommand(command, cwd, session = process.env.AGENT_TOOLKIT_SESSION_DIR, home = os.homedir()) {
  if (!session) throw Error('Start Pi through pi-yolo to enable its OS sandbox')
  const root = process.env.AGENT_TOOLKIT_WORKSPACE || workspace(cwd, home)
  if (!within(canonical(root), canonical(cwd))) throw Error('Command working directory is outside the assigned workspace')
  const selected = JSON.parse(fs.readFileSync(path.join(session, 'native-profile.json'), 'utf8'))
  return ['exec', 'codex', 'sandbox', '-P', PROFILE, '-C', cwd, ...codexArgs(root, session, home, selected), '--', '/bin/bash', '-c', command].map(quote).join(' ')
}
function removeEmptyWorkspaceDirectory(command, cwd, root, home = os.homedir()) {
  const match = /^(?:\/bin\/)?rmdir (['"]?)(?:\.\/)?([A-Za-z0-9_.][A-Za-z0-9._-]*)\1$/.exec(command.trim())
  if (!match || canonical(cwd) !== canonical(root)) return false
  const name = match[2]
  const target = path.join(canonical(root), name)
  // Case variants can identify the same protected directory on macOS.
  const identifier = name.toLowerCase()
  const resource = target.toLowerCase()
  if (['.', '..', '.git', '.pi', '.claude', '.codex'].includes(identifier) || SECRET_FILE_DENIES.some(pattern => path.matchesGlob(identifier, pattern) || (pattern.startsWith('**/*.') && identifier.endsWith(pattern.slice(4)))) || readRoots(home).some(value => within(resource, value.toLowerCase()) || within(value.toLowerCase(), resource))) throw Error('Cannot remove a protected workspace directory')
  // ponytail: direct children only, so no mutable parent symlinks; nested cleanup waits for a native sandbox fix.
  // rmdir is atomic: nonempty directories and final-component symlinks cannot be removed.
  fs.rmdirSync(target)
  return true
}
function claudeSettings(root, session, home = os.homedir(), env = process.env) {
  root = workspace(root, home)
  const denyRead = secretPaths(home)
  if (denyRead.some(value => within(value, root))) throw Error('Credential storage must remain separate from the workspace')
  const readOnly = readRoots(home)
  const metadata = gitMetadata(root, home)
  const protectedWrites = [...readOnly, path.join(session, 'claude.json'), path.join(session, 'gitconfig'), path.join(session, 'AGENTS.md'), ...metadata.flatMap(value => [path.join(value, 'config'), path.join(value, 'hooks')]), ...['.claude', '.codex', '.pi'].map(value => path.join(root, value))]
  const absolute = value => '/' + value
  return {
    env: { CLAUDE_CODE_TMPDIR: path.join(session, 'tmp'), CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', SSL_CERT_FILE: '/etc/ssl/cert.pem' },
    sandbox: {
      enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
      excludedCommands: ['autoreview-yolo', 'pg18-fresh-yolo', 'pg-test start', 'pg-test start --postgres-version 17', 'pg-test start --postgres-version 18', 'pg-test start-migration', 'pg-test start-migration --postgres-version 17', 'pg-test start-migration --postgres-version 18', 'pg-test start-admin', 'pg-test start-admin --postgres-version 17', 'pg-test start-admin --postgres-version 18', 'pg-test status *', 'pg-test stop *', 'pg-test gc'].map(value => path.join(home, '.local/bin', value)),
      filesystem: { allowWrite: [root, session, ...metadata], denyRead: [home, ...denyRead, path.join(session, 'claude.json'), ...SECRET_FILE_DENIES.map(pattern => `${root}/${pattern}`)], allowRead: [root, session, ...readOnly, ...metadata], denyWrite: protectedWrites },
      network: { allowedDomains: DOMAINS, allowLocalBinding: true, allowAllUnixSockets: false },
      credentials: { envVars: [...new Set([...Object.keys(env).filter(name => /(?:TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL)/i.test(name) || /^(?:AWS_|GOOGLE_|AZURE_)/.test(name)), 'GITHUB_TOKEN', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'SSH_AUTH_SOCK', 'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'DOCKER_HOST', 'DOCKER_CONTEXT'])].map(name => ({ name, mode: 'deny' })) },
    },
    permissions: { additionalDirectories: [root, session, ...readOnly, ...metadata], allow: ['autoreview-yolo', 'pg18-fresh-yolo', 'pg-test *'].map(value => `Bash(${path.join(home, '.local/bin', value)})`), ask: ['Bash(git push *)', 'Bash(git reset --hard *)', 'Bash(git clean -f*)', 'Bash(git branch -D *)'], deny: ['Bash(dangerouslyDisableSandbox:true)', `Read(${absolute(session)}/claude.json)`, ...denyRead.flatMap(value => [`Read(${absolute(value)})`, `Read(${absolute(value)}/**)`]), ...protectedWrites.flatMap(value => [`Edit(${absolute(value)})`, `Write(${absolute(value)})`, `Edit(${absolute(value)}/**)`, `Write(${absolute(value)}/**)`]), ...SECRET_FILE_DENIES.map(pattern => `Read(${absolute(root)}/${pattern})`)] },
  }
}
function piPolicy(base, root, session, home = os.homedir()) {
  root = workspace(root, home)
  base.permission.external_directory = { '*': 'deny', [root]: 'allow', [`${root}/*`]: 'allow', [session]: 'allow', [`${session}/*`]: 'allow' }
  if (process.platform === 'darwin' && orchestrationHost() === 'orca') {
    // TMPDIR points to private session scratch, not Orca's clipboard directory.
    const result = spawnSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8', timeout: 5000 })
    const temporary = result.stdout?.trim()
    if (result.status !== 0 || !temporary || !path.isAbsolute(temporary) || /[*?\[\]{}]/.test(temporary)) throw Error('Cannot resolve the Orca clipboard directory')
    // Ask for a specific image read; never grant the temporary directory or writes.
    base.permission.external_directory_read = { ...base.permission.external_directory, [path.join(canonical(temporary), 'orca-paste-*.png')]: 'ask' }
  }
  base.piInfrastructureReadPaths = readRoots(home)
  base.permission.path_write = { ...base.permission.path_write, [path.join(session, 'gitconfig')]: 'deny', [path.join(session, 'AGENTS.md')]: 'deny', ...Object.fromEntries(readRoots(home).flatMap(target => [[target, 'deny'], [`${target}/*`, 'deny']])) }
  for (const target of [path.join(session, 'native-profile.json'), path.join(session, 'pi/extensions'), path.join(session, 'pi/settings.json'), path.join(session, 'pi/codex-runtimes'), path.join(home, '.pi/agent/extensions'), path.join(home, '.pi/agent/settings.json')]) {
    base.permission.path[target] = 'deny'
    base.permission.path[`${target}/*`] = 'deny'
  }
  for (const target of secretPaths(home)) { base.permission.path[target] = 'deny'; base.permission.path[`${target}/*`] = 'deny' }
  base.permission.path[path.join(session, 'pi/auth.json')] = 'deny'
  return base
}
function codexRules(home = os.homedir()) {
  const rules = []
  // Allow rules authorize commands; they do not bypass this profile's denied-read sandbox.
  for (const name of ['pg-test', 'autoreview-yolo', 'pg18-fresh-yolo']) rules.push(`prefix_rule(pattern = ${JSON.stringify([path.join(home, '.local/bin', name)])}, decision = "allow", justification = "Reviewed bounded Toolkit helper")`)
  for (const args of [['push'], ['reset', '--hard'], ['clean', '-f'], ['branch', '-D']]) rules.push(`prefix_rule(pattern = ${JSON.stringify(['git', ...args])}, decision = "prompt", justification = "Publication or loss of work requires explicit authorization")`)
  return rules.join('\n') + '\n'
}
function assertModernCodex(root, home, configHome = process.env.CODEX_HOME || path.join(home, '.codex')) {
  const files = new Set([path.join(configHome, 'config.toml'), path.join(root, '.codex/config.toml')])
  for (let directory = root; within(home, directory); directory = path.dirname(directory)) {
    files.add(path.join(directory, '.codex/config.toml'))
    if (directory === home) break
  }
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    let settings
    try { settings = require('smol-toml').parse(fs.readFileSync(file, 'utf8')) }
    catch { throw Error(`Cannot validate Codex settings: ${file}`) }
    if (Object.hasOwn(settings, 'sandbox_mode') || Object.hasOwn(settings, 'sandbox_workspace_write')) throw Error(`Retired sandbox settings in ${file}; migrate them before starting a managed session`)
  }
}
function requireEngine(host) {
  const result = spawnSync(host, ['--version'], { encoding: 'utf8', timeout: 5000 })
  const version = result.stdout?.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
  const minimum = host === 'codex' ? [0, 160, 0] : [2, 1, 289]
  if (result.status !== 0 || !version || version[0] * 1000000 + version[1] * 1000 + version[2] < minimum[0] * 1000000 + minimum[1] * 1000 + minimum[2]) throw Error(`${host} ${minimum.join('.')} or later is required`)
}
function validateCodex(args) {
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--') break
    if (/^(?:--(?:sandbox|add-dir|cd|profile|remote|approve-for-me|dangerously-bypass-approvals-and-sandbox|dangerously-bypass-hook-trust|ask-for-approval|worktree|enable|disable|yolo|full-auto|ignore-rules|ignore-user-config)(?:=|$)|-[sapCP](?:$|[^-]))/.test(argument) || ['sandbox', 'exec-server', 'login', 'logout', 'mcp', 'plugin', 'update', 'cloud', 'remote-control', 'app', 'debug', 'apply'].includes(argument)) throw Error('Managed sessions do not accept permission, workspace, remote, or feature overrides')
    if (argument === '-c' || argument === '--config' || argument.startsWith('--config=') || argument.startsWith('-c') && argument.length > 2) {
      const value = argument === '-c' || argument === '--config' ? args[++index] : argument.replace(/^(?:--config=|-c)/, '')
      if (!/^(?:model|model_reasoning_effort|model_reasoning_summary|service_tier)=/.test(value || '')) throw Error('Only model and service-tier configuration overrides are accepted')
    }
  }
}
module.exports = { PROFILE, DOMAINS, workspace, sessionDirectory, profile, codexArgs, sandboxCommand, claudeSettings, piPolicy, toml, canonical, within, validateCodex, codexRules, readRoots, assertModernCodex, gitConfiguration, removeEmptyWorkspaceDirectory }
if (require.main === module) {
  const [action, ...args] = process.argv.slice(2)
  try {
    if (action === 'workspace') console.log(workspace(process.cwd(), args[0] || os.userInfo().homedir))
    else if (action === 'prepare') console.log(sessionDirectory(args[0] || os.userInfo().homedir))
    else if (action === 'git-config') console.log(gitConfiguration(args[0], args[1] || os.userInfo().homedir))
    else if (action === 'codex') console.log(toml(profile(args[0], args[1], args[2] || os.userInfo().homedir)))
    else if (action === 'claude') {
      const settings = args[2] && fs.existsSync(args[2]) ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : {}
      const scoped = claudeSettings(args[0], args[1], args[3] || os.userInfo().homedir, { ...process.env, ...settings.env })
      settings.sandbox = scoped.sandbox
      settings.permissions = { ...settings.permissions, ...scoped.permissions, deny: [...(settings.permissions?.deny || []), ...scoped.permissions.deny] }
      settings.env = { ...settings.env, ...scoped.env }
      settings.disableAllHooks = true
      fs.writeFileSync(path.join(args[1], 'claude.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    }
    else if (action === 'rules') process.stdout.write(codexRules())
    else if (action === 'orchestration-host') console.log(orchestrationHost())
    else if (action === 'session-rules') {
      const owner = { orca: 'Orca', paseo: 'Paseo', none: 'none' }[orchestrationHost()]
      fs.writeFileSync(args[1], `Orchestration host: ${owner}\n\n${fs.readFileSync(args[0], 'utf8')}`, { mode: 0o600, flag: 'wx' })
    }
    else if (action === 'instructions') console.log(JSON.stringify(fs.readFileSync(args[0], 'utf8')))
    else if (action === 'validate-codex') validateCodex(args)
    else if (action === 'check-engine') requireEngine(args[0])
    else if (action === 'check-codex-config') assertModernCodex(args[0], args[1], args[2] || path.join(args[1], '.codex'))
    else if (action === 'check-pi') {
      const { pathToFileURL } = require('node:url')
      const packageFile = require('node:module').findPackageJSON('@earendil-works/pi-coding-agent', pathToFileURL(canonical(args[0])))
      if (!packageFile) throw Error('Cannot locate the installed Pi SDK package')
      const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
      const entry = manifest.exports?.['.']?.import
      if (typeof entry !== 'string') throw Error('Pi SDK lacks a public ESM entry point')
      import(new URL(entry, pathToFileURL(packageFile)).href).then(sdk => {
        if (['createBashToolDefinition', 'createLocalBashOperations'].some(name => typeof sdk[name] !== 'function')) throw Error('Pi SDK lacks the required sandbox APIs')
      }).catch(error => { console.error(error.message); process.exitCode = 1 })
    }
    else if (action === 'pi') {
      const root = process.env.AGENT_TOOLKIT_WORKSPACE
      const session = process.env.AGENT_TOOLKIT_SESSION_DIR
      const home = args[2] || os.userInfo().homedir
      fs.writeFileSync(path.join(session, 'native-profile.json'), JSON.stringify(profile(root, session, home)), { mode: 0o600, flag: 'wx' })
      fs.writeFileSync(args[1], JSON.stringify(piPolicy(JSON.parse(fs.readFileSync(args[0], 'utf8')), root, session, home), null, 2) + '\n', { mode: 0o600 })
    }
    else throw Error('Unknown development policy action')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
