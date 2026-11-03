import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launchBrowser } from '../src/core/browser.js';
import { runTrial } from '../src/core/replay.js';
import { reproduce, classify, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

const definition = {
  steps: [{ action: 'goto', url: '/' }],
  expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'GOOD' },
  observeMs: 0,
};

async function fixture(t, handler = (_req, res) => res.end('<p id="out">BAD</p>')) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/`;
}

function tracked(t, prepare, { watchdogMs = 2500, contextDelayMs = 0 } = {}) {
  const opened = [];
  const controller = new AbortController();
  const browser = { async newContext(options) {
    const context = await env.browser.newContext(options);
    opened.push(context);
    prepare?.(context);
    if (contextDelayMs) await new Promise((resolve) => setTimeout(resolve, contextDelayMs));
    return context;
  } };
  // The watchdog only bounds the failing implementation; it owns these contexts.
  const watchdog = setTimeout(() => {
    controller.abort();
    for (const context of opened) void context.close().catch(() => {});
  }, watchdogMs);
  t.after(async () => {
    clearTimeout(watchdog);
    await Promise.allSettled(opened.map((context) => context.close()));
  });
  return { browser, opened, signal: controller.signal, controller };
}

test('zero reproduction budget does not start a browser context', async (t) => {
  const run = tracked(t);
  const result = await reproduce(run.browser, definition, { maxMs: 0, runs: 1, signal: run.signal });
  assert.equal(result.status, Status.BUDGET_EXHAUSTED);
  assert.equal(result.runs, 0);
  assert.equal(run.opened.length, 0);
});

test('a total reproduction deadline interrupts an unanswered navigation and keeps shared resources', async (t) => {
  const baseUrl = await fixture(t, () => {});
  const other = await env.browser.newContext();
  t.after(() => other.close());
  const page = await other.newPage();
  await page.setContent('<p>other task</p>');
  const run = tracked(t);
  const started = performance.now();
  const result = await reproduce(run.browser, definition, { baseUrl, maxMs: 250, runs: 1, signal: run.signal });
  assert.equal(result.status, Status.BUDGET_EXHAUSTED, JSON.stringify(result));
  assert.ok(performance.now() - started < 2000, 'the current navigation must not run until the watchdog');
  assert.ok(run.opened.every((context) => !env.browser.contexts().includes(context)));
  assert.equal(await page.textContent('p'), 'other task');
});

for (const contextDelayMs of [0, 3000]) test('cancelling a frozen renderer interrupts the pending action after ' + contextDelayMs + 'ms context readiness', { timeout: 15000 }, async (t) => {
  const baseUrl = await fixture(t, (_req, res) => res.end('<button onclick="console.log(\'frozen\');while(true){}">Freeze</button><p id="out">BAD</p>'));
  let abortedAt;
  const run = tracked(t, (context) => {
    context.on('page', (page) => page.on('console', (message) => {
      if (message.text() !== 'frozen') return;
      abortedAt = performance.now();
      run.controller.abort();
    }));
  }, { contextDelayMs, watchdogMs: 10000 });
  const result = await runTrial(run.browser, { ...definition, baseUrl, steps: [...definition.steps, { action: 'click', target: [{ by: 'role', role: 'button', name: 'Freeze' }] }], signal: run.signal });
  assert.ok(abortedAt, 'the actual page must enter its blocking handler');
  assert.equal(result.outcome, 'aborted');
  assert.ok(performance.now() - abortedAt < 1800, 'cancellation must not depend on the watchdog');
  assert.ok(run.opened.every((context) => !env.browser.contexts().includes(context)));
});

test('page creation failure is classified and closes the context it already opened', async (t) => {
  const run = tracked(t, (context) => { context.newPage = async () => { throw new Error('fixture page creation failure'); }; });
  const result = await runTrial(run.browser, { ...definition, signal: run.signal });
  assert.equal(result.outcome, 'env-error');
  assert.match(result.reason, /page creation failure/);
  assert.ok(run.opened.every((context) => !env.browser.contexts().includes(context)));
});

test('zero minimization budget includes its initial timing replay', async (t) => {
  const baseUrl = await fixture(t);
  const red = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(red.status, Status.REPRODUCED);
  const run = tracked(t);
  const result = await minimize(run.browser, definition, { baseUrl, signature: red.signature, maxMs: 0, signal: run.signal });
  assert.equal(result.status, Status.BUDGET_EXHAUSTED);
  assert.equal(result.confirmed, false);
  assert.equal(run.opened.length, 0);
  assert.deepEqual(result.testCase, definition);
});

test('minimization final confirmation shares the total deadline', async (t) => {
  const baseUrl = await fixture(t, (_req, res) => setTimeout(() => res.end('<p id="out">BAD</p>'), 900));
  const red = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(red.status, Status.REPRODUCED);
  const run = tracked(t);
  const started = performance.now();
  const result = await minimize(run.browser, definition, { baseUrl, signature: red.signature, strategy: 'ddmin', stepTimeoutMs: 1000, maxMs: 300, signal: run.signal });
  assert.equal(result.status, Status.BUDGET_EXHAUSTED, JSON.stringify(result));
  assert.equal(result.confirmed, false);
  assert.equal(result.confirm.status, Status.BUDGET_EXHAUSTED);
  assert.ok(performance.now() - started < 2000);
});

test('dependency probing also stops at the minimization deadline', async (t) => {
  const baseUrl = await fixture(t, (_req, res) => res.end('<style>@keyframes spin{to{transform:rotate(360deg)}}#out{animation:spin 1s infinite}</style><button>Run</button><p id="out">BAD</p>'));
  const input = { ...definition, steps: [...definition.steps, { action: 'click', target: [{ by: 'role', role: 'button', name: 'Run' }] }] };
  const red = await reproduce(env.browser, input, { baseUrl, runs: 1 });
  assert.equal(red.status, Status.REPRODUCED);
  const run = tracked(t);
  const started = performance.now();
  const result = await minimize(run.browser, input, { baseUrl, signature: red.signature, stepTimeoutMs: 1000, maxMs: 300, signal: run.signal });
  assert.equal(result.status, Status.BUDGET_EXHAUSTED, JSON.stringify(result));
  assert.equal(result.confirmed, false);
  assert.ok(performance.now() - started < 2000);
});

test('an already cancelled operation never creates a context', async (t) => {
  const run = tracked(t);
  run.controller.abort();
  assert.equal((await runTrial(run.browser, { ...definition, signal: run.signal })).outcome, 'aborted');
  assert.equal((await reproduce(run.browser, definition, { signal: run.signal })).status, Status.ABORTED);
  const reduced = await minimize(run.browser, definition, { signature: { kind: 'text', target: 'css=#out', actual: 'BAD' }, signal: run.signal });
  assert.equal(reduced.status, Status.ABORTED);
  assert.equal(reduced.confirmed, false);
  assert.equal(run.opened.length, 0);
});

test('a context created after cancellation is closed without creating a page', async (t) => {
  let context;
  let pages = 0;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  t.after(async () => { await context?.close(); });
  const browser = { async newContext(options) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    context = await env.browser.newContext(options);
    context.once('close', resolveClosed);
    const open = context.newPage.bind(context);
    context.newPage = (...args) => { pages++; return open(...args); };
    return context;
  } };
  const result = await runTrial(browser, { ...definition, maxMs: 50 });
  assert.equal(result.outcome, 'budget-exhausted');
  assert.equal(result.cleanup.status, 'pending');
  await closed;
  assert.equal(pages, 0);
  assert.ok(!env.browser.contexts().includes(context));
});

test('a pending page creation is cancelled with its owned context', async (t) => {
  const run = tracked(t, (context) => {
    context.newPage = () => new Promise(() => {});
  });
  const result = await runTrial(run.browser, { ...definition, maxMs: 300 });
  assert.equal(result.outcome, 'budget-exhausted');
  assert.equal(run.opened.length, 1);
  assert.ok(run.opened.every((context) => !env.browser.contexts().includes(context)));
});

test('unacknowledged cleanup is bounded and cannot return a passing outcome', async (t) => {
  const baseUrl = await fixture(t, (_req, res) => res.end('<p id="out">GOOD</p>'));
  let close;
  const browser = { async newContext(options) {
    const context = await env.browser.newContext(options);
    close = context.close.bind(context);
    context.close = () => { void close(); return new Promise(() => {}); };
    return context;
  } };
  t.after(async () => { await close?.(); });
  const started = performance.now();
  const result = await runTrial(browser, { ...definition, baseUrl, maxMs: 10_000 });
  assert.equal(result.outcome, 'env-error');
  assert.equal(result.cleanup.status, 'pending');
  assert.match(result.reason, /cleanup pending/);
  assert.ok(performance.now() - started < 4500);
});

test('invalid budgets and repeat counts are rejected before opening a context', async (t) => {
  const run = tracked(t);
  const signature = { kind: 'text', target: 'css=#out', actual: 'BAD' };
  for (const maxMs of [-1, NaN, Infinity]) {
    await assert.rejects(runTrial(run.browser, { ...definition, maxMs }), /maxMs/);
    await assert.rejects(reproduce(run.browser, definition, { maxMs }), /maxMs/);
    await assert.rejects(minimize(run.browser, definition, { signature, maxMs }), /maxMs/);
  }
  for (const runs of [0, -1, 1.5, Infinity]) await assert.rejects(reproduce(run.browser, definition, { runs }), /runs/);
  for (const options of [{ maxTrials: -1 }, { confirmRuns: 0 }, { concurrency: 0 }]) await assert.rejects(minimize(run.browser, definition, { signature, ...options }));
  assert.equal(run.opened.length, 0);
});

test('interrupted trials cannot be classified as a complete reproduction', () => {
  const failed = { outcome: 'fail', signature: { kind: 'text', target: 'css=#out', actual: 'BAD' } };
  assert.equal(classify([failed, { outcome: 'budget-exhausted' }], 2), Status.BUDGET_EXHAUSTED);
  assert.equal(classify([failed, { outcome: 'aborted' }], 2), Status.ABORTED);
});
