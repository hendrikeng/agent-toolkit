const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { planInstall, install } = require('./install.cjs')

test('fresh native Pi SDK loads copied skill bodies and shared guidance, with review mode applied to the actual request', t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-native-pi-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const plan = planInstall({ home, repo: path.resolve(__dirname, '..') })
  if (!plan.options.installPi) { t.skip('Pi CLI absent; native SDK behavior unverified'); return }
  install(plan, () => {}) // Downloading dependencies is outside this check.
  const sdk = path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent/dist/index.js')
  const source = `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
    globalThis.fetch = async () => { throw Error('Network is disabled in this fixture'); };
    const { createAgentSession, ModelRuntime, DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(process.argv[1]).href);
    const home = process.env.HOME, agentDir = process.env.PI_CODING_AGENT_DIR;
    const settings = SettingsManager.inMemory({ packages: [], cacheWarming: { enabled: false }, retry: { enabled: false } });
    const resources = new DefaultResourceLoader({ cwd: home, agentDir, settingsManager: settings, noThemes: true, noPromptTemplates: true });
    await resources.reload();
    assert.deepEqual(resources.getExtensions().errors, []);
    const models = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
    await models.setRuntimeApiKey('openai', 'fixture-never-sent');
    const model = models.getModels('openai')[0];
    assert.ok(model);
    const { session } = await createAgentSession({ cwd: home, agentDir, modelRuntime: models, model, tools: ['read'], resourceLoader: resources, settingsManager: settings, sessionManager: SessionManager.inMemory(home) });
    const requests = [], errors = [];
    let nextRequest;
    session.agent.streamFunction = (_model, context) => { requests.push(context); nextRequest?.(); throw Error('Fixture transport stops before a model call'); };
    await session.bindExtensions({ mode: 'rpc', onError: error => errors.push(error) });
    try {
      await session.prompt('/reviews off');
      await session.prompt('/skill:ponytail full');
      const request = requests.at(-1);
      assert.ok(request);
      const system = request.messages.find(m => m.role === 'system').content;
      assert.match(system, /Read repository instructions before work/);
      const englishLocation = join(home, '.agents/skills/simple-english/SKILL.md');
      assert.ok(system.includes(englishLocation), 'Simple English must be visible in the native model skill catalog for automatic selection');
      assert.equal(realpathSync(englishLocation), join(home, '.local/share/agent-toolkit/resources/skills/simple-english/SKILL.md'));
      assert.match(system, /SESSION REVIEW MODE IS OFF/);
      assert.ok(!system.includes('Before choosing a worker, read'));
      assert.ok(!system.includes("Follow Orca's settlement"));
      const text = request.messages.filter(m => m.role === 'user').flatMap(m => m.content).filter(c => c.type === 'text').map(c => c.text).join('\\n');
      assert.match(text, /The ladder shortens the/);
      const location = text.match(/location="([^"]+)"/)[1];
      assert.equal(realpathSync(location), join(home, '.local/share/agent-toolkit/resources/skills/ponytail/SKILL.md'));
      await session.prompt('/skill:test-audit inspect a test');
      const audit = requests.at(-1).messages.at(-1).content.map(c => c.text ?? '').join('');
      assert.match(audit, /What credible regression makes it fail/);
      const englishReady = new Promise(resolve => { nextRequest = resolve; });
      await session.prompt('/simple-english check README.md');
      await englishReady;
      await session.waitForIdle();
      const english = requests.at(-1).messages.at(-1).content.map(c => c.text ?? '').join('');
      assert.match(english, /<skill name="simple-english"/);
      assert.match(english, /Do not modify files/);
      for (const name of ['ponytail-audit', 'ponytail-debt', 'ponytail-help']) {
        await session.prompt('/skill:' + name);
        await session.waitForIdle();
        const expanded = requests.at(-1).messages.at(-1).content.map(c => c.text ?? '').join('');
        const copied = join(home, '.local/share/agent-toolkit/resources/skills', name, 'SKILL.md');
        assert.ok(expanded.includes('<skill name="' + name + '"'));
        assert.equal(realpathSync(expanded.match(/location="([^"]+)"/)[1]), copied);
        const body = readFileSync(copied, 'utf8').replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n/, '').trim();
        assert.ok(expanded.includes(body), name + ' must expand its full copied body');
      }
      assert.deepEqual(errors, []);
      writeFileSync(join(agentDir, 'active-codex-account.json'), JSON.stringify({ profile: 'missing-account' }));
      let stopped = false;
      await session.bindExtensions({ mode: 'rpc', shutdownHandler: () => { stopped = true; } });
      assert.equal(stopped, true, 'Native session startup must refuse fallback from a missing selected account');
    } finally { session.dispose(); }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, sdk], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? os.tmpdir(), HOME: home, PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'), XDG_CONFIG_HOME: path.join(home, '.config') },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
