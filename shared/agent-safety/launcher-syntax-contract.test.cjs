const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const launcher = readFileSync(join(__dirname, 'agent-yolo'), 'utf8')
const guardPath = join(__dirname, 'git-yolo-guard')
const installer = readFileSync(join(__dirname, '../../install.sh'), 'utf8')
const { PATCHES, patchFile } = require('./patch-permission-tool-visibility.cjs')
function checkHeredocs(source) {
 const blocks = [...source.matchAll(/<<'([A-Z_]+)'\n([\s\S]*?)\n\1\b/g)]
 assert.ok(blocks.length)
 for (const [, delimiter, body] of blocks) assert.equal((body.match(/'/g) || []).length % 2, 0, `Unbalanced apostrophe in ${delimiter} heredoc`)
}
test('launcher avoids macOS Bash 3.2 unmatched-heredoc-apostrophe regression', () => {
 checkHeredocs(launcher)
 assert.throws(() => checkHeredocs(launcher.replace('const runtimeAgentDir =', "// Orca's workspace\nconst runtimeAgentDir =")), /Unbalanced apostrophe/)
})
test('installer defaults to one no-argument installation', () => {
 const root = mkdtempSync(join(tmpdir(), 'install-choice-'))
 mkdirSync(join(root, 'shared/agent-safety'), { recursive: true })
 for (const name of ['agent-yolo', 'git-yolo-guard']) writeFileSync(join(root, 'shared/agent-safety', name), readFileSync(join(__dirname, name)))
 // Exercise the argument parser only; never run installation side effects.
 const parser = installer.slice(0, installer.indexOf('initialize_blueprint_submodule()'))
 writeFileSync(join(root, 'install.sh'), parser + '\nprintf done\n')
 const agent = join(root, 'agent')
 const run = args => spawnSync('/bin/bash', [join(root, 'install.sh'), ...args], { env: { ...process.env, HOME: root, AGENT_TOOLKIT_PI_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent }, encoding: 'utf8' })
 const defaults = run([])
 assert.equal(defaults.status, 0, defaults.stderr)
 assert.match(defaults.stdout, /Installing development access/)
 assert.ok(defaults.stdout.endsWith('done'))
 assert.equal(run(['--unknown']).status, 2)
})

test('pi-yolo defaults to Sol at medium thinking while preserving explicit overrides', () => {
 const block = launcher.slice(launcher.indexOf('    has_model=false'), launcher.indexOf('    PATH=$PATH', launcher.indexOf('    has_model=false')))
 const args = values => spawnSync('/bin/bash', ['-uc', `${block}\nprintf '%s\\n' "\${pi_args[@]}"`, 'launcher-test', ...values], { encoding: 'utf8' })
 const defaults = args([])
 assert.equal(defaults.status, 0, defaults.stderr)
 assert.deepEqual(defaults.stdout.trim().split('\n'), ['--model', 'openai-codex/gpt-5.6-sol', '--thinking', 'medium'])
 const explicit = args(['--model', 'google/gemini', '--thinking', 'high'])
 assert.equal(explicit.status, 0, explicit.stderr)
 assert.deepEqual(explicit.stdout.trim().split('\n'), ['--model', 'google/gemini', '--thinking', 'high'])
 assert.match(launcher, /pi "\$\{pi_args\[@\]\}"/)
})

test('pi-yolo exposes installed skill roots without exposing whole agent directories', () => {
 for (const path of ['runtimeAgentDir, "skills"', 'managedAgentDir, "skills"', '".agents/skills"', '".claude/skills"', '".codex/skills"']) assert.ok(launcher.includes(path), path)
 assert.doesNotMatch(launcher, /piInfrastructureReadPaths[^]*path\.join\(os\.homedir\(\), "\.agents"\)/)
})

test('permission manager patch remains repeatable after removing project policy imports', () => {
 const source = PATCHES['permission-manager.ts'].map(([before]) => before).join('\n')
 const patched = patchFile('permission-manager.ts', source)
 assert.equal(patchFile('permission-manager.ts', patched), patched)
})


test('Git allows native local commands while blocking aliases, extensions, credentials, and destructive forms', () => {
 const env = { ...process.env }
 for (const key of Object.keys(env)) if (/^GIT_(?:CONFIG|DIR|WORK_TREE|COMMON_DIR|NAMESPACE|EXEC_PATH|SSH)/.test(key)) delete env[key]
 const check = args => spawnSync(guardPath, ['--agent-toolkit-check', ...args], { env, encoding: 'utf8' })
 assert.equal(spawnSync('/bin/bash', ['-n', guardPath]).status, 0)
 assert.match(readFileSync(guardPath, 'utf8'), /--no-external-commands --no-aliases/)
 for (const args of [['status'], ['switch', 'topic'], ['tag', 'v1'], ['worktree', 'repair']]) assert.equal(check(args).status, 0, args.join(' '))
 for (const args of [['push'], ['merge', '--abort'], ['cherry-pick', '--abort'], ['cherry-pick', '--quit'], ['cherry-pick', '--skip'], ['revert', '--abort'], ['revert', '--quit'], ['revert', '--skip'], ['http-push', 'origin', 'https://example.invalid/repo'], ['reset', 'HEAD~1'], ['am', '--abort'], ['am', '--skip'], ['fast-import'], ['repack', '-Ad', '--unpack-unreachable=now'], ['apply', '--unsafe-paths', 'change.patch'], ['mv', '-f', 'a', 'b'], ['remote', 'remove', 'origin'], ['remote', '-v', 'remove', 'origin'], ['remote', '--verbose', 'set-url', 'origin', 'elsewhere'], ['remote', 'set-url', 'origin', 'elsewhere'], ['maintenance', 'run'], ['maintenance', 'register'], ['maintenance', 'start'], ['stash', 'pop'], ['stash', 'branch', 'recover'], ['credential', 'fill'], ['lfs', 'push'], ['difftool'], ['submodule', 'foreach', 'rm -rf .'], ['bisect', 'run', 'sh'], ['clean', '-fd'], ['reset', '--har'], ['checkout', 'topic'], ['checkout', '--', 'file'], ['switch', '-C', 'topic'], ['switch', '--orphan', 'topic'], ['switch', '-fC', 'topic'], ['switch', '--force-c', 'topic'], ['branch', '-D', 'topic'], ['branch', '-m', 'old', 'new'], ['branch', '--mov', 'old', 'new'], ['branch', '--edit-description', 'main'], ['branch', '-u', 'origin/main'], ['branch', '-M', 'topic'], ['branch', '-fd', 'topic'], ['tag', '--f', 'v1'], ['tag', '--delete=v1'], ['symbolic-ref', '-d', 'refs/heads/topic'], ['symbolic-ref', 'refs/heads/main', 'refs/heads/other'], ['notes', 'add', '-f', '-m', '', 'HEAD'], ['notes', 'edit', 'HEAD'], ['notes', 'remove'], ['notes', '--ref', 'review', 'remove', 'HEAD'], ['notes', '--ref=review', 'prune'], ['checkout-index', '-f', '--', 'file'], ['read-tree', '--reset', '-u', 'HEAD'], ['sparse-checkout', 'set', 'src'], ['worktree', 'remove', 'path'], ['worktree', 'move', 'path', 'elsewhere/not'], ['worktree', 'add', '-fB', 'main', 'path', 'HEAD~1']]) assert.equal(check(args).status, 126, args.join(' '))
})

test('installer validates shell files before side effects and selects the complete bundle atomically', () => {
 const gate = installer.indexOf('/bin/bash -n "$script"')
 assert.ok(gate > 0 && gate < installer.indexOf('timestamp='))
 const activation = installer.indexOf('activate "$permission_bundle" "$target"')
 assert.ok(activation > installer.lastIndexOf('\ninstall_pi_packages\n'))
 assert.ok(activation > installer.indexOf('verify "$permission_bundle"'))
 assert.ok(activation > installer.indexOf('Refusing an unmanaged Pi launcher'))
 assert.doesNotMatch(installer, /install_pi_policy\(\)|repository-trust|permission-current/)
 assert.doesNotMatch(launcher, /ENFORCE_REPOSITORY_TRUST|approvedExecution|trustedRepositories/)
})
