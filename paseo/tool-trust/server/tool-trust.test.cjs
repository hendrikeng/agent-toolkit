const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The plugin writes its permission log under HOME, so every test runs with a temporary HOME.
// The real path, because the plugin keeps memory paths that pass through a symlink, such as /var on macOS, pending.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tool-trust-')));
const home = process.env.HOME;
test.after(() => {
  process.env.HOME = home;
  fs.rmSync(root, { recursive: true, force: true });
});
const fake = path.join(root, 'home');
fs.mkdirSync(fake);
process.env.HOME = fake;

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

test('Claude edits of its own project auto-memory notes are approved in edit modes; other notes stay pending', async () => {
  // Claude Code names the memory directory of cwd /repo/x "-repo-x". Paseo homes link projects/ to ~/.claude/projects.
  const outside = path.join(root, 'outside');
  const own = path.join(fake, '.claude/projects/-repo-x/memory');
  for (const dir of [own, path.join(fake, '.claude/projects/-repo-y/memory'), path.join(fake, '.claude/projects/-X-main/memory'), path.join(outside, 'projects/-repo-x/memory'),
    path.join(fake, '.paseo/zerosub/homes/claude-abc'), path.join(fake, '.paseo/zerosub/homes/claude-bad')])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), '');
  fs.writeFileSync(path.join(own, 'MEMORY.md'), '');
  fs.symlinkSync(path.join(fake, '.claude/projects'), path.join(fake, '.paseo/zerosub/homes/claude-abc/projects'));
  fs.symlinkSync(path.join(outside, 'projects'), path.join(fake, '.paseo/zerosub/homes/claude-bad/projects'));
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(own, 'link.md'));
  fs.linkSync(path.join(outside, 'secret.md'), path.join(own, 'hard.md'));

  const { default: contribute } = await import('../index.server.ts');
  let handler;
  contribute({ on(name, callback) { handler = callback; return () => {}; } });
  const approved = [];
  // The agent ID doubles as the agent's current mode in the daemon snapshot.
  const context = { paseo: {
    agents: { ref(id) { return {
      async refresh() { return { agent: { currentModeId: id === 'unknown' ? null : id } }; },
      async respondToPermission({ requestId }) { approved.push(requestId); },
    }; } },
    // Paseo's project registry keeps the main checkout of the worktree workspace ws-main.
    workspaces: { ref(id) { return { async refresh() { return id === 'ws-main' ? { projectRootPath: '/X/main' } : null; } }; } },
  } };
  const dispatch = ([name, file, mode = 'auto', provider = 'claude'], agent = { cwd: '/repo/x', workspaceId: null }) => handler({ agent: { id: mode, ...agent }, request: {
    id: `${provider} ${mode} ${name} ${file}`, provider, kind: 'tool', name, input: { file_path: file },
    detail: { type: 'edit', filePath: file },
  } }, context);
  const allowed = [
    ['Edit', `${own}/MEMORY.md`],
    ['Write', `${fake}/.paseo/zerosub/homes/claude-abc/projects/-repo-x/memory/topic.md`, 'default'],
    ['MultiEdit', `${own}/MEMORY.md`, 'acceptEdits'],
  ];
  const pending = [
    ['Edit', `${own}/MEMORY.md`, 'plan'],
    ['Edit', `${own}/MEMORY.md`, 'unknown'],
    ['Edit', `${own}/MEMORY.md`, 'auto', 'codex'],
    ['Bash', `${own}/MEMORY.md`],
    ['Write', `${fake}/.claude/projects/-repo-y/memory/a.md`],
    ['Write', `${fake}/.paseo/zerosub/homes/claude-bad/projects/-repo-x/memory/a.md`],
    ['Write', `${outside}/projects/-repo-x/memory/a.md`],
    ['Write', `${own}/settings.json`],
    ['Write', `${own}/../memory/MEMORY.md`],
    ['Write', `${fake}/.claude/projects/-repo-x/notes.md`],
    ['Edit', `${fake}/.claude/settings.json`],
    ['Edit', `${own}/link.md`],
    ['Edit', `${own}/hard.md`],
  ];
  for (const request of [...allowed, ...pending]) await dispatch(request);
  assert.deepEqual(approved, allowed.map(([name, file, mode = 'auto']) => `claude ${mode} ${name} ${file}`));

  // Claude Code files a worktree agent's memory under the main checkout, so the Paseo project root also counts.
  approved.length = 0;
  const worktree = { cwd: '/wt/feature', workspaceId: 'ws-main' };
  await dispatch(['Write', `${fake}/.claude/projects/-X-main/memory/a.md`], worktree);
  await dispatch(['Write', `${fake}/.claude/projects/-repo-y/memory/a.md`], worktree);
  await dispatch(['Write', `${fake}/.claude/projects/-X-main/memory/a.md`]);
  assert.deepEqual(approved, [`claude auto Write ${fake}/.claude/projects/-X-main/memory/a.md`]);
});

