import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { EnvBlockedError } from '../src/core/errors.js';
import { runTrial } from '../src/core/replay.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

async function serve(t, html) {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/pending')) return;
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/`;
}

test('an unfinished image does not block recording an interactive page', async (t) => {
  const baseUrl = await serve(t, '<!doctype html><button>Ready</button><img src="/pending-image">');
  const recording = await startRecording(env.browser, { baseUrl, navTimeoutMs: 10000 });
  try {
    assert.equal(await recording.page.getByRole('button', { name: 'Ready' }).isVisible(), true);
    assert.equal(await recording.page.evaluate(() => document.readyState), 'interactive', 'The image request must still be unfinished');
  }
  finally { await recording.stop(); }
  const replay = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'visible', target: [{ by: 'role', role: 'button', name: 'Ready' }] }, navTimeoutMs: 10000 });
  assert.equal(replay.outcome, 'pass');
});

test('navigation timeout is ENV_BLOCKED, closes its context, and omits URL secrets', async (t) => {
  const baseUrl = await serve(t, '<!doctype html><script src="/pending-script" defer></script>');
  const count = env.browser.contexts().length;
  await assert.rejects(startRecording(env.browser, { baseUrl, startPath: '/?token=fixture-secret#private', navTimeoutMs: 150 }), (error) => {
    assert.ok(error instanceof EnvBlockedError);
    assert.match(error.message, /did not become ready/);
    assert.doesNotMatch(error.message, /fixture-secret|#private/);
    assert.match(error.hint, /development server/);
    return true;
  });
  assert.equal(env.browser.contexts().length, count);
});
