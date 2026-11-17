import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let server, watchAppUpdates;
before(async () => {
  server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  ({ watchAppUpdates } = await server.ssrLoadModule('/src/utils/appUpdates.ts'));
});
after(async () => { await server?.close(); });

const json = version => Response.json({ version });
const flush = () => new Promise(resolve => setImmediate(resolve));

function browser(t, respond = () => json('loaded-version')) {
  let now = 0, nextTimer = 0;
  const cleanups = [];
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  const timers = new Map();
  const requests = [];
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { onLine: true };
  const schedule = (callback, delay, repeat = false) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay, delay, repeat });
    return id;
  };
  Object.assign(window, {
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id)
  });
  for (const [name, value] of Object.entries({ window, document, navigator, fetch: (...args) => {
    requests.push(args);
    return respond(...args);
  } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
    cleanups.push(() => previous
      ? Object.defineProperty(globalThis, name, previous)
      : delete globalThis[name]);
  }
  t.mock.method(Date, 'now', () => now);

  return {
    window, document, navigator, requests, timers,
    cleanup: callback => cleanups.push(callback),
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = end;
      await flush();
    }
  };
}

test('avisa uma vez quando uma nova publicação aparece e consulta sem cache', async t => {
  let version = 'loaded-version', notices = 0;
  const env = browser(t, () => json(version));
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  assert.equal(env.requests.length, 0, 'não disputa a primeira renderização');
  await env.advance(10_000);
  assert.equal(notices, 0);
  assert.equal(env.requests[0][0], '/app-version.json');
  assert.equal(env.requests[0][1].cache, 'no-store');
  version = 'new-version';
  await env.advance(50_000);
  assert.equal(notices, 1);
  await env.advance(120_000);
  env.window.dispatchEvent(new Event('focus'));
  await flush();
  assert.equal(notices, 1);
  assert.equal(env.requests.length, 2, 'para de consultar após avisar');
});

test('detecta uma publicação ocorrida antes da primeira checagem', async t => {
  const env = browser(t, () => json('already-published'));
  let notices = 0;
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  await env.advance(10_000);
  assert.equal(notices, 1, 'compara com o bundle em uso, sem adotar a versão remota como referência');
});

test('falhas, fallback HTML e metadados inválidos não geram falso aviso nem impedem nova tentativa', async t => {
  const responses = [
    () => { throw new TypeError('offline'); },
    () => new Response('unavailable', { status: 503 }),
    () => new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
    () => Response.json(null),
    () => Response.json({}),
    () => json(''),
    () => json('   '),
    () => json(123),
    () => json('loaded-version'),
    () => json('new-version')
  ];
  const env = browser(t, () => responses.shift()());
  let notices = 0;
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  await env.advance(10_000);
  for (let i = 0; i < 9; i++) {
    assert.equal(notices, 0);
    await env.advance(60_000);
  }
  assert.equal(notices, 0);
  await env.advance(60_000);
  assert.equal(notices, 1);
});

test('pausa em segundo plano e offline e revalida ao retornar à aba ou conexão', async t => {
  const env = browser(t);
  let notices = 0;
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  env.document.visibilityState = 'hidden';
  await env.advance(60_000);
  assert.equal(env.requests.length, 0);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  env.window.dispatchEvent(new Event('focus'));
  await flush();
  assert.equal(env.requests.length, 1, 'eventos simultâneos não duplicam a checagem');
  env.navigator.onLine = false;
  await env.advance(60_000);
  assert.equal(env.requests.length, 1);
  env.navigator.onLine = true;
  env.window.dispatchEvent(new Event('online'));
  await flush();
  assert.equal(env.requests.length, 2);
  assert.equal(notices, 0);
});

test('limita consultas pendentes, cancela timeout e recupera na próxima checagem', async t => {
  let attempts = 0;
  const env = browser(t, (_url, { signal }) => {
    if (++attempts > 1) return json('new-version');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  });
  let notices = 0;
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  await env.advance(10_000);
  env.window.dispatchEvent(new Event('focus'));
  assert.equal(env.requests.length, 1);
  await env.advance(10_000);
  assert.equal(env.requests[0][1].signal.aborted, true);
  assert.equal(notices, 0);
  await env.advance(40_000);
  assert.equal(notices, 1);
});

test('desmontar remove listeners, timers e ignora respostas atrasadas', async t => {
  let release, notices = 0;
  const env = browser(t, () => new Promise(resolve => { release = resolve; }));
  const stopBeforeCheck = watchAppUpdates('loaded-version', () => notices++);
  stopBeforeCheck();
  await env.advance(10_000);
  assert.equal(env.requests.length, 0);
  const stop = watchAppUpdates('loaded-version', () => notices++);
  env.cleanup(stop);
  await env.advance(10_000);
  stop();
  assert.equal(env.requests[0][1].signal.aborted, true);
  release(json('new-version'));
  await flush();
  env.window.dispatchEvent(new Event('focus'));
  env.window.dispatchEvent(new Event('online'));
  env.document.dispatchEvent(new Event('visibilitychange'));
  await env.advance(120_000);
  assert.equal(env.requests.length, 1);
  assert.equal(env.timers.size, 0);
  assert.equal(notices, 0);
});
