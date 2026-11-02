import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { runTrial } from '../src/core/replay.js';
import { reproduce, classify, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';
import { signatureKey } from '../src/core/oracle.js';
import { lockCase } from '../src/core/caselock.js';
import { tempRepo, serveSpec } from './helpers.js';

let env; let server; let baseUrl;
const missing = '<!doctype html><p id="primary">BAD</p>';
const staging = missing + '<p id="extra">WAITING</p><button onclick="document.querySelector(\'#extra\').textContent=\'READY\'">Stage</button><button onclick="document.querySelector(\'#extra\').textContent=\'OTHER\'">Other</button>';
const choices = missing + '<input id="expected" aria-label="Status" value="READY"><input id="other" aria-label="Status" value="READY"><button onclick="document.querySelector(\'#other\').remove()">Stage</button>';
const css = value => [{ by: 'css', value }];
const primary = { kind: 'text', target: css('#primary'), equals: 'GOOD' };
const extra = { kind: 'text', target: css('#extra'), equals: 'READY' };
const click = name => ({ action: 'click', target: [{ by: 'role', role: 'button', name }] });
before(async () => {
  env = await launchBrowser();
  server = createServer((req, res) => res.end(req.url === '/missing' ? missing : req.url === '/locators' ? choices : staging));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await env?.browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test('a later invalid check takes precedence over an earlier business failure', async () => {
  const result = await runTrial(env.browser, { baseUrl, steps: [{ action: 'goto', url: '/missing' }], expectation: primary, also: [extra], settleMs: 0 });
  assert.equal(result.outcome, 'test-invalid');
  assert.equal(result.check, 1);
  assert.match(result.reason, /not-found/);
});

test('shortening cannot turn a passing extra check into a second failure', async () => {
  const definition = { steps: [{ action: 'goto', url: '/' }, click('Stage')], expectation: primary, also: [extra], observeMs: 0 };
  const red = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(red.status, Status.REPRODUCED);
  const reduced = await minimize(env.browser, definition, { baseUrl, signature: red.signature, strategy: 'ddmin', confirmRuns: 1, maxTrials: 8, maxMs: 30_000 });
  assert.equal(reduced.confirmed, true);
  assert.deepEqual(reduced.keptIndices, [0, 1]);
  assert.ok(reduced.stats.differentFailure > 0);
  const brokenContext = await runTrial(env.browser, { ...definition, baseUrl, steps: [{ action: 'goto', url: '/' }] });
  assert.notEqual(signatureKey(red.signature, 'loose'), signatureKey(brokenContext.signature, 'loose'), 'loose matching still preserves passing extra conditions');
});

test('different extra failures do not share the first failure fingerprint', async () => {
  const definition = { expectation: primary, also: [extra], observeMs: 0 };
  const waiting = await runTrial(env.browser, { ...definition, baseUrl, steps: [{ action: 'goto', url: '/' }] });
  const other = await runTrial(env.browser, { ...definition, baseUrl, steps: [{ action: 'goto', url: '/' }, click('Other')] });
  assert.equal(waiting.outcome, 'fail');
  assert.equal(other.outcome, 'fail');
  assert.notEqual(signatureKey(waiting.signature), signatureKey(other.signature));
  assert.equal(classify([waiting, other], 2), Status.FLAKY);
});

test('shortening cannot switch a passing check to another candidate', async () => {
  const definition = { steps: [{ action: 'goto', url: '/locators' }, click('Stage')], expectation: primary, also: [{ kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'Status' }, { by: 'css', value: '#other' }], equals: 'READY' }], observeMs: 0 };
  const red = await reproduce(env.browser, definition, { baseUrl, runs: 1 });
  assert.equal(red.status, Status.REPRODUCED);
  const reduced = await minimize(env.browser, definition, { baseUrl, signature: red.signature, strategy: 'ddmin', confirmRuns: 1, maxTrials: 8, maxMs: 30_000 });
  assert.equal(reduced.confirmed, true);
  assert.deepEqual(reduced.keptIndices, [0, 1]);
});

test('a masked invalid extra check cannot establish a locked failure', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  await writeFile(join(repo.root, 'index.html'), missing);
  const result = await lockCase(env.browser, env, repo.root, { steps: [{ action: 'goto', url: '/' }], expectation: primary, also: [extra], observeMs: 0, serve: await serveSpec(repo.root) }, { id: 'invalid-extra', runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID);
  assert.equal(result.caseId, undefined);
});
