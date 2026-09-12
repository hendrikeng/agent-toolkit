import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { StringEnum } from '@earendil-works/pi-ai'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createBashTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { evaluateDevelopmentPolicy, inspectDevelopmentShell } from '@gotgenes/pi-permission-system'
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
 if (facts.commands.some(args => evaluateDevelopmentPolicy(permission, 'bash', args.join(' ')) !== 'allow')) throw new Error('Accepted bash policy denied this command')
 let inspection = !facts.effects && facts.commands.length > 0
 let gitMutation = false
 let integration = false
 for (const args of facts.commands) {
  if (args[0].split('/').at(-1)?.toLowerCase() !== 'git') { inspection = false; continue }
  try { const operation = execFileSync(join(bundle, 'git'), ['--agent-toolkit-selected', ...args.slice(1)], { cwd: selected, stdio: 'pipe', encoding: 'utf8' }).trim(); integration ||= operation === 'integration' } catch { throw new Error('Git guard rejected the operation or its arguments; no command ran. For mutations, select the target with the repository parameter instead of Git -C') }
  try { execFileSync(join(bundle, 'git'), ['--agent-toolkit-inspect', ...args.slice(1)], { cwd: selected, stdio: 'pipe' }) } catch { inspection = false; gitMutation = true }
 }
 if (gitMutation && facts.directories.some(directory => directory !== selected)) throw new Error('For Git mutations, select the target with the repository parameter instead of shell directory changes')
 return { ...facts, inspection, gitMutation, integration, cwd: selected }
}
export function runBash(id: string, params: { command: string; timeout?: number; repository?: string }, signal: AbortSignal | undefined, update: any, cwd: string, env: NodeJS.ProcessEnv = {}) {
 return createBashTool(cwd, { spawnHook: context => ({ ...context, env: { ...context.env, ...env } }) }).execute(id, params, signal, update)
}
export default function developmentAccess(pi: ExtensionAPI) {
 let resourceScope: any
 const resourceEnv = new Map<string, string | undefined>()
 const clearResourceEnv = () => {
  for (const [key, value] of resourceEnv) value === undefined ? delete process.env[key] : process.env[key] = value
  resourceEnv.clear()
 }
 const helper = () => require(join(contract().bundle, 'local-resources.cjs'))
 const resourceRoot = (id: string) => join(realpathSync(tmpdir()), 'agent-toolkit-resources', id)
 const persistResources = () => {
  const root = resourceRoot(resourceScope.id)
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
    const file = join(resourceRoot(params.scope_id), 'resource-scope.json')
    if (physicalPath(file) !== file) throw new Error('Resource scope identity changed')
    const candidate = JSON.parse(readFileSync(file, 'utf8'))
    if (candidate.id !== params.scope_id || JSON.stringify(candidate.declarations) !== JSON.stringify(params.declarations) || candidate.workspace !== ctx.cwd) throw new Error('Resource scope changed; unchanged resume cannot expand it')
    resourceScope = candidate
   } else {
    if (!ctx.hasUI || !await ctx.ui.confirm('Approve bounded local test resources?', JSON.stringify({ declarations: params.declarations, runtime: helper().RESOURCE_RUNTIME, workspace: ctx.cwd, deletion: 'not authorized' }, null, 2), { signal })) return { content: [{ type: 'text', text: 'Not approved' }], details: {} }
    resourceScope = { id: randomUUID(), declarations: params.declarations, workspace: ctx.cwd, resources: {} }; persistResources()
   }
   clearResourceEnv()
   helper().prepareResources(resourceScope.id, resourceScope.declarations, resourceScope.resources, persistResources, resourceScope.workspace, resourceRoot(resourceScope.id), helper().dockerRuntime())
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
 pi.registerTool({
  name: 'bash', label: 'bash', description: 'Native permission-gated shell. repository selects any physical working directory in the accepted development roots.',
  parameters: Type.Object({ command: Type.String({ minLength: 1 }), timeout: Type.Optional(Type.Number()), repository: Type.Optional(Type.String({ minLength: 1 })) }), executionMode: 'sequential',
  async execute(id, params, signal, update, ctx) {
   const { assertDevelopmentPath, developmentRoots } = contract()
   const cwd = params.repository ? isAbsolute(params.repository) ? params.repository : `${ctx.cwd}/${params.repository}` : ctx.cwd
   const roots = developmentRoots(process.env.HOME), selected = assertDevelopmentPath(cwd, roots), runtime = process.env.PI_CODING_AGENT_DIR!, facts = await inspectShell(params.command, selected), targets = [...facts.paths, ...facts.candidates, ...facts.directories].filter(path => path && path !== '/dev/null').map(path => assertDevelopmentPath(path, roots))
   if ([selected, ...targets].some(path => path === runtime || path.startsWith(`${runtime}/`))) throw new Error('Runtime agent files are read-only during the session')
   return runBash(id, params, signal, update, selected)
  },
 })
 pi.on('session_start', (_event, ctx) => {
  const { bundle, POLICY_VERSION, developmentRoots } = contract()
  require(join(bundle, 'permission-bundle.cjs')).verifyBundle(bundle)
  ctx.ui.notify(`${POLICY_VERSION}: ${developmentRoots(process.env.HOME).join(', ')}. New worktrees under these roots need no registration or restart.`, 'info')
 })
 pi.on('session_shutdown', clearResourceEnv)
}
