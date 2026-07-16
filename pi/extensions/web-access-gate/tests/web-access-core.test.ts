import assert from "node:assert/strict";
import test from "node:test";
import { WEB_LOADER_TOOL, WEB_TOOL_NAMES, webToolSet } from "../web-access-core.ts";

test("web tools start behind the compact loader", () => {
  assert.deepEqual(
    webToolSet(["read", ...WEB_TOOL_NAMES], [...WEB_TOOL_NAMES], false),
    ["read", WEB_LOADER_TOOL],
  );
});

test("enabling adds only installed web tools and preserves existing tools", () => {
  assert.deepEqual(
    webToolSet(["read", WEB_LOADER_TOOL], ["web_search", "fetch_content"], true),
    ["read", WEB_LOADER_TOOL, "web_search", "fetch_content"],
  );
});

test("repeated toggles stay deduplicated", () => {
  const on = webToolSet(["read", WEB_LOADER_TOOL], [...WEB_TOOL_NAMES], true);
  assert.deepEqual(webToolSet(on, [...WEB_TOOL_NAMES], true), on);
  assert.deepEqual(webToolSet(on, [...WEB_TOOL_NAMES], false), ["read", WEB_LOADER_TOOL]);
});
