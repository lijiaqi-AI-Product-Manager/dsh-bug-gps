import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';

let root; let env; let server;
const fixture = (title) => '<!doctype html><meta charset="utf-8"><h1>' + title + '</h1><button id="add" onclick="document.querySelector(\'#total\').textContent=\'1\'">Add</button><output id="total">0</output><a href="/about.html">About</a><div contenteditable="true" role="textbox" aria-label="Notes"></div>';
before(async () => { root = await mkdtemp(join(tmpdir(), 'buggps-toolbar-')); await writeFile(join(root, 'index.html'), fixture('Demo')); await writeFile(join(root, 'about.html'), fixture('About')); env = await launchBrowser(); server = await startStaticServer(root); });
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function begin(t) { const rec = await startRecording(env.browser, { baseUrl: server.url, toolbar: true }); t.after(() => rec.stop()); rec.page.setDefaultTimeout(3000); return { rec, page: rec.page, ui: rec.page.locator('#__buggps_toolbar') }; }

test('toolbar language and recorded state survive a full page navigation', async (t) => {
  const { rec, page, ui } = await begin(t);
  await ui.getByRole('button', { name: '预期文本', exact: true }).waitFor();
  assert.equal(await ui.locator('[role="status"]').getAttribute('aria-live'), 'polite');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await ui.getByRole('button', { name: '应可见', exact: true }).click();
  await page.getByRole('heading', { name: 'Demo', exact: true }).click();
  await ui.getByText('已设置 1 项预期', { exact: true }).waitFor();
  await ui.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await ui.getByRole('button', { name: 'Expected text', exact: true }).waitFor();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('heading', { name: 'About', exact: true }).waitFor();
  await ui.getByText('1 expectation set', { exact: true }).waitFor();
  await ui.getByRole('button', { name: 'Finish recording', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click', 'click']);
});

test('selection has an accessible active state and can be cancelled by button or Escape', async (t) => {
  const { rec, page, ui } = await begin(t);
  const choose = ui.getByRole('button', { name: '应可见', exact: true, includeHidden: true });
  await page.getByRole('button', { name: 'Add', exact: true }).focus();
  await choose.click();
  assert.equal(await choose.getAttribute('aria-pressed'), 'true');
  await ui.getByRole('button', { name: '取消选取', exact: true }).click();
  assert.equal(await choose.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#add').evaluate((node) => document.activeElement === node), true);
  await choose.focus(); await choose.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await choose.getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  assert.equal(await page.locator('#total').innerText(), '1');
  assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click']);
});

test('finishing without a positive expectation requires an explicit incomplete finish', async (t) => {
  const { rec, ui } = await begin(t);
  let ended = false; rec.finished.then(() => { ended = true; });
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  await ui.getByText('尚未设置正向预期，当前记录不能确认修复。', { exact: true }).waitFor();
  assert.equal(ended, false);
  await ui.getByRole('button', { name: '继续录制', exact: true }).click();
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  await ui.getByRole('button', { name: '保留未完成记录并结束', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  assert.equal(rec.result.expectation, null);
});

test('unsupported input remains visible without copying its text into the toolbar', async (t) => {
  const { rec, page, ui } = await begin(t);
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('private draft content');
  await ui.getByText('1 项输入问题，当前记录不可用于验证。', { exact: true }).waitFor();
  assert.equal((await ui.innerText()).includes('private draft content'), false);
  assert.equal(rec.result.captureIssues.length, 1);
});

test('toolbar supports eight languages and usable narrow-screen controls without recording its own actions', async (t) => {
  const { rec, page, ui } = await begin(t);
  const language = ui.getByRole('combobox', { name: '界面语言', exact: true });
  assert.equal(await language.locator('option').count(), 8);
  for (const [value, label] of [['en', 'Expected text'], ['ja', '期待するテキスト'], ['ko', '기대 텍스트'], ['de', 'Erwarteter Text'], ['fr', 'Texte attendu'], ['es', 'Texto esperado'], ['pt-BR', 'Texto esperado'], ['zh-CN', '预期文本']]) {
    await ui.locator('select').selectOption(value);
    await ui.getByRole('button', { name: label, exact: true }).waitFor();
  }
  for (const width of [1280, 375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    const bounds = await ui.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify({ width, bounds }));
    for (const box of await ui.getByRole('button').evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length).map((node) => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width })))) assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
  }
  await ui.getByRole('button', { name: '收起工具栏', exact: true }).click();
  assert.equal(await ui.getByRole('button', { name: '预期文本', exact: true }).isVisible(), false);
  await ui.getByRole('button', { name: '展开工具栏', exact: true }).click();
  await ui.getByRole('button', { name: '预期文本', exact: true }).waitFor();
  assert.equal((await rec.stop()).filter((step) => !['goto', 'viewport'].includes(step.action)).length, 0);
});

test('checkpoint and pinned-step summaries survive navigation and preserve the original action', async (t) => {
  const { rec, page, ui } = await begin(t);
  page.on('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await ui.locator('summary').click();
  await ui.getByRole('button', { name: '上一步是关键', exact: true }).click();
  await ui.getByText('0 个检查点 · 1 个关键步骤', { exact: true }).waitFor();
  await ui.locator('summary').click();
  await ui.getByRole('button', { name: '此刻应为', exact: true }).click();
  await page.locator('#total').click();
  await ui.getByText('1 个检查点 · 1 个关键步骤', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await ui.getByText('1 个检查点 · 1 个关键步骤', { exact: true }).waitFor();
  const steps = await rec.stop();
  assert.deepEqual(steps.map((step) => step.action), ['goto', 'click', 'click']);
  assert.equal(steps[1].pinned, true);
  assert.equal(steps[1].check.equals, '1');
});

test('a delayed language request cannot replace a newer choice after navigation', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  await page.evaluate(() => {
    const record = window.__buggpsRecord;
    window.__toolbarLanguageSettled = new Promise((resolve) => { window.__resolveToolbarLanguage = resolve; });
    window.__buggpsRecord = async (event) => {
      if (event.type === 'toolbar' && event.language === 'en') await new Promise((resolve) => setTimeout(resolve, 300));
      const view = await record(event);
      if (event.type === 'toolbar' && event.language === 'en') window.__resolveToolbarLanguage();
      return view;
    };
  });
  await ui.locator('select').selectOption('en');
  await ui.locator('select').selectOption('ja');
  await page.evaluate(() => window.__toolbarLanguageSettled);
  await ui.getByRole('button', { name: '期待するテキスト', exact: true }).waitFor();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await ui.getByRole('button', { name: '期待するテキスト', exact: true }).waitFor();
  assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click']);
});

test('finishing retains a pinned step whose acknowledgement is delayed', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  await ui.getByRole('button', { name: '应可见', exact: true }).click();
  await page.getByRole('heading', { name: 'Demo', exact: true }).click();
  await ui.getByText('已设置 1 项预期', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.evaluate(() => {
    const record = window.__buggpsRecord;
    window.__buggpsRecord = async (event) => {
      if (event.type === 'pin') await new Promise((resolve) => setTimeout(resolve, 500));
      return record(event);
    };
  });
  await ui.locator('summary').click();
  await ui.getByRole('button', { name: '上一步是关键', exact: true }).click();
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  const steps = await rec.stop();
  assert.equal(steps.at(-1).pinned, true);
  assert.deepEqual(steps.map((step) => step.action), ['goto', 'click']);
});

test('absence of page errors alone cannot bypass the positive-expectation warning', async (t) => {
  const { rec, page, ui } = await begin(t);
  await ui.locator('summary').click();
  await ui.getByRole('button', { name: '不应报错', exact: true }).click();
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  await ui.getByText('尚未设置正向预期，当前记录不能确认修复。', { exact: true }).waitFor();
  await ui.getByRole('button', { name: '继续录制', exact: true }).click();
  await ui.getByRole('button', { name: '应可见', exact: true }).click();
  await page.getByRole('heading', { name: 'Demo', exact: true }).click();
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  assert.equal(rec.result.expectation.kind, 'no-page-error');
  assert.equal(rec.result.also[0].kind, 'visible');
});

test('toolbar position and collapsed state survive navigation without adding page actions', async (t) => {
  const { rec, page, ui } = await begin(t);
  await ui.locator('summary').click();
  await ui.getByRole('button', { name: '移动到其他角落', exact: true }).click();
  await ui.getByRole('button', { name: '收起工具栏', exact: true }).click();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await ui.getByRole('button', { name: '展开工具栏', exact: true }).waitFor();
  assert.equal(await ui.getByRole('button', { name: '预期文本', exact: true }).isVisible(), false);
  assert.equal(await ui.evaluate((node) => node.style.left), '12px');
  await ui.getByRole('button', { name: '展开工具栏', exact: true }).click();
  assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click']);
});

test('finishing waits for the last expectation to be acknowledged', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  await page.evaluate(() => {
    const record = window.__buggpsRecord;
    window.__buggpsRecord = (event) => event.type === 'expect'
      ? new Promise((resolve) => setTimeout(() => resolve(record(event)), 500))
      : record(event);
  });
  await ui.getByRole('button', { name: '应可见', exact: true }).click();
  await page.getByRole('heading', { name: 'Demo', exact: true }).click();
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  assert.equal(rec.result.expectation.kind, 'visible');
});

test('unacknowledged events cannot silently finish a recording', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  let ended = false; rec.finished.then(() => { ended = true; });
  await page.evaluate(() => { window.__buggpsFlushRecording = () => new Promise(() => {}); });
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  await ui.getByText('尚未确认全部记录，请检查宿主任务后重试结束。', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(ended, false);
  assert.equal(await ui.getByRole('button', { name: '结束录制', exact: true }).isEnabled(), true);
});

test('an explicit incomplete finish retains an acknowledgement problem in the draft', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  await ui.getByRole('button', { name: '结束录制', exact: true }).click();
  await ui.getByText('尚未设置正向预期，当前记录不能确认修复。', { exact: true }).waitFor();
  await page.evaluate(() => { window.__buggpsFlushRecording = () => new Promise(() => {}); });
  await ui.getByRole('button', { name: '保留未完成记录并结束', exact: true }).click();
  assert.equal(await rec.finished, 'stop');
  assert.equal(rec.result.captureIssues[0].code, 'recording-connection');
});

