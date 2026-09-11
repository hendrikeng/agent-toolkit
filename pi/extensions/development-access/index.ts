import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { StringEnum } from '@earendil-works/pi-ai'
import { join, isAbsolute } from 'node:path'
import { createBashTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { inspectDevelopmentShell, evaluateDevelopmentPolicy, developmentDirectoryPolicy, getPermissionsService } from '@gotgenes/pi-permission-system'
import { Type } from 'typebox'

const require = createRequire(import.meta.url)
function contract() {
 const bundle = process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE
 if (!bundle) throw new Error('Installation [development-roots-v1]: start through the fully installed pi-yolo launcher')
 return { bundle, ...require(join(bundle, 'development-policy.cjs')) }
}
export async function inspectShell(command: string, cwd: string) {
 const { bundle, physicalPath } = contract()
 const selected = physicalPath(cwd)
 const permission = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'extensions/pi-permission-system/config.json'), 'utf8')).permission
 const facts = await inspectDevelopmentShell(command, selected, permission)
 let inspection = !facts.effects && facts.commands.length > 0
 let gitMutation = false
 let integration = false
 for (const args of facts.commands) {
  if (args[0].split('/').at(-1)?.toLowerCase() !== 'git') { inspection = false; continue }
  try { const operation = execFileSync(join(bundle, 'git'), ['--agent-toolkit-selected', ...args.slice(1)], { cwd: selected, stdio: 'pipe', encoding: 'utf8' }).trim(); integration = integration || operation === 'integration' } catch { throw new Error('Git guard rejected the operation or its arguments; no command ran. For mutations, select the target with the repository parameter instead of Git -C') }
  try { execFileSync(join(bundle, 'git'), ['--agent-toolkit-inspect', ...args.slice(1)], { cwd: selected, stdio: 'pipe' }) } catch { inspection = false; gitMutation = true }
 }
 if (gitMutation && facts.directories.some(directory => directory !== selected)) throw new Error('For Git mutations, select the target with the repository parameter instead of shell directory changes')
 return { ...facts, inspection, gitMutation, integration, cwd: selected }
}
export function runBash(id: string, params: { command: string; timeout?: number; repository?: string }, signal: AbortSignal | undefined, update: any, cwd: string, env: NodeJS.ProcessEnv = {}) {
 return createBashTool(cwd, { spawnHook: context => ({ ...context, env: { ...context.env, ...env } }) }).execute(id, params, signal, update)
}
export default function developmentAccess(pi: ExtensionAPI) {
 const localGit = new Set<string>()
 let floor: Record<string, unknown>
 let infrastructure: Record<string, unknown> = {}
 const narrow = async (surface: string, target: string, ctx: any, selected: 'allow' | 'ask' | 'deny' = 'allow') => {
  if (!floor) throw new Error('Installation floor is not loaded')
  const floorDecision = evaluateDevelopmentPolicy(floor, surface, target)
  const decision = [floorDecision, selected].includes('deny') ? 'deny' : [floorDecision, selected].includes('ask') ? 'ask' : 'allow'
  if (decision === 'deny') throw new Error(`Accepted ${surface} policy denied this target or command unit`)
  // Native asks already use their own prompt. A later allowance must not erase
  // the installer's narrower policy. Never disclose argument credential values.
  const native = getPermissionsService()?.checkPermission(surface, target)
  if (decision === 'ask' && (selected === 'ask' || native?.state === 'allow' && native.origin !== 'session') && (!ctx.hasUI || !await ctx.ui.confirm('Accepted policy requires authorization', `Approve this ${surface} operation for this call? Values are omitted to protect credentials.`))) throw new Error('Accepted policy authorization was not granted')
 }
 let resourceScope: any
 const resourceEnv = new Map<string, string | undefined>()
 const clearResourceEnv = () => {
  for (const [key, value] of resourceEnv) value === undefined ? delete process.env[key] : process.env[key] = value
  resourceEnv.clear()
 }
 const helper = () => require(join(contract().bundle, 'local-resources.cjs'))
 const persistResources = () => {
  const root = join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT!, 'local-resource-scopes', resourceScope.id)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const target = join(root, 'resource-scope.json'), temporary = `${target}.${randomUUID()}`
  writeFileSync(temporary, JSON.stringify(resourceScope), { flag: 'wx', mode: 0o600 }); renameSync(temporary, target)
 }
 const exposeResources = () => {
  clearResourceEnv()
  for (const [key, value] of Object.entries(helper().resourceEnvironment(resourceScope.resources, helper().dockerRuntime()))) {
   if (!resourceEnv.has(key)) resourceEnv.set(key, process.env[key])
   process.env[key] = String(value)
  }
 }
 pi.registerTool({ name: 'prepare_local_resources', label: 'Local Test Resources', description: 'Approve bounded new Docker test resources once, or resume an unchanged scope by ID. No existing service administration or deletion.', parameters: Type.Object({ declarations: Type.Array(Type.Any()), scope_id: Type.Optional(Type.String()) }), executionMode: 'sequential',
  async execute(_id, params, signal, _update, ctx) {
   helper().validateResources(params.declarations)
   if (params.scope_id) {
    if (!/^[a-f0-9-]{36}$/.test(params.scope_id)) throw new Error('Invalid resource scope ID')
    const { physicalPath } = contract()
    const file = join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT!, 'local-resource-scopes', params.scope_id, 'resource-scope.json')
    if (physicalPath(file) !== file) throw new Error('Resource scope identity changed')
    const candidate = JSON.parse(readFileSync(file, 'utf8'))
    if (candidate.id !== params.scope_id || JSON.stringify(candidate.declarations) !== JSON.stringify(params.declarations) || candidate.workspace !== ctx.cwd) throw new Error('Resource scope changed; unchanged resume cannot expand it')
    resourceScope = candidate
   } else {
    if (!ctx.hasUI || !await ctx.ui.confirm('Approve bounded local test resources?', JSON.stringify({ declarations: params.declarations, runtime: helper().RESOURCE_RUNTIME, workspace: ctx.cwd, deletion: 'not authorized' }, null, 2), { signal })) return { content: [{ type: 'text', text: 'Not approved' }], details: {} }
    resourceScope = { id: randomUUID(), declarations: params.declarations, workspace: ctx.cwd, resources: {} }; persistResources()
   }
   clearResourceEnv()
   helper().prepareResources(resourceScope.id, resourceScope.declarations, resourceScope.resources, persistResources, resourceScope.workspace, join(process.env.AGENT_TOOLKIT_SCRATCH_ROOT!, 'local-resource-scopes', resourceScope.id), helper().dockerRuntime())
   exposeResources()
   return { content: [{ type: 'text', text: JSON.stringify({ scope_id: resourceScope.id, resources: Object.entries(resourceScope.resources).map(([name, item]: any) => ({ name, identity: item.id })), credentials: 'Injected as RESOURCE_<ID>_URL; do not commit them' }) }], details: {} }
  },
 })
 pi.registerTool({ name: 'operate_local_resource', label: 'Local Resource Operation', description: 'Reset, scan or stop only an identity-verified resource from the active approved local scope.', parameters: Type.Object({ resource_id: Type.String(), operation: StringEnum(['reset', 'scan', 'stop'] as const) }), executionMode: 'sequential',
  async execute(_id, params) {
   const record = resourceScope?.resources[params.resource_id]
   if (!record) throw new Error('Resume or approve this resource scope first')
   const output = helper().operateResource(record, params.operation, helper().dockerRuntime()); persistResources()
   if (params.operation === 'stop') exposeResources()
   return { content: [{ type: 'text', text: output || 'Operation complete; resources retained' }], details: {} }
  },
 })
 pi.on('session_shutdown', clearResourceEnv)
 const pendingProbe = new Map<string, 'write' | 'read'>()
 let probeWritten = false, probeRead = false
 pi.registerTool({
  name: 'bash', label: 'bash', description: 'Native permission-gated shell. repository selects its working directory independently of graph mode.',
  parameters: Type.Object({ command: Type.String({ minLength: 1 }), timeout: Type.Optional(Type.Number()), repository: Type.Optional(Type.String({ minLength: 1 })) }), executionMode: 'sequential',
  async execute(id, params, signal, update, ctx) {
   const { physicalPath } = contract()
   const cwd = params.repository ? isAbsolute(params.repository) ? params.repository : `${ctx.cwd}/${params.repository}` : ctx.cwd
   return runBash(id, params, signal, update, physicalPath(cwd))
  },
 })
 pi.on('session_start', (_event, ctx) => {
  const { bundle, POLICY_VERSION, developmentRoots } = contract()
  require(join(bundle, 'permission-bundle.cjs')).verifyBundle(bundle)
  const config = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'extensions/pi-permission-system/config.json'), 'utf8'))
  floor = config.permission
  const readPaths: Record<string, string> = { '*': 'deny' }
  for (const path of config.piInfrastructureReadPaths ?? []) { readPaths[path] = 'allow'; readPaths[`${path}/*`] = 'allow' }
  infrastructure = { external_directory: readPaths }
  ctx.ui.notify(`${POLICY_VERSION}: ${developmentRoots(process.env.HOME).join(', ')}. Reload retains this permission version.`, 'info')
 })
 pi.on('before_agent_start', event => probeRead ? undefined : ({ systemPrompt: event.systemPrompt + `\nPermission startup probe: before ordinary work, use native write on ${process.env.AGENT_TOOLKIT_REVIEW_ROOT}/.native-probe-${process.pid}.txt with content "native report probe", then native read on that exact path. Retain it. This verifies native routing, not shell-only filesystem access.` }))
 pi.on('tool_call', async (event, ctx) => {
  let selectedCwd = ctx.cwd, targetHint = '', operation = event.toolName
  try {
   const { physicalPath, developmentRoots, within } = contract()
   if (!getPermissionsService()) throw new Error('Native permission service is not active')
   const roots = developmentRoots(process.env.HOME)
   const input = event.input as any
   const probe = `${process.env.AGENT_TOOLKIT_REVIEW_ROOT}/.native-probe-${process.pid}.txt`
   if (['write', 'read'].includes(event.toolName) && input.path === probe) {
    if (physicalPath(probe) !== probe) throw new Error('Native probe path identity changed')
    try { const stat = lstatSync(probe); if (!stat.isFile() || stat.nlink !== 1) throw new Error('Native probe must be an unshared regular file') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (event.toolName === 'write' && input.content !== 'native report probe') throw new Error('Startup probe content mismatch')
    pendingProbe.set(event.toolCallId, event.toolName as 'write' | 'read')
   } else if (!probeWritten || !probeRead) throw new Error(`Installation [development-roots-v1]: native report probe is incomplete. Write and read ${probe} through native tools first.`)
   if (event.toolName === 'bash') {
    const cwd = input.repository ? isAbsolute(input.repository) ? input.repository : `${ctx.cwd}/${input.repository}` : ctx.cwd
    selectedCwd = physicalPath(cwd)
    if (!within(cwd, roots)) throw new Error('Selected working directory is outside accepted roots')
    const facts = await inspectShell(input.command, cwd)
    const service = getPermissionsService()
    const selectedPolicy = developmentDirectoryPolicy(process.env.PI_CODING_AGENT_DIR!, facts.cwd)
    await narrow('external_directory', facts.cwd, ctx, selectedPolicy('external_directory', facts.cwd))
    for (const args of facts.commands) {
     const name = args[0].split('/').at(-1)?.toLowerCase()
     operation = name ?? 'bash'
     if (['npm', 'pnpm', 'yarn', 'bun'].includes(name!) && args.slice(1).some((arg, index) => /^-[^-]*g/.test(arg) || /^--(?:global|location=global)(?:=|$)/.test(arg) || (arg === '--location' && args[index + 2] === 'global'))) throw new Error('Global package installation requires separate host authorization')
     await narrow('bash', [name, ...args.slice(1)].join(' '), ctx, selectedPolicy('bash', [name, ...args.slice(1)].join(' ')))
     if (!service || service.checkPermission('bash', [name, ...args.slice(1)].join(' ')).state === 'deny') throw new Error('Native operation policy denied this parsed command')
    }
    for (const target of [...facts.paths, ...facts.candidates, ...facts.directories]) {
     targetHint = target
     if (target && target !== '/dev/null') { await narrow('path', target, ctx, selectedPolicy('path', target)); await narrow('external_directory', target, ctx, selectedPolicy('external_directory', target)) }
     if (target && target !== '/dev/null' && !within(target, roots)) throw new Error(`Explicit shell target is outside accepted roots: ${target}`)
    }
    for (const args of facts.commands) {
     const name = args[0].split('/').at(-1)?.toLowerCase()
     if (['pg-test', 'git-test'].includes(name!) && ['start', 'start-admin', 'create'].includes(args[1])) {
      if (process.env.AGENT_TOOLKIT_GIT_INSPECTION_ONLY === 'true') throw new Error('Additional fixture creation is outside graph resource declarations. Use the approved graph resource tools.')
      if (!ctx.hasUI || !await ctx.ui.confirm('Authorize one bounded fixture?', `Create one ${name} fixture for this task? The managed helper retains its identity and evidence. No existing repository or database administration is authorized.`)) throw new Error('Fixture creation requires bounded setup authorization')
     }
    }
    if (facts.integration && (!ctx.hasUI || !await ctx.ui.confirm('Authorize branch integration?', `This operation integrates history in ${facts.cwd}. Proceed only for an explicit user integration request after preserving local work.`))) throw new Error('Branch integration needs separate operation-specific authorization')
    if (facts.gitMutation && !facts.integration && !localGit.has(facts.cwd)) {
     if (!ctx.hasUI || !await ctx.ui.confirm('Approve local Git mutation scope?', `Allow local Git mutations in ${facts.cwd} for this session task? Hooks stay enabled. Publication, deletion and history replacement remain excluded.`)) throw new Error('Local Git mutation needs task-specific human authorization')
     localGit.add(facts.cwd)
    }
    if (resourceScope) exposeResources()
   } else if (typeof input.path === 'string') {
    const value = input.path.replace(/^@/, '')
    const target = physicalPath(isAbsolute(value) ? value : `${ctx.cwd}/${value}`)
    targetHint = target
    await narrow('path', target, ctx)
    await narrow(event.toolName === 'write' || event.toolName === 'edit' ? event.toolName : 'read', target, ctx)
    if (within(target, roots)) await narrow('external_directory', target, ctx)
    if (getPermissionsService()?.checkPermission('path', target).state === 'deny') throw new Error('Native protected-path policy denied this target')
    // The native package owns protected-secret rules and bounded infrastructure
    // reads. Physical aliases must also meet its external-directory decision.
    if (!within(target, roots) && !within(target, [physicalPath(process.env.AGENT_TOOLKIT_REVIEW_ROOT!)])) {
     if (!['read', 'fffind', 'ffgrep', 'grep', 'find', 'ls'].includes(event.toolName) || evaluateDevelopmentPolicy(infrastructure, 'external_directory', target) !== 'allow') throw new Error(`Target requires bounded path authorization: ${target}`)
    }
   }
  } catch (error) { return { block: true, reason: `Path/operation policy [development-roots-v1], cwd=${JSON.stringify(selectedCwd)}, operation=${JSON.stringify(operation)}${targetHint ? `, target=${JSON.stringify(targetHint)}` : ''}: ${error instanceof Error ? error.message : 'Rejected operation'}. No in-session grant overrides this denial. Use a separately authorized human operation, or the declared resource tools where applicable; chat approval does not change policy.` } }
 })
 pi.on('tool_result', event => {
  const probe = pendingProbe.get(event.toolCallId)
  pendingProbe.delete(event.toolCallId)
  if (event.isError) return
  if (probe === 'write') probeWritten = true
  if (probe === 'read' && probeWritten) probeRead = true
 })
}
