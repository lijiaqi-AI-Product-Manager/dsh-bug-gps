// The DSH tool layer exercised without DSH: execute() is called the way the tool registry
// would, with an exec that only carries a signal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, serveSpec } from './helpers.js';
import { startStaticServer } from '../examples/serve.js';
import { launchBrowser } from '../src/core/browser.js';
import { recordSession } from '../bench/sessions.js';
import { createToolSpecs } from '../src/dsh/tools.js';
import { hashCase } from '../src/core/caselock.js';

let repo; let server; let guard = true; let tools; let serve; let serveCmd;
const exec = () => ({ signal: new AbortController().signal });
const run = (name, args) => tools.find((t) => t.name === name).execute(args, exec());
const appJs = () => join(repo.root, 'app.js');
const BUG = /\/\/ SEEDED BUG 1: should call recompute\(\);[^\r\n]*\r?\n\s*renderCart\(\);/;

before(async () => {
  repo = await tempRepo();
  server = await startStaticServer(repo.root);
  serve = await serveSpec(repo.root);
  // As a user would type it: quoted paths (the repo path contains a space).
  serveCmd = `node "${serve.command[1]}" "${serve.command[2]}" ${serve.command[3]}`;
  tools = createToolSpecs({ resolveCwd: async () => repo.root, guardActive: () => guard });
  // A draft as buggps_record would have saved it (recorded from real DOM events, scripted user).
  const env = await launchBrowser();
  const s = await recordSession(env.browser, server.url, 'stale-discount');
  await env.browser.close();
  await mkdir(join(repo.root, '.buggps', 'drafts'), { recursive: true });
  await writeFile(join(repo.root, '.buggps', 'drafts', 'coupon.json'), JSON.stringify({ schema: 'buggps.draft/v1', steps: s.steps, expectation: s.expectation }));
});
after(async () => { await server?.close(); await repo?.cleanup(); });

test('every tool result is plain JSON with a status (what defineTool will validate)', () => {
  for (const t of tools) {
    assert.match(t.name, /^buggps_[a-z]+$/);
    assert.equal(t.output.schema.type, 'object');
    assert.ok(t.timeoutMs > 0);
  }
});

test('lock: dev server down is ENV_BLOCKED and nothing is locked', async () => {
  const r = await run('buggps_lock', { url: 'http://127.0.0.1:9/', draft: '.buggps/drafts/coupon.json' });
  assert.equal(r.status, 'ENV_BLOCKED');
  const st = await run('buggps_status', {});
  assert.deepEqual(st.cases, []);
});

test('lock -> verify(no change) -> verify(wrong fix) -> verify(real fix)', async () => {
  const locked = await run('buggps_lock', { draft: '.buggps/drafts/coupon.json', case_id: 'coupon', serve: serveCmd, serve_url: serve.url });
  assert.equal(locked.status, 'LOCKED', JSON.stringify(locked));
  assert.match(locked.binding, /^managed/);
  assert.equal(locked.observed_now, '$17.00');
  assert.equal(locked.minimization.model_calls, 0);
  assert.ok(locked.shortened_steps.length < locked.recorded_steps);

  assert.equal((await run('buggps_verify', { case_id: 'coupon' })).status, 'NO_CODE_CHANGE');

  const src = await readFile(appJs(), 'utf8');
  await writeFile(appJs(), src.replace('let total = subtotal() - state.discount;', 'let total = Math.max(0, subtotal() - state.discount);'));
  const wrong = await run('buggps_verify', { case_id: 'coupon' });
  assert.equal(wrong.status, 'STILL_FAILING');
  assert.match(wrong.next, /Keep working/);

  await writeFile(appJs(), src.replace(BUG, 'recompute();'));
  const ok = await run('buggps_verify', { case_id: 'coupon' });
  assert.equal(ok.status, 'VERIFIED', JSON.stringify(ok));
  assert.match(ok.patch, /app\.js/);
  assert.equal(ok.shortened_case_agrees, true);
  const runRecord = JSON.parse(await readFile(join(repo.root, ok.run_record), 'utf8'));
  assert.equal(runRecord.verdict, 'VERIFIED');
});

