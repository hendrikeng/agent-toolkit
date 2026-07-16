export function parseFigmaUrl(raw?: string): { fileKey?: string; nodeId?: string } {
  if (!raw) return {};
  try {
    const url = new URL(raw);
    if (!/(^|\.)figma\.com$/i.test(url.hostname)) return {};
    const parts = url.pathname.split("/").filter(Boolean);
    let fileKey: string | undefined;
    if (["design", "board", "slides", "file"].includes(parts[0] ?? "")) {
      fileKey = parts[1];
      if (parts[2] === "branch" && parts[3]) fileKey = parts[3];
    }
    const rawNodeId = url.searchParams.get("node-id") ?? undefined;
    const nodeId = rawNodeId?.replaceAll("-", ":");
    return { fileKey, nodeId };
  } catch {
    return {};
  }
}
