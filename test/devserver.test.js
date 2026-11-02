import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { startDevServer } from '../src/core/devserver.js';
import { EnvBlockedError } from '../src/core/errors.js';
import { EXAMPLE_DIR, freePort } from './helpers.js';

const SERVE = fileURLToPath(new URL('../examples/serve.js', import.meta.url));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('dev server: waits for readiness, then stop() kills our process and frees the port', async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const s = await startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, SERVE, EXAMPLE_DIR, String(port)], url });
  assert.equal((await fetch(url)).status, 200);
  await s.stop();
  assert.equal(alive(s.pid), false);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
});

test('an already cancelled start does not create a server', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, SERVE, EXAMPLE_DIR, String(await freePort())], url: 'http://127.0.0.1:9/', signal: controller.signal }), { name: 'AbortError' });
});

test('cancelling a ready server terminates its owned process', async () => {
  const controller = new AbortController();
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = await startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, SERVE, EXAMPLE_DIR, String(port)], url, signal: controller.signal });
  try {
    controller.abort();
    const deadline = Date.now() + 2000;
    while (alive(server.pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal(alive(server.pid), false);
  } finally { await server.stop(); }
});

test('an occupied port returning HTTP 500 is preserved and ENV_BLOCKED', async () => {
  const listener = createServer((_req, res) => { res.writeHead(500); res.end('existing server'); });
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  const url = `http://127.0.0.1:${port}/`;
  try {
    await assert.rejects(startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, SERVE, EXAMPLE_DIR, String(port)], url }), (err) => err instanceof EnvBlockedError && /already serving/.test(err.message));
    assert.equal((await fetch(url)).status, 500);
  } finally { await new Promise((done) => listener.close(done)); }
});

test('dev server that crashes on start is ENV_BLOCKED with its log tail', async () => {
  await assert.rejects(
    startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, '-e', 'console.error("boom: missing dependency"); process.exit(3)'], url: 'http://127.0.0.1:5199/', readyTimeoutMs: 5000 }),
    (err) => err instanceof EnvBlockedError && /boom: missing dependency/.test(err.message),
  );
});
