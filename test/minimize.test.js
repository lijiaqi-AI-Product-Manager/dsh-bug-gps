import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.js';
import { recordSession } from '../bench/sessions.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';

let env;
let session;
let red;
before(async () => {
  env = await withEnv();
  session = await recordSession(env.browser, env.url, 'stale-discount');
  red = await reproduce(env.browser, session, { baseUrl: env.url });
});
after(async () => { await env?.close(); });

const names = (steps) => steps.map((s) => s.target?.[0]?.name ?? s.target?.[0]?.value ?? s.url);

test('strict minimization keeps exactly the causal steps and re-confirms 3/3', async () => {
  assert.equal(red.status, Status.REPRODUCED);
  const m = await minimize(env.browser, session, { baseUrl: env.url, signature: red.signature });
  assert.equal(m.confirmed, true);
  assert.equal(m.stats.modelCalls, 0);
  assert.deepEqual(names(m.testCase.steps), ['/', 'Add Apple', 'Add Banana', 'Coupon', 'Apply coupon', 'Remove Apple']);
  assert.ok(m.minimizedSteps < m.originalSteps);
});

test('loose matching accepts a wrong reduction: that is why strict is the default', async () => {
  // "total is not $18.00" is already true on an empty cart ($0.00), so a kind+target-only
  // oracle happily deletes every action. Strict matching requires the same observed $17.00.
  const m = await minimize(env.browser, { ...session, match: 'loose' }, { baseUrl: env.url, signature: red.signature, match: 'loose' });
  assert.ok(m.minimizedSteps <= 2, `loose kept ${m.minimizedSteps} steps`);
  assert.ok(!names(m.testCase.steps).includes('Apply coupon'), 'loose reduction lost the coupon, i.e. it is a different bug');
});

test('budget exhaustion returns only a confirmed case, or the original', async () => {
  const m = await minimize(env.browser, session, { baseUrl: env.url, signature: red.signature, maxTrials: 3 });
  assert.equal(m.status, Status.BUDGET_EXHAUSTED);
  assert.ok(m.stats.trials <= 3);
  if (m.confirmed) assert.equal(m.confirm.status, Status.REPRODUCED);
  else assert.equal(m.minimizedSteps, m.originalSteps);
});

test('page-error case minimizes to the two changelog clicks', async () => {
  const s = await recordSession(env.browser, env.url, 'changelog-crash');
  const r = await reproduce(env.browser, s, { baseUrl: env.url });
  const m = await minimize(env.browser, s, { baseUrl: env.url, signature: r.signature });
  assert.equal(m.confirmed, true);
  assert.deepEqual(names(m.testCase.steps), ['/', 'About', 'Show changelog', 'Show changelog']);
});
