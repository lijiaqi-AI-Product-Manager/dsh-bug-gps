import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { stepLabel } from '../src/core/describe.js';
import { createToolSpecs } from '../src/dsh/tools.js';
import { readFile } from 'node:fs/promises';

let root; let env; let server;
const text = 'Table documents {\n id int [pk]\n body text\n}';
const editorTarget = [{ by: 'css', value: '#editor' }];
const paste = (value = text) => ({ action: 'paste', editor: 'monaco', mode: 'replace-all', target: editorTarget, value });
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'buggps-paste-'));
  await writeFile(join(root, 'index.html'), `<!doctype html><meta charset="utf-8">
    <div><div>SQL Script</div><div class="monaco-editor"><textarea id="editor" aria-label="Editor content">previous content</textarea></div></div>
    <label>Password<textarea id="secret"></textarea></label><label>Plain<input id="plain"></label>
    <div contenteditable="true" aria-label="Rich editor"></div><pre id="out"></pre>
    <div class="CodeMirror"><textarea id="legacy"></textarea></div>
    <script>
      const editor=document.getElementById('editor');
      const query=new URL(location.href).searchParams;
      if(query.has('duplicate')) document.body.insertAdjacentHTML('afterbegin','<div class="monaco-editor"><textarea aria-label="Editor content">example one</textarea></div><div class="monaco-editor"><textarea aria-label="Editor content">example two</textarea></div>');
      if(query.has('secret')) editor.setAttribute('aria-label','API token');
      if(query.has('disabled')) editor.disabled=true;
      if(query.has('readonly')) editor.readOnly=true;
      editor.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){console.log('paste-selected');if(query.has('lock-on-select'))editor.readOnly=true;}});
      editor.addEventListener('paste',event=>{
        if(query.has('unhandled')) return;
        event.preventDefault();
        console.log('paste-handled');
        if(editor.disabled||editor.readOnly) return;
        const metadataMatches=event.clipboardData.types.join('|')==='text/html|text/plain|application/x-fixture'&&event.clipboardData.getData('text/html')==='<b>formatted</b>'&&event.clipboardData.getData('application/x-fixture')==='{"multicursor":false}';
        const value=query.has('metadata')&&!metadataMatches?'missing clipboard format':event.clipboardData.getData('text/plain');
        editor.setRangeText(value,editor.selectionStart,editor.selectionEnd,'end');
        document.getElementById('out').textContent=editor.value;
        if(query.has('input')) editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
      });
    </script>`);
  env = await launchBrowser();
  server = await startStaticServer(root);
});
after(async () => { await env?.browser.close(); await server?.close(); if (root) await rm(root, { recursive: true, force: true }); });

async function recording(t, path = '/') {
  const rec = await startRecording(env.browser, { baseUrl: server.url, startPath: path });
  t.after(() => rec.stop());
  return rec;
}
async function sendPaste(page, target, value) {
  await target.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', content);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, value);
}
const definition = (step) => ({ steps: [{ action: 'goto', url: '/' }, step], expectation: { kind: 'value', target: editorTarget, equals: text }, also: [{ kind: 'text', target: [{ by: 'css', value: '#out' }], equals: text.replace(/\s+/g, ' ') }], observeMs: 0 });

test('a consumed full-replacement paste is captured and replayed without typing conversion', async (t) => {
  const rec = await recording(t, '/?input');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await sendPaste(rec.page, field, text);
  assert.equal(await rec.page.locator('#out').textContent(), text);
  const steps = await rec.stop();
  const inputs = steps.filter((step) => ['paste', 'fill'].includes(step.action));
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].action, 'paste');
  assert.equal(inputs[0].mode, 'replace-all');
  assert.equal(inputs[0].value, text);
  assert.equal(rec.dropped.length, 0);
  const result = await reproduce(env.browser, { ...definition(paste()), steps }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});