test('picking uncovers a page result and restores the acceptance summary afterwards', async (t) => {
  const { rec, page, ui } = await begin(t);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    const result = document.createElement('button'); result.id = 'page-result'; result.textContent = 'Page result';
    result.style.cssText = 'position:fixed;right:24px;bottom:140px;height:44px';
    result.onclick = () => { result.dataset.activated = 'true'; };
    document.body.appendChild(result);
  });
  const before = await ui.boundingBox(); const target = await page.locator('#page-result').boundingBox();
  assert.ok(target.y >= before.y && target.y + target.height <= before.y + before.height, 'The result starts underneath the expanded toolbar');
  await ui.getByRole('button', { name: '应可见', exact: true }).click();
  await ui.getByRole('button', { name: '展开工具栏', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Page result', exact: true }).click();
  await ui.getByText('已设置 1 项预期', { exact: true }).waitFor();
  assert.equal(await page.locator('#page-result').getAttribute('data-activated'), null, 'Picking must not execute the page action');
  assert.equal(rec.result.expectation.kind, 'visible');
  assert.equal((await rec.stop()).filter((step) => !['goto', 'viewport'].includes(step.action)).length, 0);
});

test('a language input keeps its intent when older state arrives before change', async (t) => {
  const { rec, page, ui } = await begin(t);
  const observed = await page.evaluate(async () => {
    const root = document.getElementById('__buggps_toolbar').shadowRoot;
    const language = root.getElementById('language');
    const record = window.__buggpsRecord;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__buggpsRecord = async (event) => {
      if (event.type === 'toolbar' && event.language === 'en') await gate;
      return record(event);
    };
    language.value = 'en';
    language.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const previous = await window.__buggpsGetState();
    window.__buggpsUpdateToolbar(previous);
    const selected = language.value;
    language.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    release();
    return { selected, previousLanguage: previous.language };
  });
  assert.equal(observed.previousLanguage, 'zh-CN');
  assert.equal(observed.selected, 'en');
  await ui.getByRole('button', { name: 'Expected text', exact: true }).waitFor();
  assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto']);
});

