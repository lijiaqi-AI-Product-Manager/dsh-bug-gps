import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo } from './helpers.js';
import { snapshotTree } from '../src/core/snapshot.js';
import { CASE_SCHEMA, RUN_SCHEMA, hashCase, hashLock } from '../src/core/caselock.js';
import { EVALUATOR_VERSION } from '../src/core/oracle.js';
import { createToolSpecs } from '../src/dsh/tools.js';

async function fixture(t) {
  const repo = await tempRepo();
  t.after(() => repo.cleanup());
  const tree = await snapshotTree(repo.root);
  const cases = new Map();
  const runs = join(repo.root, '.buggps', 'runs');
  await mkdir(runs, { recursive: true });
  const status = createToolSpecs({ resolveCwd: async () => repo.root, guardActive: () => true })
    .find((tool) => tool.name === 'buggps_status');
  return {
    tree,
    async addCase(id, options = {}) {
      const body = {
        schema: CASE_SCHEMA, id, steps: [{ action: 'goto', url: '/' }],
        expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$18.00' },
        observeMs: 1000, serve: { command: ['node', 'serve.js'], url: 'http://127.0.0.1:5199/' },
      };
      const lock = {
        schema: 'buggps.lock/v1', caseId: id, caseSha256: hashCase(body), baselineTree: tree,
        red: { evaluator: 'lockedEvaluator' in options ? options.lockedEvaluator : EVALUATOR_VERSION, observed: '$17.00' },
      };
      const dir = join(repo.root, '.buggps', 'cases', id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'case.json'), JSON.stringify(body));
      await writeFile(join(dir, 'lock.json'), JSON.stringify(lock));
      cases.set(id, { body, lock });
    },
    async run(id, runId, overrides = {}) {
      const { body, lock } = cases.get(id);
      const record = {
        schema: RUN_SCHEMA, producer: 'dsh-bug-gps', runId, caseId: id, evaluator: EVALUATOR_VERSION,
        caseSha256: hashCase(body), lockSha256: hashLock(lock), baselineTree: tree,
        treeBefore: tree, treeAfter: tree, finishedAt: '2026-01-01T00:00:10.000Z', verdict: 'VERIFIED',
        ...overrides,
      };
      await writeFile(join(runs, runId + '.json'), JSON.stringify(record));
    },
    async read() {
      const result = await status.execute({}, { signal: new AbortController().signal });
      assert.equal(result.status, 'OK');
      return { result, cases: new Map(result.cases.map((entry) => [entry.case_id, entry])) };
    },
  };
}

test('legal case names matching object properties have no invented latest run', async (t) => {
  const f = await fixture(t);
  for (const id of ['constructor', 'toString', 'hasOwnProperty', 'ordinary']) await f.addCase(id);
  const { cases } = await f.read();
  for (const [id, entry] of cases) assert.equal(entry.latest, null, id);
});

test('status uses completion time when concurrent runs finish in reverse start order', async (t) => {
  const f = await fixture(t);
  await f.addCase('overlap');
  await f.run('overlap', '2026-01-01T00-00-00-000Z-long', {
    finishedAt: '2026-01-01T00:00:03.000Z', verdict: 'STILL_FAILING',
  });
  await f.run('overlap', '2026-01-01T00-00-01-000Z-short', {
    finishedAt: '2026-01-01T00:00:02.000Z', verdict: 'VERIFIED',
  });
  const latest = (await f.read()).cases.get('overlap').latest;
  assert.equal(latest.verdict, 'STILL_FAILING');
  assert.equal(latest.at, '2026-01-01T00:00:03.000Z');
});