test('changing only lock metadata is CASE_TAMPERED in-session', async () => {
  const file = join(repo.root, '.buggps', 'cases', 'coupon', 'lock.json');
  const original = await readFile(file, 'utf8');
  const manifest = JSON.parse(original);
  manifest.red.observed = 'changed evidence';
  await writeFile(file, JSON.stringify(manifest));
  try { assert.equal((await run('buggps_verify', { case_id: 'coupon' })).status, 'CASE_TAMPERED'); }
  finally { await writeFile(file, original); }
});

test('rewriting case.json AND lock.json consistently (shell bypass) is still CASE_TAMPERED in-session', async () => {
  const dir = join(repo.root, '.buggps', 'cases', 'coupon');
  const body = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(dir, 'lock.json'), 'utf8'));
  body.expectation = { kind: 'visible', target: body.expectation.target }; // weakened
  lock.caseSha256 = hashCase(body); // a consistent rewrite: file hashes alone cannot tell
  await writeFile(join(dir, 'case.json'), JSON.stringify(body));
  await writeFile(join(dir, 'lock.json'), JSON.stringify(lock));
  const r = await run('buggps_verify', { case_id: 'coupon' });
  assert.equal(r.status, 'CASE_TAMPERED');
});

test('verify refuses to judge when write protection is not active', async () => {
  guard = false;
  try {
    const r = await run('buggps_verify', { url: server.url, case_id: 'coupon' });
    assert.equal(r.status, 'ENV_BLOCKED');
    assert.match(r.message, /write protection is not active/);
  } finally { guard = true; }
});

test('status lists the case with its latest verdict', async () => {
  const st = await run('buggps_status', { url: server.url });
  assert.equal(st.write_protection, 'active');
  assert.equal(st.dev_server, 'reachable');
  assert.equal(st.cases[0].case_id, 'coupon');
  assert.ok(st.cases[0].latest.verdict);
  assert.equal(st.cases[0].binding, 'managed');
  assert.equal(typeof st.cases[0].latest.applies_to_current_code, 'boolean');
  assert.equal(st.cases[0].latest.applies_to_current_code, false, 'changed conditions invalidate the historical verdict');
});

test('record: toolbar flow saves a draft the agent can lock', async () => {
  const recTools = createToolSpecs({
    resolveCwd: async () => repo.root,
    guardActive: () => true,
    testHooks: {
      headedRecording: false,
      onRecordingPage: (page) => {
        page.on('dialog', (d) => d.accept('$18.00'));
        (async () => {
          await page.getByRole('button', { name: 'Add Apple' }).click();
          await page.getByRole('button', { name: 'Add Banana' }).click();
          await page.getByRole('textbox', { name: 'Coupon' }).fill('SAVE10');
          await page.getByRole('button', { name: 'Apply coupon' }).click();
          await page.getByRole('button', { name: 'Remove Apple' }).click();
          await page.locator('#__buggps_toolbar summary').click();
          await page.getByRole('button', { name: /上一步是关键/ }).click();
          await page.getByRole('button', { name: /预期文本/ }).click();
          await page.getByTestId('total').click();
          await page.getByRole('button', { name: /结束/ }).click();
        })();
      },
    },
  });
  const r = await recTools[0].execute({ url: server.url, name: 'by hand' }, exec());
  assert.equal(r.status, 'RECORDED', JSON.stringify(r));
  assert.match(r.draft, /^\.buggps\/drafts\/[0-9a-f-]+\.json$/);
  assert.equal(JSON.parse(await readFile(join(repo.root, r.draft), 'utf8')).name, 'by hand');
  assert.ok(JSON.parse(await readFile(join(repo.root, r.draft), 'utf8')).browser.viewport.width > 0);
  assert.equal(r.user_saw, '$18.00'); // the repo's code is fixed by now, so the page is right
  assert.equal(r.key_steps.length, 1);
});
