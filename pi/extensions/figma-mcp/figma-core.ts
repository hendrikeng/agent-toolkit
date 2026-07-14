export function isFigmaUseResource(
  resource: { name?: string; title?: string } | undefined,
  uri: string,
): boolean {
  if ([resource?.name, resource?.title].some((value) => value?.trim().toLowerCase() === "figma-use")) return true;
  let decoded = uri;
  try { decoded = decodeURIComponent(uri); } catch { /* Keep the original URI. */ }
  const normalized = decoded.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /(?:^|\/)figma-use(?:\.md|\.skill\.md)?$/.test(normalized) || /(?:^|\/)figma-use\/skill\.md$/.test(normalized);
}

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
