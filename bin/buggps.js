#!/usr/bin/env node
// BugGPS developer CLI. The DSH plugin will call the same core functions; this exists so the
// core can be exercised (and real cases recorded) before the DSH layer lands.
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';
import { lockCase, verifyCase } from '../src/core/caselock.js';
import { validateExpectation } from '../src/core/oracle.js';
import { EnvBlockedError, TestDefinitionError } from '../src/core/errors.js';

const USAGE = `buggps <command> [options]

  record     --url <dev server> [--start /path] [--out case.json]   headed recording with toolbar
  reproduce  --url <url> --case <case.json> [--runs 3]
  minimize   --url <url> --case <case.json> [--out min.json] [--strategy units|ddmin] [--max-trials 80]
  lock       --url <url> --case <case.json> [--repo .]               reproduce on current code, then lock
  verify     --url <url> --id <caseId> [--repo .]                    RED->GREEN check on current code

  common: --json  --browser-path <chrome/edge exe>  --headed`;

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' }, start: { type: 'string', default: '/' }, out: { type: 'string' },
    case: { type: 'string' }, runs: { type: 'string', default: '3' }, strategy: { type: 'string', default: 'units' },
    'max-trials': { type: 'string', default: '80' }, repo: { type: 'string', default: '.' }, id: { type: 'string' },
    json: { type: 'boolean', default: false }, 'browser-path': { type: 'string' }, headed: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const cmd = positionals[0];
if (!cmd || o.help) { console.log(USAGE); process.exit(cmd ? 0 : 64); }
const need = (k) => { if (!o[k]) { console.error(`missing --${k}\n\n${USAGE}`); process.exit(64); } return o[k]; };
const print = (human, data) => console.log(o.json ? JSON.stringify(data, null, 2) : human);

let env;
try {
  env = await launchBrowser({ executablePath: o['browser-path'], headless: !(cmd === 'record' || o.headed) });
  const code = await run();
  process.exitCode = code;
} catch (err) {
  if (err instanceof EnvBlockedError) { print(`ENV_BLOCKED: ${err.message}\nnext: ${err.hint}`, { status: 'ENV_BLOCKED', reason: err.message, hint: err.hint }); process.exitCode = 4; }
  else if (err instanceof TestDefinitionError) { print(`TEST_INVALID: ${err.message}`, { status: 'TEST_INVALID', reason: err.message }); process.exitCode = 3; }
  else throw err;
} finally {
  await env?.browser.close().catch(() => {});
}

async function loadCaseFile() {
  return JSON.parse(await readFile(need('case'), 'utf8'));
}

async function run() {
  const baseUrl = need('url');
  switch (cmd) {
    case 'record': {
      const rec = await startRecording(env.browser, { baseUrl, startPath: o.start, toolbar: true });
      console.error('Recording. Use the toolbar (bottom right) to set the expectation, then press stop.');
      const how = await rec.finished;
      const steps = await rec.stop();
      const out = resolve(o.out ?? `.buggps/drafts/case-${Date.now()}.json`);
      const body = { schema: 'buggps.draft/v1', baseUrl, steps, expectation: rec.result.expectation, expectedFrom: rec.result.expectedFrom, recordedAt: new Date().toISOString(), endedBy: how };
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(body, null, 2));
      const warn = body.expectation ? '' : '\nWARNING: no expectation set; add one before reproduce/lock.';
      print(`recorded ${steps.length} steps -> ${out}${warn}`, { status: 'RECORDED', steps: steps.length, file: out, expectation: body.expectation });
      return body.expectation ? 0 : 2;
    }
    case 'reproduce': {
      const c = await loadCaseFile();
      validateExpectation(c.expectation);
      const r = await reproduce(env.browser, c, { baseUrl, runs: Number(o.runs) });
      print(`${r.status} ${JSON.stringify(r.tally)} observed=${JSON.stringify(r.observed)}${r.reason ? ` reason=${r.reason} (step ${r.stepIndex})` : ''} ${r.durationMs}ms`, r);
      return r.status === 'REPRODUCED' ? 0 : 1;
    }
    case 'minimize': {
      const c = await loadCaseFile();
      validateExpectation(c.expectation);
      const red = await reproduce(env.browser, c, { baseUrl, runs: Number(o.runs) });
      if (red.status !== 'REPRODUCED') { print(`cannot minimize: ${red.status}`, red); return 1; }
      const m = await minimize(env.browser, c, { baseUrl, signature: red.signature, strategy: o.strategy, maxTrials: Number(o['max-trials']) });
      if (o.out) await writeFile(resolve(o.out), JSON.stringify({ ...m.testCase, minimizedFrom: o.case }, null, 2));
      print(`${m.status} confirmed=${m.confirmed} ${m.originalSteps} -> ${m.minimizedSteps} steps, ${m.stats.trials} trials, ${m.stats.durationMs}ms, model calls 0`, m);
      return m.confirmed ? 0 : 1;
    }
    case 'lock': {
      const c = await loadCaseFile();
      const r = await lockCase(env.browser, env, resolve(o.repo), c, { baseUrl, runs: Number(o.runs) });
      print(r.caseId ? `LOCKED ${r.caseId} (RED ${JSON.stringify(r.red.tally)}, observed ${JSON.stringify(r.red.observed)})` : `not locked: ${r.status}`, r);
      return r.caseId ? 0 : 1;
    }
    case 'verify': {
      const r = await verifyCase(env.browser, env, resolve(o.repo), need('id'), { baseUrl, runs: Number(o.runs) });
      print(`${r.verdict}${r.check ? ` ${JSON.stringify(r.check.tally)} observed=${JSON.stringify(r.check.observed)}` : ''}${r.patch ? `\n${r.patch.stat}` : ''}`, r);
      return r.verdict === 'VERIFIED' ? 0 : 1;
    }
    default:
      console.error(USAGE);
      return 64;
  }
}
