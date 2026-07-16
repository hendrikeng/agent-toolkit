import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isFigmaUseResource, parseFigmaUrl } from "./figma-core.ts";

const TOOL_NAME = "figma_mcp";
const LOCAL_URL = "http://127.0.0.1:3845/mcp";
const REMOTE_URL = "https://mcp.figma.com/mcp";
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const configuredAgentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const expandedAgentDir =
  configuredAgentDir === "~"
    ? homedir()
    : configuredAgentDir.startsWith("~/")
      ? join(homedir(), configuredAgentDir.slice(2))
      : configuredAgentDir;
const AUTH_DIR = join(resolve(expandedAgentDir), "mcp-auth");
const OAUTH_ENV_VARS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "XAUTHORITY",
  "BROWSER",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

type Endpoint = "local" | "remote";
type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    [key: string]: unknown;
  };
};

type McpResource = {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

type McpClient = {
  connect(transport: unknown, options?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
  listTools(params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ tools: McpTool[] }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: Record<string, unknown>,
  ): Promise<any>;
  listResources(params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ resources: McpResource[] }>;
  readResource(params: { uri: string }, options?: Record<string, unknown>): Promise<any>;
  getInstructions(): string | undefined;
  onclose?: () => void;
  onerror?: (error: Error) => void;
};

type McpTransport = {
  close(): Promise<void>;
  stderr?: NodeJS.ReadableStream | null;
};

type ToolParams = {
  action:
    | "catalog"
    | "schema"
    | "call"
    | "inspect"
    | "screenshot"
    | "variables"
    | "metadata"
    | "figjam"
    | "resources"
    | "resource";
  tool?: string;
  arguments?: Record<string, unknown>;
  url?: string;
  nodeId?: string;
  uri?: string;
  name?: string;
  clientLanguages?: string;
  clientFrameworks?: string;
  forceCode?: boolean;
  contentsOnly?: boolean;
  includeImagesOfNodes?: boolean;
};

const PARAMETERS = Type.Object({
  action: StringEnum(
    [
      "catalog",
      "schema",
      "call",
      "inspect",
      "screenshot",
      "variables",
      "metadata",
      "figjam",
      "resources",
      "resource",
    ] as const,
    { description: "Use aliases for common reads; use schema then call for other MCP tools." },
  ),
  tool: Type.Optional(Type.String({ description: "MCP tool name for schema or call." })),
  arguments: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for a generic MCP tool call." }),
  ),
  url: Type.Optional(Type.String({ description: "Figma design, board, or slides URL." })),
  nodeId: Type.Optional(Type.String({ description: "Figma node ID, for example 123:456." })),
  uri: Type.Optional(Type.String({ description: "Exact MCP resource URI." })),
  name: Type.Optional(Type.String({ description: "Resource name or URI substring." })),
  clientLanguages: Type.Optional(Type.String()),
  clientFrameworks: Type.Optional(Type.String()),
  forceCode: Type.Optional(Type.Boolean()),
  contentsOnly: Type.Optional(Type.Boolean()),
  includeImagesOfNodes: Type.Optional(Type.Boolean()),
});

