// Run with the installed DeepSeek desktop executable, ELECTRON_RUN_AS_NODE=1,
// and --expose-internals. Uses that app's actual profile boot, agent loop,
// native observer and Rill emitter. The model reply
// is deterministic; no provider request or user history is involved.
// Arguments: <desktop profile directory> <rillbuddy-emit.exe>
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

async function main() {
  const [sourceProfile, emitter] = process.argv.slice(2);
  const scenario = process.argv[4] || 'complete';
  assert(sourceProfile && emitter, 'Pass the desktop profile and emitter paths');
  const resources = path.join(path.dirname(process.execPath), 'resources');
  const runtime = path.join(resources, 'app.asar/dsh');
  const pkg = name => path.join(runtime, 'node_modules/@deepseek-ai', name);
  const load = (name, file = 'lib/index.js') => import(pathToFileURL(path.join(pkg(name), file)).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-dsh-runtime-'));
  process.env.DSH_HOME = path.join(dir, 'dsh');
  process.env.RILLBUDDY_HOME = path.join(dir, 'rill');
  process.env.DSH_PRIMARY_RUNTIME = path.join(resources, 'runtime/primary-runtime');
  process.env.DSH_TELEMETRY_DISABLED = '1';
  const profileDir = path.join(process.env.DSH_HOME, 'profiles/desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(process.env.RILLBUDDY_HOME, { recursive: true });
  const recorded = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/v1/event') recorded.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(204).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(process.env.RILLBUDDY_HOME, 'port'), String(server.address().port));
  fs.writeFileSync(path.join(process.env.RILLBUDDY_HOME, 'token'), 'isolated-integration-test');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceProfile, 'package.json'), 'utf8'));
  manifest.dependencies = {};
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifest));
  const adapterPath = path.join(dir, 'rill-events.mjs');
  fs.copyFileSync(path.join(__dirname, '../adapters/deepseek-harness/rill-events.mjs'), adapterPath);
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
    '- id: session-title-llm\n  disabled: true',
    '- id: desktop-product-telemetry\n  disabled: true',
    '- id: product-analytics\n  disabled: true',
    '- id: agent-default-model\n  config:\n    provider: rill-test\n    model: fixture',
    '- insert:\n    - id: rillbuddy-deepseek-harness\n      name: ' + JSON.stringify(adapterPath.replaceAll('\\', '/')) + '\n      config:\n        emitter: ' + JSON.stringify(path.resolve(emitter).replaceAll('\\', '/')),
  ].join('\n') + '\n');
  let ctx;
  try {
    console.log('Booting isolated desktop profile');
    const boot = await load('dsh-app-boot');
    const { runProfile } = await load('dsh', 'lib/profile-boot.js');
    const installAnchor = path.join(pkg('dsh'), 'package.json');
    const profile = boot.loadProfileDirectory('dsh', profileDir, installAnchor);
    ({ ctx } = await runProfile({ environment: boot.loadLayeredEnv('dsh'), profile: 'desktop', resolvedProfile: { profile, installAnchor }, patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] }));
    console.log('Desktop profile booted');
    const { LlmAdapter, LlmError, createUserMessage } = await load('dsh-llm');
    class Fixture extends LlmAdapter {
      calls = 0;
      async *stream() {
        if (scenario === 'error') throw new LlmError('Isolated fixture failure', 'AUTH');
        if (this.calls++ === 0) {
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: 0, id: 'fixture-call', name: 'rill_probe', argumentsDelta: '{"canary":"PRIVATE_TOOL_ARGUMENT"}' };
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'fixture-call', name: 'rill_probe', arguments: '{"canary":"PRIVATE_TOOL_ARGUMENT"}' } };
          yield { type: 'finish', reason: 'tool-calls' };
          return;
        }
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'OK' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'OK' } };
        yield { type: 'finish', reason: 'stop' };
      }
    }
    ctx.llm.registerAdapter(['rill-test'], new Fixture());
    ctx.tools.register({
      name: 'rill_probe', description: 'Isolated integration fixture',
      parameters: { type: 'object', properties: { canary: { type: 'string' } }, required: ['canary'] },
      output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, render: () => [{ type: 'text', text: 'PRIVATE_TOOL_OUTPUT' }] },
      execute: async () => ({ ok: true }),
    });
    console.log('Fixture model registered');
    const created = await ctx.sessionController.create({ cwd: dir });
    console.log('Real agent created');
    const agent = ctx.agents.get(created.sessionId);
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Rill integration fixture' }], source: { kind: 'user' } }));
    const deadline = Date.now() + 15_000;
    while (!recorded.some(e => e.event === 'turn.done') && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    const events = recorded.map(e => e.event);
    console.log(JSON.stringify({ runtime: boot.getDshRuntimeVersion(), events }));
    console.log(JSON.stringify({ diagnostics: agent.session.snapshotEvents().filter(e => /hook|turn\/end|error/.test(e.type)).map(e => ({ type: e.type, data: e.data })) }));
    assert(events.includes('session.start'), 'Real agent creation must invoke SessionStart');
    assert(events.includes('turn.start'), 'Real prompt must invoke UserPromptSubmit');
    if (scenario === 'complete') {
      assert(events.includes('tool.start'), 'Real tool dispatch must reach Rill');
      assert(events.includes('tool.end'), 'Real tool completion must reach Rill');
    }
    assert(events.includes('turn.done'), 'Real agent completion must invoke Stop');
    assert.equal(recorded.find(e => e.event === 'turn.done').detail.result, scenario === 'error' ? 'error' : 'ok');
    assert(recorded.every(e => e.source === 'deepseek-harness'));
    assert(recorded.every(e => !JSON.stringify(e).includes('Rill integration fixture')), 'Prompt must never reach Rill');
    assert(!JSON.stringify(recorded).includes('PRIVATE_TOOL_'), 'Tool arguments and results must never reach Rill');
    console.log('PASS: desktop runtime -> agent -> native observer -> emitter -> isolated HTTP');
  } finally {
    const cleanup = ctx?.fiber.dispose();
    if (cleanup) await Promise.race([cleanup, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    await new Promise(resolve => server.close(resolve));
    // Remove only this test's mkdtemp directory.
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith('rill-dsh-runtime-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
