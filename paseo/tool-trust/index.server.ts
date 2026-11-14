import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { appendFile, chmod, lstat, mkdir, realpath, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
declare const console: { info(...args: unknown[]): void };

// Paseo tools approved without a prompt for Codex and Claude: discovery, status, cancel, soft-delete
// (archive_agent, for worker cleanup), and workspace create/rename. Claude also approves create_agent, update_agent,
// and set_agent_mode when they name a safe mode. Other tools that start processes or terminals,
// read or type into terminals, drive the browser, schedule work, approve permissions, prompt existing agents,
// or hard-delete state keep the normal approval flow.
const trustedTools = new Set([
  "list_agents", "list_hosts", "list_models", "list_pending_permissions", "list_profiles", "list_providers",
  "list_schedules", "list_terminals", "list_workspace_scripts", "list_workspaces",
  "get_agent_status", "get_agent_activity", "inspect_provider", "inspect_schedule", "schedule_logs",
  "cancel_agent", "archive_agent", "create_workspace", "rename_workspace",
]);
// Claude only: these tools set a permission mode, so they are approved only when every mode field is a safe mode
// and at least one is present. A missing mode prompts, because the provider default mode is unknown here.
// Codex requests carry no tool arguments, so Codex always prompts for them.
const modeTools = new Set(["create_agent", "update_agent", "set_agent_mode"]);
// Modes that keep native approvals. Any other requested mode, such as bypassPermissions or full-access, prompts.
const safeModes = new Set(["default", "plan", "acceptEdits", "auto", "auto-review", "read-only"]);
// Claude only: built-in file edits of the agent's own auto-memory notes. Claude Code protects its config directory,
// so settings cannot pre-approve these writes and auto-mode agents stall on the prompt.
const editTools = new Set(["Edit", "Write", "MultiEdit"]);
// Claude modes that allow file edits. Plan mode and unknown modes prompt.
const editModes = new Set(["default", "acceptEdits", "auto", "bypassPermissions"]);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
let realHome: Promise<string> | undefined;
// A note is approved only in <root>/projects/<project>/memory/, where <root> is ~/.claude or a Paseo Claude home and
// <project> is Claude Code's name for the agent's cwd or its Paseo project root. Claude Code files a git worktree's
// memory under the main repository. Both paths come from Paseo records, so another project's memory prompts.
// The checkout placement's mainRepoRoot is not used: Paseo derives it with git in the cwd, which the agent controls.
// shortcut: an agent in a subdirectory of a project that Paseo does not know writes to memory that prompts here.
// shortcut: the plugin cannot learn the agent's Claude home, so any Paseo home is accepted. On this setup all homes link
// projects/ to ~/.claude/projects, so they share one memory directory per project.
async function isOwnMemoryNote(file: unknown, roots: (string | undefined)[]): Promise<boolean> {
  if (typeof file !== "string" || !file.startsWith("/") || file.includes("\0")
    || file.split("/").slice(1).some(segment => segment === "" || segment === "." || segment === "..")) return false;
  try {
    const home = await (realHome ??= realpath(homedir()).catch(error => { realHome = undefined; throw error; }));
    const slash = file.lastIndexOf("/"), dir = file.slice(0, slash), name = file.slice(slash + 1);
    const project = dir.startsWith(`${home}/`) ? /^(?:\.claude|\.paseo\/zerosub\/homes\/[^/]+)\/projects\/([^/]+)\/memory$/
      .exec(dir.slice(home.length + 1))?.[1] : undefined;
    if (!name.endsWith(".md") || !project
      || !roots.some(root => root?.replace(/[^a-zA-Z0-9]/g, "-") === project)) return false;
    // The requested directory must contain no symlink, so the write goes where the check looked. The only exception
    // is a Paseo home whose projects/ links to ~/.claude/projects, which leads to the same project's main memory.
    const real = await realpath(dir);
    if (real !== dir && real !== `${home}/.claude/projects/${project}/memory`) return false;
    // An existing note must be a plain file with one link; a symlink or hard link could point at another file.
    // shortcut: a new note can still become a symlink between this check and the write. Only a process that can write
    // the memory directory can do that, and the Toolkit sandbox gives agents no write access to ~/.claude or ~/.paseo.
    const stat = await lstat(file).catch((error: { code?: string }) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return !stat || (stat.isFile() && stat.nlink === 1);
  } catch {
    return false;
  }
}

// Record each prompt left for the human, so frequent safe prompts can become approvals later.
// Only the file's directory and extension, or the program name (plus the subcommand of a known multi-command tool), are
// kept; never command arguments, file names, file contents, edit strings, or other input fields.
async function logPending(agent: string, request: AgentPermissionRequest) {
  try {
    const args = record(request.input), detail = request.detail;
    const command = detail?.type === "shell" ? detail.command : request.name === "Bash" ? args?.command : undefined;
    const file = detail && "filePath" in detail ? detail.filePath : args?.file_path ?? args?.notebook_path;
    // Keep the program name, and the subcommand only for known multi-command tools. A command that starts with an
    // quoted or substituted assignment is logged as unparsed, because its value could leak into the program position.
    const words = typeof command === "string" ? command.trim().split(/\s+/) : [];
    while (/^[A-Za-z_]\w*=[^'"`$(]*$/.test(words[0] ?? "")) words.shift();
    const program = words[0]?.split("/").pop() ?? "";
    const plain = /^[A-Za-z0-9._+-]+$/.test(program);
    const shell = !plain ? "(unparsed)"
      : `${program} ${subcommandTools.has(program) && /^[a-z][a-z0-9-]*$/.test(words[1] ?? "") ? words[1] : ""}`.trim();
    const where = typeof file === "string"
      ? `${file.slice(0, file.lastIndexOf("/") + 1).slice(0, 200)}*${/\.[A-Za-z0-9]{1,8}$/.exec(file)?.[0] ?? ""}` : undefined;
    const summary = request.name.startsWith("mcp__") ? undefined : typeof command === "string" ? shell : where;
    const dir = `${homedir()}/.local/share/agent-toolkit`, log = `${dir}/permission-log.jsonl`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // shortcut: two prompts at the rotation size can race, so one rotated log can be lost; fine for usage statistics.
    if (((await stat(log).catch(() => null))?.size ?? 0) > 1_000_000) await rename(log, `${dir}/permission-log.1.jsonl`);
    await appendFile(log, `${JSON.stringify({ time: new Date().toISOString(), agent, provider: request.provider,
      tool: request.name, kind: request.kind, summary })}\n`, { mode: 0o600 });
    // appendFile and mkdir keep the mode of an existing file or directory, so tighten older ones.
    await Promise.all([chmod(log, 0o600), chmod(dir, 0o700)]).catch(() => {});
  } catch {
    // Logging must never change the permission outcome.
  }
}

const subcommandTools = new Set(["git", "gh", "npm", "npx", "pnpm", "yarn", "bun", "docker", "kubectl", "fly", "flyctl",
  "railway", "infisical", "uv", "pip", "poetry", "cargo", "go", "make", "brew", "paseo", "claude", "codex"]);

export default function contribute(server: PluginServerContext) {
  const unsubscribe = server.on("agent.permission_requested", async (event, context) => {
    const request = event.request;
    if (request.kind !== "tool") return logPending(event.agent.id, request);

    const input = request.input;
    const args = record(input);
    const claudeName = request.provider === "claude" && request.name.startsWith("mcp__paseo__")
      ? request.name.slice("mcp__paseo__".length) : "";
    // set_agent_mode takes modeId; create_agent and update_agent take settings.modeId. Any other mode field must also be safe.
    const mode = claudeName === "set_agent_mode" ? args?.modeId : record(args?.settings)?.modeId;
    const modes = [mode, args?.modeId, args?.sessionMode, record(args?.settings)?.modeId].filter(value => value !== undefined);
    const claudeTool = trustedTools.has(claudeName) || (modeTools.has(claudeName) && mode !== undefined
      && modes.every(value => typeof value === "string" && safeModes.has(value)));
    const schema = record(args?.requestedSchema);
    const properties = schema && "properties" in schema ? record(schema.properties) : {};
    const emptySchema = schema?.type === "object" && Object.keys(schema).every(key => key === "type" || key === "properties")
      && properties !== null && Object.keys(properties).length === 0;
    const codexTool = request.provider === "codex" && request.name === "CodexMcpElicitation"
      && request.metadata?.serverName === "paseo"
      && (args?.mode === "form" || args?.mode === "openai/form") && args?.url === null
      && emptySchema
      && trustedTools.has(/^Allow the paseo MCP server to run tool "([a-z][a-z0-9_]*)"\?$/.exec(request.description ?? "")?.[1] ?? "");
    // Cheap shape check first, so ordinary edit prompts do not wait for daemon lookups.
    const memoryShaped = typeof args?.file_path === "string" && /\/projects\/[^/]+\/memory\/[^/]+\.md$/.test(args.file_path);
    const memoryEdit = !claudeTool && !codexTool && request.provider === "claude" && editTools.has(request.name) && memoryShaped
      && await isOwnMemoryNote(args?.file_path, [event.agent.cwd, event.agent.workspaceId ? (await context.paseo.workspaces
        .ref(event.agent.workspaceId).refresh().catch(() => null))?.projectRootPath : undefined])
      && editModes.has((await context.paseo.agents.ref(event.agent.id).refresh().catch(() => null))?.agent.currentModeId ?? "");
    if (!claudeTool && !codexTool && !memoryEdit) return logPending(event.agent.id, request);

    await context.paseo.agents.ref(event.agent.id).respondToPermission({
      requestId: request.id,
      response: { behavior: "allow" },
    });
    console.info(`${memoryEdit ? "Claude memory note edit" : "Paseo MCP"} permission approved: ${request.id} for agent ${event.agent.id}`);
  });
  return unsubscribe;
}
