import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reproduce, Status } from '../src/core/reproduce.js';
import { createToolSpecs } from '../src/dsh/tools.js';

const expectation = { kind: 'text', target: [{ by: 'css', value: '#total' }], equals: 'OK' };
const definition = { steps: [{ action: 'goto', url: '/' }], expectation };
const recorded = { ...definition, source: 'recorded', captureVersion: 'buggps.capture/v2', expectedFrom: 'BUG', capturedChecks: [{ kind: 'text', target: expectation.target, observed: 'BUG' }] };
const cli = fileURLToPath(new URL('../bin/buggps.js', import.meta.url));
const invalidCases = [null, [], 'private input', 17,
  { ...definition, steps: {} }, { ...definition, steps: null }, { ...definition, steps: [null] }, { ...definition, steps: ['click'] },
  { ...definition, also: {} }, { ...definition, also: [null] },
  { ...definition, expectation: { ...expectation, target: [null] } },
  { ...definition, expectation: { ...expectation, target: [{ by: 'role', role: {} }] } },
  { ...definition, expectation: { ...expectation, target: [{ by: 'css', value: '#total', within: 'wrong' }] } },
  { ...definition, steps: [{ action: 'click', target: [null] }] },
  { ...definition, steps: [{ action: 'unknown', target: expectation.target }] },
  { ...definition, steps: [{ action: 'goto', url: '/', check: null }] },
  { ...definition, minimizedSteps: [null] },
  { ...definition, source: 'recorded' },
  { ...recorded, captureVersion: 'buggps.capture/unknown' },
  { ...recorded, capturedChecks: {} },
  { ...recorded, capturedChecks: [] },
  { ...recorded, capturedChecks: [null] },
  { ...recorded, expectedFrom: 'private-fixture-value' },
  { ...recorded, expectation: { ...expectation, comparison: 'startsWith' } },
];

test('malformed case structures return TEST_INVALID without opening a context', async () => {
  let contexts = 0;
  const browser = { async newContext() { contexts++; throw new Error('Browser must not be touched'); } };
  for (const value of invalidCases) {
    const result = await reproduce(browser, value, { runs: 1 });
    assert.equal(result.status, Status.TEST_INVALID, JSON.stringify({ value, result }));
    assert.equal(result.runs, 0);
  }
  assert.equal(contexts, 0);
  assert.equal((await reproduce(browser, definition, { runs: 1 })).status, Status.ENV_BLOCKED);
  assert.equal(contexts, 1, 'A valid definition still reaches the environment check');
});

test('CLI reports invalid input before attempting its configured browser', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'buggps-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'case.json');
  const source = ['{"secret":"private-fixture-value",', ...invalidCases.map((value) => JSON.stringify(value))];
  for (const value of source) {
    await writeFile(file, value);
    const result = spawnSync(process.execPath, [cli, 'lock', '--repo', root, '--case', file, '--browser-path', join(root, 'missing-browser.exe'), '--url', 'http://127.0.0.1:9/', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'TEST_INVALID');
    assert.doesNotMatch(result.stdout + result.stderr, /private-fixture-value|TypeError|SyntaxError/);
  }
  await writeFile(file, JSON.stringify(definition));
  const valid = spawnSync(process.execPath, [cli, 'lock', '--repo', root, '--case', file, '--browser-path', join(root, 'missing-browser.exe'), '--url', 'http://127.0.0.1:9/', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(valid.status, 4, valid.stdout + valid.stderr);
  assert.equal(JSON.parse(valid.stdout).status, 'ENV_BLOCKED');
  assert.equal(await access(join(root, '.buggps')).then(() => true, () => false), false);
});

test('DSH rejects a malformed draft before checking the supplied URL', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'buggps-invalid-tool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'draft.json');
  const lock = createToolSpecs({ resolveCwd: async () => root, guardActive: () => true }).find((tool) => tool.name === 'buggps_lock');
  for (const value of ['{"secret":"private-fixture-value",', ...invalidCases.map((value) => JSON.stringify(value))]) {
    await writeFile(file, value);
    const result = await lock.execute({ draft: file, url: 'http://127.0.0.1:9/', minimize: false }, { signal: new AbortController().signal });
    assert.equal(result.status, Status.TEST_INVALID, JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result), /private-fixture-value|TypeError|SyntaxError/);
  }
  await writeFile(file, JSON.stringify(definition));
  assert.equal((await lock.execute({ draft: file, url: 'http://127.0.0.1:9/', minimize: false }, { signal: new AbortController().signal })).status, Status.ENV_BLOCKED);
  assert.equal(await access(join(root, '.buggps')).then(() => true, () => false), false);
});
