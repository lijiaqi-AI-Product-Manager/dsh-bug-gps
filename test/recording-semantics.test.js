import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { lockCase, verifyCase, hashCase, loadCase } from '../src/core/caselock.js';
import { tempRepo, serveSpec } from './helpers.js';

const action = (attributes = '') => '<button ' + attributes + ' onclick="setOut(\'BUG\')">Launch</button>';
const markup = (body) => '<!doctype html><meta charset="utf-8">' + body +
  '<p id="out">READY</p><script>function setOut(value){document.getElementById("out").textContent=value;}</script>';
const pages = {
  '/role-list': '<aside aria-label="Tools">' + action('role="button link"') + '</aside>',
  '/unknown-role': action('role="unknown-role button link"'),
  '/implicit-role': action('role="unknown-role"'),
  '/role-key': '<div role="unknown-role button" tabindex="0" onkeydown="if(event.key===\' \')setOut(\'BUG\')">Launch</div>',
  '/label-priority': '<span id="caption">Launch</span>' + action('aria-labelledby="caption" aria-label="Wrong"'),
  '/missing-label': action('aria-labelledby="missing" aria-label="Launch"'),
  '/unnamed-region': '<aside>' + action() + '</aside><main><button>Launch</button></main>',
  '/duplicate-region': '<aside>' + action() + '</aside><aside><button>Launch</button></aside>',
  '/unlocatable': '<div class="custom-action" style="width:100px;height:40px;background:gray" onclick="setOut(\'BUG\')"></div>',
  '/fault': action('id="fault"'),
  '/frame': action() + '<iframe src="/child" title="Embedded action"></iframe>',
  '/child': '<button onclick="parent.setOut(\'BUG\')">Launch</button>',
  '/popup': '<a href="/child" target="_blank">Open action</a>',
};
let server; let env; let baseUrl;
before(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(markup(pages[request.url] ?? ''));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port + '/';
  env = await launchBrowser();
});
after(async () => {
  await env?.browser.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const expectation = { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'EXPECTED' };
async function capture(t, path, act) {
  const rec = await startRecording(env.browser, { baseUrl, startPath: path });
  t.after(() => rec.stop());
  await act(rec.page);
  assert.equal(await rec.page.locator('#out').textContent(), 'BUG');
  const steps = await rec.stop();
  return { rec, steps, definition: { ...rec.result, source: 'recorded', steps, expectation, expectedFrom: 'BUG', capturedChecks: [{ kind: expectation.kind, target: expectation.target, observed: 'BUG' }], observeMs: 0 } };
}

test('a role fallback control preserves its Space activation', async (t) => {
  const { steps, definition } = await capture(t, '/role-key', (page) => page.getByRole('button', { name: 'Launch' }).press('Space'));
  assert.equal(steps.filter((step) => step.action === 'press').length, 1);
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
  assert.equal(result.observed, 'BUG');
});

test('embedded actions cannot be replayed against a same-named main-page control', async (t) => {
  const { rec, definition } = await capture(t, '/frame', (page) => page.frameLocator('iframe').getByRole('button', { name: 'Launch' }).click());
  assert.ok(rec.result.captureIssues.some((issue) => issue.code === 'unsupported-context'));
  assert.equal(definition.steps.filter((step) => step.action === 'click').length, 0);
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
});

test('actions in an additional page keep the recording incomplete', async (t) => {
  const rec = await startRecording(env.browser, { baseUrl, startPath: '/popup' });
  t.after(() => rec.stop());
  const [popup] = await Promise.all([rec.page.waitForEvent('popup'), rec.page.getByRole('link', { name: 'Open action' }).click()]);
  await popup.getByRole('button', { name: 'Launch' }).click();
  await rec.stop();
  assert.ok(rec.result.captureIssues.some((issue) => issue.code === 'unsupported-context'));
});

for (const path of ['/role-list', '/unknown-role', '/implicit-role', '/label-priority', '/missing-label']) {
  test('record and replay preserve browser role/name semantics: ' + path, async (t) => {
    const { rec, steps, definition } = await capture(t, path, (page) => page.getByRole('button', { name: 'Launch', exact: true }).click());
    assert.equal(steps.filter((step) => step.action === 'click').length, 1);
    assert.deepEqual(rec.result.captureIssues, []);
    const result = await reproduce(env.browser, definition, { baseUrl, runs: 1, stepTimeoutMs: 500 });
    assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
    assert.equal(result.observed, 'BUG');
  });
}

test('recording scopes a repeated control to a unique unnamed landmark', async (t) => {
  const { steps, definition } = await capture(t, '/unnamed-region', (page) => page.getByRole('complementary').getByRole('button', { name: 'Launch' }).click());
  assert.deepEqual(steps[1].target[0].within, { role: 'complementary', name: '' });
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1, stepTimeoutMs: 500 });
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
  assert.equal(result.observed, 'BUG');
});

