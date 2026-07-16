export const WEB_TOOL_NAMES = ["web_search", "fetch_content", "get_search_content"] as const;
export const WEB_LOADER_TOOL = "enable_web_access";

export function webToolSet(current: string[], available: string[], enabled: boolean): string[] {
  const webTools = new Set<string>(WEB_TOOL_NAMES);
  const next = current.filter((name) => !webTools.has(name));
  if (enabled) {
    const availableSet = new Set(available);
    for (const name of WEB_TOOL_NAMES) {
      if (availableSet.has(name)) next.push(name);
    }
  }
  if (!next.includes(WEB_LOADER_TOOL)) next.push(WEB_LOADER_TOOL);
  return [...new Set(next)];
}
