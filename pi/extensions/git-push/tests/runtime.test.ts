import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

const hook = registerHooks({ resolve(specifier, context, next) {
 if (specifier === "typebox" && context.parentURL?.endsWith("/git-push/index.ts")) return { url: "data:text/javascript,export const Type=new Proxy({}, {get:()=>()=>({})});", shortCircuit: true }
 return next(specifier, context)
} })
const { default: extension } = await import("../index.ts")
test.after(() => hook.deregister())

test("trusted push keeps hooks enabled and sends only the confirmed commit to a safe transport stub", async () => {
 const tools = new Map<string, any>(), events = new Map<string, any>(), commands = new Map<string, any>()
 const calls: string[][] = []
 let toolNames: string[] = [], transport = 0
 const upstream = "a".repeat(40), commit = "b".repeat(40)
 const result = (stdout = "", code = 0) => ({ stdout, stderr: "", code, killed: false })
 extension({
  registerTool: (tool: any) => tools.set(tool.name, tool), on: (name: string, handler: any) => events.set(name, handler), registerCommand: (name: string, command: any) => commands.set(name, command),
  getActiveTools: () => toolNames, setActiveTools: (names: string[]) => { toolNames = names }, sendUserMessage: (prompt: string) => events.get("before_agent_start")({ prompt }),
  exec: async (_binary: string, args: string[]) => {
   calls.push(args)
   assert.ok(!args.some(arg => arg.includes("hooksPath") || arg === "--no-verify"))
   const argv = args.slice(args.indexOf("-C") + 2)
   if (argv.includes("push")) {
    transport++
    assert.ok(argv.includes(`${commit}:refs/heads/dev`))
    assert.ok(argv.includes(`--force-with-lease=refs/heads/dev:${upstream}`))
    assert.ok(argv.includes("--recurse-submodules=no"))
    assert.ok(!argv.includes("--force"))
    return result("safe transport stub; no network")
   }
   if (argv[0] === "status") return result()
   if (argv[0] === "branch") return result("dev\n")
   if (argv[0] === "config") {
    const key = argv.at(-1)!
    return key.endsWith(".remote") ? result("origin\n") : key.endsWith(".merge") ? result("refs/heads/dev\n") : result("", 1)
   }
   if (argv[0] === "remote") return result(argv.length === 1 ? "origin\n" : "git@github.com:fixture/repo.git\n")
   if (argv[0] === "rev-parse") return result(argv.includes("--show-toplevel") ? "/fixture\n" : argv.includes("--symbolic-full-name") ? "refs/remotes/origin/dev\n" : argv.includes("HEAD") ? `${commit}\n` : `${upstream}\n`)
   if (argv[0] === "rev-list") return result("0\t1\n")
   if (argv[0] === "log") return result("bbbbbbb fixture\n")
   if (argv[0] === "update-ref") return result()
   throw new Error(`Unexpected Git call: ${argv.join(" ")}`)
  },
 } as never)
 const ctx = { cwd: "/fixture", mode: "tui", waitForIdle: async () => {}, ui: { confirm: async () => true, notify: (message: string) => { throw new Error(message) } } }
 const push = () => tools.get("push_current_branch").execute("test", {}, undefined, undefined, ctx)
 await assert.rejects(push, /not armed/)
 await commands.get("push").handler("", ctx)
 await push()
 assert.equal(transport, 1)
 await assert.rejects(push, /not armed/)
 const old = process.env.GIT_CONFIG_COUNT
 try {
  process.env.GIT_CONFIG_COUNT = "1"
  await commands.get("push").handler("", ctx)
  const before = calls.length
  await assert.rejects(push, /Unset GIT_CONFIG_COUNT/)
  assert.equal(calls.length, before)
 } finally { if (old === undefined) delete process.env.GIT_CONFIG_COUNT; else process.env.GIT_CONFIG_COUNT = old }
})
