import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { tempRepo, serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

test('a dynamic filename uses its fixed prefix without merging different wrong prefixes', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const file = join(repo.root, 'index.html');
  const page = (prefix) => `<!doctype html><input aria-label="Filename" id="name"><script>document.querySelector('#name').value='${prefix}_'+Date.now()</script>`;
  await writeFile(file, page('Old'));
  const locked = await lockCase(env.browser, env, repo.root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'Filename' }], equals: 'New_', comparison: 'startsWith' }, observeMs: 0, serve: await serveSpec(repo.root) }, { id: 'prefix' });
  assert.equal(locked.caseId, 'prefix', JSON.stringify(locked));
  await writeFile(file, page('Other'));
  assert.equal((await verifyCase(env.browser, env, repo.root, 'prefix', { runs: 1 })).verdict, Verdict.DIFFERENT_FAILURE);
  await writeFile(file, page('New'));
  assert.equal((await verifyCase(env.browser, env, repo.root, 'prefix', { runs: 1 })).verdict, Verdict.VERIFIED);
});

test('collection checks retain their explicit selector and distinguish wrong counts', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const file = join(repo.root, 'index.html');
  const page = (count) => '<!doctype html>' + '<a href="/feature">Feature</a>'.repeat(count);
  await writeFile(file, page(1));
  const locked = await lockCase(env.browser, env, repo.root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'count', target: [{ by: 'css', value: 'a[href="/feature"]' }], equals: 2 }, observeMs: 0, serve: await serveSpec(repo.root) }, { id: 'count' });
  assert.equal(locked.caseId, 'count', JSON.stringify(locked));
  await writeFile(file, page(0));
  assert.equal((await verifyCase(env.browser, env, repo.root, 'count', { runs: 1 })).verdict, Verdict.DIFFERENT_FAILURE);
  await writeFile(file, page(2));
  assert.equal((await verifyCase(env.browser, env, repo.root, 'count', { runs: 1 })).verdict, Verdict.VERIFIED);
});

for (const kind of ['count', 'hidden']) test(`${kind} absence alone cannot verify a feature removed by a no-op handler`, async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const file = join(repo.root, 'index.html');
  const html = '<!doctype html><button onclick="document.body.insertAdjacentHTML(\'beforeend\',\'<p class=error>Broken</p>\')">Run</button>';
  await writeFile(file, html);
  const locked = await lockCase(env.browser, env, repo.root, { steps: [{ action: 'goto', url: '/' }, { action: 'click', target: [{ by: 'role', role: 'button', name: 'Run' }] }], expectation: { kind, target: [{ by: 'css', value: '.error' }], ...(kind === 'count' ? { equals: 0 } : {}) }, observeMs: 0, serve: await serveSpec(repo.root) }, { id: 'absence', runs: 1 });
  assert.equal(locked.caseId, 'absence');
  await writeFile(file, '<!doctype html><button>Run</button>');
  const result = await verifyCase(env.browser, env, repo.root, 'absence', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.reviewReasons.includes('negative-only'));
});
