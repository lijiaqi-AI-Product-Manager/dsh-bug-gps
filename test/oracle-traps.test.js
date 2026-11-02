// Regression tests for the wrong-reduction traps found on real apps (see bench/spike-s2-s3.md):
// a symptom that equals a state reachable WITHOUT the bug must not survive minimization.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';

let env;
before(async () => { env = await withEnv(); });
after(async () => { await env?.close(); });

const goto = { action: 'goto', url: '/' };
const click = (name) => ({ action: 'click', target: [{ by: 'role', role: 'button', name }] });

test('text expectation whose target is missing is TEST_INVALID, not a failure', async () => {
  const c = { steps: [goto], expectation: { kind: 'text', target: [{ by: 'testId', value: 'no-such-thing' }], equals: 'x' } };
  const r = await reproduce(env.browser, c, { baseUrl: env.url, runs: 1 });
  assert.equal(r.status, Status.TEST_INVALID);
});

test('"visible": disappeared-after-being-seen and never-seen have different signatures', async () => {
  // "Remove Apple" appears after Add Apple and disappears when removed (correct behaviour,
  // used here as a stand-in for a bug that removes an element).
  const c = {
    steps: [goto, click('Add Apple'), click('Remove Apple')],
    expectation: { kind: 'visible', target: [{ by: 'role', role: 'button', name: 'Remove Apple' }] },
  };
  const red = await reproduce(env.browser, c, { baseUrl: env.url });
  assert.equal(red.status, Status.REPRODUCED);
  assert.match(red.observed, /was visible earlier/);
  const never = await reproduce(env.browser, { ...c, steps: [goto] }, { baseUrl: env.url, runs: 1 });
  assert.notEqual(never.trials[0].signature.actual, red.signature.actual);

  // So minimization cannot delete the steps that made the element appear.
  const m = await minimize(env.browser, c, { baseUrl: env.url, signature: red.signature });
  assert.equal(m.minimizedSteps, 3);
});
