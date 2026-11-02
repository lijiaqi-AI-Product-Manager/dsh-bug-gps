#!/usr/bin/env node
// BugGPS CLI: the same core functions the DSH tools call, plus `demo` (a ready-to-run seeded
// project) and `doctor` (environment check).
import { parseArgs } from 'node:util';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { startRecording } from '../src/core/recorder.js';
import { reproduce } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';
import { lockCase, normalizeServe, verifyCase } from '../src/core/caselock.js';
import { validateCase } from '../src/core/oracle.js';
import { EnvBlockedError, TestDefinitionError } from '../src/core/errors.js';
import { CONFIG_FILE } from '../src/dsh/tools.js';

const USAGE = `buggps <command> [options]

  demo       [dir]                                                  seeded example project (git repo + ${CONFIG_FILE})
  doctor     [--repo .] [--url <dev server>]                        check node, git, browser, pnpm, dsh, serve config
  record     --url <dev server> [--start /path] [--out case.json]   headed recording with toolbar
  reproduce  --url <url> --case <case.json> [--runs 3]
  minimize   --url <url> --case <case.json> [--out min.json] [--strategy units|ddmin] [--max-trials 80]
  lock       --case <case.json> [--repo .] [--id id] [--serve "<cmd>" --serve-url <url> | --url <url>]
  verify     --id <caseId> [--repo .] [--url <url>]                 RED->GREEN check on current code

  lock/verify start the app themselves when a serve command is given (or in ${CONFIG_FILE});
  only then can verify say VERIFIED. With --url alone a pass is PASSED_UNBOUND.

  common: --json  --browser-path <chrome/edge exe>  --headed`;

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' }, start: { type: 'string', default: '/' }, out: { type: 'string' },
    case: { type: 'string' }, runs: { type: 'string', default: '3' }, strategy: { type: 'string', default: 'units' },
    'max-trials': { type: 'string', default: '80' }, repo: { type: 'string', default: '.' }, id: { type: 'string' },
    serve: { type: 'string' }, 'serve-url': { type: 'string' },
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
  if (cmd === 'demo') process.exitCode = await demo(positionals[1] ?? 'buggps-demo');
  else if (cmd === 'doctor') process.exitCode = await doctor();
  else {
    env = await launchBrowser({ executablePath: o['browser-path'], headless: !(cmd === 'record' || o.headed) });
    process.exitCode = await run();
  }
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

async function serveFor(repo) {
  if (o.serve) return normalizeServe({ command: o.serve, url: need('serve-url') });
  try { return normalizeServe(JSON.parse(await readFile(join(repo, CONFIG_FILE), 'utf8')).serve); } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err instanceof TestDefinitionError ? err : new TestDefinitionError(`${CONFIG_FILE}: ${err.message}`);
  }
}

async function run() {
  switch (cmd) {
    case 'record': {
      const baseUrl = need('url');
      const rec = await startRecording(env.browser, { baseUrl, startPath: o.start, toolbar: true });
      console.error('Recording. Use the toolbar (bottom right) to set the expectation, then press stop.');
      const how = await rec.finished;
      const steps = await rec.stop();
      const out = resolve(o.out ?? `.buggps/drafts/case-${Date.now()}.json`);
      const { expectation, also } = rec.result;
      const body = { schema: 'buggps.draft/v1', source: 'recorded', baseUrl, steps, expectation, ...(also.length ? { also } : {}), expectedFrom: rec.result.expectedFrom, recordedAt: new Date().toISOString(), endedBy: how };
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(body, null, 2));
      const warn = body.expectation ? '' : '\nWARNING: no expectation set; add one before reproduce/lock.';
      print(`recorded ${steps.length} steps -> ${out}${warn}`, { status: 'RECORDED', steps: steps.length, file: out, expectation: body.expectation, also });
      return body.expectation ? 0 : 2;
    }
    case 'reproduce': {
      const c = await loadCaseFile();
      validateCase(c);
      const r = await reproduce(env.browser, c, { baseUrl: need('url'), runs: Number(o.runs) });
      print(`${r.status} ${JSON.stringify(r.tally)} observed=${JSON.stringify(r.observed)}${r.reason ? ` reason=${r.reason} (step ${r.stepIndex})` : ''} ${r.durationMs}ms`, r);
      return r.status === 'REPRODUCED' ? 0 : 1;
    }
    case 'minimize': {
      const c = await loadCaseFile();
      validateCase(c);
      const baseUrl = need('url');
      const red = await reproduce(env.browser, c, { baseUrl, runs: Number(o.runs) });
      if (red.status !== 'REPRODUCED') { print(`cannot minimize: ${red.status}`, red); return 1; }
      const m = await minimize(env.browser, c, { baseUrl, signature: red.signature, strategy: o.strategy, maxTrials: Number(o['max-trials']) });
      if (o.out) await writeFile(resolve(o.out), JSON.stringify({ ...m.testCase, minimizedFrom: o.case }, null, 2));
      print(`${m.status} confirmed=${m.confirmed} ${m.originalSteps} -> ${m.minimizedSteps} steps, ${m.stats.trials} trials, ${m.stats.durationMs}ms, model calls 0`, m);
      return m.confirmed ? 0 : 1;
    }
    case 'lock': {
      const c = await loadCaseFile();
      const repo = resolve(o.repo);
      const serve = await serveFor(repo);
      if (!serve) need('url');
      const r = await lockCase(env.browser, env, repo, { ...c, ...(serve ? { serve } : {}) }, { baseUrl: o.url, runs: Number(o.runs), ...(o.id ? { id: o.id } : {}) });
      print(r.caseId ? `LOCKED ${r.caseId} (${r.lock.binding}; RED ${JSON.stringify(r.red.tally)}, observed ${JSON.stringify(r.red.observed)})` : `not locked: ${r.status}${r.reason ? ` (${r.reason})` : ''}`, r);
      return r.caseId ? 0 : 1;
    }
    case 'verify': {
      const r = await verifyCase(env.browser, env, resolve(o.repo), need('id'), { baseUrl: o.url, runs: Number(o.runs) });
      const why = r.reviewReasons ? ` (${r.reviewReasons.join(', ')})` : '';
      print(`${r.verdict}${why}${r.check ? ` ${JSON.stringify(r.check.tally)} observed=${JSON.stringify(r.check.observed)}` : ''}${r.check?.reason ? `\nreason: ${r.check.reason}` : ''}${r.patch ? `\n${r.patch.stat}` : ''}`, r);
      return r.verdict === 'VERIFIED' ? 0 : 1;
    }
    default:
      console.error(USAGE);
      return 64;
  }
}

