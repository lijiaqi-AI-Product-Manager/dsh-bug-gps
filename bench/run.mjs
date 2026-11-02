#!/usr/bin/env node
// Spike S2/S3 measurements on the SEEDED example (scripted sessions, not human recordings).
// Writes bench/results/<timestamp>.json with every number the spike report quotes.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { withEnv } from '../test/helpers.js';
import { recordSession } from './sessions.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';

const label = (s) => s.url ?? `${s.action} ${s.target?.[0]?.name ?? s.target?.[0]?.value}${s.value !== undefined ? ` = ${JSON.stringify(s.value)}` : ''}`;

const env = await withEnv();
const out = {
  kind: 'SEEDED example, scripted sessions',
  at: new Date().toISOString(),
  machine: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, node: process.version, browser: `${env.channel} ${env.version}` },
  cases: [],
};
try {
  for (const name of ['stale-discount', 'changelog-crash', 'flaky-total']) {
    const t0 = Date.now();
    const s = await recordSession(env.browser, env.url, name);
    const recordMs = Date.now() - t0;
    const red = await reproduce(env.browser, s, { baseUrl: env.url, runs: name === 'flaky-total' ? 10 : 3 });
    const row = { name, recordedSteps: s.steps.length, recordMs, reproduce: { status: red.status, tally: red.tally, observed: red.observed, ms: red.durationMs } };
    if (red.status === Status.REPRODUCED) {
      for (const [strategy, match] of [['units', 'strict'], ['ddmin', 'strict'], ['units', 'loose']]) {
        const m = await minimize(env.browser, { ...s, match }, { baseUrl: env.url, signature: red.signature, match, strategy });
        row[`minimize_${strategy}_${match}`] = {
          status: m.status, confirmed: m.confirmed, steps: `${m.originalSteps} -> ${m.minimizedSteps}`,
          kept: m.testCase.steps.map(label), stats: m.stats,
        };
      }
    }
    out.cases.push(row);
    console.log(JSON.stringify(row, null, 2));
  }
} finally {
  await env.close();
}
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(`./results/${out.at.replace(/[:.]/g, '-')}.json`, import.meta.url);
await writeFile(file, JSON.stringify(out, null, 2));
console.log(`wrote ${file.pathname}`);