test('duplicate unnamed landmarks stay ambiguous instead of selecting the first', async (t) => {
  const { definition } = await capture(t, '/duplicate-region', (page) => page.locator('aside').first().getByRole('button', { name: 'Launch' }).click());
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1, stepTimeoutMs: 250 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
  assert.match(result.reason, /ambiguous/);
});

test('an action without a locator marks the draft incomplete and cannot become a reproduction', async (t) => {
  const { rec, definition } = await capture(t, '/unlocatable', (page) => page.locator('.custom-action').click());
  assert.ok(rec.result.captureIssues.some((issue) => issue.code === 'action-target'));
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
});

test('locator capture errors block the draft without copying page error text', async (t) => {
  const { rec, definition } = await capture(t, '/fault', async (page) => {
    await page.locator('#fault').evaluate((element) => {
      const original = element.getAttribute.bind(element);
      element.getAttribute = (name) => { if (name === 'role') throw new Error('private-sample-value'); return original(name); };
      element.click();
    });
  });
  assert.ok(rec.result.captureIssues.some((issue) => issue.code === 'capture-error'));
  assert.ok(!JSON.stringify(rec.result.captureIssues).includes('private-sample-value'));
  const result = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
});

test('stop waits for delayed action acknowledgement and concurrent stop calls agree', async (t) => {
  const rec = await startRecording(env.browser, { baseUrl, startPath: '/fault' });
  t.after(() => rec.stop());
  await rec.page.evaluate(() => {
    const record = window.__buggpsRecord;
    window.__buggpsRecord = async (event) => { await new Promise((resolve) => setTimeout(resolve, 350)); return record(event); };
  });
  await rec.page.getByRole('button', { name: 'Launch' }).click();
  await rec.page.evaluate(() => setTimeout(() => document.querySelector('#fault').click(), 100));
  const [first, second] = await Promise.all([rec.stop(), rec.stop()]);
  assert.equal(first.filter((step) => step.action === 'click').length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(rec.result.captureIssues, []);
});

test('a never-acknowledged action keeps a bounded incomplete draft', { timeout: 10000 }, async (t) => {
  const rec = await startRecording(env.browser, { baseUrl, startPath: '/fault' });
  t.after(() => rec.stop());
  await rec.page.evaluate(() => { window.__buggpsRecord = () => new Promise(() => {}); });
  await rec.page.getByRole('button', { name: 'Launch' }).click();
  await rec.stop();
  assert.ok(rec.result.captureIssues.some((issue) => issue.code === 'recording-connection'));
});

test('legacy recordings require renewed capture and captured observations are bound to the case', async () => {
  const legacy = { source: 'recorded', steps: [{ action: 'goto', url: '/fault' }], expectation, expectedFrom: 'BUG', observeMs: 0 };
  const result = await reproduce(env.browser, legacy, { baseUrl, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID);
  assert.match(result.reason, /record.*again|new recording/i);
  assert.notEqual(hashCase({ ...legacy, captureVersion: 'buggps.capture/v2' }), hashCase({ ...legacy, captureVersion: 'buggps.capture/v2', expectedFrom: 'READY' }));
});

test('a replay that misses the primary or additional captured state cannot lock an unrelated failure', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const { rec, definition } = await capture(t, '/role-list', (page) => page.getByRole('button', { name: 'Launch' }).click());
  await writeFile(join(repo.root, 'index.html'), markup(pages['/role-list']));
  const wrong = { ...definition, steps: definition.steps.filter((step) => step.action !== 'click') };
  const locked = await lockCase(env.browser, env, repo.root, wrong, { baseUrl, id: 'missed-action', runs: 1 });
  assert.equal(locked.status, Status.TEST_INVALID, JSON.stringify(locked));
  assert.match(locked.reason, /recorded.*state|captured.*state/i);
  assert.ok(!locked.caseId);
  const extra = { ...wrong, expectation: { kind: 'no-page-error' }, expectedFrom: null, also: [expectation] };
  const alsoLocked = await lockCase(env.browser, env, repo.root, extra, { baseUrl, id: 'missed-additional-action', runs: 1 });
  assert.equal(alsoLocked.status, Status.TEST_INVALID, JSON.stringify(alsoLocked));
  assert.ok(!alsoLocked.caseId);
  assert.deepEqual(rec.result.captureIssues, []);
});

test('a captured visible state cannot be replaced by a missing target when locking', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const rec = await startRecording(env.browser, { baseUrl, startPath: '/fault', toolbar: true });
  t.after(() => rec.stop());
  rec.page.on('dialog', (dialog) => dialog.accept('EXPECTED'));
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.locator('#out').click();
  await rec.page.getByRole('button', { name: /应可见/ }).click();
  await rec.page.locator('#fault').click();
  await rec.stop();
  assert.equal(rec.result.capturedChecks.find((check) => check.kind === 'visible').observed, true);
  const definition = { ...rec.result, source: 'recorded', steps: [{ action: 'goto', url: '/unlocatable' }], observeMs: 0 };
  const locked = await lockCase(env.browser, env, repo.root, definition, { baseUrl, id: 'missing-visible-state', runs: 1 });
  assert.equal(locked.status, Status.TEST_INVALID, JSON.stringify(locked));
  assert.match(locked.reason, /captured.*state/i);
});