test('other schemas, unknown verdicts and incomplete timestamps cannot mask a real run', async (t) => {
  const f = await fixture(t);
  await f.addCase('history');
  await f.run('history', '2026-01-01T00-00-00-000Z-valid', { verdict: 'NEEDS_REVIEW' });
  await f.run('history', '2026-01-01T00-00-01-000Z-other', { schema: 'unrelated.metadata/v1' });
  await f.run('history', '2026-01-01T00-00-02-000Z-unknown', { verdict: 'LOOKS_GOOD' });
  await f.run('history', '2026-01-01T00-00-03-000Z-incomplete', { finishedAt: undefined });
  await f.run('history', '2026-01-01T00-00-04-000Z-invalid', { finishedAt: 'invalid-date' });
  const latest = (await f.read()).cases.get('history').latest;
  assert.equal(latest.verdict, 'NEEDS_REVIEW');
  assert.equal(latest.at, '2026-01-01T00:00:10.000Z');
});

test('historical results stay visible but require current run and locked evaluators', async (t) => {
  const f = await fixture(t);
  const scenarios = [
    ['old-run', {}, { evaluator: 'buggps.oracle/v8' }],
    ['missing-run', {}, { evaluator: undefined }],
    ['old-lock', { lockedEvaluator: 'buggps.oracle/v7' }, {}],
    ['missing-lock', { lockedEvaluator: undefined }, {}],
  ];
  for (const [id, options, record] of scenarios) {
    await f.addCase(id, options);
    await f.run(id, '2026-01-01T00-00-00-000Z-' + id, record);
  }
  const { result, cases } = await f.read();
  for (const [id] of scenarios) {
    const latest = cases.get(id).latest;
    assert.equal(latest.verdict, 'VERIFIED', id);
    assert.equal(latest.applies_to_current_code, false, id);
    assert.ok(latest.not_current_reasons.includes('evaluator-changed'), id);
  }
  assert.match(result.note, /evaluator/);
});

test('current results remain applicable while changed code and frozen inputs have explicit reasons', async (t) => {
  const f = await fixture(t);
  const scenarios = [
    ['current', {}, null],
    ['changed-code', { treeAfter: '0'.repeat(40) }, 'code-changed'],
    ['changed-case', { caseSha256: '0'.repeat(64) }, 'case-changed'],
    ['changed-lock', { lockSha256: '0'.repeat(64) }, 'lock-changed'],
    ['unbound', { treeAfter: undefined }, 'code-unbound'],
  ];
  for (const [id, record] of scenarios) {
    await f.addCase(id);
    await f.run(id, '2026-01-01T00-00-00-000Z-' + id, record);
  }
  const { cases } = await f.read();
  for (const [id, , reason] of scenarios) {
    const latest = cases.get(id).latest;
    assert.equal(latest.applies_to_current_code, reason === null, id);
    if (reason) assert.ok(latest.not_current_reasons.includes(reason), id);
    else assert.deepEqual(latest.not_current_reasons ?? [], []);
  }
});

test('NO_CODE_CHANGE remains distinct and is bound only to its recorded baseline code', async (t) => {
  const f = await fixture(t);
  await f.addCase('unchanged');
  await f.addCase('moved');
  await f.run('unchanged', '2026-01-01T00-00-00-000Z-unchanged', { verdict: 'NO_CODE_CHANGE', treeAfter: undefined });
  await f.run('moved', '2026-01-01T00-00-00-000Z-moved', { verdict: 'NO_CODE_CHANGE', treeBefore: '0'.repeat(40), treeAfter: undefined });
  const { cases } = await f.read();
  assert.equal(cases.get('unchanged').latest.verdict, 'NO_CODE_CHANGE');
  assert.equal(cases.get('unchanged').latest.applies_to_current_code, true);
  assert.equal(cases.get('moved').latest.applies_to_current_code, false);
  assert.ok(cases.get('moved').latest.not_current_reasons.includes('code-changed'));
});

test('runs with equal completion timestamps have a deterministic tie break', async (t) => {
  const f = await fixture(t);
  await f.addCase('tie');
  await f.run('tie', '2026-01-01T00-00-02-000Z-b', { verdict: 'STILL_FAILING' });
  await f.run('tie', '2026-01-01T00-00-01-000Z-a', { verdict: 'VERIFIED' });
  assert.equal((await f.read()).cases.get('tie').latest.verdict, 'STILL_FAILING');
});
