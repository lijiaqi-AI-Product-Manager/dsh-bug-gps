import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startDevServer } from '../src/core/devserver.js';
import { EnvBlockedError } from '../src/core/errors.js';
import { EXAMPLE_DIR } from './helpers.js';

const SERVE = fileURLToPath(new URL('../examples/serve.js', import.meta.url));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('dev server: waits for readiness, then stop() kills our process and frees the port', async () => {
  const port = 5170 + Math.floor(Math.random() * 20);
  const url = `http://127.0.0.1:${port}/`;
  const s = await startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, SERVE, EXAMPLE_DIR, String(port)], url });
  assert.equal((await fetch(url)).status, 200);
  await s.stop();
  assert.equal(alive(s.pid), false);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
});

test('dev server that crashes on start is ENV_BLOCKED with its log tail', async () => {
  await assert.rejects(
    startDevServer({ cwd: EXAMPLE_DIR, argv: [process.execPath, '-e', 'console.error("boom: missing dependency"); process.exit(3)'], url: 'http://127.0.0.1:5199/', readyTimeoutMs: 5000 }),
    (err) => err instanceof EnvBlockedError && /boom: missing dependency/.test(err.message),
  );
});
