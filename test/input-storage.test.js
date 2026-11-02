import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { createToolSpecs } from '../src/dsh/tools.js';
import { lockCase, loadCase } from '../src/core/caselock.js';
import { TestDefinitionError } from '../src/core/errors.js';
import { git } from '../src/core/snapshot.js';

let root; let server; let env;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'buggps-inputs-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><h1>Inputs</h1>'
    + '<label>API token<textarea id="token"></textarea></label>'
    + '<label>密码<input id="password" type="password"></label><label>验证码<input id="otp" autocomplete="one-time-code"></label>'
    + '<label>Password<input id="first" type="password"></label><label>Password<input id="second" type="password"></label><p id="out">BAD</p>');
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
  server = await startStaticServer(root);
  env = await launchBrowser();
});
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

async function recording(t) {
  const rec = await startRecording(env.browser, { baseUrl: server.url });
  t.after(() => rec.stop());
  return rec;
}

test('sensitive textarea values are stored as references', async (t) => {
  const rec = await recording(t);
  const value = 'TEST_ONLY_API_VALUE';
  await rec.page.locator('#token').fill(value);
  const steps = await rec.stop();
  assert.doesNotMatch(JSON.stringify(steps), new RegExp(value));
  assert.equal(typeof steps.find((s) => s.action === 'fill').value.secret, 'string');
});

test('different Chinese secret fields have distinct references and revisiting a field reuses its reference', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('#password').fill('FIRST_TEST_VALUE');
  await rec.page.locator('#otp').fill('SECOND_TEST_VALUE');
  await rec.page.locator('#password').fill('UPDATED_TEST_VALUE');
  const steps = await rec.stop();
  const refs = steps.filter((s) => s.action === 'fill').map((s) => s.value.secret);
  assert.equal(refs.length, 3);
  assert.notEqual(refs[0], refs[1]);
  assert.equal(refs[0], refs[2]);
  assert.doesNotMatch(JSON.stringify(steps), /FIRST_TEST_VALUE|SECOND_TEST_VALUE|UPDATED_TEST_VALUE/);
});

test('separate secret fields with the same label keep separate references', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('#first').fill('FIRST_TEST_VALUE');
  await rec.page.locator('#second').fill('SECOND_TEST_VALUE');
  const refs = (await rec.stop()).filter((s) => s.action === 'fill').map((s) => s.value.secret);
  assert.notEqual(refs[0], refs[1]);
});

test('Chinese draft names preserve independent recordings without overwriting', async () => {
  let driverError;
  const tools = createToolSpecs({ resolveCwd: async () => root, guardActive: () => true, testHooks: {
    headedRecording: false,
    onRecordingPage: (page) => {
      (async () => {
        await page.getByRole('button', { name: /应可见/ }).click();
        await page.getByRole('heading', { name: 'Inputs' }).click();
        await page.getByRole('button', { name: /结束/ }).click();
      })().catch(async (err) => { driverError = err; await page.close(); });
    },
  } });
  const record = tools.find((t) => t.name === 'buggps_record');
  const a = await record.execute({ url: server.url, name: '购物车异常' }, { signal: new AbortController().signal });
  assert.equal(a.status, 'RECORDED', JSON.stringify(a));
  const original = await readFile(join(root, a.draft), 'utf8');
  const b = await record.execute({ url: server.url, name: '表单异常' }, { signal: new AbortController().signal });
  assert.ifError(driverError);
  assert.equal(b.status, 'RECORDED', JSON.stringify(b));
  assert.notEqual(a.draft, b.draft);
  assert.equal(await readFile(join(root, a.draft), 'utf8'), original);
  assert.equal(JSON.parse(original).name, '购物车异常');
  assert.equal(JSON.parse(await readFile(join(root, b.draft), 'utf8')).name, '表单异常');
});

test('case loading rejects a path outside the cases directory', async () => {
  const outside = join(root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'case.json'), '{}');
  await writeFile(join(outside, 'lock.json'), '{}');
  await assert.rejects(() => loadCase(root, '../../outside'), TestDefinitionError);
});

test('locking an existing case refuses to overwrite its saved contract', async () => {
  const definition = { steps: [{ action: 'goto', url: '/' }], expectation: { kind: 'text', target: [{ by: 'css', value: '#out' }], equals: 'GOOD' }, observeMs: 0 };
  const first = await lockCase(env.browser, env, root, definition, { baseUrl: server.url, id: '购物车', runs: 1 });
  assert.equal(first.caseId, '购物车');
  const original = await readFile(join(root, '.buggps', 'cases', first.caseId, 'case.json'), 'utf8');
  await assert.rejects(() => lockCase(env.browser, env, root, { ...definition, expectation: { ...definition.expectation, equals: 'OTHER' } }, { baseUrl: server.url, id: '购物车', runs: 1 }), TestDefinitionError);
  assert.equal(await readFile(join(root, '.buggps', 'cases', first.caseId, 'case.json'), 'utf8'), original);
});
