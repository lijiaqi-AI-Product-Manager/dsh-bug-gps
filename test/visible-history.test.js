import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { runTrial } from '../src/core/replay.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { EVALUATOR_VERSION } from '../src/core/oracle.js';
import { startStaticServer } from '../examples/serve.js';
import { tempRepo, serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

const html = (id = 'receipt') => `<!doctype html><h1 id="${id}">Receipt</h1><p id="out">Ready</p><button onclick="preview()">Preview</button><button>Continue</button><script>function preview(){document.getElementById('out').textContent='Preview opened';document.querySelector('h1').remove();}</script>`;
const css = (value) => [{ by: 'css', value }];
const click = (name) => ({ action: 'click', target: [{ by: 'role', role: 'button', name }] });

async function fixture(t) {
  const repo = await tempRepo();
  const file = join(repo.root, 'index.html');
  await writeFile(file, html());
  const server = await startStaticServer(repo.root);
  t.after(async () => { try { await server.close(); } finally { await repo.cleanup(); } });
  return { ...repo, file, url: server.url };
}

test('a never-seen extra target cannot borrow visibility from the primary target', async (t) => {
  const app = await fixture(t);
  const r = await runTrial(env.browser, { baseUrl: app.url, steps: [{ action: 'goto', url: '/' }, click('Continue')], expectation: { kind: 'visible', target: css('#receipt') }, also: [{ kind: 'visible', target: css('#never') }] });
  assert.equal(r.outcome, 'fail');
  assert.equal(r.check, 1);
  assert.match(r.observed, /never visible/);
});

test('an extra visible condition retains its own earlier candidate after DOM removal', async (t) => {
  const app = await fixture(t);
  const r = await runTrial(env.browser, { baseUrl: app.url, steps: [{ action: 'goto', url: '/' }, click('Preview')], expectation: { kind: 'text', target: css('#out'), equals: 'Preview opened' }, also: [{ kind: 'visible', target: css('#receipt') }] });
  assert.equal(r.outcome, 'fail');
  assert.equal(r.check, 1);
  assert.match(r.observed, /was visible earlier/);
  assert.deepEqual(r.signature.priorResolution, { by: 'css', value: '#receipt' });
  assert.equal(r.signature.resolution, undefined);
  assert.equal(r.visibilityHistory['final:1'].seen, true);
  assert.ok(r.resolutionProfile['final:1']?.includes(JSON.stringify({ by: 'css', value: '#receipt' })));
});

test('restoring a removed element with the original candidate is verified with a fresh baseline', async (t) => {
  const app = await fixture(t);
  const definition = { steps: [{ action: 'goto', url: '/' }, click('Preview')], expectation: { kind: 'visible', target: css('#receipt') }, also: [{ kind: 'text', target: css('#out'), equals: 'Preview opened' }], serve: await serveSpec(app.root), observeMs: 100 };
  const locked = await lockCase(env.browser, env, app.root, definition, { id: 'removed', runs: 1 });
  assert.equal(locked.caseId, 'removed');
  await writeFile(app.file, html().replace("document.querySelector('h1').remove()", "document.querySelector('h1').dataset.saved='yes'"));
  const verified = await verifyCase(env.browser, env, app.root, 'removed', { runs: 1 });
  assert.equal(verified.verdict, Verdict.VERIFIED, JSON.stringify(verified));
  assert.equal(verified.baselineControl?.matchesLockedFailure, true);
});

test('restoring a removed element through a different candidate still requires review', async (t) => {
  const app = await fixture(t);
  const definition = { steps: [{ action: 'goto', url: '/' }, click('Preview')], expectation: { kind: 'visible', target: [...css('#receipt'), ...css('#replacement')] }, also: [{ kind: 'text', target: css('#out'), equals: 'Preview opened' }], serve: await serveSpec(app.root), observeMs: 0 };
  assert.equal((await lockCase(env.browser, env, app.root, definition, { id: 'changed', runs: 1 })).caseId, 'changed');
  await writeFile(app.file, html('replacement').replace("document.querySelector('h1').remove()", "document.querySelector('h1').dataset.saved='yes'"));
  const verified = await verifyCase(env.browser, env, app.root, 'changed', { runs: 1 });
  assert.equal(verified.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(verified.reviewReasons.includes('locator-drift'));
});

test('an earlier substring match does not establish that the exact target appeared', async (t) => {
  const app = await fixture(t);
  await writeFile(app.file, html().replace('>Receipt</h1>', '>Receipt preview</h1>'));
  const r = await runTrial(env.browser, { baseUrl: app.url, steps: [{ action: 'goto', url: '/' }, click('Preview')], expectation: { kind: 'visible', target: [{ by: 'role', role: 'heading', name: 'Receipt' }] } });
  assert.equal(r.outcome, 'fail');
  assert.match(r.observed, /never visible/);
  assert.equal(r.signature.priorResolution, undefined);
});

test('a pending visibility read cannot prevent closing a frozen page', { timeout: 15_000 }, async (t) => {
  const app = await fixture(t);
  await writeFile(app.file, '<!doctype html><h1 id="receipt">Receipt</h1><button onclick="while(true){}">Freeze</button>');
  const started = Date.now();
  const r = await runTrial(env.browser, { baseUrl: app.url, steps: [{ action: 'goto', url: '/' }, click('Freeze')], expectation: { kind: 'visible', target: css('#receipt') }, stepTimeoutMs: 400 });
  assert.equal(r.outcome, 'step-error');
  assert.ok(Date.now() - started < 10_000, 'the owned context must close despite its pending DOM read');
});

test('an evaluator change is reported separately from an actual locator change', async (t) => {
  const app = await fixture(t);
  const definition = { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: css('#out'), equals: 'GOOD' }, serve: await serveSpec(app.root), observeMs: 0 };
  assert.equal((await lockCase(env.browser, env, app.root, definition, { id: 'legacy', runs: 1 })).caseId, 'legacy');
  const path = join(app.root, '.buggps/cases/legacy/lock.json');
  const previous = JSON.parse(await readFile(path, 'utf8'));
  previous.red.evaluator = 'buggps.oracle/v3';
  await writeFile(path, JSON.stringify(previous));
  await writeFile(app.file, html().replace('>Ready</p>', '>GOOD</p>'));
  const r = await verifyCase(env.browser, env, app.root, 'legacy', { runs: 1 });
  assert.equal(r.verdict, Verdict.NEEDS_REVIEW);
  assert.deepEqual(r.reviewReasons, ['evaluator-changed']);
  assert.deepEqual(r.check.evaluatorChange, { locked: 'buggps.oracle/v3', current: EVALUATOR_VERSION });
  assert.equal(r.check.resolutionChanges, undefined);
});
