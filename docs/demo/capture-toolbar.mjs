// Captures the running toolbar on the seeded shop example. No repair is performed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEnv } from '../../test/helpers.js';
import { startRecording } from '../../src/core/recorder.js';

const source = fileURLToPath(new URL('../..', import.meta.url));
const output = join(source, 'docs/media/toolbar');
await mkdir(output, { recursive: true });
const env = await withEnv();
const captures = [];
let rec;
try {
  rec = await startRecording(env.browser, { baseUrl: env.url, toolbar: true });
  const page = rec.page;
  const toolbar = page.locator('#__buggps_toolbar');
  page.on('dialog', (dialog) => dialog.accept('$18.00'));
  await page.setViewportSize({ width: 375, height: 812 });
  for (const name of ['Add Apple', 'Add Banana']) await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('textbox', { name: 'Coupon', exact: true }).fill('SAVE10');
  await page.getByRole('button', { name: 'Apply coupon', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Apple', exact: true }).click();
  await toolbar.locator('summary').click();
  await toolbar.getByRole('button', { name: '上一步是关键', exact: true }).click();
  await toolbar.getByRole('button', { name: '预期文本', exact: true }).click();
  await page.getByTestId('total').click();
  await toolbar.getByText('已设置 1 项预期', { exact: true }).waitFor();
  for (const language of ['zh-CN', 'en']) {
    await toolbar.locator('select').selectOption(language);
    await page.evaluate(() => document.fonts.ready);
    const path = join(output, language + '.png');
    await page.screenshot({ path });
    captures.push({ file: language + '.png', language, viewport: { width: 375, height: 812 }, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
  const files = ['src/core/recorder.js', 'src/core/recording-toolbar.js'];
  const sources = await Promise.all(files.map(async (path) => ({ path, sha256: createHash('sha256').update(await readFile(join(source, path))).digest('hex') })));
  await writeFile(join(output, 'capture.json'), JSON.stringify({ schema: 'buggps.toolbar-capture/v1', source: 'scripted seeded example', scope: 'recording and expectation setup only; no repair or verification result', producer: 'docs/demo/capture-toolbar.mjs', captures, sources }, null, 2) + '\n');
  console.log(JSON.stringify({ output: 'docs/media/toolbar', screenshots: captures.length }));
} finally { await rec?.stop(); await env.close(); }
