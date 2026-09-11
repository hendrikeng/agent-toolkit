import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { graphGit, repositoryIdentity, gitEnvironment } from '../task-graph-core.ts'

// Source lifecycle check: real scope-owned Git fixtures and scripts, simulated
// Orca RPCs. Native parser/policy routing is checked separately, never claimed here.
const globals = globalThis as any
const chain = 'git rev-parse HEAD && git status && git log -5 --oneline && git diff --stat && git rev-parse -q --verify MERGE_HEAD'
const hooks = registerHooks({ resolve(specifier, context, next) {
 if (!context.parentURL?.endsWith('/task-graph/index.ts')) return next(specifier, context)
 const modules: Record<string, string> = {
  '@earendil-works/pi-coding-agent': 'export const getAgentDir=()=>globalThis.agentDir; export const truncateHead=content=>({content}); export const withFileMutationQueue=(_path,fn)=>fn();',
  '@earendil-works/pi-ai': 'export const StringEnum=()=>({});',
  typebox: 'export const Type=new Proxy({}, {get:()=>()=>({})});',
  'node:child_process': 'export const execFileSync=(_binary,args)=>JSON.stringify(globalThis.orcaRpc(args));',
  '../development-access/index.ts': `export const inspectShell=async(command,cwd)=>({inspection:command===${JSON.stringify(chain)}||command==='git status --short',cwd,directories:command==='cd .. && node --version'?[cwd.slice(0,cwd.lastIndexOf('/'))]:[]});`,
 }
 return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context)
} })
const { default: extension } = await import('../index.ts')
test.after(() => hooks.deregister())

