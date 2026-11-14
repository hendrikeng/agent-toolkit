import type { PluginServerContext } from "@getpaseo/plugin/server";
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
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export default function contribute(server: PluginServerContext) {
  const unsubscribe = server.on("agent.permission_requested", async (event, context) => {
    const request = event.request;
    if (request.kind !== "tool") return;

    const input = request.input;
    const args = record(input);
    const claudeName = request.provider === "claude" && request.name.startsWith("mcp__paseo__")
      ? request.name.slice("mcp__paseo__".length) : "";
    // set_agent_mode takes modeId; create_agent and update_agent take settings.modeId. Any other mode field must also be safe.
    const mode = claudeName === "set_agent_mode" ? args?.modeId : record(args?.settings)?.modeId;
    const modes = [mode, args?.modeId, args?.sessionMode, record(args?.settings)?.modeId].filter(value => value !== undefined);
    const claudeTool = trustedTools.has(claudeName) || (modeTools.has(claudeName) && mode !== undefined
      && modes.every(value => typeof value === "string" && safeModes.has(value)));
    const schema = input !== null && typeof input === "object" && !Array.isArray(input) ? input.requestedSchema : null;
    const emptySchema = schema !== null && typeof schema === "object" && !Array.isArray(schema)
      && "type" in schema && schema.type === "object"
      && Object.keys(schema).every(key => key === "type" || key === "properties")
      && (!("properties" in schema) || (schema.properties !== null && typeof schema.properties === "object"
        && !Array.isArray(schema.properties) && Object.keys(schema.properties).length === 0));
    const codexTool = request.provider === "codex" && request.name === "CodexMcpElicitation"
      && request.metadata?.serverName === "paseo"
      && input !== null && typeof input === "object" && !Array.isArray(input)
      && (input.mode === "form" || input.mode === "openai/form") && input.url === null
      && emptySchema
      && trustedTools.has(/^Allow the paseo MCP server to run tool "([a-z][a-z0-9_]*)"\?$/.exec(request.description ?? "")?.[1] ?? "");
    if (!claudeTool && !codexTool) return;

    await context.paseo.agents.ref(event.agent.id).respondToPermission({
      requestId: request.id,
      response: { behavior: "allow" },
    });
    console.info(`Paseo MCP permission approved: ${request.id} for agent ${event.agent.id}`);
  });
  return unsubscribe;
}
