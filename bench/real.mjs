#!/usr/bin/env node
// Real-app evaluation harness. Apps live under a SHORT root (default %LOCALAPPDATA%\Temp\bgr)
// because long checkout paths break git/node_modules on Windows (MAX_PATH).
//
//   node bench/real.mjs setup <caseId>               clone + checkout buggy commit + install deps (runs third-party installs)
//   node bench/real.mjs serve <caseId>               start the app's dev server at the buggy commit, for recording
//   node bench/real.mjs check <caseId> <case.json>   reproduce -> minimize -> lock -> apply real fix -> verify -> restore
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { launchBrowser } from '../src/core/browser.js';
import { startDevServer } from '../src/core/devserver.js';
import { reproduce, Status } from '../src/core/reproduce.js';
import { minimize } from '../src/core/minimize.js';
import { lockCase, verifyCase, warmupPage, withManagedServer } from '../src/core/caselock.js';
import { git } from '../src/core/snapshot.js';

const ROOT = process.env.BUGGPS_REAL_ROOT ?? join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'Temp', 'bgr');
const manifest = JSON.parse(await readFile(new URL('./real-cases.json', import.meta.url), 'utf8'));
const [cmd, id, caseFile] = process.argv.slice(2);
const spec = manifest.cases.find((c) => c.id === id);
if (!spec) { console.error(`unknown case "${id}". known: ${manifest.cases.map((c) => c.id).join(', ')}`); process.exit(64); }
const appDir = join(ROOT, spec.app);
const baseUrl = `http://127.0.0.1:${spec.port}/`;