function oauthEnvironment(): Record<string, string> {
  const env: Record<string, string> = { MCP_REMOTE_CONFIG_DIR: AUTH_DIR };
  for (const key of OAUTH_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function compactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstSentence(value?: string, max = 150): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? normalized;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1)}…`;
}

function summarizeCatalog(tools: McpTool[], endpoint: Endpoint, instructions?: string): string {
  const lines = tools.map((tool) => {
    const mode = tool.annotations?.readOnlyHint ? "read" : tool.annotations?.destructiveHint ? "destructive" : "action";
    return `- ${tool.name} [${mode}]${tool.description ? ` — ${firstSentence(tool.description)}` : ""}`;
  });
  const header = `Figma MCP (${endpoint}) exposes ${tools.length} tool(s). Use action=schema before unfamiliar generic calls.`;
  const serverNote = instructions ? `\nServer note: ${firstSentence(instructions, 400)}` : "";
  return `${header}\n${lines.join("\n")}${serverNote}`;
}

function stringifyContentItem(item: any): string | undefined {
  if (!item || typeof item !== "object") return String(item);
  if (item.type === "text") return String(item.text ?? "");
  if (item.type === "resource_link") return `[Resource: ${item.title ?? item.name ?? item.uri}] ${item.uri}`;
  if (item.type === "resource") {
    const resource = item.resource ?? {};
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.blob === "string") return `[Binary resource: ${resource.uri ?? "unknown"} (${resource.mimeType ?? "unknown"})]`;
  }
  if (item.type === "audio") return `[Audio result omitted: ${item.mimeType ?? "unknown"}]`;
  if (item.type !== "image") return JSON.stringify(item);
  return undefined;
}

async function truncateForContext(text: string): Promise<{ text: string; file?: string }> {
  const truncated = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!truncated.truncated) return { text: truncated.content };

  const outputDir = await mkdtemp(join(tmpdir(), "pi-figma-mcp-"));
  const file = join(outputDir, `${Date.now()}-${randomUUID()}.txt`);
  await writeFile(file, text, { encoding: "utf8", mode: 0o600 });
  const note = `\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)}/${formatSize(truncated.totalBytes)}. Full output: ${file}]`;
  return { text: truncated.content + note, file };
}

function toolArguments(tool: McpTool, params: ToolParams): Record<string, unknown> {
  const parsed = parseFigmaUrl(params.url);
  const candidates: Record<string, unknown> = {
    url: params.url,
    fileKey: parsed.fileKey,
    nodeId:
      params.nodeId ??
      parsed.nodeId ??
      (params.action === "figjam" && tool.inputSchema.required?.includes("nodeId") ? "0:1" : undefined),
    clientLanguages: params.clientLanguages ?? "unknown",
    clientFrameworks: params.clientFrameworks ?? "unknown",
    forceCode: params.forceCode,
    contentsOnly: params.contentsOnly,
    includeImagesOfNodes: params.includeImagesOfNodes,
  };
  const properties = tool.inputSchema.properties ?? {};
  return Object.fromEntries(
    Object.entries(candidates).filter(([key, value]) => value !== undefined && Object.hasOwn(properties, key)),
  );
}

export default function figmaMcpExtension(pi: ExtensionAPI) {
  let desiredEndpoint: Endpoint | undefined;
  let connectedEndpoint: Endpoint | undefined;
  let client: McpClient | undefined;
  let transport: McpTransport | undefined;
  let tools = new Map<string, McpTool>();
  let resources: McpResource[] | undefined;
  let connectPromise: Promise<void> | undefined;
  let pendingTransport: McpTransport | undefined;
  let connectAbort: AbortController | undefined;
  let connectionEpoch = 0;
  let lastError: string | undefined;
  let stderrTail = "";
  let figmaUseGuidanceLoaded = false;

  const setStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus("figma-mcp", connectedEndpoint ? `figma:${connectedEndpoint}` : undefined);
  };

  const setToolActive = (active: boolean) => {
    const current = pi.getActiveTools();
    const next = active
      ? [...new Set([...current, TOOL_NAME])]
      : current.filter((name) => name !== TOOL_NAME);
    pi.setActiveTools(next);
  };

  const clearConnection = () => {
    client = undefined;
    transport = undefined;
    connectedEndpoint = undefined;
    tools = new Map();
    resources = undefined;
    figmaUseGuidanceLoaded = false;
  };

  const disconnect = async (keepDesired = false) => {
    connectionEpoch += 1;
    connectAbort?.abort();
    connectAbort = undefined;
    const pending = connectPromise;
    connectPromise = undefined;
    const inFlightTransport = pendingTransport;
    pendingTransport = undefined;
    if (!keepDesired) desiredEndpoint = undefined;
    await inFlightTransport?.close().catch(() => undefined);
    if (pending) await pending.catch(() => undefined);
    const oldClient = client;
    const oldTransport = transport;
    clearConnection();
    if (oldClient) await oldClient.close().catch(() => undefined);
    else await oldTransport?.close().catch(() => undefined);
  };

  const connect = async (endpoint: Endpoint): Promise<void> => {
    if (client && connectedEndpoint === endpoint) return;
    if (connectPromise) {
      await connectPromise;
      if (client && connectedEndpoint === endpoint) return;
    }

    const epoch = ++connectionEpoch;
    const controller = new AbortController();
    connectAbort = controller;
    desiredEndpoint = endpoint;
    lastError = undefined;
    stderrTail = "";
    const oldClient = client;
    const oldTransport = transport;
    clearConnection();

    const pending = (async () => {
      if (oldClient) await oldClient.close().catch(() => undefined);
      else await oldTransport?.close().catch(() => undefined);

      const [{ Client }, transportModule] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        endpoint === "local"
          ? import("@modelcontextprotocol/sdk/client/streamableHttp.js")
          : import("@modelcontextprotocol/sdk/client/stdio.js"),
      ]);

      const nextClient = new Client({ name: "pi-figma", version: "0.1.0" }) as unknown as McpClient;
      let nextTransport: McpTransport;

      if (endpoint === "local") {
        const { StreamableHTTPClientTransport } = transportModule as typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        nextTransport = new StreamableHTTPClientTransport(new URL(LOCAL_URL)) as unknown as McpTransport;
      } else {
        const { StdioClientTransport } = transportModule as typeof import("@modelcontextprotocol/sdk/client/stdio.js");
        const proxy = resolve(EXTENSION_DIR, "node_modules", "mcp-remote", "dist", "proxy.js");
        nextTransport = new StdioClientTransport({
          command: "node",
          args: [
            proxy,
            REMOTE_URL,
            "--transport",
            "http-only",
            "--auth-timeout",
            "120",
            "--enable-proxy",
            "--silent",
          ],
          // The MCP SDK adds safe HOME/PATH defaults. Add only OAuth browser/proxy/TLS variables, never provider credentials.
          env: oauthEnvironment(),
          stderr: "pipe",
        }) as unknown as McpTransport;
        nextTransport.stderr?.on("data", (chunk) => {
          stderrTail = `${stderrTail}${String(chunk)}`.slice(-8192);
        });
      }

      pendingTransport = nextTransport;
      if (controller.signal.aborted) throw new Error("Figma connection cancelled.");

      nextClient.onerror = (error) => {
        lastError = compactError(error);
      };
      nextClient.onclose = () => {
        if (client === nextClient) clearConnection();
      };

      try {
        await nextClient.connect(nextTransport, {
          signal: controller.signal,
          timeout: endpoint === "remote" ? 180_000 : 15_000,
        });
        const result = await nextClient.listTools({}, { signal: controller.signal, timeout: 30_000 });
        if (controller.signal.aborted || connectionEpoch !== epoch || desiredEndpoint !== endpoint) {
          if (!controller.signal.aborted) await nextClient.close().catch(() => undefined);
          throw new Error("Figma connection was superseded.");
        }
        client = nextClient;
        transport = nextTransport;
        connectedEndpoint = endpoint;
        tools = new Map(result.tools.map((tool) => [tool.name, tool]));
      } catch (error) {
        if (!controller.signal.aborted) await nextClient.close().catch(() => undefined);
        const suffix = stderrTail.trim() ? ` (${stderrTail.trim().split("\n").at(-1)})` : "";
        throw new Error(`${compactError(error)}${suffix}`);
      }
    })();
    connectPromise = pending;

    try {
      await pending;
    } finally {
      if (connectPromise === pending) connectPromise = undefined;
      if (connectAbort === controller) connectAbort = undefined;
      if (pendingTransport === transport || !connectedEndpoint) pendingTransport = undefined;
    }
  };

  const ensureConnected = async (): Promise<McpClient> => {
    if (!desiredEndpoint) throw new Error("Figma is off. Run /figma on first.");
    if (!client || connectedEndpoint !== desiredEndpoint) await connect(desiredEndpoint);
    if (!client) throw new Error(lastError ?? "Could not connect to Figma MCP.");
    return client;
  };

  const listResources = async (activeClient: McpClient): Promise<McpResource[]> => {
    if (!resources) {
      const result = await activeClient.listResources({}, { timeout: 30_000 });
      resources = result.resources;
    }
    return resources;
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "Figma MCP",
    description:
      "Token-efficient, on-demand Figma access. Common reads use inspect/screenshot/variables/metadata/figjam. Use catalog, then schema and call for other remote tools. Use resources/resource to load Figma guidance only when needed.",
    promptSnippet: "Inspect or modify Figma through the currently enabled MCP connection",
    promptGuidelines: [
      "Use figma_mcp only when Figma access is enabled; prefer its compact aliases for common reads.",
      "Before a generic figma_mcp call, inspect catalog and schema rather than guessing arguments.",
      "Before calling Figma's use_figma write tool, load the relevant official Figma skill with figma_mcp resource and include its required skillNames value.",
    ],
    parameters: PARAMETERS,
    executionMode: "parallel",
    prepareArguments(args) {
      if (!args || typeof args !== "object") return args as any;
      const input = args as Record<string, unknown>;
      if (typeof input.arguments === "string") {
        try {
          return { ...input, arguments: JSON.parse(input.arguments) };
        } catch {
          return input;
        }
      }
      return input;
    },
    async execute(_toolCallId, rawParams, signal, onUpdate) {
      const params = rawParams as ToolParams;
      const activeClient = await ensureConnected();

      if (params.action === "catalog") {
        return {
          content: [{ type: "text", text: summarizeCatalog([...tools.values()], connectedEndpoint!, activeClient.getInstructions()) }],
          details: { endpoint: connectedEndpoint, toolCount: tools.size },
        };
      }

      if (params.action === "schema") {
        if (!params.tool) throw new Error("action=schema requires tool.");
        const selected = tools.get(params.tool);
        if (!selected) throw new Error(`Unknown Figma MCP tool: ${params.tool}. Use action=catalog.`);
        const text = JSON.stringify(
          {
            name: selected.name,
            description: selected.description,
            annotations: selected.annotations,
            inputSchema: selected.inputSchema,
          },
          null,
          2,
        );
        const output = await truncateForContext(text);
        return { content: [{ type: "text", text: output.text }], details: { endpoint: connectedEndpoint, tool: selected.name, fullOutput: output.file } };
      }

      if (params.action === "resources") {
        const available = await listResources(activeClient);
        const text = available.length
          ? available
              .map((resource) => `- ${resource.title ?? resource.name ?? resource.uri} — ${resource.uri}${resource.description ? ` — ${firstSentence(resource.description)}` : ""}`)
              .join("\n")
          : "Figma MCP exposes no resources on this endpoint.";
        return { content: [{ type: "text", text }], details: { endpoint: connectedEndpoint, resourceCount: available.length } };
      }

      if (params.action === "resource") {
        const available = await listResources(activeClient);
        let uri = params.uri;
        if (!uri && params.name) {
          const query = params.name.toLowerCase();
          const matches = available.filter((resource) =>
            [resource.uri, resource.name, resource.title].some((value) => value?.toLowerCase().includes(query)),
          );
          if (matches.length !== 1) {
            throw new Error(matches.length ? `Resource name is ambiguous: ${matches.map((item) => item.uri).join(", ")}` : `No resource matches: ${params.name}`);
          }
          uri = matches[0].uri;
        }
        if (!uri) throw new Error("action=resource requires uri or name.");
        const result = await activeClient.readResource({ uri }, { signal, timeout: 60_000 });
        const text = (result.contents ?? [])
          .map((item: any) => (typeof item.text === "string" ? item.text : `[Binary resource: ${item.uri ?? uri}]`))
          .join("\n\n");
        const output = await truncateForContext(text || "Resource is empty.");
        const selectedResource = available.find((resource) => resource.uri === uri);
        if (!output.file && isFigmaUseResource(selectedResource, uri)) figmaUseGuidanceLoaded = true;
        return { content: [{ type: "text", text: output.text }], details: { endpoint: connectedEndpoint, uri, fullOutput: output.file } };
      }

      const aliases: Record<string, string> = {
        inspect: "get_design_context",
        screenshot: "get_screenshot",
        variables: "get_variable_defs",
        metadata: "get_metadata",
        figjam: "get_figjam",
      };
      const remoteToolName = params.action === "call" ? params.tool : aliases[params.action];
      if (!remoteToolName) throw new Error(`Unsupported action: ${params.action}`);
      const selected = tools.get(remoteToolName);
      if (!selected) {
        const hint = connectedEndpoint === "local" ? "Try /figma on remote for write and remote-only tools." : "Use action=catalog.";
        throw new Error(`Figma endpoint does not expose ${remoteToolName}. ${hint}`);
      }
      if (params.action === "call" && !params.tool) throw new Error("action=call requires tool.");

      const callArguments =
        params.action === "call" ? (params.arguments ?? {}) : toolArguments(selected, params);
      if (remoteToolName === "use_figma") {
        const skillNames =
          typeof callArguments.skillNames === "string"
            ? callArguments.skillNames.split(",").map((name) => name.trim())
            : [];
        if (!figmaUseGuidanceLoaded || !skillNames.includes("resource:figma-use")) {
          throw new Error(
            "use_figma requires the complete official figma-use resource to be loaded in this connection and skillNames to include resource:figma-use.",
          );
        }
      }

      const result = await activeClient.callTool(
        { name: remoteToolName, arguments: callArguments },
        undefined,
        {
          signal,
          timeout: 120_000,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: 600_000,
          onprogress: (progress: any) => {
            const label = progress?.message ?? `${progress?.progress ?? "…"}${progress?.total ? `/${progress.total}` : ""}`;
            onUpdate?.({ content: [{ type: "text", text: `${remoteToolName}: ${label}` }], details: { endpoint: connectedEndpoint, tool: remoteToolName } });
          },
        },
      );

      if (result?.isError) {
        const message = (result.content ?? []).map(stringifyContentItem).filter(Boolean).join("\n") || `${remoteToolName} failed.`;
        const output = await truncateForContext(message);
        throw new Error(output.text);
      }

      const images = (result?.content ?? [])
        .filter((item: any) => item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string")
        .map((item: any) => ({ type: "image" as const, data: item.data, mimeType: item.mimeType }));
      const textParts = (result?.content ?? []).map(stringifyContentItem).filter((item: unknown): item is string => typeof item === "string" && item.length > 0);
      if (!textParts.length && result?.structuredContent) textParts.push(JSON.stringify(result.structuredContent, null, 2));
      const output = await truncateForContext(textParts.join("\n\n") || `${remoteToolName} completed.`);

      return {
        content: [{ type: "text" as const, text: output.text }, ...images],
        details: {
          endpoint: connectedEndpoint,
          tool: remoteToolName,
          imageCount: images.length,
          fullOutput: output.file,
        },
      };
    },
  });

  pi.registerCommand("figma", {
    description: "Toggle token-efficient Figma MCP: /figma on [local|remote], off, status, tools",
    getArgumentCompletions(prefix) {
      const values = ["on", "on local", "on remote", "off", "status", "tools"];
      const matches = values.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (rawArgs, ctx) => {
      const [command = "status", requestedEndpoint] = rawArgs.trim().toLowerCase().split(/\s+/);

      if (command === "off") {
        setToolActive(false);
        await disconnect(false);
        setStatus(ctx);
        ctx.ui.notify("Figma MCP off; its tool schema is no longer sent to the model.", "info");
        return;
      }

      if (command === "status") {
        const state = connectedEndpoint ? `on (${connectedEndpoint}, ${tools.size} MCP tools behind 1 Pi tool)` : desiredEndpoint ? `reconnecting (${desiredEndpoint})` : "off";
        ctx.ui.notify(`Figma MCP: ${state}${lastError ? ` — last error: ${lastError}` : ""}`, connectedEndpoint ? "info" : "warning");
        return;
      }

      if (command === "tools") {
        if (!desiredEndpoint) {
          ctx.ui.notify("Figma MCP is off. Run /figma on first.", "warning");
          return;
        }
        const activeClient = await ensureConnected();
        ctx.ui.notify(summarizeCatalog([...tools.values()], connectedEndpoint!, activeClient.getInstructions()), "info");
        return;
      }

      if (command !== "on") {
        ctx.ui.notify("Usage: /figma on [local|remote] | off | status | tools", "warning");
        return;
      }

      let endpoint: Endpoint | undefined;
      if (["local", "desktop", "read"].includes(requestedEndpoint)) endpoint = "local";
      if (["remote", "write"].includes(requestedEndpoint)) endpoint = "remote";
      if (!endpoint && ctx.hasUI) {
        const choice = await ctx.ui.select("Figma connection", [
          "Local desktop — fastest, current selection, read-only",
          "Remote — OAuth, links, read and write",
        ]);
        if (!choice) return;
        endpoint = choice.startsWith("Local") ? "local" : "remote";
      }
      endpoint ??= "local";

      ctx.ui.notify(endpoint === "remote" ? "Connecting to Figma remote; your browser may open for OAuth…" : "Connecting to the Figma desktop MCP…", "info");
      try {
        await connect(endpoint);
        setToolActive(true);
        setStatus(ctx);
        ctx.ui.notify(
          `Figma MCP on (${endpoint}): ${tools.size} server tools are hidden behind one compact Pi tool.`,
          "info",
        );
      } catch (error) {
        setToolActive(false);
        await disconnect(false);
        setStatus(ctx);
        ctx.ui.notify(`Figma connection failed: ${compactError(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    setToolActive(false);
    await disconnect(false);
    setStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    setToolActive(false);
    await disconnect(false);
  });
}
