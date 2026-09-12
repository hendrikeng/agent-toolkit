import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { registerHooks } from "node:module"
import test from "node:test"

const globals = globalThis as any
const hooks = registerHooks({ resolve(specifier, context, next) {
 if (!context.parentURL?.endsWith("/development-access/index.ts")) return next(specifier, context)
 const modules: Record<string, string> = {
  "@earendil-works/pi-coding-agent": "export const createBashTool=cwd=>({execute:async()=>{globalThis.selectedCwd=cwd;return {content:[]}}});",
  "@earendil-works/pi-ai": "export const StringEnum=()=>({});",
  typebox: "export const Type=new Proxy({}, {get:()=>()=>({})});",
  "@gotgenes/pi-permission-system": "export const evaluateDevelopmentPolicy=()=> 'allow'; export const inspectDevelopmentShell=async(command)=>({commands:[],effects:false,directories:[],paths:command==='outside'?['/private']:[],candidates:[]});",
 }
 return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context)
} })
const { default: extension } = await import("../index.ts")
test.after(() => hooks.deregister())

test("accepted development roots need no checkout registration or startup probe", async () => {
 const scratch = process.env.AGENT_TOOLKIT_SCRATCH_ROOT || join(homedir(), "Code/.agent-toolkit-scratch")
 const root = realpathSync(mkdtempSync(join(scratch, "development-access-"))), bundle = new URL("../../../../shared/agent-safety", import.meta.url).pathname
 const before = process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE; process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE = bundle
 try {
  const tools = new Map<string, any>(), events = new Map<string, any>()
  extension({ registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => events.set(name, handler) } as never)
  assert.equal(events.has("tool_call"), false)
  assert.equal(events.has("before_agent_start"), false)
  const created = join(root, "new-worktree"); mkdirSync(created)
  await tools.get("bash").execute("id", { command: "node --version", repository: created }, undefined, undefined, { cwd: root })
  assert.equal(globals.selectedCwd, created)
  await assert.rejects(tools.get("bash").execute("escape", { command: "outside", repository: created }, undefined, undefined, { cwd: root }), /outside accepted development roots/)
 } finally {
  if (before === undefined) delete process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE; else process.env.AGENT_TOOLKIT_PERMISSION_BUNDLE = before
 }
})