function fixture() {
 const root = mkdtempSync(join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT!, 'graph-v3-'))
 const before = { ...process.env }
 const sources = [0, 1].map(() => JSON.parse(execFileSync('git-test', ['create'], { encoding: 'utf8' })).path)
 const bin = join(root, 'bin'); mkdirSync(bin)
 symlinkSync(new URL('../../../../shared/agent-safety/git-yolo-guard', import.meta.url).pathname, join(bin, 'git'))
 Object.assign(process.env, gitEnvironment(), { PATH: `${bin}:${process.env.PATH}`, AGENT_TOOLKIT_PI_AGENT_DIR: join(root, 'agent'), AGENT_TOOLKIT_PERMISSION_BUNDLE: new URL('../../../../shared/agent-safety', import.meta.url).pathname, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' })
 for (const source of sources) {
  writeFileSync(join(source, 'owned.txt'), 'original\n')
  writeFileSync(join(source, '.gitignore'), '.ready\n')
  writeFileSync(join(source, 'setup.cjs'), "require('node:fs').writeFileSync('.ready','ready')\n")
  writeFileSync(join(source, 'check.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('.ready','utf8'),'ready')\n")
  graphGit(source, 'add', '--', 'owned.txt', '.gitignore', 'setup.cjs', 'check.cjs'); graphGit(source, 'commit', '-m', 'Fixture inputs')
  writeFileSync(join(source, '.git/hooks/pre-commit'), '#!/bin/sh\nprintf hook >> "$(git rev-parse --git-common-dir)/hook-evidence"\n', { mode: 0o755 })
 }
 writeFileSync(join(sources[0], 'unrelated.txt'), 'staged unrelated input\n')
 graphGit(sources[0], 'add', '--', 'unrelated.txt')
 mkdirSync(join(sources[0], 'docs/future'), { recursive: true })
 writeFileSync(join(sources[0], 'docs/future/input.md'), 'approved input snapshot\n')
 const heads = sources.map(source => graphGit(source, 'rev-parse', 'HEAD'))
 const indexes = sources.map(source => readFileSync(join(source, '.git/index')))
 const runs: any[] = [], ledger: any[] = [], worktrees: any[] = [], calls: string[][] = []
 let lose = '', confirmations = 0
 globals.orcaRpc = (args: string[]) => {
  calls.push(args)
  const option = (key: string) => args[args.indexOf(key) + 1]
  const op = args.slice(0, 2).join(' ')
  let result: any
  const selector = option('--repo')
  const repoIndex = selector?.startsWith('id:') ? Number(selector.slice(3)) : selector?.startsWith('path:') ? sources.findIndex(source => repositoryIdentity(source) === repositoryIdentity(selector.slice(5))) : -1
  if (op === 'repo list') result = { repos: sources.map((path, index) => ({ id: String(index), path })) }
  else if (op === 'repo show') result = { repo: { id: String(repoIndex), defaultTerminals: [], setup: [] } }
  else if (op === 'worktree list') result = { worktrees: worktrees.filter(item => item.repo === repoIndex) }
  else if (op === 'worktree create') {
   assert.equal(option('--setup'), 'skip'); assert.ok(args.includes('--no-parent'))
   const name = option('--name'), path = join(root, name)
   graphGit(sources[repoIndex], 'worktree', 'add', '-b', name, path, option('--base-branch'))
   const worktree = { id: `fixture::${path}`, path, branch: `refs/heads/${name}`, displayName: name, repo: repoIndex }
   worktrees.push(worktree); result = { worktree }
  } else if (op === 'orchestration run-list') result = { runs }
  else if (op === 'orchestration run-create') { const run = { id: `run_${runs.length}`, objective: option('--objective') }; runs.push(run); result = { run } }
  else if (op === 'orchestration run-show') result = { run: runs.find(run => run.id === option('--id')) }
  else if (op === 'orchestration task-list') result = { tasks: ledger.filter(task => task.run_id === option('--run')) }
  else if (op === 'orchestration task-create') { const task = { id: `task_${ledger.length}`, run_id: option('--run'), spec: option('--spec'), deps: option('--deps'), status: 'ready', parent_id: null }; ledger.push(task); result = { task } }
  else if (op === 'orchestration task-update') { const task = ledger.find(task => task.id === option('--id')); task.status = option('--status'); result = { task } }
  else throw Error(`Unexpected RPC: ${op}`)
  if (lose === op) { lose = ''; throw Error('Lost creation response') }
  return { ok: true, result }
 }
 function runtime() {
  const tools = new Map<string, any>(), events = new Map<string, any>(), commands = new Map<string, any>()
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => events.set(name, handler), registerCommand: (name: string, command: any) => commands.set(name, command), sendUserMessage: () => {} } as never)
  assert.equal(tools.has('bash'), false, 'graph does not own ordinary bash')
  const ctx = { cwd: sources[0], hasUI: true, isIdle: () => true, ui: { confirm: async () => { confirmations++; return true }, notify: (message: string) => { throw Error(message) } } }
  let serial = 0
  return {
   command: (args: string) => commands.get('graph').handler(args, ctx),
   stop: () => events.get('session_shutdown')(),
   async call(name: string, input: any = {}) {
    const id = String(++serial)
    const event = { toolName: name, input, toolCallId: id }
    const blocked = await events.get('tool_call')(event, ctx)
    if (blocked?.block) throw Error(blocked.reason)
    let output: any, error: any
    try {
     if (name === 'write') { mkdirSync(join(input.path, '..'), { recursive: true }); writeFileSync(input.path, input.content); output = { content: [] } }
     else if (name === 'bash') { output = { content: [{ type: 'text', text: execFileSync('/bin/bash', ['-c', input.command], { cwd: input.repository ?? ctx.cwd, env: process.env, encoding: 'utf8' }) }] } }
     else output = await tools.get(name).execute(id, input, undefined, undefined, ctx)
    } catch (failure) { error = failure }
    const after = await events.get('tool_result')?.({ ...event, isError: Boolean(error), content: output?.content ?? [] }, ctx)
    if (after?.isError) throw Error(after.content[0].text)
    if (error) throw error
    return output
   },
  }
 }
 let r = runtime()
 const plan: any = { objective: 'Source lifecycle fixture', mode: 'plan-only', inputs: [{ repository: sources[0], paths: ['docs/future/input.md'] }], foundations: sources.map((repository, index) => ({ repository, commit: heads[index] })), tasks: sources.map((repository, index) => ({ id: `task-${index}`, goal: 'Scoped source check', repository, owns: ['docs/future'], depends_on: index ? ['task-0'] : [], done_when: ['Focused check passes'], setup: 'node setup.cjs', validation: 'node check.cjs' })) }
 return { root, sources, heads, indexes, plan, calls, worktrees, get r() { return r }, get confirmations() { return confirmations }, set lose(value: string) { lose = value },
  async resume() { r.stop(); r = runtime(); await r.command(`plan ${plan.objective}`) },
  close() { r.stop(); for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) },
 }
}