test('Only prompts left pending are logged privately, with paths and command names but no input contents', async () => {
  const dir = path.join(fake, '.local/share/agent-toolkit'), log = path.join(dir, 'permission-log.jsonl');
  fs.rmSync(log, { force: true });
  const { default: contribute } = await import('../index.server.ts');
  let handler;
  contribute({ on(name, callback) { handler = callback; return () => {}; } });
  const context = { paseo: { agents: { ref() { return { async respondToPermission() {} }; } } } };
  const dispatch = request => handler({ agent: { id: 'agent-1' }, request: { provider: 'claude', kind: 'tool', ...request } }, context);
  await dispatch({ id: 'p1', name: 'mcp__paseo__list_agents', input: {} });
  assert.equal(fs.existsSync(log), false);
  // A log from an older plugin version can be readable by others.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(log, '');
  fs.chmodSync(log, 0o644);
  fs.chmodSync(dir, 0o755);
  await dispatch({ id: 'p2', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'secret-old', new_string: 'secret-new' },
    detail: { type: 'edit', filePath: '/repo/a.ts', oldString: 'secret-old', newString: 'secret-new' } });
  await dispatch({ id: 'p3', name: 'Bash', input: { command: 'API_TOKEN=secret-token git push https://secret@host main', description: 'secret-description' } });
  await dispatch({ id: 'p4', name: 'Bash', input: { command: '  /usr/bin/npx playwright test --password=secret' } });
  await dispatch({ id: 'p5', name: 'Bash', input: { command: 'ssh secret-user@secret-host' } });
  await dispatch({ id: 'p5b', name: 'Bash', input: { command: 'AUTH="Bearer secret-quoted" curl https://x' } });
  await dispatch({ id: 'p5c', name: 'Bash', input: { command: 'echo secret-first-arg | cli login' } });
  await dispatch({ id: 'p6', name: 'Write', input: { file_path: `/repo/${'a'.repeat(400)}`, content: 'secret-content' } });
  await dispatch({ id: 'p7', name: 'mcp__paseo__send_agent_prompt', input: { agentId: 'a', prompt: 'secret-prompt' } });
  const text = fs.readFileSync(log, 'utf8');
  assert.doesNotMatch(text, /secret/);
  assert.equal(fs.statSync(log).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  const lines = text.trim().split('\n').map(line => JSON.parse(line));
  for (const line of lines) assert.match(line.time, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(lines.map(({ time, ...line }) => line), [
    { agent: 'agent-1', provider: 'claude', tool: 'Edit', kind: 'tool', summary: '/repo/*.ts' },
    { agent: 'agent-1', provider: 'claude', tool: 'Bash', kind: 'tool', summary: 'git push' },
    { agent: 'agent-1', provider: 'claude', tool: 'Bash', kind: 'tool', summary: 'npx playwright' },
    { agent: 'agent-1', provider: 'claude', tool: 'Bash', kind: 'tool', summary: 'ssh' },
    { agent: 'agent-1', provider: 'claude', tool: 'Bash', kind: 'tool', summary: '(unparsed)' },
    { agent: 'agent-1', provider: 'claude', tool: 'Bash', kind: 'tool', summary: 'echo' },
    { agent: 'agent-1', provider: 'claude', tool: 'Write', kind: 'tool', summary: '/repo/*' },
    { agent: 'agent-1', provider: 'claude', tool: 'mcp__paseo__send_agent_prompt', kind: 'tool' },
  ]);
});