/** Seeded example as its own git repo, with a serve command so verify can say VERIFIED. */
async function demo(target) {
  const dir = resolve(target);
  if (existsSync(dir)) { console.error(`${dir} already exists; pass another directory`); return 64; }
  const examples = fileURLToPath(new URL('../examples/', import.meta.url));
  await cp(join(examples, 'cart-shop'), dir, { recursive: true });
  await cp(join(examples, 'serve.js'), join(dir, 'serve.js'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'buggps-demo', private: true, type: 'module', scripts: { dev: 'node serve.js . 5173' } }, null, 2));
  await writeFile(join(dir, CONFIG_FILE), JSON.stringify({ serve: { command: ['node', 'serve.js', '.', '5180'], url: 'http://127.0.0.1:5180/' } }, null, 2));
  await writeFile(join(dir, '.gitignore'), '.buggps/\n');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  // The demo commit is local scaffolding; fall back to a neutral identity if none is configured.
  try { git('commit', '-q', '-m', 'BugGPS demo (seeded bugs)'); } catch { git('-c', 'user.name=buggps-demo', '-c', 'user.email=demo@buggps.invalid', 'commit', '-q', '-m', 'BugGPS demo (seeded bugs)'); }
  print(`BugGPS demo ready: ${dir}

  1. cd "${dir}" && npm run dev        (app for recording at http://127.0.0.1:5173/)
  2. In DSH, from that folder:  用 BugGPS 修这个 bug：删掉购物车里的商品后，优惠没有重新计算。dev server 在 http://127.0.0.1:5173/
     The agent opens a browser for you: add Apple and Banana, apply coupon SAVE10, remove Apple,
     click 预期文本 on the total and type $18.00, then press stop.
  3. BugGPS locks the case and verifies fixes on its own server (port 5180, from ${CONFIG_FILE}).

  The example contains deliberately planted bugs (marked SEEDED BUG in app.js).`, { status: 'OK', dir });
  return 0;
}

async function doctor() {
  const repo = resolve(o.repo);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  // Fixed command lines only (no user input); a shell resolves npm-style .cmd shims on Windows.
  const tool = (bin, args) => {
    const r = spawnSync([bin, ...args].join(' '), { encoding: 'utf8', shell: true, windowsHide: true });
    return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null;
  };
  add('node >= 20', Number(process.versions.node.split('.')[0]) >= 20, process.version);
  const gitV = tool('git', ['--version']);
  add('git', Boolean(gitV), gitV ?? 'not on PATH');
  const inRepo = gitV && spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repo, encoding: 'utf8' }).stdout.trim() === 'true';
  add(`project is a git repository (${repo})`, Boolean(inRepo), inRepo ? 'yes' : 'BugGPS snapshots the working tree with git');
  try { const b = await launchBrowser({ executablePath: o['browser-path'] }); add('browser (system Edge/Chrome)', true, `${b.channel} ${b.version}`); await b.browser.close(); } catch (err) { add('browser (system Edge/Chrome)', false, err.message); }
  const pnpm = tool('pnpm', ['--version']);
  add('pnpm >= 10 (dsh plugin add needs it)', Boolean(pnpm) && Number(pnpm.split('.')[0]) >= 10, pnpm ?? 'not on PATH');
  const dsh = tool('dsh', ['--version']);
  add('dsh (tested: 0.2.1-rc.5)', Boolean(dsh), dsh ?? 'not on PATH');
  let serve;
  try { serve = await serveFor(repo); add(`serve command (${CONFIG_FILE})`, Boolean(serve), serve ? `${serve.command.join(' ')} -> ${serve.url}` : 'none: verify can say at most PASSED_UNBOUND'); } catch (err) { add(`serve command (${CONFIG_FILE})`, false, err.message); }
  if (serve) {
    const busy = await fetch(serve.url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    add('serve port is free', !busy, busy ? `something already answers at ${serve.url}` : serve.url);
  }
  if (o.url) {
    const up = await fetch(o.url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status < 500, () => false);
    add('dev server for recording', up, o.url);
  }
  print(checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}`).join('\n'), { status: checks.every((c) => c.ok) ? 'OK' : 'PROBLEMS', checks });
  return checks.every((c) => c.ok) ? 0 : 1;
}