test('one approval, lost-response recovery, diagnostics, failure evidence and clean checkpoint completion', async () => {
 const f = fixture()
 try {
  await f.r.command(`plan ${f.plan.objective}`)
  await assert.rejects(f.r.call('bash', { command: chain }), /Command failed/)
  const approved = (await f.r.call('propose_task_graph', f.plan)).details
  f.lose = 'worktree create'
  await assert.rejects(f.r.call('prepare_task_graph_workspace'), /Lost/)
  await f.resume()
  const prepared = (await f.r.call('prepare_task_graph_workspace')).details
  assert.equal(f.confirmations, 1); assert.equal(f.worktrees.length, 2)
  await assert.rejects(f.r.call('start_task_graph_task', { task_id: 'task-1' }), /first unfinished/)
  for (const [index, source] of f.sources.entries()) {
   const root = prepared.repositories[source].path, task_id = `task-${index}`
   await f.r.call('start_task_graph_task', { task_id })
   await assert.rejects(f.r.call('bash', { repository: source, command: 'node check.cjs' }), /writing workspace/)
   await f.r.call('bash', { repository: root, command: 'node setup.cjs' })
   await assert.rejects(f.r.call('bash', { repository: root, command: 'cd .. && node --version' }), /directory change escapes/)
   await assert.rejects(f.r.call('write', { path: `${root}/docs/future/../future/x.md`, content: 'traversal' }), /literal absolute/)
   await f.r.call('bash', { repository: root, command: 'node --version' })
   await assert.rejects(f.r.call('write', { path: join(root, 'owned.txt'), content: 'implementation' }), /Planning-only/)
   await assert.rejects(f.r.call('write', { path: join(source, 'docs/future/x.md'), content: 'source write' }), /isolated workspace/)
   await f.r.call('write', { path: join(root, 'docs/future/x.md'), content: 'approved documentation\n' })
   await f.r.call('checkpoint_task_graph', { repository: root, paths: ['docs/future/x.md'], message: 'Scoped documentation' })
   await assert.rejects(f.r.call('bash', { repository: root, command: 'node -e "process.exit(7)"' }))
   await assert.rejects(f.r.call('complete_task_graph_task', { task_id, evidence: 'false success' }), /validation/)
   await f.r.call('bash', { repository: root, command: 'node check.cjs' })
   await f.r.call('bash', { repository: root, command: 'node --version' })
   await assert.rejects(f.r.call('complete_task_graph_task', { task_id, evidence: 'stale validation' }), /validation/)
   await f.r.call('bash', { repository: root, command: 'node check.cjs' })
   await f.r.call('complete_task_graph_task', { task_id, evidence: 'Declared validation passed on clean checkpoint' })
   await assert.rejects(f.r.call('bash', { command: chain }), /Command failed/)
  }
  const result = await f.r.call('finish_task_graph', { run_id: prepared.run_id, evidence: 'Source lifecycle check complete; mocked Orca only' })
  assert.equal(result.details.status, 'complete')
  assert.equal(f.confirmations, 1)
  for (const [index, source] of f.sources.entries()) {
   assert.equal(graphGit(source, 'rev-parse', 'HEAD'), f.heads[index])
   assert.deepEqual(readFileSync(join(source, '.git/index')), f.indexes[index])
   assert.ok(readFileSync(join(source, '.git/hook-evidence'), 'utf8').includes('hook'))
  }
  assert.equal(JSON.parse(readFileSync(approved.record, 'utf8')).version, 3)
  const planningHeads = f.sources.map(source => graphGit(prepared.repositories[source].path, 'rev-parse', 'HEAD'))
  writeFileSync(join(f.sources[0], 'docs/future/input.md'), 'later source edit\n')
  f.plan.mode = 'execute'; f.plan.objective = 'Separately approved execution'; delete f.plan.inputs
  f.plan.tasks.forEach((task: any) => { task.owns = ['owned.txt'] })
  f.plan.foundations.forEach((entry: any, index: number) => { entry.commit = planningHeads[index] })
  await f.r.command(`execute ${f.plan.objective}`)
  await f.r.call('propose_task_graph', f.plan)
  const execution = (await f.r.call('prepare_task_graph_workspace')).details
  assert.equal(f.confirmations, 2)
  assert.equal(f.worktrees.length, 4)
  assert.equal(readFileSync(join(execution.repositories[f.sources[0]].path, 'docs/future/input.md'), 'utf8'), 'approved input snapshot\n')
  for (const [index, source] of f.sources.entries()) {
   const root = execution.repositories[source].path, task_id = `task-${index}`
   assert.notEqual(root, prepared.repositories[source].path)
   assert.equal(graphGit(root, 'rev-parse', 'HEAD'), planningHeads[index])
   await f.r.call('start_task_graph_task', { task_id })
   await f.r.call('bash', { repository: root, command: 'node setup.cjs' })
   await f.r.call('write', { path: join(root, 'owned.txt'), content: 'approved implementation\n' })
   await f.r.call('checkpoint_task_graph', { repository: root, paths: ['owned.txt'], message: 'Scoped implementation' })
   await f.r.call('bash', { repository: root, command: 'node check.cjs' })
   await f.r.call('complete_task_graph_task', { task_id, evidence: 'Execution check passed on final checkpoint' })
   assert.equal(graphGit(prepared.repositories[source].path, 'rev-parse', 'HEAD'), planningHeads[index])
   assert.deepEqual(readFileSync(join(source, '.git/index')), f.indexes[index])
  }
  await f.r.call('finish_task_graph', { run_id: execution.run_id, evidence: 'Separate source execution validated; no integration or deletion' })
  console.log(`Retained graph source fixture: ${f.root}`)
 } finally { f.close() }
})

