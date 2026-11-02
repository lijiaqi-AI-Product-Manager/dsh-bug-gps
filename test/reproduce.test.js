import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.js';
import { recordSession } from '../bench/sessions.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { launchBrowser } from '../src/core/browser.js';
import { EnvBlockedError } from '../src/core/errors.js';

let env;
before(async () => { env = await withEnv(); });
after(async () => { await env?.close(); });

test('recorded session replays and reproduces the seeded bug 3/3', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  assert.equal(s.dropped, 0);
  assert.ok(s.steps.every((st) => st.action === 'goto' || st.target.length > 0), 'every step has locator candidates');
  const r = await reproduce(env.browser, s, { baseUrl: env.url });
  assert.equal(r.status, Status.REPRODUCED);
  assert.equal(r.observed, '$17.00');
});

test('the same steps against a correct expectation are NOT_REPRODUCED', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  // The buggy app really shows $17.00; asserting that is a passing check, not a reproduction.
  const r = await reproduce(env.browser, { ...s, expectation: { ...s.expectation, equals: '$17.00' } }, { baseUrl: env.url });
  assert.equal(r.status, Status.NOT_REPRODUCED);
});

test('a step whose target no longer exists is TEST_INVALID, not REPRODUCED', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const steps = s.steps.map((st) => (st.action === 'click' && st.target[0].name === 'Remove Apple'
    ? { ...st, target: [{ by: 'role', role: 'button', name: 'Remove Durian' }] } : st));
  const r = await reproduce(env.browser, { ...s, steps }, { baseUrl: env.url });
  assert.equal(r.status, Status.TEST_INVALID);
  assert.match(r.reason, /not-found/);
});

test('dev server down is ENV_BLOCKED', async () => {
  const s = await recordSession(env.browser, env.url, 'stale-discount');
  const { startStaticServer } = await import('../examples/serve.js');
  const gone = await startStaticServer('.');
  await gone.close(); // a port that was just free: connection refused
  const r = await reproduce(env.browser, s, { baseUrl: gone.url });
  assert.equal(r.status, Status.ENV_BLOCKED);
  assert.equal(r.runs, 1, 'stops after the first environment failure');
});

test('missing browser is an EnvBlockedError with a next step, never a silent download', async () => {
  await assert.rejects(launchBrowser({ executablePath: 'C:\\no such dir\\chrome.exe' }), (err) => {
    assert.ok(err instanceof EnvBlockedError);
    assert.match(err.hint, /Edge or Google Chrome/);
    return true;
  });
});

test('non-deterministic bug is FLAKY', async () => {
  const s = await recordSession(env.browser, env.url, 'flaky-total');
  const r = await reproduce(env.browser, s, { baseUrl: env.url, runs: 10 });
  assert.equal(r.status, Status.FLAKY, JSON.stringify(r.tally));
});

test('uncaught page error is reproduced with a normalized signature', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const r = await reproduce(env.browser, s, { baseUrl: env.url });
  assert.equal(r.status, Status.REPRODUCED);
  assert.match(r.signature.actual, /TypeError/);
});
