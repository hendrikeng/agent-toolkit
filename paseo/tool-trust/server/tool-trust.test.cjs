const test = require('node:test');
const assert = require('node:assert/strict');

test('Paseo approvals resolve for Codex and Claude; other permissions remain pending', async () => {
  const { default: contribute } = await import('../index.server.ts');
  let handler;
  let cleaned = false;
  const cleanup = contribute({ on(name, callback) {
    assert.equal(name, 'agent.permission_requested');
    handler = callback;
    return () => { cleaned = true; };
  } });
  const resolutions = [];
  const context = { paseo: { agents: { ref(id) { return { async respondToPermission(response) {
    resolutions.push({ agent: id, ...response });
  } }; } } } };
  const codex = {
    id: 'permission-1', provider: 'codex', name: 'CodexMcpElicitation', kind: 'tool',
    description: 'Allow the paseo MCP server to run tool "inspect_provider"?',
    input: { mode: 'form', requestedSchema: { type: 'object' }, url: null },
    metadata: { serverName: 'paseo' },
  };
  const dispatch = request => handler({ agent: { id: 'agent-1' }, request }, context);
  await dispatch(codex);
  await dispatch({ ...codex, id: 'permission-2', description: 'Allow the paseo MCP server to run tool "create_agent"?' });
  await dispatch({ id: 'permission-3', provider: 'claude', kind: 'tool', name: 'mcp__paseo__inspect_provider' });
  await dispatch({ ...codex, id: 'permission-4', input: { ...codex.input, requestedSchema: { properties: {}, type: 'object' } } });
  assert.deepEqual(resolutions, [1, 2, 3, 4].map(i => ({ agent: 'agent-1', requestId: `permission-${i}`, response: { behavior: 'allow' } })));
  for (const request of [
    { ...codex, metadata: { serverName: 'other' } },
    { ...codex, input: { ...codex.input, mode: 'url', url: 'https://example.com' } },
    { ...codex, input: { ...codex.input, requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } } } },
    ...[null, [], { type: 'object', properties: null }, { type: 'object', properties: [] }, { type: 'object', required: ['answer'] }].map(requestedSchema => ({ ...codex, input: { ...codex.input, requestedSchema } })),
    { ...codex, description: 'Authorize a payment' },
    { ...codex, kind: 'question' },
    { ...codex, name: 'CodexExecCommand' },
    { id: 'other', provider: 'claude', kind: 'tool', name: 'Bash' },
    { id: 'other', provider: 'claude', kind: 'tool', name: 'mcp__other__inspect_provider' },
    { id: 'other', provider: 'claude', kind: 'tool', name: 'mcp__paseo_evil__inspect_provider' },
  ]) await dispatch(request);
  assert.equal(resolutions.length, 4);
  cleanup();
  assert.equal(cleaned, true);
});
