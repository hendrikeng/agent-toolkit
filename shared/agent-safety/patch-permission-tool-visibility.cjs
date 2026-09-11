// One version-checked compatibility set, applied only to a newly staged package.
// No trust callback, reason-string authority, or upgrade chain.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')
const VERSION = '20.7.3'
const PATCHES = {
 'access-intent/path-surfaces.ts': [
  ['export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set([\n', 'export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set([\n  "fffind", "ffgrep",\n'],
  ['export const PATH_BEARING_TOOLS = new Set([\n', 'export const PATH_BEARING_TOOLS = new Set([\n  "fffind", "ffgrep",\n'],
 ],
 'access-intent/tool-kind.ts': [[
  '      command: getNonEmptyString(record.command) ?? "",\n      workdir: undefined,',
  '      command: getNonEmptyString(record.command) ?? "",\n      workdir: getNonEmptyString(record.repository) ?? undefined,',
 ]],
 'access-intent/path-normalization.ts': [
  ['import { expandHomePath }', 'import { physicalPath } from "../agent-toolkit-path.cjs";\nimport { expandHomePath }'],
  ['  const lexical = normalizePathForComparison(pathValue, base, flavor);\n  if (!lexical) return "";\n  return flavor.fold(canonicalizePath(lexical, flavor));',
   '  const literal = normalizePathPolicyLiteral(pathValue);\n  if (!literal) return "";\n  if (process.platform !== "win32") return physicalPath(literal.startsWith("/") ? literal : `${base}/${literal}`);\n  return flavor.fold(canonicalizePath(normalizePathForComparison(pathValue, base, flavor), flavor));'],
 ],
 'path-normalizer.ts': [
  ['import type { PathFlavor }', 'import { physicalPath } from "./agent-toolkit-path.cjs";\nimport type { PathFlavor }'],
  ['    return this.flavor.impl.resolve(this.cwd, offset);', '    return physicalPath(offset.startsWith("/") ? offset : `${this.cwd}/${offset}`);'],
  ['    return this.flavor.impl.join(offset, target);', '    return offset ? `${offset}/${target}` : target;'],
 ],
 'access-intent/bash/bash-path-resolver.ts': [
  ['export class BashPathResolver {', 'export class BashPathResolver {\n  readonly developmentDirectories: string[] = [];'],
  ['    if (target === null) return UNKNOWN_BASE;\n    return this.deriveBaseFromCdTarget(base, target);', '    if (target === null) throw new Error("Unsupported shell syntax: unresolved working-directory change");\n    const next = this.deriveBaseFromCdTarget(base, target);\n    if (next.kind === "unknown") throw new Error("Unsupported shell syntax: unresolved working-directory change");\n    this.developmentDirectories.push(this.normalizer.resolveBase(next.offset));\n    return next;'],
  ['        const accessPath = this.normalizer.forPath(candidate);', '        throw new Error("Unsupported shell syntax: explicit relative path after unresolved working-directory change");\n        const accessPath = this.normalizer.forPath(candidate);'],
 ],
 'handlers/gates/external-directory-policy.ts': [
  ['import type { AccessPath }', 'import { AccessPath }'],
  ['  return resolver.resolve({\n    kind: "access-path",\n    surface: "external_directory",\n    path,\n    agentName,\n  });',
   '  const check = (value: AccessPath) => resolver.resolve({ kind: "access-path" as const, surface: "external_directory", path: value, agentName });\n  const canonical = path.boundaryValue();\n  return pickMostRestrictive([check(path), check(AccessPath.forLiteral(canonical || path.value()))])!;'],
 ],
 'access-intent/bash/command-enumeration.ts': [
  ['import type { TSNode } from "#src/access-intent/bash/parser";', 'import type { TSNode } from "#src/access-intent/bash/parser";\nimport { resolveNodeText } from "#src/access-intent/bash/node-text";'],
  ['    // A command\'s text already contains any substitution; descend its subtree',
   '    const words = node.namedChildren.filter(child => child.type !== "variable_assignment").map(child => resolveNodeText(child.type === "command_name" ? child.child(0) ?? child : child));\n    words[0] = basename(words[0] ?? "").toLowerCase();\n    out.push(makeUnit(words.join(" "), context, classifyWrapperCommand(node)));\n    // A command\'s text already contains any substitution; descend its subtree'],
  ['  out.push(makeUnit(node.text, context));\n}', '  out.push(makeUnit(node.text, context, "opaque-payload"));\n}'],
  ['const INDIRECTION_WRAPPER_NAMES = new Set([', 'const INDIRECTION_WRAPPER_NAMES = new Set([\n  "command", "exec", "builtin",'],
  ['      commandName = basename(child.text);', '      commandName = basename(resolveNodeText(child.type === "command_name" ? child.child(0) ?? child : child)).toLowerCase();'],
  ['    args.push(child.text);', '    args.push(resolveNodeText(child));'],
 ],
 'service.ts': [['import type { ToolAccessExtractor }', 'export { inspectDevelopmentShell, evaluateDevelopmentPolicy, developmentDirectoryPolicy } from "./agent-toolkit-shell";\nimport type { ToolAccessExtractor }']],
}
const PUBLIC_TYPES = '\n// agent-toolkit development-roots-v1 compatibility API\nexport declare function developmentDirectoryPolicy(agentDir: string, cwd: string): (surface: string, target: string) => "allow" | "ask" | "deny";\nexport declare function inspectDevelopmentShell(command: string, cwd: string, permission?: Record<string, unknown>): Promise<{ commands: string[][]; effects: boolean; paths: string[]; candidates: string[]; directories: string[] }>;\nexport declare function evaluateDevelopmentPolicy(permission: Record<string, unknown>, surface: string, target: string): "allow" | "ask" | "deny";\n'
const additions = { 'agent-toolkit-shell.ts': 'permission-shell.ts', 'agent-toolkit-path.cjs': 'development-policy.cjs' }
const FILES = [...Object.keys(PATCHES), ...Object.keys(additions)]
function patchFile(name, source) {
 const replacements = PATCHES[name] || []
 if (replacements.every(([, after]) => source.split(after).length === 2)) return source
 for (const [before, after] of replacements) {
  assert.equal(source.split(before).length, 2, `Unexpected pinned source in ${name}; stage a pristine ${VERSION} package`)
  source = source.replace(before, after)
 }
 return source
}
function metadata(root) {
 const value = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'))
 assert.equal(value.name, '@gotgenes/pi-permission-system')
 assert.equal(value.version, VERSION)
}
function install(root) {
 metadata(root)
 const changes = Object.keys(PATCHES).map(name => [name, patchFile(name, fs.readFileSync(join(root, 'src', name), 'utf8'))])
 for (const [name, source] of Object.entries(additions)) changes.push([name, fs.readFileSync(join(__dirname, source), 'utf8')])
 const declarations = join(root, 'dist/public.d.ts')
 const original = fs.readFileSync(declarations, 'utf8')
 assert.ok(original.includes('getPermissionsService'), 'Unexpected public declaration format')
 assert.ok(!original.includes('// agent-toolkit development-roots-v1 compatibility API') || original.endsWith(PUBLIC_TYPES), 'Stage a pristine package for a changed compatibility interface')
 for (const [name, source] of changes) fs.writeFileSync(join(root, 'src', name), source)
 if (!original.endsWith(PUBLIC_TYPES)) fs.writeFileSync(declarations, original + PUBLIC_TYPES)
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function checkInstallation(root, expected) {
 metadata(root)
 assert.ok(fs.readFileSync(join(root, 'dist/public.d.ts'), 'utf8').endsWith(PUBLIC_TYPES), 'Missing public compatibility declarations')
 assert.ok(expected && Object.keys(expected).length, 'An installation manifest is required')
 for (const [name, digest] of Object.entries(expected)) {
  const file = join(root, name), stat = fs.lstatSync(file)
  assert.ok(stat.isFile() && !stat.isSymbolicLink())
  assert.equal(hash(fs.readFileSync(file)), digest, `Installation byte mismatch: ${name}`)
 }
 for (const name of Object.keys(PATCHES)) assert.equal(patchFile(name, fs.readFileSync(join(root, 'src', name), 'utf8')), fs.readFileSync(join(root, 'src', name), 'utf8'))
 for (const name of ['handlers/gates/bash-command.ts', 'handlers/gates/tool-call-gate-pipeline.ts']) assert.ok(!fs.readFileSync(join(root, 'src', name), 'utf8').includes('approvedExecution'), 'Obsolete execution override in package')
}
module.exports = { VERSION, FILES, PATCHES, patchFile, install, checkInstallation, hash }
if (require.main === module) { assert.equal(process.argv.length, 3); install(process.argv[2]) }
