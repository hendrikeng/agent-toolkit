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
  await dispatch({ ...codex, id: 'permission-2', description: 'Allow the paseo MCP server to run tool "archive_agent"?' });
  await dispatch({ id: 'permission-3', provider: 'claude', kind: 'tool', name: 'mcp__paseo__inspect_provider' });
  await dispatch({ ...codex, id: 'permission-4', input: { ...codex.input, requestedSchema: { properties: {}, type: 'object' } } });
  assert.deepEqual(resolutions, [1, 2, 3, 4].map(i => ({ agent: 'agent-1', requestId: `permission-${i}`, response: { behavior: 'allow' } })));
  for (const request of [
    { ...codex, metadata: { serverName: 'other' } },
    { ...codex, input: { ...codex.input, mode: 'url', url: 'https://example.com' } },
    { ...codex, input: { ...codex.input, requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } } } },
    ...[null, [], { type: 'object', properties: null }, { type: 'object', properties: [] }, { type: 'object', required: ['answer'] }].map(requestedSchema => ({ ...codex, input: { ...codex.input, requestedSchema } })),
    { ...codex, description: 'Authorize a payment' },
    ...['send_terminal_keys', 'capture_terminal', 'create_agent', 'update_agent', 'set_agent_mode', 'send_agent_prompt'].map(tool => ({ ...codex, description: `Allow the paseo MCP server to run tool "${tool}"?` })),
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

test('Claude approvals cover only listed Paseo tools in modes that keep native approvals', async () => {
  const { default: contribute } = await import('../index.server.ts');
  let handler;
  contribute({ on(name, callback) { handler = callback; return () => {}; } });
  const approved = [];
  const context = { paseo: { agents: { ref() { return { async respondToPermission({ requestId }) { approved.push(requestId); } }; } } } };
  const dispatch = (name, input) => handler({ agent: { id: 'agent-1' }, request: { id: `${name} ${JSON.stringify(input)}`, provider: 'claude', kind: 'tool', name: `mcp__paseo__${name}`, input } }, context);
  const allowed = [
    ['list_agents', {}],
    ['create_agent', { title: 't', provider: 'claude/x', initialPrompt: 'p', settings: { modeId: 'auto' } }],
    ['update_agent', { agentId: 'a', settings: { modeId: 'plan' } }],
    ['set_agent_mode', { agentId: 'a', modeId: 'auto-review' }],
  ];
  const pending = [
    ['create_agent', { title: 't', provider: 'claude/x', initialPrompt: 'p', settings: { modeId: 'bypassPermissions' } }],
    ['create_agent', { title: 't', provider: 'claude/x', initialPrompt: 'p' }],
    ['create_agent', { title: 't', provider: 'claude/x', initialPrompt: 'p', modeId: 'auto' }],
    ['update_agent', { agentId: 'a', name: 'n' }],
    ['send_agent_prompt', { agentId: 'a', prompt: 'p', sessionMode: 'plan' }],
    ['capture_terminal', { terminalId: 't' }],
    ['update_agent', { agentId: 'a', settings: { modeId: 'bypassPermissions' } }],
    ['set_agent_mode', { agentId: 'a', modeId: ['auto'] }],
    ['send_terminal_keys', { terminalId: 't', keys: 'rm -rf ~' }],
    ['browser_evaluate', { script: 'document.cookie' }],
    ['respond_to_permission', {}],
    ['archive_workspace', { workspaceId: 'w' }],
  ];
  for (const [name, input] of [...allowed, ...pending]) await dispatch(name, input);
  assert.deepEqual(approved, allowed.map(([name, input]) => `${name} ${JSON.stringify(input)}`));
});
