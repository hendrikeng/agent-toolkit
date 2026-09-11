// Compatibility API for permission-system 20.7.3. Uses its parser, not a second shell language.
import { BashPathResolver } from './access-intent/bash/bash-path-resolver'
import { BashProgram } from './access-intent/bash/program'
import { getParser } from './access-intent/bash/parser'
import { resolveNodeText } from './access-intent/bash/node-text'
import { PathNormalizer } from './path-normalizer'
import { pathFlavorForPlatform } from './path/path-flavor'
import { PermissionManager } from './permission-manager'
import { physicalPath } from './agent-toolkit-path.cjs'
import { getProjectConfigPath } from './config-paths'
import { normalizeFlatConfig } from './normalize'
import { evaluate } from './rule'

// An additive floor: callers cannot use this result to override native decisions.
export function evaluateDevelopmentPolicy(permission: Parameters<typeof normalizeFlatConfig>[0], surface: string, target: string) {
 return evaluate(surface, target, normalizeFlatConfig(permission), pathFlavorForPlatform(process.platform)).action
}

export function developmentDirectoryPolicy(agentDir: string, cwd: string) {
 const project = getProjectConfigPath(cwd)
 if (physicalPath(project) !== project) throw new Error('Project permission configuration must not use a symlink alias')
 const manager = new PermissionManager({ agentDir, flavor: pathFlavorForPlatform(process.platform) })
 manager.configureForCwd(cwd)
 const rules = manager.getComposedConfigRules()
 if (manager.getConfigIssues().length) throw new Error('Selected directory has invalid native permission configuration')
 return (surface: string, target: string) => evaluate(surface, target, rules, pathFlavorForPlatform(process.platform)).action
}

export async function inspectDevelopmentShell(command: string, cwd: string, permission?: Parameters<typeof normalizeFlatConfig>[0]) {
 const normalizer = new PathNormalizer(pathFlavorForPlatform(process.platform), cwd)
 const program = await BashProgram.parse(command, normalizer, permission ? token => evaluateDevelopmentPolicy(permission, 'path', token) !== 'allow' : undefined)
 const tree = (await getParser()).parse(command)
 if (!tree) throw new Error('Unsupported shell syntax: parse error')
 const commands: string[][] = []
 let effects = false
 try {
  if (tree.rootNode.hasError) throw new Error('Unsupported shell syntax: parse error')
  const walk = (node: any) => {
   if (['heredoc_body', 'comment'].includes(node.type)) return
   if (['file_redirect', 'heredoc_redirect', 'herestring_redirect', 'variable_assignment'].includes(node.type)) effects = true
   if (node.type === 'variable_assignment') {
    const name = node.text.split('=')[0]
    if (/^(?:PATH|HOME|SHELL|ENV|BASH_ENV|CDPATH|IFS|ZDOTDIR|LD_.*|DYLD_.*|NODE_OPTIONS|PYTHONPATH|GIT_.*|PG.*|AGENT_TOOLKIT_.*)$/.test(name)) throw new Error('Operation policy: policy-sensitive environment assignment is not permitted')
   }
   if (node.type === 'command') {
    const args = node.namedChildren.filter((child: any) => child.type !== 'variable_assignment').map((child: any) => resolveNodeText(child.type === 'command_name' ? child.child(0) ?? child : child))
    if (args.length) commands.push(args)
   }
   for (const child of node.namedChildren) walk(child)
  }
  walk(tree.rootNode)
  if (!commands.length || program.commands().some(unit => unit.wrapperKind)) throw new Error('Unsupported shell syntax: opaque command or execution wrapper')
  const resolver = new BashPathResolver(normalizer)
  resolver.resolve(tree.rootNode)
  return { commands, effects, directories: resolver.developmentDirectories, paths: program.externalPaths().map(value => value.boundaryValue()), candidates: program.pathRuleCandidates().map(value => value.path.boundaryValue()) }
 } finally { tree.delete() }
}