function run(argv, cwd) {
  console.error(`$ ${argv.join(' ')}   (in ${cwd})`);
  // shell only on Windows for .cmd shims (npm/npx); argv items are fixed strings from real-cases.json.
  const r = spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${argv[0]} exited ${r.status}`);
}

// The app's own dev server, started by BugGPS from the checkout (managed binding).
function serveSpec() {
  const vite = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error(`vite not installed in ${appDir}; run: node bench/real.mjs setup ${id}`);
  return { command: [process.execPath, vite, '--port', String(spec.port), '--strictPort', '--host', '127.0.0.1'], url: baseUrl, readyTimeoutMs: 120_000 };
}

function serve() {
  const s = serveSpec();
  return startDevServer({ cwd: appDir, argv: s.command, url: s.url, readyTimeoutMs: s.readyTimeoutMs });
}

switch (cmd) {
  case 'setup': {
    await mkdir(ROOT, { recursive: true });
    if (!existsSync(appDir)) run(['git', 'clone', '--filter=blob:none', `${spec.repo}.git`, appDir], ROOT);
    run(['git', 'checkout', '-q', spec.buggyCommit], appDir);
    run(spec.install, appDir);
    console.log(`ready: ${appDir} at ${spec.buggyCommit.slice(0, 10)}`);
    break;
  }
  case 'serve': {
    const server = await serve();
    console.log(`${spec.id} (buggy ${spec.buggyCommit.slice(0, 10)}) at ${server.url}`);
    console.log(`record with:\n  node bin/buggps.js record --url ${server.url} --start ${spec.startPath} --out bench/real-recordings/${spec.id}.json`);
    console.log('Ctrl+C to stop the dev server.');
    const stop = async () => { await server.stop(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await new Promise(() => {});
    break;
  }
  case 'scripted': {
    // Records the scripted session for this case (real app, scripted user) for a dry run of `check`.
    const { REAL_SESSIONS } = await import('./real-sessions.js');
    const { startRecording } = await import('../src/core/recorder.js');
    const s = REAL_SESSIONS[id];
    if (!s) throw new Error(`no scripted session for ${id}`);
    const server = await serve();
    const env = await launchBrowser();
    try {
      const rec = await startRecording(env.browser, { baseUrl, startPath: s.startPath ?? spec.startPath });
      await rec.page.waitForLoadState('networkidle').catch(() => {});
      await s.drive(rec.page);
      const steps = await rec.stop();
      await mkdir('bench/real-recordings', { recursive: true });
      const file = resolve(`bench/real-recordings/${id}.scripted.json`);
      await writeFile(file, JSON.stringify({ schema: 'buggps.draft/v1', kind: 'REAL app, scripted session', baseUrl, steps, expectation: s.expectation, dropped: rec.dropped.length, ...(rec.result.captureIssues.length ? { captureIssues: rec.result.captureIssues } : {}) }, null, 2));
      console.log(`recorded ${steps.length} steps (dropped ${rec.dropped.length}) -> ${file}`);
      for (const st of steps) console.log(' ', st.action, JSON.stringify(st.target?.[0] ?? st.url), st.value ?? '');
    } finally {
      await env.browser.close().catch(() => {});
      await server.stop();
    }
    break;
  }
  case 'check': {
    if (!caseFile) { console.error('usage: check <caseId> <case.json>'); process.exit(64); }
    const recorded = JSON.parse(await readFile(caseFile, 'utf8'));
    const head = (await git(appDir, ['rev-parse', 'HEAD'])).trim();
    if (head !== spec.buggyCommit) throw new Error(`${appDir} is at ${head}, expected buggy ${spec.buggyCommit}`);
    const dirty = (await git(appDir, ['status', '--porcelain', '--', ...spec.fixFiles])).trim();
    if (dirty) throw new Error(`fix files already modified in ${appDir}:\n${dirty}`);

    // Provenance comes from the recording itself: scripted sessions must never be reported as
    // human recordings.
    const out = { case: spec.id, kind: 'REAL app', input: recorded.kind ?? recorded.source ?? 'unknown', binding: 'managed', at: new Date().toISOString(), recordedSteps: recorded.steps.length, expectation: recorded.expectation };
    const serve = serveSpec();
    const env = await launchBrowser();
    try {
      const pre = await withManagedServer(appDir, serve, async (url) => {
        const red = await reproduce(env.browser, recorded, { baseUrl: url, runs: 3 });
        out.reproduce = { status: red.status, tally: red.tally, observed: red.observed, reason: red.reason, stepIndex: red.stepIndex, ms: red.durationMs };
        console.log('reproduce', out.reproduce);
        if (red.status !== Status.REPRODUCED) return null;
        const m = await minimize(env.browser, recorded, { baseUrl: url, signature: red.signature, maxMs: 300_000, late: red.late });
        const label = (s) => s.url ?? `${s.action} ${s.target?.[0]?.name ?? s.target?.[0]?.value ?? s.target?.[0]?.role}${s.value !== undefined ? `=${JSON.stringify(s.value)}` : ''}`;
        out.minimize = { status: m.status, confirmed: m.confirmed, steps: `${m.originalSteps} -> ${m.minimizedSteps}`, kept: m.testCase.steps.map(label), stats: m.stats };
        console.log('minimize', out.minimize);
        return m.confirmed && m.minimizedSteps < m.originalSteps ? m.testCase.steps : undefined;
      }, { warmup: warmupPage(env.browser, recorded) });
      if (out.reproduce.status === Status.REPRODUCED) {
        const locked = await lockCase(env.browser, env, appDir, { ...recorded, serve, minimizedSteps: pre.result ?? undefined }, { id: spec.id });
        out.lock = { status: locked.status, minimizedKept: locked.lock?.redMinimized?.kept ?? null, reason: locked.reason ?? null, tally: (locked.red ?? locked.lock?.red)?.tally ?? null };
        if (locked.caseId) {
          out.verifyBeforeFix = (await verifyCase(env.browser, env, appDir, spec.id, {})).verdict;
          await git(appDir, ['checkout', spec.fixCommit, '--', ...spec.fixFiles]);
          try {
            const v = await verifyCase(env.browser, env, appDir, spec.id, {});
            out.verifyWithRealFix = { verdict: v.verdict, reviewReasons: v.reviewReasons, tally: v.check?.tally, observed: v.check?.observed, reason: v.check?.reason, disabledSteps: v.check?.disabledSteps, minimizedCheck: v.minimizedCheck, patch: v.patch?.stat };
            console.log('verify with real fix', out.verifyWithRealFix);
          } finally {
            await git(appDir, ['checkout', 'HEAD', '--', ...spec.fixFiles]); // restore buggy code
          }
        }
      }
    } finally {
      await env.browser.close().catch(() => {});
    }
    await mkdir(new URL('./results/', import.meta.url), { recursive: true });
    const file = resolve(`bench/results/real-${spec.id}-${out.at.replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(out, null, 2));
    console.log(`wrote ${file}`);
    break;
  }
  default:
    console.error('usage: node bench/real.mjs setup|serve|check <caseId> [case.json]');
    process.exit(64);
}
