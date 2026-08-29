import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WEB_LOADER_TOOL, WEB_TOOL_NAMES, webToolSet } from "./web-access-core.ts";

export default function webAccessGate(pi: ExtensionAPI) {
  const availableWebTools = () => {
    const names = new Set(pi.getAllTools().map((tool) => tool.name));
    return WEB_TOOL_NAMES.filter((name) => names.has(name));
  };

  const isEnabled = () => WEB_TOOL_NAMES.some((name) => pi.getActiveTools().includes(name));

  const setEnabled = (enabled: boolean, ctx?: ExtensionContext) => {
    const available = availableWebTools();
    pi.setActiveTools(webToolSet(pi.getActiveTools(), available, enabled));
    ctx?.ui.setStatus("web-access", enabled ? ctx.ui.theme.fg("accent", "| 🌐 WEB") : undefined);
    return available;
  };

  pi.registerTool({
    name: WEB_LOADER_TOOL,
    label: "Enable Web Access",
    description:
      "Enable Pi's web_search, fetch_content, and stored-result tools for this session. Use only when the task needs current information, external documentation, URL content, or fact-checking that local files cannot provide.",
    parameters: Type.Object({}),
    async execute() {
      const available = setEnabled(true);
      if (available.length === 0) {
        throw new Error("pi-web-access is not installed or did not load.");
      }
      return {
        content: [{ type: "text", text: `Web access enabled for this session: ${available.join(", ")}` }],
        details: { enabled: true, tools: available },
      };
    },
  });

  pi.registerCommand("web", {
    description: "Control lazy web tools: /web on, off, status",
    getArgumentCompletions(prefix) {
      const values = ["on", "off", "status"];
      const matches = values.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (rawArgs, ctx) => {
      const command = rawArgs.trim().toLowerCase() || "status";
      if (command === "status") {
        const available = availableWebTools();
        ctx.ui.notify(
          `Web access: ${isEnabled() ? "on" : "off"}; available: ${available.join(", ") || "none"}`,
          isEnabled() ? "info" : "warning",
        );
        return;
      }
      if (command === "off") {
        setEnabled(false, ctx);
        ctx.ui.notify("Web access off; only the compact loader remains available.", "info");
        return;
      }
      if (command === "on") {
        const available = setEnabled(true, ctx);
        if (available.length === 0) {
          ctx.ui.notify("pi-web-access is not installed or did not load.", "error");
          return;
        }
        ctx.ui.notify(`Web access on: ${available.join(", ")}`, "info");
        return;
      }
      ctx.ui.notify("Usage: /web on | off | status", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    setEnabled(false, ctx);
  });
}
