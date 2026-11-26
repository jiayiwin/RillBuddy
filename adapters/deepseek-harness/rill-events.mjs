// Native read-only observer for both CLI and Electron DSH runtimes. No DSH
// package imports: versioned host services remain owned by the active app.
// State notifications are trusted integration work, not agent shell commands.
import { spawn } from 'node:child_process';

export const name = 'rillbuddy-events';
const DEFAULT_EMITTER = null /* __RILLBUDDY_EMITTER__ */;

export function apply(ctx, config = {}) {
  const emitter = config.emitter ?? DEFAULT_EMITTER;
  if (typeof emitter !== 'string' || !emitter) throw new Error('RillBuddy emitter path is required');
  const lifetime = new AbortController();
  const queues = new Map();
  const children = new Set();
  const started = new Set();

  function metadata(agent) {
    const header = agent?.session?.header;
    if (!header?.id) return;
    return { session_id: header.id, cwd: header.cwd || '' };
  }

  function run(payload) {
    if (lifetime.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(emitter, ['--source', 'deepseek-harness'], {
          stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
          timeout: 1500, signal: lifetime.signal,
        });
      } catch { resolve(); return; }
      children.add(child);
      child.stdin.on('error', () => {});
      child.once('error', () => { children.delete(child); resolve(); });
      child.once('close', () => { children.delete(child); resolve(); });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  function send(point, agent, detail = {}) {
    const base = metadata(agent);
    if (!base || lifetime.signal.aborted) return Promise.resolve();
    const prev = queues.get(base.session_id) ?? Promise.resolve();
    const pending = prev.catch(() => {}).then(() => run({ ...base, hook_event_name: point, ...detail }));
    queues.set(base.session_id, pending);
    pending.finally(() => { if (queues.get(base.session_id) === pending) queues.delete(base.session_id); });
    return pending;
  }

  const sessionStart = ({ agent }) => {
    const id = metadata(agent)?.session_id;
    if (!id || started.has(id)) return;
    started.add(id);
    return send('SessionStart', agent);
  };
  // The lifecycle event was renamed between the 0.1 and 0.2 DSH releases.
  ctx.on('agent/created', sessionStart);
  ctx.on('agent/session-start', sessionStart);
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') return send('UserPromptSubmit', { session });
    if (event.type === 'turn/end') {
      const reason = event.data?.reason?.kind ?? event.data?.reason;
      const stop_reason = reason === 'completed' ? 'ok' : /cancel|abort|interrupt/.test(reason || '') ? 'aborted' : 'error';
      return send('Stop', { session }, { stop_reason });
    }
  });
  ctx.on('tools/pre-execute', async (exec, next) => {
    // Never copy tool arguments, prompts, tool output or transcript contents.
    await send('PreToolUse', exec.agent, { tool_name: exec.name });
    return next();
  });
  ctx.on('tools/post-execute', async (exec, result, next) => {
    await send(result?.isError ? 'PostToolUseFailure' : 'PostToolUse', exec.agent, { tool_name: exec.name });
    return next();
  });
  ctx.on('agent/disposed', ({ agent }) => {
    const id = metadata(agent)?.session_id;
    if (id) started.delete(id);
    return send('SessionEnd', agent);
  });
  ctx.effect(() => async () => {
    lifetime.abort();
    for (const child of children) child.kill();
    await Promise.allSettled(queues.values());
  });
}
