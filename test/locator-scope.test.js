import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { resolveTarget } from '../src/core/locator.js';
import { runTrial } from '../src/core/replay.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { canonicalJson } from '../src/core/canonical.js';
import { tempRepo, serveSpec } from './helpers.js';

let env; let server; let baseUrl;
const scope = { role: 'region', name: 'Checkout' };
const scoped = { by: 'text', value: 'Pick', within: scope, index: 0 };
const unscoped = { by: 'text', value: 'Pick' };
const choices = [scoped, unscoped];
const section = (id, value) => `<section aria-label="Checkout"><span>Invoice</span><input id="${id}" aria-label="Total" value="${value}"></section>`;
const duplicate = section('first', 'GOOD') + section('original', 'BAD');
const input = { by: 'role', role: 'textbox', name: 'Total', within: scope, index: 0 };
const html = (ready) => `<!doctype html><section id="scope"><button id="pick" onclick="window.recordPick?.();document.querySelector('#out').textContent=this.closest('section').getAttribute('aria-label')==='Checkout'?'GOOD':'EARLY'">Pick</button></section><p id="out">READY</p>${ready ? '<script>setTimeout(()=>document.querySelector("#scope").setAttribute("aria-label","Checkout"),1000)</script>' : ''}`;

before(async () => {
  env = await launchBrowser();
  server = createServer((req, res) => res.end(req.url === '/duplicate' ? '<!doctype html>' + duplicate : html(req.url === '/ready')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await env?.browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function pageFor(t, path = '/missing') {
  const context = await env.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(baseUrl + path);
  return page;
}

test('an action waits for its named container before using a matching page-wide fallback', async () => {
  const result = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/ready' }, { action: 'click', target: choices }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'GOOD' }, stepTimeoutMs: 4000 });
  assert.equal(result.outcome, 'pass', JSON.stringify(result));
  assert.deepEqual(result.resolutionProfile['step:1'], [canonicalJson(scoped)]);
});

test('a permanently missing scope keeps its exact fallback within the caller budget', async (t) => {
  const page = await pageFor(t);
  const pauses = [];
  const pause = page.waitForTimeout.bind(page);
  page.waitForTimeout = async ms => { pauses.push(ms); await pause(ms); };
  const result = await resolveTarget(page, choices, { timeoutMs: 200 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.used, unscoped);
  assert.ok(pauses.reduce((sum, ms) => sum + ms, 0) <= 200);
});

test('zero-time observation does not add a scope-preference wait', async (t) => {
  const page = await pageFor(t);
  page.waitForTimeout = () => { throw new Error('snapshot must not wait'); };
  const result = await resolveTarget(page, choices, { timeoutMs: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.used, unscoped);
});

test('cancelling a scope wait prevents its fallback action', async () => {
  const controller = new AbortController();
  let timer; let clicked = false;
  try {
    const result = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/missing' }, { action: 'click', target: choices }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'GOOD' }, stepTimeoutMs: 4000, signal: controller.signal, probe: async (page, index) => {
      if (index !== 0) return;
      await page.exposeFunction('recordPick', () => { clicked = true; });
      timer = setTimeout(() => controller.abort(), 80);
    } });
    assert.equal(result.outcome, 'aborted');
    assert.equal(clicked, false);
  } finally { clearTimeout(timer); }
});

test('an index cannot make duplicate named containers unambiguous, including loose names', async (t) => {
  const page = await pageFor(t, '/duplicate');
  for (const name of ['Total', 'Tota']) {
    const result = await resolveTarget(page, [{ ...input, name }], { timeoutMs: 0 });
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, 'ambiguous');
  }
});

test('a duplicate container cannot verify an unchanged bad target through its first match', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const file = join(repo.root, 'index.html');
  const original = '<!doctype html>' + section('original', 'BAD');
  await writeFile(file, original);
  const locked = await lockCase(env.browser, env, repo.root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: [input], equals: 'GOOD' }, serve: await serveSpec(repo.root), observeMs: 0 }, { id: 'scope', runs: 1 });
  assert.equal(locked.caseId, 'scope');
  await writeFile(file, '<!doctype html>' + duplicate);
  const result = await verifyCase(env.browser, env, repo.root, 'scope', { runs: 1 });
  assert.equal(result.verdict, Verdict.TEST_INVALID, JSON.stringify(result));
  assert.match(result.check.reason, /scope ambiguous/);
});

test('a collection check cannot hide duplicate containers behind a scoped index', async () => {
  const result = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/duplicate' }], expectation: { kind: 'count', target: [input], equals: 1 } });
  assert.equal(result.outcome, 'test-invalid');
  assert.match(result.reason, /scope.*ambiguous/);
});

test('unique containers retain indexed controls and unindexed text locators', async (t) => {
  const page = await pageFor(t);
  await page.setContent('<!doctype html><section aria-label="Checkout"><span>Invoice</span><input aria-label="Total" value="FIRST"><input aria-label="Total" value="SECOND"></section>');
  const indexed = await resolveTarget(page, [{ ...input, index: 1 }], { timeoutMs: 0 });
  assert.equal(indexed.ok, true);
  assert.equal(await indexed.locator.inputValue(), 'SECOND');
  const text = await resolveTarget(page, [{ by: 'text', value: 'Invoice', within: scope }], { timeoutMs: 0 });
  assert.equal(text.ok, true);
});

test('an independent exact ID fallback does not inherit a text-scope delay', async (t) => {
  const page = await pageFor(t);
  page.waitForTimeout = () => { throw new Error('independent exact candidate must not wait'); };
  const id = { by: 'css', value: '#pick' };
  const result = await resolveTarget(page, [scoped, id], { timeoutMs: 2000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.used, id);
});

test('a delayed poll cannot discard an exact fallback already available within the budget', async (t) => {
  const page = await pageFor(t);
  const pause = page.waitForTimeout.bind(page);
  page.waitForTimeout = ms => pause(ms + 800);
  const result = await resolveTarget(page, choices, { timeoutMs: 600 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.used, unscoped);
});

test('an unsupported scope is rejected instead of silently searching the entire page', async () => {
  const result = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/missing' }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out', within: scope }], equals: 'READY' } });
  assert.equal(result.outcome, 'test-invalid');
  assert.match(result.reason, /within is supported only/);
});

test('invalid wait budgets cannot create an unbounded locator loop', { timeout: 15000 }, async (t) => {
  const page = await pageFor(t);
  for (const timeoutMs of [NaN, Infinity, -1]) {
    await assert.rejects(resolveTarget(page, choices, { timeoutMs }), /timeoutMs must be a finite, non-negative number/);
  }
});