test('declared inspection records setup and validation only in the active workspace', async () => {
 const f = fixture()
 try {
  f.plan.tasks[0].setup = f.plan.tasks[0].validation = 'git status --short'
  await f.r.command(`plan ${f.plan.objective}`)
  const approval = (await f.r.call('propose_task_graph', f.plan)).details
  const prepared = (await f.r.call('prepare_task_graph_workspace')).details
  const repository = prepared.repositories[f.sources[0]].path
  await f.r.call('start_task_graph_task', { task_id: 'task-0' })
  await f.r.call('bash', { command: 'git status --short', repository: f.sources[0] })
  assert.equal(JSON.parse(readFileSync(approval.record, 'utf8')).active.setup, false)
  await assert.rejects(f.r.call('complete_task_graph_task', { task_id: 'task-0', evidence: 'source inspection is not task validation' }), /validation/)
  await f.r.call('bash', { command: 'git status --short', repository })
  const state = JSON.parse(readFileSync(approval.record, 'utf8'))
  assert.equal(state.active.setup, true)
  assert.equal(state.active.validation.command, 'git status --short')
  assert.equal(state.active.validation.head, graphGit(repository, 'rev-parse', 'HEAD'))
  await f.r.call('complete_task_graph_task', { task_id: 'task-0', evidence: 'Declared inspection passed on the clean workspace' })
 } finally { f.close() }
})

test('incremental scope adds only the new task and workspace without recapturing inputs', async () => {
 const f = fixture()
 try {
  const task = f.plan.tasks.pop(), foundation = f.plan.foundations.pop()
  await f.r.command(`plan ${f.plan.objective}`)
  const approval = (await f.r.call('propose_task_graph', f.plan)).details
  const first = (await f.r.call('prepare_task_graph_workspace')).details
  const original = JSON.parse(readFileSync(approval.record, 'utf8'))
  await assert.rejects(f.r.call('expand_task_graph_scope', { owns: [], resources: [], inputs: [{ repository: f.sources[0], paths: ['docs/future/input.md'] }] }), /cannot recapture/)
  assert.equal(f.confirmations, 1)
  await f.r.call('expand_task_graph_scope', { owns: [{ task_id: 'task-0', paths: ['docs/additions'] }], resources: [], tasks: [task], foundations: [foundation] })
  const expanded = JSON.parse(readFileSync(approval.record, 'utf8'))
  assert.equal(f.confirmations, 2)
  assert.equal(expanded.key, original.key)
  assert.deepEqual(expanded.repositories[0].inputs, original.repositories[0].inputs)
  const prepared = (await f.r.call('prepare_task_graph_workspace')).details
  assert.equal(prepared.repositories[f.sources[0]].path, first.repositories[f.sources[0]].path)
  assert.equal(f.worktrees.length, 2)
  assert.equal(f.calls.filter(args => args.slice(0, 2).join(' ') === 'orchestration run-create').length, 1)
 } finally { f.close() }
})

test('named plans cannot bypass pending Security or Product approvals', async () => {
 const f = fixture()
 try {
  f.plan.mode = 'execute'; f.plan.objective = 'docs/future/input.md'
  await f.r.command(`execute ${f.plan.objective}`)
  const target = join(f.sources[0], 'docs/future/input.md')
  const markdown = security => `# Plan\n\n## Metadata\n- Plan-ID: task-0\n- Status: ready-for-promotion\n- Priority: p1\n- Dependencies: none\n- Acceptance-Criteria: checked\n- Validation-Lanes: always\n- Risk-Tier: low\n- Security-Approval: ${security}\n- Product-Approval: pending\n`
  writeFileSync(target, markdown('pending'))
  await assert.rejects(f.r.call('propose_task_graph', f.plan), /security approval/)
  writeFileSync(target, markdown('approved'))
  await assert.rejects(f.r.call('propose_task_graph', f.plan), /Product approval/)
  assert.equal(f.confirmations, 0)
 } finally { f.close() }
})

test('old approvals are not expanded and source changes block continuation', async () => {
 const f = fixture()
 try {
  await f.r.command(`plan ${f.plan.objective}`)
  const approval = (await f.r.call('propose_task_graph', f.plan)).details
  const old = JSON.parse(readFileSync(approval.record, 'utf8'))
  writeFileSync(approval.record, JSON.stringify({ ...old, version: 2 })) // Owned fixture record only.
  await assert.rejects(f.resume(), /older contract/)
  writeFileSync(approval.record, JSON.stringify(old))
  await f.resume()
  writeFileSync(join(f.sources[0], 'owned.txt'), 'outside graph mutation\n')
  await assert.rejects(f.r.call('prepare_task_graph_workspace'), /Source checkout/)
 } finally { f.close() }
})
