const test = require('node:test')
const assert = require('node:assert/strict')
const { configurePaseo } = require('./configure.cjs')

test('native Paseo guidance is idempotent and preserves host-owned settings', () => {
  const rules = 'Read repository instructions. Apply Ponytail and Test Audit.\n'
  const original = {
    version: 1,
    daemon: { appendSystemPrompt: 'Human instructions', mcp: { enabled: false, injectIntoAgents: false }, browserTools: { enabled: false }, agentProfiles: [{ name: 'Selected account', provider: 'codex-work', model: 'selected', thinkingOptionId: 'high' }] },
    agents: { providers: {
      'codex-work': { extends: 'codex', label: 'Work', command: ['/custom/codex'], env: { CODEX_HOME: '/accounts/work' }, models: [{ id: 'selected', label: 'Selected' }], paseoTools: { disabledTools: ['kill_agent'] }, options: { sandbox_mode: 'read-only' } },
      claude: { env: { CLAUDE_CONFIG_DIR: '/accounts/claude' }, enabled: false },
      pi: { command: ['/custom/pi'] },
    } },
    worktrees: { root: '/existing/worktrees' },
    pluginsEnabled: false,
  }
  const source = JSON.stringify(original, null, 2) + '\n'
  const updated = configurePaseo(source, rules, '/fixture')
  const settings = JSON.parse(updated)
  assert.ok(settings.daemon.appendSystemPrompt.startsWith('Human instructions\n\n'))
  assert.ok(settings.daemon.appendSystemPrompt.includes('Orchestration host: Paseo'))
  assert.equal(settings.daemon.appendSystemPrompt.split(rules).length, 2, 'inject shared instructions exactly once')
  assert.deepEqual(settings.daemon.mcp, { enabled: true, injectIntoAgents: true })
  assert.deepEqual(settings.daemon.agentProfiles, original.daemon.agentProfiles)
  assert.deepEqual(settings.daemon.browserTools, original.daemon.browserTools)
  assert.deepEqual(settings.agents.providers['codex-work'], { ...original.agents.providers['codex-work'], env: { CODEX_HOME: '/accounts/work', AGENT_TOOLKIT_ORCHESTRATION_HOST: 'paseo' } })
  assert.deepEqual(settings.agents.providers.claude, { ...original.agents.providers.claude, env: { CLAUDE_CONFIG_DIR: '/accounts/claude', AGENT_TOOLKIT_ORCHESTRATION_HOST: 'paseo' } })
  assert.deepEqual(settings.agents.providers.codex, { env: { AGENT_TOOLKIT_ORCHESTRATION_HOST: 'paseo' } })
  assert.deepEqual(settings.agents.providers.pi, original.agents.providers.pi)
  assert.deepEqual(settings.worktrees, original.worktrees)
  assert.equal(settings.pluginsEnabled, false)
  assert.equal(configurePaseo(updated, rules, '/fixture'), updated)

  settings.daemon.appendSystemPrompt += '\nHuman tail'
  const refreshed = JSON.parse(configurePaseo(JSON.stringify(settings), 'Updated shared instructions\n', '/fixture'))
  assert.ok(refreshed.daemon.appendSystemPrompt.startsWith('Human instructions\n\n'))
  assert.ok(refreshed.daemon.appendSystemPrompt.endsWith('\nHuman tail'))
  assert.ok(!refreshed.daemon.appendSystemPrompt.includes(rules))
  assert.equal(refreshed.daemon.appendSystemPrompt.split('Orchestration host: Paseo').length, 2)

  const defaults = JSON.parse(configurePaseo('{"version":1}', rules, '/fixture'))
  assert.equal(defaults.worktrees.root, '/fixture/Code/paseo-worktrees')
  for (const prompt of [
    settings.daemon.appendSystemPrompt.replace(rules, 'Edited managed instructions\n'),
    settings.daemon.appendSystemPrompt + settings.daemon.appendSystemPrompt,
    '<!-- agent-toolkit:paseo broken -->',
    settings.daemon.appendSystemPrompt + '<!-- agent-toolkit:paseo broken -->',
  ]) assert.throws(() => configurePaseo(JSON.stringify({ daemon: { appendSystemPrompt: prompt } }), rules), /changed or malformed/)
  for (const config of ['{', '[]', '{"version":2}']) assert.throws(() => configurePaseo(config, rules), /Invalid Paseo config/)
  assert.throws(() => configurePaseo(JSON.stringify({ daemon: { appendSystemPrompt: rules } }), rules), /duplicate instructions/)
  assert.throws(() => configurePaseo('{"agents":{"providers":{"codex-work":{"extends":"codex","env":{"AGENT_TOOLKIT_ORCHESTRATION_HOST":"orca"}}}}}', rules), /Conflicting orchestration owner/)
})