test('the next page keeps the latest language while an older reply is pending', { timeout: 10000 }, async (t) => {
  let releaseEnglish;
  let japaneseApplied;
  let englishSettled;
  const englishGate = new Promise((resolve) => { releaseEnglish = resolve; });
  const japanese = new Promise((resolve) => { japaneseApplied = resolve; });
  const english = new Promise((resolve) => { englishSettled = resolve; });
  const originalNewContext = env.browser.newContext;
  env.browser.newContext = async (...args) => {
    const context = await originalNewContext.apply(env.browser, args);
    const expose = context.exposeBinding.bind(context);
    context.exposeBinding = (name, callback, options) => expose(name, name === '__buggpsRecord' ? async (source, event) => {
      if (event.type === 'toolbar' && event.language === 'en') await englishGate;
      const view = await callback(source, event);
      if (event.type === 'toolbar' && event.language === 'ja') japaneseApplied();
      if (event.type === 'toolbar' && event.language === 'en') englishSettled();
      return view;
    } : callback, options);
    return context;
  };
  let timer;
  try {
    const { rec, page, ui } = await begin(t);
    env.browser.newContext = originalNewContext;
    await ui.locator('select').selectOption('en');
    await ui.locator('select').selectOption('ja');
    await Promise.race([japanese, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Latest language was not delivered while an older reply was pending')), 1800); })]);
    clearTimeout(timer);
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await ui.getByRole('button', { name: '期待するテキスト', exact: true }).waitFor();
    releaseEnglish();
    await english;
    const state = await page.evaluate(() => window.__buggpsGetState());
    assert.equal(state.language, 'ja');
    await ui.getByRole('button', { name: '期待するテキスト', exact: true }).waitFor();
    assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click']);
  } finally {
    clearTimeout(timer);
    releaseEnglish();
    env.browser.newContext = originalNewContext;
  }
});

test('a delayed language change keeps independent collapse and corner preferences', { timeout: 10000 }, async (t) => {
  const { rec, page, ui } = await begin(t);
  await page.evaluate(() => {
    const record = window.__buggpsRecord;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releaseToolbarPreference = release;
    window.__buggpsRecord = async (event) => {
      if (event.type === 'toolbar' && event.language === 'en') await gate;
      return record(event);
    };
  });
  try {
    await ui.locator('select').selectOption('en');
    await ui.locator('summary').click();
    await ui.getByRole('button', { name: 'Move to another corner', exact: true }).click();
    await ui.getByRole('button', { name: 'Collapse toolbar', exact: true }).click();
    await page.waitForFunction(async () => {
      const view = await window.__buggpsGetState();
      return view.collapsed && view.corner === 'bl';
    }, undefined, { timeout: 3000 });
    await page.evaluate(() => window.__releaseToolbarPreference());
    await page.waitForFunction(async () => (await window.__buggpsGetState()).language === 'en', undefined, { timeout: 3000 });
    const state = await page.evaluate(() => window.__buggpsGetState());
    assert.equal(state.collapsed, true);
    assert.equal(state.corner, 'bl');
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await ui.getByRole('button', { name: 'Expand toolbar', exact: true }).waitFor();
    assert.equal(await ui.evaluate((node) => node.style.left), '12px');
    assert.deepEqual((await rec.stop()).map((step) => step.action), ['goto', 'click']);
  } finally {
    await page.evaluate(() => window.__releaseToolbarPreference?.()).catch(() => {});
  }
});
