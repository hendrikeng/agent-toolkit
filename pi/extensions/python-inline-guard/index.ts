import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Node {
  type: string;
  text: string;
  namedChildren: Node[];
  children: Node[];
  startIndex: number;
  endIndex: number;
  hasError: boolean;
}

// Reuse the permission package's pinned Bash grammar and parser runtime.
async function loadParser() {
  const agentDir = process.env.AGENT_TOOLKIT_PI_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
  const packages = createRequire(join(agentDir, "npm/package.json"));
  const permission = createRequire(packages.resolve("@gotgenes/pi-permission-system"));
  const { Parser, Language } = await import(pathToFileURL(permission.resolve("web-tree-sitter")).href);
  await Parser.init({ locateFile: () => permission.resolve("web-tree-sitter/web-tree-sitter.wasm") });
  const parser = new Parser();
  parser.setLanguage(await Language.load(permission.resolve("tree-sitter-bash/tree-sitter-bash.wasm")));
  return parser as { parse(command: string): { rootNode: Node; delete(): void } | null };
}

function literal(node: Node): string | undefined {
  if (node.text === "-" && node.namedChildren.length === 0) return "-";
  if (node.type === "raw_string") return node.text.slice(1, -1);
  // Bash removes escaped newlines; double quotes only unescape these four characters.
  if (node.type === "string_content") return node.text.replace(/\\([\n$`"\\])/g, (_escape, char) => char === "\n" ? "" : char);
  if (["word", "number"].includes(node.type) && node.namedChildren.length === 0) {
    if (/[*?\[\]{}~]/.test(node.text)) return undefined; // Unquoted shell expansions can change argv or its length.
    return node.text.replace(/\\(.)/gs, (_escape, char) => char === "\n" ? "" : char);
  }
  if (["command_name", "concatenation", "string"].includes(node.type)) {
    const parts = node.namedChildren.map(literal);
    if (parts.every((part) => part !== undefined)) return parts.join("");
  }
  return undefined;
}

const REDIRECT_REASON = "Cannot verify Python arguments around this redirection; put interpreter options and the script/module before redirections.";

function pythonReason(node: Node, redirected: boolean): string | undefined {
  const head = node.namedChildren.find((child) => child.type === "command_name");
  const name = head && literal(head);
  if (name === undefined && head?.text.includes("python")) return "Cannot verify an expanding Python executable name; use a literal interpreter path.";
  if (!name || !/(?:^|\/)python(?:3(?:\.[^/]*)?)?$/.test(name)) return;
  // Reject tokens silently dropped by the grammar, including unquoted continuations.
  let offset = 0;
  for (const child of node.children) {
    if (node.text.slice(offset, child.startIndex - node.startIndex).trim()) return "Cannot verify Python token boundaries; use single-line literal arguments.";
    offset = child.endIndex - node.startIndex;
  }
  if (node.text.slice(offset).trim()) return "Cannot verify Python token boundaries; use single-line literal arguments.";
  const words = node.children.filter((child) => !["command_name", "variable_assignment"].includes(child.type));
  const dynamicReason = "Cannot verify dynamic Python interpreter arguments; use literal options and a script path.";
  for (let i = 0; i < words.length; i++) {
    if (words[i].type.endsWith("_redirect")) return REDIRECT_REASON;
    const arg = literal(words[i]);
    if (arg === undefined) return dynamicReason;
    // The grammar can mistake an adjacent descriptor (0<&-) for a numeric script argument.
    if (redirected && words[i].type === "number") return REDIRECT_REASON;
    if (arg === "--" || arg === "-" || !arg.startsWith("-")) return;
    if (arg.startsWith("--")) {
      if (arg === "--check-hash-based-pycs" && (!words[++i] || literal(words[i]) === undefined)) return dynamicReason;
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if (flag === "c") return "Inline Python (-c, including combined switches) is disabled; run a script file instead.";
      if (flag === "m") return; // Remaining words belong to the module, not the interpreter.
      if (flag === "W" || flag === "X") {
        if (j === arg.length - 1 && (!words[++i] || literal(words[i]) === undefined)) return dynamicReason;
        break;
      }
    }
  }
  if (redirected) return REDIRECT_REASON;
}

function reasonIn(node: Node, redirected = false): string | undefined {
  if (node.hasError && node.text.includes("python")) return "Cannot verify Python options in an unresolved Bash command.";
  const hasRedirect = redirected || node.namedChildren.some((child) => child.type.endsWith("_redirect"));
  if (node.type === "command") {
    const reason = pythonReason(node, hasRedirect);
    if (reason) return reason;
  }
  // Quoted strings have no executions. Heredoc expansions can contain nested substitutions.
  if (node.type === "raw_string") return;
  for (const child of node.namedChildren) {
    // ponytail: ambiguous redirect argv stays blocked; use a complete shell argv model if needed.
    const inheritsRedirect = ["command", "pipeline", "redirected_statement", "subshell", "compound_statement"].includes(child.type);
    const reason = reasonIn(child, inheritsRedirect && hasRedirect);
    if (reason) return reason;
  }
}

export default function pythonInlineGuard(pi: ExtensionAPI) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
  const config = JSON.parse(readFileSync(join(agentDir, "extensions/pi-permission-system/config.json"), "utf8"));
  const shellTools = { ...config.shellTools, bash: { commandArgument: "command" } };
  let parser: ReturnType<typeof loadParser> | undefined;
  pi.on("tool_call", async (event) => {
    const shell = shellTools[event.toolName];
    if (!shell) return;
    parser ??= loadParser().catch((error) => { parser = undefined; throw error; });
    const tree = (await parser).parse(event.input[shell.commandArgument] as string);
    if (!tree) return { block: true, reason: "Cannot parse Bash command to verify Python options." };
    try {
      const reason = reasonIn(tree.rootNode);
      if (reason) return { block: true, reason };
    } finally {
      tree.delete();
    }
  });
}
