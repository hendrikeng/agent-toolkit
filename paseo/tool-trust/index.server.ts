import type { PluginServerContext } from "@getpaseo/plugin/server";
declare const console: { info(...args: unknown[]): void };

export default function contribute(server: PluginServerContext) {
  const unsubscribe = server.on("agent.permission_requested", async (event, context) => {
    const request = event.request;
    if (request.kind !== "tool") return;

    const claudeTool = request.provider === "claude" && /^mcp__paseo__[a-z][a-z0-9_]*$/.test(request.name);
    const input = request.input;
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
      && /^Allow the paseo MCP server to run tool "[a-z][a-z0-9_]*"\?$/.test(request.description ?? "");
    if (!claudeTool && !codexTool) return;

    await context.paseo.agents.ref(event.agent.id).respondToPermission({
      requestId: request.id,
      response: { behavior: "allow" },
    });
    console.info(`Paseo MCP permission approved: ${request.id} for agent ${event.agent.id}`);
  });
  return unsubscribe;
}
