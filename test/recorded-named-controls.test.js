import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';

const button = (name, result) => '<button onclick="setOut(\'' + result + '\')">' + name + '</button>';
const reset = button('Reset', 'EXPECTED');
const other = button('Add Table', 'EXPECTED');
const target = button('Add Table', 'BUG');
const region = (contents) => '<aside aria-label="Table tools">' + contents + '</aside>';
const pages = {
  '/named': region(reset + target) + '<main>' + other + '</main>',
  '/repeated': region(reset + other + target) + '<main>' + other + '</main>',
  '/duplicate': region(target) + region(other),
};

let server; let browser; let baseUrl;
before(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8">' + (pages[request.url] ?? '') +
      '<p id="out">READY</p><script>function setOut(value){document.getElementById("out").textContent=value;}</script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/';
  ({ browser } = await launchBrowser());
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function roundTrip(t, path, act) {
  const recording = await startRecording(browser, { baseUrl, startPath: path });
  t.after(() => recording.stop());
  await act(recording.page);
  await recording.page.locator('#out').filter({ hasText: 'BUG' }).waitFor();
  const steps = await recording.stop();
  return reproduce(browser, {
    steps,
    expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'EXPECTED' },
    observeMs: 0,
  }, { baseUrl, runs: 1 });
}

test('a recorded named button keeps its unique named region despite another button with the same name', async (t) => {
  const result = await roundTrip(t, '/named', (page) =>
    page.getByRole('complementary', { name: 'Table tools' }).getByRole('button', { name: 'Add Table', exact: true }).click());
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
  assert.equal(result.observed, 'BUG');
});

test('recording chooses the clicked same-named button within its region, ignoring other button names', async (t) => {
  const result = await roundTrip(t, '/repeated', (page) =>
    page.getByRole('complementary', { name: 'Table tools' }).getByRole('button', { name: 'Add Table', exact: true }).nth(1).click());
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
  assert.equal(result.observed, 'BUG');
});

test('recording does not silently select the first of duplicate named regions', async (t) => {
  const result = await roundTrip(t, '/duplicate', (page) =>
    page.locator('aside').first().getByRole('button', { name: 'Add Table', exact: true }).click());
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
  assert.match(result.reason, /ambiguous/);
});
