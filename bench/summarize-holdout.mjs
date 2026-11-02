#!/usr/bin/env node
// Keep every attempt; select the most recent record per fixed case, never the best result.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const manifest = JSON.parse(await readFile(new URL('./holdout-cases.json', import.meta.url), 'utf8'));
const folder = fileURLToPath(new URL('./results/', import.meta.url));
const records = [];
for (const file of (await readdir(folder)).filter((f) => f.startsWith('holdout-') && f.endsWith('.json')).sort()) {
  const record = JSON.parse(await readFile(join(folder, file), 'utf8'));
  if (record.schema === 'buggps.holdout-result/v1' && record.dataset === manifest.dataset) records.push({ file, ...record });
}
const rows = manifest.cases.map((spec) => {
  const attempts = records.filter((r) => r.case === spec.id).sort((a, b) => a.at.localeCompare(b.at) || a.file.localeCompare(b.file));
  const latest = attempts.at(-1);
  return { case: spec.id, project: spec.project, attempts: attempts.map((r) => ({ file: r.file, at: r.at, status: r.status, definitionRevision: r.input?.definitionRevision ?? 1 })), latest: latest?.file ?? null, status: latest?.status ?? 'NO_RESULT', rawRecording: latest?.rawRecording?.status ?? 'NOT_RUN', lock: latest?.lock?.status ?? 'NOT_RUN', fixed: latest?.fixed?.verdict ?? 'NOT_RUN', expectedOutcome: latest?.expectedOutcome ?? false, authoredTargets: latest?.input?.authoredTargets?.length ?? 0, shortened: latest?.minimize ? { original: latest.minimize.original, result: latest.minimize.shortened, fixedComparison: latest.minimize.fixedComparison?.status ?? 'NOT_RECORDED', agreesWithFullRecording: latest.minimize.agreesWithFullRecording ?? null } : null, durationMs: latest?.durationMs ?? null };
});
const byStatus = {};
for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
const summary = { schema: 'buggps.regression-summary/v1', dataset: manifest.dataset, evaluation: 'expanded-regression, not a blind holdout or estimated field success rate', denominator: manifest.denominator, attempted: rows.filter((r) => r.latest).length, retainedAttemptRecords: records.length, projects: new Set(manifest.cases.map((c) => c.project)).size, expectedOutcomes: rows.filter((r) => r.expectedOutcome).length, byStatus, selection: 'latest chronological attempt per case, including failures', rows };
const fingerprint = createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 12);
await writeFile(join(folder, `regression-summary-${fingerprint}.json`), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ attempted: summary.attempted, denominator: summary.denominator, expectedOutcomes: summary.expectedOutcomes, byStatus, file: `bench/results/regression-summary-${fingerprint}.json` }));
if (summary.attempted !== summary.denominator) process.exitCode = 1;
