import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext) {
  const unsubscribe = server.on("agent.permission_requested", async (event, context) => {
    const request = event.request;
    if (request.kind !== "tool") return;

    const claudeTool = request.provider === "claude" && /^mcp__paseo__[a-z][a-z0-9_]*$/.test(request.name);
    const input = request.input;
    const codexTool = request.provider === "codex" && request.name === "CodexMcpElicitation"
      && request.metadata?.serverName === "paseo"
      && input !== null && typeof input === "object" && !Array.isArray(input)
      && (input.mode === "form" || input.mode === "openai/form") && input.url === null
      && JSON.stringify(input.requestedSchema) === '{"type":"object"}'
      && /^Allow the paseo MCP server to run tool "[a-z][a-z0-9_]*"\?$/.test(request.description ?? "");
    if (!claudeTool && !codexTool) return;

    await context.paseo.agents.ref(event.agent.id).respondToPermission({
      requestId: request.id,
      response: { behavior: "allow" },
    });
  });
  return unsubscribe;
}
