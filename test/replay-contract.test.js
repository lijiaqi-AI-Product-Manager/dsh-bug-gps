import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { lockCase, verifyCase, Verdict } from '../src/core/caselock.js';
import { signatureKey } from '../src/core/oracle.js';
import { git } from '../src/core/snapshot.js';
import { startStaticServer } from '../examples/serve.js';
import { serveSpec } from './helpers.js';

let env;
before(async () => { env = await launchBrowser(); });
after(async () => { await env?.browser.close(); });
const out = [{ by: 'css', value: '#out' }];
const choices = (role, name) => [{ by: 'role', role, name }, { by: 'css', value: '#one' }];

async function fixture(t, html) {
  const root = await mkdtemp(join(tmpdir(), 'buggps-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'index.html');
  await writeFile(file, '<!doctype html><meta charset="utf-8">' + html);
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  return { root, file };
}

async function lock(root, definition) {
  const result = await lockCase(env.browser, env, root, { observeMs: 0, ...definition, serve: await serveSpec(root) }, { id: 'case', runs: 1 });
  assert.equal(result.caseId, 'case', JSON.stringify(result));
  return result;
}

test('an exact assertion switching candidates requires review', async (t) => {
  const html = '<input id="one" aria-label="Amount" value="BAD"><input id="two" aria-label="Amount" value="GOOD">';
  const { root, file } = await fixture(t, html);
  await lock(root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: choices('textbox', 'Amount'), equals: 'GOOD' } });
  await writeFile(file, html.replace('<input id="one" aria-label="Amount" value="BAD">', ''));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.reviewReasons.includes('locator-drift'));
  assert.ok(result.check.resolutionChanges.includes('final:0'));
});

test('an exact action switching candidates requires review', async (t) => {
  const one = '<button id="one" onclick="document.querySelector(\'#out\').textContent=\'BAD\'">Run</button>';
  const two = '<button id="two" onclick="document.querySelector(\'#out\').textContent=\'GOOD\'">Run</button>';
  const { root, file } = await fixture(t, one + two + '<p id="out">BAD</p>');
  await lock(root, { steps: [{ action: 'goto', url: '/' }, { action: 'click', target: choices('button', 'Run') }], expectation: { kind: 'text', target: out, equals: 'GOOD' } });
  await writeFile(file, two + '<p id="out">BAD</p>');
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.ok(result.check.resolutionChanges.includes('step:1'));
});

test('a real fix retaining its fallback target is verified; shrinking cannot switch the failure target', async (t) => {
  const html = '<input id="one" aria-label="Amount" value="BAD"><input id="two" aria-label="Amount" value="BAD">';
  const { root, file } = await fixture(t, html);
  const locked = await lock(root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: choices('textbox', 'Amount'), equals: 'GOOD' } });
  const server = await startStaticServer(root);
  try {
    await writeFile(file, '<input id="two" aria-label="Amount" value="BAD">');
    const changed = await reproduce(env.browser, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: choices('textbox', 'Amount'), equals: 'GOOD' }, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
    assert.notEqual(signatureKey(locked.red.signature), signatureKey(changed.signature));
  } finally { await server.close(); }
  await writeFile(file, html.replace('id="one" aria-label="Amount" value="BAD"', 'id="one" aria-label="Amount" value="GOOD"'));
  const result = await verifyCase(env.browser, env, root, 'case', { runs: 1 });
  assert.equal(result.verdict, Verdict.VERIFIED, JSON.stringify(result));
});

