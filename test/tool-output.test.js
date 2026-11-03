import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createToolSpecs } from '../src/dsh/tools.js';
import { apply } from '../src/dsh/index.js';
import { CASE_SCHEMA, hashCase } from '../src/core/caselock.js';
import { EVALUATOR_VERSION, validateCase } from '../src/core/oracle.js';
import { tempRepo } from './helpers.js';

const output = createToolSpecs({ resolveCwd: async () => '.', guardActive: () => true })[0].output;
const textFor = (value) => output.render({}, value).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
const limit = 12000;

test('small tool previews retain the verdict, references, next action and complete value', () => {
  const value = Object.freeze({ status: 'VERIFIED', case_id: 'coupon', runs: Object.freeze({ pass: 3 }),
    run_record: '.buggps/runs/run.json', patch_file: '.buggps/runs/run.patch', next: 'Inspect the saved evidence.' });
  const before = JSON.stringify(value);
  const text = textFor(value);
  assert.match(text, /^BugGPS VERIFIED/);
  for (const field of ['case_id: coupon', 'run_record: .buggps/runs/run.json', 'patch_file: .buggps/runs/run.patch', 'next: Inspect the saved evidence.']) assert.ok(text.includes(field));
  assert.doesNotMatch(text, /abbreviated/);
  assert.equal(JSON.stringify(value), before);
});

test('large observations have an explicit preview budget with evidence and next action first', () => {
  const observation = 'X'.repeat(262144);
  const value = { status: 'VERIFIED', now: observation, run_record: '.buggps/runs/run.json',
    patch_file: '.buggps/runs/run.patch', next: 'Inspect the complete run record and patch.' };
  const text = textFor(value);
  assert.ok(text.length <= limit, String(text.length));
  assert.ok(text.indexOf('run_record: .buggps/runs/run.json') < 2048);
  assert.ok(text.indexOf('next: Inspect the complete run record and patch.') < 2048);
  assert.match(text, /preview.*abbreviated/i);
  assert.equal(value.now, observation);
});

test('baseline status and matching control remain visible before a large observation', () => {
  const value = { status: 'VERIFIED', baseline_control: { observed: 'X'.repeat(262144),
    status: 'REPRODUCED', tally: { fail: 3 }, matchesLockedFailure: true }, run_record: '.buggps/runs/run.json', next: 'Inspect evidence.' };
  const text = textFor(value);
  assert.ok(text.length <= limit);
  assert.ok(text.indexOf('"matchesLockedFailure":true') >= 0 && text.indexOf('"matchesLockedFailure":true') < 2048);
  assert.ok(text.includes('"status":"REPRODUCED"'));
  assert.ok(text.includes('"tally":{"fail":3}'));
  assert.equal(value.baseline_control.observed.length, 262144);
});

test('case verdicts precede large expectations in a multi-case status preview', () => {
  const cases = ['first', 'middle', 'last'].map((case_id) => ({ case_id, expectation: 'X'.repeat(262144),
    latest: { verdict: case_id === 'first' ? 'STILL_FAILING' : 'NEEDS_REVIEW', applies_to_current_code: true } }));
  const value = { status: 'OK', cases };
  const text = textFor(value);
  assert.ok(text.length <= limit);
  assert.ok(text.includes('"case_id":"first"'));
  assert.ok(text.indexOf('"verdict":"STILL_FAILING"') >= 0 && text.indexOf('"verdict":"STILL_FAILING"') < 2048);
  assert.equal(cases[0].expectation.length, 262144);
  assert.equal(cases.length, 3);
});

test('many fields and long keys cannot push a preview beyond its total budget', () => {
  const value = { status: 'STILL_FAILING' };
  for (let i = 0; i < 150; i++) value['field-' + i + '-'.repeat(i === 0 ? 20000 : 0)] = 'value'.repeat(1000);
  value.run_record = '.buggps/runs/run.json';
  value.next = 'Continue repairing the source.';
  const text = textFor(value);
  assert.ok(text.length <= limit, String(text.length));
  assert.ok(text.includes('run_record: .buggps/runs/run.json'));
  assert.ok(text.includes('next: Continue repairing the source.'));
  assert.match(text, /preview.*abbreviated/i);
  assert.equal(Object.keys(value).length, 153);
});

test('abbreviated Unicode text does not split valid surrogate pairs', () => {
  const text = textFor({ status: 'OK', message: '🧭'.repeat(10000), observed: '𠮷'.repeat(10000), next: 'Read the complete record.' });
  assert.ok(text.length <= limit);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      assert.ok(text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF);
      i++;
    } else assert.ok(unit < 0xDC00 || unit > 0xDFFF);
  }
});

test('registered rc.5 projection bounds an accepted large expectation without changing saved evidence', async (t) => {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const expected = 'X'.repeat(262144);
  const body = { schema: CASE_SCHEMA, id: 'large', steps: [{ action: 'goto', url: '/' }],
    expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: expected }, observeMs: 1000 };
  validateCase(body);
  const dir = join(repo.root, '.buggps', 'cases', body.id);
  await mkdir(dir, { recursive: true });
  const caseText = JSON.stringify(body);
  await writeFile(join(dir, 'case.json'), caseText);
  await writeFile(join(dir, 'lock.json'), JSON.stringify({ schema: 'buggps.lock/v1', caseId: body.id,
    caseSha256: hashCase(body), red: { evaluator: EVALUATOR_VERSION, observed: 'before' } }));
  const tools = [];
  apply({ get: (name) => name === 'workingDirectory' ? { ensure: async () => repo.root } : undefined,
    tools: { guard: () => {}, register: (tool) => tools.push(tool) }, skills: { register: () => {} } });
  const status = tools.find((tool) => tool.name === 'buggps_status');
  const value = await status.execute({}, { agent: { session: {} }, signal: new AbortController().signal });
  const text = status.output.render({}, value).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  assert.equal(value.status, 'OK');
  assert.ok(text.length <= limit, String(text.length));
  assert.match(text, /preview.*abbreviated/i);
  assert.ok(value.cases[0].expectation.length > expected.length);
  assert.equal(await readFile(join(dir, 'case.json'), 'utf8'), caseText);
});