test('a real captured click rejects an unrelated repair and verifies the actual handler repair', { timeout: 120000 }, async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const html = markup(pages['/role-list']);
  await writeFile(join(repo.root, 'index.html'), html);
  const rec = await startRecording(env.browser, { baseUrl, startPath: '/role-list', toolbar: true });
  t.after(() => rec.stop());
  rec.page.on('dialog', (dialog) => dialog.accept('EXPECTED'));
  await rec.page.getByRole('button', { name: 'Launch', exact: true }).click();
  await rec.page.getByRole('button', { name: /预期文本/ }).click();
  await rec.page.locator('#out').click();
  await rec.page.getByRole('button', { name: /结束录制/ }).click();
  await rec.finished;
  const definition = { ...rec.result, source: 'recorded', steps: await rec.stop(), observeMs: 0, serve: await serveSpec(repo.root) };
  definition.steps[0].url = '/';
  const locked = await lockCase(env.browser, env, repo.root, definition, { id: 'real-click', runs: 3 });
  assert.equal(locked.status, Status.REPRODUCED, JSON.stringify(locked));
  assert.equal(locked.red.observed, 'BUG');
  const saved = await loadCase(repo.root, 'real-click');
  assert.equal(saved.body.source, 'recorded');
  assert.equal(saved.body.expectedFrom, 'BUG');
  await writeFile(join(repo.root, 'index.html'), html.replace('>READY</p>', '>EXPECTED</p>'));
  const wrong = await verifyCase(env.browser, env, repo.root, 'real-click', { runs: 3 });
  assert.equal(wrong.verdict, 'STILL_FAILING', JSON.stringify(wrong));
  await writeFile(join(repo.root, 'index.html'), html.replace("setOut('BUG')", "setOut('EXPECTED')"));
  const correct = await verifyCase(env.browser, env, repo.root, 'real-click', { runs: 3 });
  assert.equal(correct.verdict, 'VERIFIED', JSON.stringify(correct));
  assert.equal(correct.baselineControl.matchesLockedFailure, true);
});