test('a recording keeps its initial browser settings and replays a responsive resize', async (t) => {
  const { root } = await fixture(t, '<button onclick="document.querySelector(\'#out\').textContent=innerWidth<800?\'BAD\':\'GOOD\'">Run</button><p id="out">GOOD</p>');
  const server = await startStaticServer(root);
  t.after(() => server.close());
  const rec = await startRecording(env.browser, { baseUrl: server.url });
  const initial = await rec.page.evaluate(() => ({ width: innerWidth, height: innerHeight, locale: navigator.language, timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone, deviceScaleFactor: devicePixelRatio }));
  try {
    await rec.page.setViewportSize({ width: 600, height: 700 });
    await rec.page.getByRole('button', { name: 'Run' }).click();
  } finally { await rec.stop(); }
  assert.deepEqual(rec.result.browser, { viewport: { width: initial.width, height: initial.height }, locale: initial.locale, timezoneId: initial.timezoneId, deviceScaleFactor: initial.deviceScaleFactor });
  assert.ok(rec.steps.some((s) => s.action === 'viewport' && s.width === 600 && s.pinned));
  const result = await reproduce(env.browser, { steps: rec.steps, browser: rec.result.browser, expectation: { kind: 'text', target: out, equals: 'GOOD' }, observeMs: 0 }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
});

test('failed network requests are checked without retaining URL credentials or query data', async (t) => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/broken')) { req.socket.destroy(); return; }
    res.end('<!doctype html><h1>Ready</h1><script>fetch("/broken?token=fixture-value#secret").catch(()=>{})</script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await reproduce(env.browser, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'no-failed-request' }, also: [{ kind: 'visible', target: [{ by: 'role', role: 'heading', name: 'Ready' }] }], observeMs: 100 }, { baseUrl: `http://127.0.0.1:${server.address().port}/`, runs: 1 });
  assert.equal(result.status, Status.REPRODUCED, JSON.stringify(result));
  assert.match(result.observed, /GET .*\/broken/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-value|#secret/);
});

test('a legacy lock without resolution provenance needs a new lock before verification', async (t) => {
  const { root, file } = await fixture(t, '<p id="out">BAD</p>');
  await lock(root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: out, equals: 'GOOD' } });
  const lockFile = join(root, '.buggps', 'cases', 'case', 'lock.json');
  const manifest = JSON.parse(await readFile(lockFile, 'utf8'));
  delete manifest.red.resolutionProfile;
  await writeFile(lockFile, JSON.stringify(manifest));
  await writeFile(file, '<p id="out">GOOD</p>');
  assert.equal((await verifyCase(env.browser, env, root, 'case', { runs: 1 })).verdict, Verdict.NEEDS_REVIEW);
});

test('an observed fallback is retained after the original candidate returns', async (t) => {
  const html = '<input id="one" aria-label="Amount" value="BAD">';
  const { root, file } = await fixture(t, html);
  await lock(root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: choices('textbox', 'Amount'), equals: 'GOOD' }, observeMs: 1000 });
  await writeFile(file, html.replace('BAD', 'GOOD'));
  let restored = false;
  // Drive the real page between complete samples, so insertion never races the
  // locator count and input read inside one check. Production browser methods still run.
  const controlled = {
    async newContext(options) {
      const context = await env.browser.newContext(options);
      const openPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await openPage();
        const pause = page.waitForTimeout.bind(page);
        let samples = 0;
        page.waitForTimeout = async (ms) => {
          await pause(ms);
          if (ms !== 50) return;
          if (++samples === 1) await page.evaluate(() => {
            const other = document.createElement('input');
            other.id = 'two'; other.setAttribute('aria-label', 'Amount');
            document.body.append(other);
          });
          else if (samples === 2) {
            await page.evaluate(() => document.querySelector('#two').remove());
            restored = true;
          }
        };
        return page;
      };
      return context;
    },
  };
  const result = await verifyCase(controlled, env, root, 'case', { runs: 1 });
  assert.equal(restored, true);
  assert.equal(result.verdict, Verdict.NEEDS_REVIEW);
  assert.equal(result.check.resolutionProfile['final:0'].length, 2);
});

test('draft browser options cannot load arbitrary storage files and are classified as an invalid definition', async () => {
  const result = await reproduce(env.browser, { steps: [], browser: { storageState: 'untrusted-session.json' }, expectation: { kind: 'no-page-error' }, observeMs: 0 }, { runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID);
  assert.match(result.reason, /unsupported browser setting/);
});

test('a target becoming ambiguous between resolution and reading cannot pass observation', async (t) => {
  const html = '<input id="one" aria-label="Amount" value="BAD">';
  const { root, file } = await fixture(t, html);
  await lock(root, { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'value', target: choices('textbox', 'Amount'), equals: 'GOOD' }, observeMs: 1000 });
  await writeFile(file, html.replace('BAD', 'GOOD'));
  let injected = false;
  const changing = {
    async newContext(options) {
      const context = await env.browser.newContext(options);
      const openPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await openPage();
        const role = page.getByRole.bind(page);
        let reads = 0;
        page.getByRole = (...args) => {
          const locator = role(...args);
          if (args[0] !== 'textbox' || args[1]?.name !== 'Amount') return locator;
          const read = locator.inputValue.bind(locator);
          locator.inputValue = async (...readArgs) => {
            if (++reads === 2) {
              await page.evaluate(() => {
                const duplicate = document.createElement('input');
                duplicate.setAttribute('aria-label', 'Amount');
                document.body.append(duplicate);
              });
              injected = true;
            }
            return read(...readArgs);
          };
          return locator;
        };
        return page;
      };
      return context;
    },
  };
  const result = await verifyCase(changing, env, root, 'case', { runs: 1 });
  assert.equal(injected, true);
  assert.equal(result.verdict, Verdict.DIFFERENT_FAILURE);
  assert.match(result.check.observed, /target has no input value/);
});
