// BugGPS tool definitions as plain specs ({name, description, parameters, output, timeoutMs,
// execute}). index.js wraps each with DSH's defineTool; tests call execute() directly, so
// nothing here imports DSH packages. Every verdict comes from the core, never from the model.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { launchBrowser } from '../core/browser.js';
import { startRecording } from '../core/recorder.js';
import { reproduce, Status } from '../core/reproduce.js';
import { minimize } from '../core/minimize.js';
import { hashCase, loadCase, lockCase, verifyCase, Verdict } from '../core/caselock.js';
import { validateExpectation } from '../core/oracle.js';
import { EnvBlockedError, TestDefinitionError } from '../core/errors.js';
import { expectationLabel, stepLabel } from '../core/describe.js';

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true, properties: { status: { type: 'string', required: true } } },
  render: (_args, v) => [{ type: 'text', text: renderText(v) }],
};

function renderText(v) {
  const lines = [`BugGPS ${v.status}${v.message ? `: ${v.message}` : ''}`];
  for (const [k, val] of Object.entries(v)) {
    if (k === 'status' || k === 'message' || k === 'next') continue;
    lines.push(`${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  }
  if (v.next) lines.push(`next: ${v.next}`);
  return lines.join('\n');
}

// Tool values must be lossless JSON (no undefined).
const json = (v) => JSON.parse(JSON.stringify(v));

const NEXT = {
  [Verdict.VERIFIED]: 'The user\'s recorded scenario now meets the expectation in every run. You may report the fix, citing the run record. Scope: this scenario only.',
  [Verdict.NEEDS_REVIEW]: 'The expectation holds only because a recorded action now hits a DISABLED control (see disabled_steps). Ask the user whether disabling it is the intended fix. Do not claim the bug is fixed.',
  [Verdict.STILL_FAILING]: 'Same failure as before. Keep working on the application code. Do not touch .buggps/.',
  [Verdict.DIFFERENT_FAILURE]: 'The symptom changed but the expectation is still not met. Not fixed.',
  [Verdict.NO_CODE_CHANGE]: 'No code has changed since the case was locked. Make a fix first.',
  [Verdict.CASE_TAMPERED]: 'The locked case or its lock was modified, so no verdict is given. Restore .buggps/ from git, or ask the user to record again. Never edit it.',
  [Verdict.STALE]: 'Files changed while verifying. Run buggps_verify again once edits are finished.',
  [Verdict.FLAKY]: 'Results differ between runs. Report this to the user; do not claim a fix.',
  [Verdict.ENV_BLOCKED]: 'The environment is not usable (browser or dev server). Fix the environment; this says nothing about the code.',
  [Verdict.TEST_INVALID]: 'The recorded steps can no longer be replayed (see reason). If the UI changed on purpose as part of the fix, ask the user to re-record. Do not edit the case.',
  [Verdict.BUDGET_EXHAUSTED]: 'Time budget ran out before all runs finished; no verdict.',
  [Verdict.ABORTED]: 'Cancelled; no verdict.',
};

const LOCK_NEXT = {
  [Status.NOT_REPRODUCED]: 'The recorded steps did NOT show the bug on the current code, so nothing was locked. Check the expectation with the user, or record again.',
  [Status.FLAKY]: 'The bug appeared in some runs but not all, so nothing was locked. A flaky bug cannot be verified reliably; tell the user.',
  [Status.TEST_INVALID]: 'The recording cannot be replayed (see reason), so nothing was locked. Ask the user to record again.',
  [Status.ENV_BLOCKED]: 'The environment is not usable (dev server or browser). Fix it and retry.',
};

async function reachable(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); return r.status < 500; } catch { return false; }
}

function envBlocked(message, hint) {
  return { status: 'ENV_BLOCKED', message, ...(hint ? { hint } : {}), next: NEXT[Verdict.ENV_BLOCKED] };
}

async function withBrowser(signal, { headless = true } = {}, fn) {
  let env;
  try {
    env = await launchBrowser({ headless });
  } catch (err) {
    if (err instanceof EnvBlockedError) return envBlocked(err.message, err.hint);
    throw err;
  }
  const onAbort = () => env.browser.close().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fn(env);
  } catch (err) {
    if (err instanceof TestDefinitionError) return { status: 'TEST_INVALID', message: err.message, next: LOCK_NEXT[Status.TEST_INVALID] };
    if (signal?.aborted) return { status: 'ABORTED', message: 'cancelled', next: NEXT[Verdict.ABORTED] };
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await env.browser.close().catch(() => {});
  }
}

const safeName = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'case';

/**
 * @param {object} deps
 * @param {(exec) => Promise<string>} deps.resolveCwd  session working directory (the user's repo)
 * @param {() => boolean} deps.guardActive              write protection registered in this process
 * @param {{headedRecording?: boolean, onRecordingPage?: Function}} [deps.testHooks]
 */
export function createToolSpecs({ resolveCwd, guardActive, testHooks = {} }) {
  // caseId -> case hash, for cases locked in THIS process: detects a lock.json rewritten by a
  // shell command together with the case (the file-level hash alone cannot).
  const lockedHere = new Map();

  const record = {
    name: 'buggps_record',
    description: 'Open a real browser on the app so the USER can reproduce a bug once. The user marks the correct expectation and the key step on the BugGPS toolbar, then presses stop. Blocks until then. Saves a draft under .buggps/drafts/ for buggps_lock.',
    parameters: {
      url: { type: 'string', required: true, description: 'Base URL of the running dev server, e.g. http://localhost:5173/' },
      start_path: { type: 'string', description: 'Path to open first (default /)' },
      name: { type: 'string', description: 'Short name for the draft, e.g. "coupon-total"' },
    },
    timeoutMs: 30 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await resolveCwd(exec);
      if (!(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server (e.g. npm run dev) and pass its URL.'));
      return json(await withBrowser(exec.signal, { headless: testHooks.headedRecording === false }, async (env) => {
        const rec = await startRecording(env.browser, { baseUrl: args.url, startPath: args.start_path ?? '/', toolbar: true });
        testHooks.onRecordingPage?.(rec.page);
        const aborted = new Promise((r) => exec.signal?.addEventListener('abort', () => r('aborted'), { once: true }));
        const how = await Promise.race([rec.finished, aborted]);
        const steps = await rec.stop();
        if (how === 'aborted') return { status: 'ABORTED', message: 'recording cancelled; nothing saved', next: NEXT[Verdict.ABORTED] };
        const file = join(cwd, '.buggps', 'drafts', `${safeName(args.name ?? `case-${Date.now()}`)}.json`);
        await mkdir(join(cwd, '.buggps', 'drafts'), { recursive: true });
        await writeFile(file, JSON.stringify({ schema: 'buggps.draft/v1', baseUrl: args.url, steps, expectation: rec.result.expectation, expectedFrom: rec.result.expectedFrom, recordedAt: new Date().toISOString(), endedBy: how }, null, 2));
        const draft = relative(cwd, file).replace(/\\/g, '/');
        if (!rec.result.expectation) {
          return { status: 'NO_EXPECTATION', draft, steps: steps.length, next: 'The user did not set the correct expectation. Ask them to record again and use the toolbar ("预期文本 / 预期输入值 / 应可见 / 不应报错") before pressing stop. Do not invent one.' };
        }
        return {
          status: 'RECORDED',
          draft,
          steps: steps.length,
          key_steps: steps.filter((s) => s.pinned).map(stepLabel),
          expectation: expectationLabel(rec.result.expectation),
          user_saw: rec.result.expectedFrom,
          next: `Call buggps_lock with url and draft="${draft}".`,
        };
      }));
    },
  };

  const lock = {
    name: 'buggps_lock',
    description: 'Replay a recorded draft on the CURRENT code. Only if the bug shows in every run, shorten the steps (replay only, no model calls) and lock the case: content-hashed and write-protected. Returns case_id for buggps_verify.',
    parameters: {
      url: { type: 'string', required: true, description: 'Base URL of the running dev server' },
      draft: { type: 'string', required: true, description: 'Draft path returned by buggps_record (relative to the repo)' },
      case_id: { type: 'string', description: 'Id for the locked case (default: draft name)' },
      minimize: { type: 'boolean', description: 'Shorten the steps (default true). The full recording stays authoritative either way.' },
    },
    timeoutMs: 20 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await resolveCwd(exec);
      const draftPath = isAbsolute(args.draft) ? args.draft : resolve(cwd, args.draft);
      let draft;
      try { draft = JSON.parse(await readFile(draftPath, 'utf8')); } catch (err) { return json({ status: 'TEST_INVALID', message: `cannot read draft ${args.draft}: ${err.message}` }); }
      if (!(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server and retry.'));
      const id = safeName(args.case_id ?? draftPath.split(/[\\/]/).pop().replace(/\.json$/, ''));
      return json(await withBrowser(exec.signal, {}, async (env) => {
        validateExpectation(draft.expectation);
        const red = await reproduce(env.browser, draft, { baseUrl: args.url, runs: 3, signal: exec.signal });
        if (red.status !== Status.REPRODUCED) {
          return { status: red.status, tally: red.tally, observed: red.observed, reason: red.reason, step: red.stepIndex !== null && draft.steps[red.stepIndex] ? stepLabel(draft.steps[red.stepIndex]) : null, next: LOCK_NEXT[red.status] ?? NEXT[red.status] };
        }
        let m = null;
        if (args.minimize !== false) m = await minimize(env.browser, draft, { baseUrl: args.url, signature: red.signature, maxMs: 300_000, signal: exec.signal });
        const minimizedSteps = m?.confirmed && m.minimizedSteps < m.originalSteps ? m.testCase.steps : undefined;
        const locked = await lockCase(env.browser, env, cwd, { ...draft, minimizedSteps }, { baseUrl: args.url, id, signal: exec.signal });
        if (!locked.caseId) return { status: locked.status, message: 'the bug did not reproduce consistently at lock time', next: LOCK_NEXT[locked.status] };
        lockedHere.set(id, locked.lock.caseSha256);
        const kept = Boolean(locked.lock.redMinimized?.kept);
        return {
          status: 'LOCKED',
          case_id: id,
          expectation: expectationLabel(draft.expectation),
          observed_now: red.observed,
          recorded_steps: draft.steps.length,
          ...(kept ? { shortest_steps: minimizedSteps.map(stepLabel) } : { steps: draft.steps.map(stepLabel) }),
          minimization: m ? { from: m.originalSteps, to: kept ? m.minimizedSteps : m.originalSteps, trials: m.stats.trials, model_calls: 0, note: 'Shortened steps help to locate the bug; the full recording decides verification.' } : 'skipped',
          next: `Find and fix the cause in the application code (never edit .buggps/), then call buggps_verify with case_id="${id}".`,
        };
      }));
    },
  };

  const verify = {
    name: 'buggps_verify',
    description: 'Decide whether a locked bug is fixed: replays the user\'s full recording on the current code (3 runs) and compares it with the RED evidence captured at lock time. The ONLY way to claim a BugGPS case is fixed.',
    parameters: {
      url: { type: 'string', required: true, description: 'Base URL of the running dev server' },
      case_id: { type: 'string', required: true, description: 'case_id from buggps_lock' },
    },
    timeoutMs: 15 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      if (!guardActive()) {
        return json({ status: 'ENV_BLOCKED', message: 'BugGPS write protection is not active in this DSH process, so a verdict cannot be trusted.', next: 'Check the dsh-bug-gps plugin loaded without warnings (dsh --profile <p> --dump-config).' });
      }
      const cwd = await resolveCwd(exec);
      const id = safeName(args.case_id);
      let lockFile;
      try { lockFile = await loadCase(cwd, id); } catch { return json({ status: 'TEST_INVALID', message: `no locked case "${id}" in ${cwd}/.buggps/cases`, next: 'Use buggps_status to list cases.' }); }
      const remembered = lockedHere.get(id);
      if (remembered && remembered !== lockFile.lock.caseSha256) {
        return json({ status: Verdict.CASE_TAMPERED, message: 'lock.json was rewritten after locking in this session', next: NEXT[Verdict.CASE_TAMPERED] });
      }
      if (remembered && hashCase(lockFile.body) !== remembered) {
        return json({ status: Verdict.CASE_TAMPERED, message: 'case.json changed after locking', next: NEXT[Verdict.CASE_TAMPERED] });
      }
      if (!(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server and retry.'));
      return json(await withBrowser(exec.signal, {}, async (env) => {
        const r = await verifyCase(env.browser, env, cwd, id, { baseUrl: args.url, signal: exec.signal });
        return {
          status: r.verdict,
          case_id: id,
          expectation: expectationLabel(lockFile.body.expectation),
          before_fix: lockFile.lock.red?.observed ?? null,
          now: r.check ? (r.check.observed ?? 'expectation met') : null,
          runs: r.check?.tally ?? null,
          ...(r.check?.reason ? { reason: r.check.reason } : {}),
          ...(r.check?.disabledSteps ? { disabled_steps: r.check.disabledSteps.map((d) => stepLabel(d.step)) } : {}),
          ...(r.minimizedCheck ? { shortened_case_agrees: r.minimizedCheck.agreesWithRecording } : {}),
          ...(r.patch ? { patch: r.patch.stat, patch_file: `.buggps/runs/${r.runId}.patch` } : {}),
          run_record: `.buggps/runs/${r.runId}.json`,
          next: NEXT[r.verdict],
        };
      }));
    },
  };

  const status = {
    name: 'buggps_status',
    description: 'List locked BugGPS cases in this repo with their latest verdict, and check the environment (write protection, dev server, browser).',
    parameters: {
      url: { type: 'string', description: 'Dev server URL to check (optional)' },
      check_browser: { type: 'boolean', description: 'Also check that Edge/Chrome can be launched' },
    },
    timeoutMs: 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await resolveCwd(exec);
      const casesDir = join(cwd, '.buggps', 'cases');
      const runsDir = join(cwd, '.buggps', 'runs');
      const ids = await readdir(casesDir).catch(() => []);
      const runs = (await readdir(runsDir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
      const latest = {};
      for (const f of runs) {
        try { const r = JSON.parse(await readFile(join(runsDir, f), 'utf8')); latest[r.caseId] = { verdict: r.verdict, at: r.finishedAt }; } catch { /* skip */ }
      }
      const cases = [];
      for (const id of ids) {
        try {
          const { body, lock } = await loadCase(cwd, id);
          cases.push({ case_id: id, expectation: expectationLabel(body.expectation), before_fix: lock.red?.observed ?? null, steps: body.steps.length, latest: latest[id] ?? null });
        } catch { cases.push({ case_id: id, error: 'unreadable' }); }
      }
      const out = { status: 'OK', repo: cwd, write_protection: guardActive() ? 'active' : 'NOT ACTIVE', cases };
      if (args.url) out.dev_server = (await reachable(args.url)) ? 'reachable' : 'NOT reachable';
      if (args.check_browser) {
        try { const env = await launchBrowser(); out.browser = `${env.channel} ${env.version}`; await env.browser.close(); } catch (err) { out.browser = `NOT usable: ${err.message}`; }
      }
      return json(out);
    },
  };

  return [record, lock, verify, status];
}
