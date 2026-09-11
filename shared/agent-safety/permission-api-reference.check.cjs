// Read-only API check of a human-provided package snapshot, not installed acceptance.
// Node compiles TypeScript; this loader resolves extensions only. It never patches source.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { homedir } = require('node:os')
const { createHash } = require('node:crypto')
const { registerHooks, stripTypeScriptTypes } = require('node:module')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { physicalPath, buildDevelopmentPolicy } = require('./development-policy.cjs')

async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node --experimental-transform-types permission-api-reference.check.cjs <snapshot>')
  const root = fs.realpathSync(process.argv[2])
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(metadata.name, '@gotgenes/pi-permission-system')
  assert.equal(metadata.version, '20.7.3')
  const source = pathToFileURL(path.join(root, 'src/')).href
  const hashes = new Map()
  function read(url) {
    const bytes = fs.readFileSync(fileURLToPath(url))
    hashes.set(url, createHash('sha256').update(bytes).digest('hex'))
    return bytes
  }
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(source) && (specifier.startsWith('#src/') || specifier.startsWith('.'))) {
      const url = specifier.startsWith('#src/') ? new URL(specifier.slice(5), source) : new URL(specifier, context.parentURL)
      for (const suffix of ['', '.ts', '/index.ts']) {
        const candidate = new URL(url.href + suffix)
        if (!candidate.href.startsWith(source)) throw new Error('Snapshot import escaped its source directory')
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          read(candidate.href)
          return { url: candidate.href, shortCircuit: true }
        }
      }
    }
    return next(specifier, context)
  }, load(url, context, next) {
    // Standard TypeScript compilation only: Node refuses automatic stripping
    // beneath node_modules. No permission-source replacements occur here.
    if (url.startsWith(source) && url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(read(url).toString('utf8'), { mode: 'transform' }) }
    return next(url, context)
  } })
  const load = file => { const url = new URL(file, source).href; read(url); return import(url) }
  const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || path.join(homedir(), 'Code/.agent-toolkit-scratch')
  assert.equal(fs.lstatSync(scratch).isSymbolicLink(), false)
  const fixture = fs.mkdtempSync(path.join(scratch, 'permission-api-reference-'))
  try {
    const { canonicalNormalizePathForComparison } = await load('access-intent/path-normalization.ts')
    const { posixPathFlavor } = await load('path/path-flavor.ts')
    const service = await load('service.ts')
    const cwd = path.join(fixture, 'Code/project')
    const outside = path.join(fixture, 'outside')
    fs.mkdirSync(cwd, { recursive: true })
    fs.mkdirSync(path.join(outside, 'child'), { recursive: true })
    fs.writeFileSync(path.join(outside, 'target'), 'synthetic boundary fixture\n')
    fs.symlinkSync(path.join(outside, 'child'), path.join(cwd, 'link'))
    const target = `${cwd}/link/../target`
    const actual = physicalPath(target)
    const packageResult = canonicalNormalizePathForComparison(target, cwd, posixPathFlavor)
    // The contents are synthetic and scope-owned. This demonstrates the OS
    // destination without touching any real secret or executing a shell payload.
    assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic boundary fixture\n')
    assert.equal(actual, path.join(outside, 'target'))
    const blockers = []
    if (packageResult !== actual) blockers.push({ contract: 'physical-path-boundary', packageResult, actual })
    if (typeof service.inspectDevelopmentShell !== 'function') blockers.push({ contract: 'shared-parsed-shell-inspection', detail: 'The reviewed shared parser inspection export is absent.' })
    else {
      const facts = await service.inspectDevelopmentShell('git rev-parse HEAD && git status && git log -5 --oneline && git diff --stat && git rev-parse -q --verify MERGE_HEAD', cwd)
      assert.equal(facts.commands.length, 5)
      assert.equal(facts.effects, false)
      assert.equal((await service.inspectDevelopmentShell('CI=1 node check.cjs | head -5', cwd)).commands.length, 2)
      assert.equal((await service.inspectDevelopmentShell('git status > report.txt', cwd)).effects, true)
      fs.mkdirSync(path.join(cwd, 'sub'))
      assert.deepEqual((await service.inspectDevelopmentShell('cd sub && cd .. && node --version', cwd)).directories, [path.join(cwd, 'sub'), cwd])
      assert.deepEqual((await service.inspectDevelopmentShell(`cd ${outside} && node --version`, cwd)).directories, [outside])
      await assert.rejects(service.inspectDevelopmentShell('cd "$UNRESOLVED" && node --version', cwd), /unresolved working-directory/)
      await assert.rejects(service.inspectDevelopmentShell('PATH=/outside git status', cwd), /policy-sensitive/)
      await assert.rejects(service.inspectDevelopmentShell('bash -c "rm file"', cwd), /Unsupported/)
      assert.equal((await service.inspectDevelopmentShell(`node ${target}`, cwd)).paths.includes(actual), true)
      const { BashProgram } = await load('access-intent/bash/program.ts')
      const { PathNormalizer } = await load('path-normalizer.ts')
      const { normalizeFlatConfig } = await load('normalize.ts')
      const { evaluate } = await load('rule.ts')
      const { resolveBashCommandCheck } = await load('handlers/gates/bash-command.ts')
      const { resolveShellInvocation, classifyToolKind } = await load('access-intent/tool-kind.ts')
      assert.equal(classifyToolKind('ffgrep'), 'path')
      assert.equal(classifyToolKind('fffind'), 'path')
      assert.equal(service.evaluateDevelopmentPolicy({ bash: { '*': 'allow', 'rm*': 'deny' } }, 'bash', 'rm file'), 'deny')
      const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'pi-permission-system.json'), 'utf8'))
      const options = { home: fixture, scratchRoot: path.join(fixture, 'Code/scratch'), reportRoot: path.join(fixture, 'Code/reports') }
      const rules = normalizeFlatConfig(buildDevelopmentPolicy(defaults, options).policy.permission).map(rule => ({ ...rule, origin: 'global' }))
      const normalizer = new PathNormalizer(posixPathFlavor, cwd)
      const check = async (command, selectedRules = rules) => {
        const program = await BashProgram.parse(command, normalizer)
        const resolver = { resolve(intent) { const rule = evaluate('bash', intent.input.command, selectedRules, posixPathFlavor); return { state: rule.action, matchedPattern: rule.pattern, origin: rule.origin } } }
        return resolveBashCommandCheck(command, program.commands(), undefined, resolver).state
      }
      for (const command of ['git rev-parse HEAD && git status && git log -5 --oneline && git diff --stat && git rev-parse -q --verify MERGE_HEAD', 'npm ci', 'pnpm exec vitest run', 'python3 -m pytest', 'node --import tsx scripts/check.ts', 'CI=1 node check.cjs | head -5', 'gh pr view 12', 'sh scripts/check.sh', 'bash -n scripts/check.sh']) assert.equal(await check(command), 'allow', command)
      for (const command of ['git push', 'git clean -fd', 'rm file', 'printf ok; rm file', 'npm publish', 'npm install -g pkg', 'docker compose up', 'postgres', 'initdb', 'pg_ctl', 'psql', 'gh pr create', "'gh' pr create", 'g"h" pr create', 'GH pr create', '/opt/homebrew/bin/gh pr create', 'gh api graphql -f query=mutation', 'env gh pr create', 'command gh pr create', 'find . -exec gh pr create ;', 'printf "%s" "$(gh pr create)"', "bash -c 'git status'"]) {
        const decision = await check(command)
        if (decision === 'ask') await assert.rejects(service.inspectDevelopmentShell(command, cwd), /Unsupported/, command)
        else assert.equal(decision, 'deny', command)
      }
      for (const origin of ['global', 'project', 'agent', 'session']) {
        assert.equal(await check('git status && node check.cjs', [...rules, { surface: 'bash', pattern: 'node*', action: 'deny', origin }]), 'deny')
        assert.equal(await check('node check.cjs', [...rules, { surface: 'bash', pattern: 'node*', action: 'ask', origin }]), 'ask')
      }
      const restricted = normalizeFlatConfig(buildDevelopmentPolicy(defaults, { ...options, restrictions: { bash: { '*': 'deny' }, external_directory: { '*': 'deny' } } }).policy.permission)
      assert.equal(await check('git status', restricted), 'deny', 'blanket human deny overrides earlier specific allows')
      const access = value => evaluate('external_directory', physicalPath(value), rules, posixPathFlavor).action
      assert.equal(access(path.join(fixture, 'Code/future-project/file')), 'allow')
      assert.equal(access(path.join(fixture, 'orca/workspaces/future-non-git/file')), 'allow')
      assert.equal(access(path.join(fixture, 'Code-other/file')), 'deny')
      assert.equal(access(target), 'deny', 'symlink followed before parent traversal')
      assert.equal(evaluate('external_directory', cwd, restricted, posixPathFlavor).action, 'deny')
      for (const local of ['.env', 'secrets.pem', '.npmrc', '.git/config', '.git/hooks/pre-commit']) assert.equal(evaluate('path', `${cwd}/${local}`, rules, posixPathFlavor).action, 'deny', local)
      const selected = path.join(fixture, 'orca/workspaces/selected')
      fs.mkdirSync(selected, { recursive: true })
      fs.writeFileSync(path.join(selected, 'check.cjs'), '// Synthetic path-selection fixture; never executed\n')
      const invocation = resolveShellInvocation('bash', { command: 'node ./check.cjs', repository: selected })
      assert.equal(invocation.workdir, selected)
      const routed = await BashProgram.parse(invocation.command, normalizer, undefined, { workdir: selected })
      assert.ok(routed.pathRuleCandidates().some(candidate => candidate.path.boundaryValue() === `${selected}/check.cjs`), JSON.stringify(routed.pathRuleCandidates().map(candidate => candidate.path.boundaryValue())))
      await require('./development-runtime.check.cjs').check({ root, fixture, service, defaults })
    }
    const report = { validation: 'source-or-snapshot-only; no installed-runtime acceptance', package: metadata.name, version: metadata.version, publicExports: Object.keys(service).sort(), blockers, fixture }
    fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
    if (blockers.length) process.exitCode = 1
  } finally {
    hook.deregister()
    for (const [url, before] of hashes) assert.equal(createHash('sha256').update(fs.readFileSync(fileURLToPath(url))).digest('hex'), before, `Reference changed: ${url}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