test('paste replay replaces existing content exactly and preserves target provenance', async () => {
  const result = await reproduce(env.browser, definition(paste()), { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
  assert.deepEqual(result.resolutionProfile['step:1'], [JSON.stringify(editorTarget[0])]);
});

test('an unhandled clipboard event is TEST_INVALID rather than a successful action', async () => {
  const input = definition(paste()); input.steps[0].url = '/?unhandled';
  const result = await reproduce(env.browser, input, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
  assert.match(result.reason, /paste.*handled|handled.*paste/i);
});

test('partial editor paste is identified as incomplete without keeping clipboard text', async (t) => {
  const rec = await recording(t);
  await sendPaste(rec.page, rec.page.locator('#editor'), text);
  await rec.stop();
  assert.ok(rec.dropped.length);
  assert.ok(rec.result.captureIssues?.length);
  assert.doesNotMatch(JSON.stringify(rec.result.captureIssues), /Table documents/);
});

test('typing into an opaque editor cannot silently become a normal fill recording', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('#editor').fill(text);
  const steps = await rec.stop();
  assert.ok(rec.result.captureIssues?.length);
  assert.equal(steps.filter((step) => step.action === 'fill').length, 0);
});

test('secret editor paste stores only a reference', async (t) => {
  const rec = await recording(t, '/?secret');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await sendPaste(rec.page, field, 'PASTE_SECRET_FIXTURE');
  const steps = await rec.stop();
  const step = steps.find((value) => value.action === 'paste');
  assert.ok(step?.value?.secret);
  assert.equal(step.editor, 'monaco');
  assert.equal(step.mode, 'replace-all');
  assert.doesNotMatch(JSON.stringify({ steps, result: rec.result, dropped: rec.dropped }), /PASTE_SECRET_FIXTURE/);
});

test('legacy fill in a code editor is rejected with a usable next action', async () => {
  const result = await reproduce(env.browser, definition({ action: 'fill', target: editorTarget, value: text }), { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
  assert.match(result.reason, /editor.*paste|paste.*editor/i);
});

test('paste labels summarize large text without copying its contents', () => {
  const label = stepLabel(paste(text));
  assert.match(label, /paste/);
  assert.doesNotMatch(label, /Table documents/);
});

test('an incomplete recording is rejected before browser startup', async () => {
  let opened = false;
  const browser = { newContext() { opened = true; throw new Error('must not open'); } };
  const result = await reproduce(browser, { ...definition(paste()), captureIssues: [{ code: 'editor-input', message: 'partial editor input' }] }, { runs: 1 });
  assert.equal(result.status, Status.TEST_INVALID);
  assert.equal(result.runs, 0);
  assert.match(result.reason, /incomplete.*partial/i);
  assert.equal(opened, false);
});

test('a unique adjacent caption distinguishes three same-name editors without a position', async (t) => {
  const rec = await recording(t, '/?duplicate');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await sendPaste(rec.page, field, text);
  const steps = await rec.stop();
  const input = steps.find((step) => step.action === 'paste');
  assert.equal(input.target[0].by, 'css');
  assert.match(input.target[0].value, /SQL Script/);
  assert.doesNotMatch(input.target[0].value, /nth|#editor/);
  const result = await reproduce(env.browser, { ...definition(paste()), steps }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});

test('changing caret position invalidates the selection required for editor replacement', async (t) => {
  const rec = await recording(t);
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await field.press('ArrowLeft');
  await sendPaste(rec.page, field, text);
  await rec.stop();
  assert.ok(rec.result.captureIssues.length);
  assert.equal(rec.steps.some((step) => step.action === 'paste'), false);
});

test('an unhandled recorded paste remains incomplete', async (t) => {
  const rec = await recording(t, '/?unhandled');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await sendPaste(rec.page, field, text);
  await rec.stop();
  assert.ok(rec.result.captureIssues.some((issue) => /did not handle/.test(issue.message)));
});

test('secret references are resolved only for execution', async () => {
  const key = 'BUGGPS_SECRET_PASTE_FIXTURE';
  const previous = process.env[key];
  const input = definition(paste({ secret: 'PASTE_FIXTURE' }));
  try {
    delete process.env[key];
    assert.equal((await reproduce(env.browser, input, { baseUrl: server.url, runs: 1 })).status, Status.ENV_BLOCKED);
    process.env[key] = text;
    assert.equal((await reproduce(env.browser, input, { baseUrl: server.url, runs: 1 })).status, Status.NOT_REPRODUCED);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});

test('invalid paste definitions cannot open a browser context', async () => {
  let opened = false;
  const browser = { newContext() { opened = true; throw new Error('must not open'); } };
  for (const invalid of [{ ...paste(), mode: 'append' }, { ...paste(), editor: 'unknown' }, paste(42)]) {
    const result = await reproduce(browser, definition(invalid), { runs: 1 });
    assert.equal(result.status, Status.TEST_INVALID);
    assert.equal(result.runs, 0);
  }
  assert.equal(opened, false);
});

test('cancellation during selection prevents clipboard dispatch and closes only its context', async () => {
  const controller = new AbortController();
  let handled = 0;
  const browser = { async newContext(options) {
    const context = await env.browser.newContext(options);
    context.on('page', (page) => page.on('console', (message) => {
      if (message.text() === 'paste-selected') controller.abort();
      if (message.text() === 'paste-handled') handled++;
    }));
    return context;
  } };
  const other = await env.browser.newContext();
  try {
    const page = await other.newPage();
    const result = await reproduce(browser, definition(paste()), { baseUrl: server.url, runs: 1, maxMs: 5000, signal: controller.signal });
    assert.equal(result.status, Status.ABORTED);
    assert.equal(handled, 0);
    await page.setContent('<p>still running</p>');
    assert.equal(await page.textContent('p'), 'still running');
  } finally { await other.close(); }
});

test('unsupported rich editing is reported without storing its content', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('[contenteditable]').fill('RICH_INPUT_FIXTURE');
  const steps = await rec.stop();
  assert.ok(rec.result.captureIssues.length);
  assert.doesNotMatch(JSON.stringify({ steps, result: rec.result, dropped: rec.dropped }), /RICH_INPUT_FIXTURE/);
});

test('record and lock tools retain and reject incomplete editor drafts', async () => {
  let drive;
  const tools = createToolSpecs({ resolveCwd: async () => root, guardActive: () => true, testHooks: { headedRecording: false, onRecordingPage(page) {
    drive = (async () => {
      try { await page.locator('#editor').fill(text); }
      finally { await page.getByRole('button', { name: /结束/ }).click(); }
    })();
  } } });
  const exec = { signal: new AbortController().signal };
  const recorded = await tools.find((tool) => tool.name === 'buggps_record').execute({ url: server.url }, exec);
  await drive;
  assert.equal(recorded.status, Status.TEST_INVALID);
  const draft = JSON.parse(await readFile(join(root, recorded.draft), 'utf8'));
  assert.ok(draft.captureIssues.length);
  const locked = await tools.find((tool) => tool.name === 'buggps_lock').execute({ draft: recorded.draft }, exec);
  assert.equal(locked.status, Status.TEST_INVALID);
  assert.match(locked.message, /incomplete/);
});

test('string clipboard formats and their order survive recording and replay', async (t) => {
  const rec = await recording(t, '/?metadata');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await field.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', '<b>formatted</b>');
    clipboardData.setData('text/plain', text);
    clipboardData.setData('application/x-fixture', '{"multicursor":false}');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  const steps = await rec.stop();
  assert.equal(rec.result.captureIssues.length, 0);
  assert.deepEqual(steps.find((step) => step.action === 'paste').clipboard.map((format) => format.type), ['text/html', 'text/plain', 'application/x-fixture']);
  const result = await reproduce(env.browser, { ...definition(paste()), steps }, { baseUrl: server.url, runs: 1 });
  assert.equal(result.status, Status.NOT_REPRODUCED, JSON.stringify(result));
});

test('formatted clipboard data for a secret editor is refused without storing any payload', async (t) => {
  const rec = await recording(t, '/?secret');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await field.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'PRIVATE_PASTE_FIXTURE');
    clipboardData.setData('text/html', '<b>PRIVATE_PASTE_FIXTURE</b>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  const steps = await rec.stop();
  assert.ok(rec.result.captureIssues.length);
  assert.doesNotMatch(JSON.stringify({ steps, result: rec.result, dropped: rec.dropped }), /PRIVATE_PASTE_FIXTURE/);
});

test('oversized or invalid clipboard formats are rejected before execution', async () => {
  const values = [
    paste('x'.repeat(1024 * 1024 + 1)),
    { ...paste(), clipboard: [{ type: 'text/plain', value: text }] },
    { ...paste(), clipboard: [{ type: 'text/plain' }, { type: 'text/plain' }] },
    { ...paste(), clipboard: [{ type: 'text/html', value: '<b>x</b>' }] },
    { ...paste({ secret: 'PASTE_FIXTURE' }), clipboard: [{ type: 'text/plain' }, { type: 'text/html', value: 'secret' }] },
  ];
  let opened = false;
  const browser = { newContext() { opened = true; throw new Error('must not open'); } };
  for (const value of values) assert.equal((await reproduce(browser, definition(value), { runs: 1 })).status, Status.TEST_INVALID);
  assert.equal(opened, false);
});

test('a field becoming read-only during selection is reported as a blocked action', async () => {
  const input = definition(paste()); input.steps[0].url = '/?lock-on-select';
  const result = await reproduce(env.browser, input, { baseUrl: server.url, runs: 1 });
  assert.deepEqual(result.trials[0].disabledSteps, [1]);
  assert.equal(result.status, Status.REPRODUCED);
});

test('an oversized recorded paste does not retain its payload', async (t) => {
  const rec = await recording(t, '/?unhandled');
  const field = rec.page.locator('#editor');
  await field.press('ControlOrMeta+A');
  await sendPaste(rec.page, field, 'x'.repeat(1024 * 1024 + 1));
  const steps = await rec.stop();
  assert.ok(rec.result.captureIssues.some((issue) => /limit/.test(issue.message)));
  assert.equal(steps.some((step) => step.action === 'paste'), false);
  assert.ok(JSON.stringify({ steps, result: rec.result }).length < 4000);
});

test('unsupported hidden editor textareas are not treated as normal form inputs', async (t) => {
  const rec = await recording(t);
  await rec.page.locator('#legacy').fill('OPAQUE_EDITOR_FIXTURE');
  const steps = await rec.stop();
  assert.ok(rec.result.captureIssues.length);
  assert.doesNotMatch(JSON.stringify({ steps, result: rec.result }), /OPAQUE_EDITOR_FIXTURE/);
  const input = definition({ action: 'fill', target: [{ by: 'css', value: '#legacy' }], value: 'OPAQUE_EDITOR_FIXTURE' });
  assert.equal((await reproduce(env.browser, input, { baseUrl: server.url, runs: 1 })).status, Status.TEST_INVALID);
});
