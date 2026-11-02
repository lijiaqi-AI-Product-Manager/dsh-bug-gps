import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { git } from '../src/core/snapshot.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });

const target = [{ by: 'testId', value: 'out' }];
const click = { action: 'click', target: [{ by: 'role', role: 'button', name: 'Run' }] };
const page = (script = '', extra = '') => '<!doctype html><meta charset="utf-8">' + extra
  + '<button onclick="run()">Run</button><p data-testid="out" role="status" aria-label="Result">BAD</p><script>function run(){' + script + '}</script>';

async function locked(t, html, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'buggps-observation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'index.html');
  await writeFile(file, html);
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  const serve = await serveSpec(root);
  const definition = { steps: [{ action: 'goto', url: '/' }, click], expectation: { kind: 'text', target, equals: 'GOOD' }, observeMs: 1000, ...extra, serve };
  const result = await lockCase(env.browser, env, root, definition, { id: 'case', runs: 1 });
  assert.equal(result.caseId, 'case', JSON.stringify(result));
  return { root, file };
}

test('a temporary wrong value inside the observation window cannot be VERIFIED', async (t) => {
  const { root, file } = await locked(t, page());
  await writeFile(file, page('const out=document.querySelector("[data-testid=out]");out.textContent="GOOD";setTimeout(()=>out.textContent="BAD",200);setTimeout(()=>out.textContent="GOOD",650);'));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.STILL_FAILING);
  const run = JSON.parse(await readFile(join(root, '.buggps', 'runs', result.runId + '.json'), 'utf8'));
  assert.equal(run.check.observation.method, 'poll');
  assert.equal(run.check.observation.intervalMs, 50);
});

test('a final assertion using a newly loose locator requires review', async (t) => {
  const { root, file } = await locked(t, page(), { expectation: { kind: 'text', target: [{ by: 'role', role: 'status', name: 'Result' }], equals: 'GOOD' }, observeMs: 0 });
  await writeFile(file, page().replace('aria-label="Result">BAD', 'aria-label="Result backup">GOOD'));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.reviewReasons.includes('locator-drift'));
  assert.ok(result.check.looseChecks.includes('final:0'));
});

test('a checkpoint using a newly loose locator requires review', async (t) => {
  const input = '<label>Current <input id="field"></label>';
  const steps = [{ action: 'goto', url: '/' }, { action: 'fill', target: [{ by: 'css', value: '#field' }], value: 'alice', check: { kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'Current' }], equals: 'alice' } }, click];
  const { root, file } = await locked(t, page('', input), { steps, observeMs: 0 });
  await writeFile(file, page('document.querySelector("[data-testid=out]").textContent="GOOD";', input.replace('Current ', 'Current backup ')));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.check.looseChecks.includes('checkpoint:1'));
});

test('an additional assertion using a newly loose locator requires review', async (t) => {
  const heading = '<h1>Details</h1>';
  const also = [{ kind: 'visible', target: [{ by: 'role', role: 'heading', name: 'Details' }] }];
  const { root, file } = await locked(t, page('', heading), { also, observeMs: 0 });
  await writeFile(file, page('document.querySelector("[data-testid=out]").textContent="GOOD";', '<h1>Details backup</h1>'));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.check.looseChecks.includes('final:1'));
});
