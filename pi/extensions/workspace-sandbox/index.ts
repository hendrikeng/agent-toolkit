import { createHash } from "node:crypto"
import { readFileSync, lstatSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import { createBashToolDefinition, createLocalBashOperations, type BashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent"

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const helperPattern = /^(autoreview-yolo|pg18-fresh-yolo|pg-test (?:start(?:-admin|-migration)?(?: --postgres-version (?:17|18))?|(?:status|stop) pg(?:17|18)-[A-Za-z0-9]{6}|gc))$/

export function createWorkspaceOperations(): BashOperations {
  const local = createLocalBashOperations({ shellPath: "/bin/bash" })
  return {
    async exec(command, cwd, options) {
      if (!process.env.AGENT_TOOLKIT_SESSION_DIR || !process.env.AGENT_TOOLKIT_WORKSPACE) throw new Error("Start a fresh pi-yolo session to use the workspace sandbox")
      const home = homedir()
      const require = createRequire(join(home, ".local/libexec/agent-toolkit/package.json"))
      const policy = require("./development-policy.cjs")
      if (!policy.within(policy.canonical(process.env.AGENT_TOOLKIT_WORKSPACE), policy.canonical(cwd))) throw new Error("Command working directory is outside the assigned workspace")
      const env = { ...process.env, ...options.env }
      const hostHelper = helperPattern.test(command.trim())
      for (const name of Object.keys(env)) {
        if (/^(?:BASH_ENV|ENV|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|PYTHONPATH|PYTHONHOME)$/.test(name) || !hostHelper && (/(?:TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL)/i.test(name) || /^(?:DATABASE_URL|PGHOST|PGPORT|PGUSER|PGDATABASE|AWS_|GOOGLE_|AZURE_|DOCKER_HOST|DOCKER_CONTEXT|SSH_AUTH_SOCK)/.test(name))) env[name] = undefined
      }
      let wrapped: string
      if (hostHelper) {
        const [name, ...args] = command.trim().split(" ")
        const helper = join(home, ".local/bin", name)
        const marker = `${helper}.agent-toolkit.sha256`
        if (!lstatSync(helper).isFile() || lstatSync(helper).isSymbolicLink() || !lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink() || createHash("sha256").update(readFileSync(helper)).digest("hex") !== readFileSync(marker, "utf8").trim()) throw new Error("The bounded helper is missing or changed; run install.sh from a trusted terminal")
        wrapped = ["exec", helper, ...args].map(quote).join(" ")
      } else {
        wrapped = policy.sandboxCommand(command, cwd)
      }
      return local.exec(wrapped, cwd, { ...options, env })
    },
  }
}

export default function workspaceSandbox(pi: ExtensionAPI) {
  const operations = createWorkspaceOperations()
  const tool = createBashToolDefinition(process.cwd(), { operations })
  pi.registerTool({ ...tool, label: "Bash (workspace sandbox)" })
  pi.on("user_bash", () => ({ operations }))
}
