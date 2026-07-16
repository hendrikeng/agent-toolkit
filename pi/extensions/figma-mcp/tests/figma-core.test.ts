import assert from "node:assert/strict";
import test from "node:test";
import { parseFigmaUrl } from "../figma-core.ts";

test("parses Figma URLs and normalizes copied node IDs", () => {
  assert.deepEqual(
    parseFigmaUrl("https://www.figma.com/design/abc123/Example?node-id=123-456"),
    { fileKey: "abc123", nodeId: "123:456" },
  );
  assert.deepEqual(
    parseFigmaUrl("https://figma.com/design/original/branch/branchKey/Example?node-id=1%3A2"),
    { fileKey: "branchKey", nodeId: "1:2" },
  );
});

test("rejects non-Figma and malformed URLs", () => {
  assert.deepEqual(parseFigmaUrl("https://example.com/design/secret?node-id=1-2"), {});
  assert.deepEqual(parseFigmaUrl("not a URL"), {});
  assert.deepEqual(parseFigmaUrl(), {});
});
