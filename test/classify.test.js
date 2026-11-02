import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, Status } from '../src/core/reproduce.js';
import { normalizeError, signatureKey } from '../src/core/oracle.js';
import { hashCase } from '../src/core/caselock.js';

const sig = (actual) => ({ kind: 'text', target: 'testId=total', actual });
const fail = (actual) => ({ outcome: 'fail', signature: sig(actual) });

test('k/k identical failures is REPRODUCED', () => {
  assert.equal(classify([fail('$17.00'), fail('$17.00'), fail('$17.00')], 3), Status.REPRODUCED);
});

test('failures with different actual values are FLAKY in strict mode, REPRODUCED in loose', () => {
  const t = [fail('$17.00'), fail('$16.00'), fail('$17.00')];
  assert.equal(classify(t, 3, 'strict'), Status.FLAKY);
  assert.equal(classify(t, 3, 'loose'), Status.REPRODUCED);
});

test('mixed pass/fail is FLAKY, never REPRODUCED', () => {
  assert.equal(classify([fail('$17.00'), { outcome: 'pass' }, fail('$17.00')], 3), Status.FLAKY);
});

test('environment failure wins over everything', () => {
  assert.equal(classify([fail('$17.00'), { outcome: 'env-error' }], 3), Status.ENV_BLOCKED);
});

test('same broken step every time is TEST_INVALID, not a reproduction', () => {
  const t = [1, 2, 3].map(() => ({ outcome: 'step-error', stepIndex: 4 }));
  assert.equal(classify(t, 3), Status.TEST_INVALID);
});

test('too few trials is BUDGET_EXHAUSTED', () => {
  assert.equal(classify([fail('$17.00')], 3), Status.BUDGET_EXHAUSTED);
});

test('all pass is NOT_REPRODUCED', () => {
  assert.equal(classify([{ outcome: 'pass' }, { outcome: 'pass' }, { outcome: 'pass' }], 3), Status.NOT_REPRODUCED);
});

test('error normalization drops volatile line/col and URLs', () => {
  const a = normalizeError("TypeError: Cannot read properties of undefined (reading 'join') at http://127.0.0.1:5173/app.js:88:31");
  const b = normalizeError("TypeError: Cannot read properties of undefined (reading 'join') at http://127.0.0.1:61234/app.js:90:12");
  assert.equal(a, b);
  assert.equal(signatureKey(null), null);
});

test('case hash is stable under key order and changes when the expectation is weakened', () => {
  const steps = [{ action: 'goto', url: '/' }];
  const a = hashCase({ steps, expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$18.00' } });
  const b = hashCase({ expectation: { equals: '$18.00', target: [{ value: 'total', by: 'testId' }], kind: 'text' }, steps });
  const c = hashCase({ steps, expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$17.00' } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
