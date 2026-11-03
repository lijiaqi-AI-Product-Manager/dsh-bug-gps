import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';

let env;
before(async () => { env = await withEnv(); });
after(async () => { await env?.close(); });

test('toolbar: picking the expectation is not recorded as a step and the case reproduces', async () => {
  const rec = await startRecording(env.browser, { baseUrl: env.url, toolbar: true });
  const { page } = rec;
  page.on('dialog', (d) => d.accept('$18.00')); // the user types the correct value
  await page.getByRole('button', { name: 'Add Apple' }).click();
  await page.getByRole('button', { name: 'Add Banana' }).click();
  await page.getByRole('textbox', { name: 'Coupon' }).fill('SAVE10');
  await page.getByRole('button', { name: 'Apply coupon' }).click();
  await page.getByRole('button', { name: 'Remove Apple' }).click();
  await page.locator('#__buggps_toolbar summary').click();
  await page.getByRole('button', { name: /上一步是关键/ }).click();
  await page.getByRole('button', { name: /预期文本/ }).click(); // toolbar lives in a shadow root
  await page.getByTestId('total').click();
  await page.getByRole('button', { name: /结束/ }).click();
  assert.equal(await rec.finished, 'stop');
  const steps = await rec.stop();

  assert.deepEqual(steps.map((s) => s.action), ['goto', 'click', 'click', 'fill', 'click', 'click']);
  assert.equal(steps[5].pinned, true, 'the step before "key step" is pinned');
  const { kind, target, equals } = rec.result.expectation;
  assert.deepEqual({ kind, first: target[0], equals }, { kind: 'text', first: { by: 'testId', value: 'total' }, equals: '$18.00' });
  assert.equal(rec.result.expectedFrom, '$17.00');
  const r = await reproduce(env.browser, { steps, expectation: rec.result.expectation }, { baseUrl: env.url });
  assert.equal(r.status, Status.REPRODUCED);
});

test('toolbar: "visible" can be picked before the element disappears', async () => {
  const rec = await startRecording(env.browser, { baseUrl: env.url, toolbar: true });
  const { page } = rec;
  await page.getByRole('button', { name: /应可见/ }).click();
  await page.getByRole('heading', { name: 'Shop' }).click(); // picked, not recorded
  await page.getByRole('link', { name: 'About' }).click();
  await page.getByRole('button', { name: /结束/ }).click();
  await rec.finished;
  const steps = await rec.stop();
  assert.deepEqual(steps.map((s) => s.action), ['goto', 'click']);
  assert.equal(rec.result.expectation.kind, 'visible');
  const r = await reproduce(env.browser, { steps, expectation: rec.result.expectation }, { baseUrl: env.url });
  assert.equal(r.status, Status.REPRODUCED, JSON.stringify(r));
});
