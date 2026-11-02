// BugGPS tool definitions as plain specs ({name, description, parameters, output, timeoutMs,
// execute}). index.js wraps each with DSH's defineTool; tests call execute() directly, so
// nothing here imports DSH packages. Every verdict comes from the core, never from the model.
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { launchBrowser } from '../core/browser.js';
import { startRecording } from '../core/recorder.js';
import { reproduce, Status } from '../core/reproduce.js';
import { minimize } from '../core/minimize.js';
import { hashCase, loadCase, lockCase, normalizeServe, verifyCase, Verdict, warmupPage, withManagedServer } from '../core/caselock.js';
import { DEFAULT_OBSERVE_MS, hasPositiveCheck, validateCase } from '../core/oracle.js';
import { snapshotTree } from '../core/snapshot.js';
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

export const CONFIG_FILE = 'buggps.config.json';

const NEXT = {
  [Verdict.VERIFIED]: 'Fix verified: on a server BugGPS started from the current working tree, the user\'s full recording met every recorded check in every run, and the patch is the diff from the locked baseline to exactly that tree. Report it citing run_record and patch_file. Scope: this recorded scenario only.',
  [Verdict.PASSED_UNBOUND]: 'The scenario passes at the given URL, but BugGPS did not start that server, so nothing proves it runs this patch. Do not call the bug fixed. To get a verdict, the case needs a serve command (buggps.config.json or buggps_lock serve=...); ask the user to lock it again with one.',
  [Verdict.NEEDS_REVIEW]: 'The checks pass, but the evidence is weaker than "fixed" (see review_reasons). Show the user the reasons and the patch and ask them to decide. Do not claim the bug is fixed.',
  [Verdict.STILL_FAILING]: 'Same failure as before. Keep working on the application code. Do not touch .buggps/.',
  [Verdict.DIFFERENT_FAILURE]: 'Not fixed: the symptom changed, or a step the user recorded no longer behaves as recorded (see reason). Keep working on the application code.',
  [Verdict.NO_CODE_CHANGE]: 'No code has changed since the case was locked. Make a fix first.',
  [Verdict.CASE_TAMPERED]: 'The locked case or its lock was modified, so no verdict is given. Restore .buggps/ from git, or ask the user to record again. Never edit it.',
  [Verdict.STALE]: 'Files changed while verifying. Run buggps_verify again once edits are finished.',
  [Verdict.FLAKY]: 'Results differ between runs. Report this to the user; do not claim a fix.',
  [Verdict.ENV_BLOCKED]: 'The environment is not usable (browser, dev server, port or a secret input). Fix the environment; this says nothing about the code.',
  [Verdict.TEST_INVALID]: 'The recorded steps can no longer be replayed (see reason). If the UI changed on purpose as part of the fix, ask the user to re-record. Do not edit the case.',
  [Verdict.BUDGET_EXHAUSTED]: 'Time budget ran out before all runs finished; no verdict.',
  [Verdict.ABORTED]: 'Cancelled; no verdict.',
};

const REVIEW_TEXT = {
  'disabled-control': 'a recorded action now hits a DISABLED control; the checks may pass only because the trigger was blocked',
  'negative-only': 'the case only checks that no error happens; removing the feature would pass too. Ask the user for a positive check (record again and add one)',
  'locator-drift': 'some recorded elements were found only by a loose name match, unlike at lock time; the replay may have used a different element',
  'baseline-not-reproduced': 'a fresh baseline did not reproduce the locked failure; inspect the startup root, dependencies and development environment',
};

const LOCK_NEXT = {
  [Status.NOT_REPRODUCED]: 'The recorded steps did NOT show the bug on the current code, so nothing was locked. Check the expectation with the user, or record again.',
  [Status.PRECONDITION_FAILED]: 'A checkpoint the user recorded does not hold on the current code, so nothing was locked. Ask the user to record again.',
  [Status.FLAKY]: 'The bug appeared in some runs but not all, so nothing was locked. A flaky bug cannot be verified reliably; tell the user.',
  [Status.TEST_INVALID]: 'The recording cannot be replayed (see reason), so nothing was locked. Ask the user to record again.',
  [Status.ENV_BLOCKED]: 'The environment is not usable (dev server, port, browser or a secret input). Fix it and retry.',
  [Verdict.STALE]: 'Files changed while locking. Lock again once nothing is editing the project.',
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
    if (err instanceof EnvBlockedError) return envBlocked(err.message, err.hint);
    if (signal?.aborted) return { status: 'ABORTED', message: 'cancelled', next: NEXT[Verdict.ABORTED] };
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await env.browser.close().catch(() => {});
  }
}

const realKey = (dir) => { try { return realpathSync.native(dir).toLowerCase(); } catch { return resolve(dir).toLowerCase(); } };

async function readConfig(cwd) {
  try { return JSON.parse(await readFile(join(cwd, CONFIG_FILE), 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new TestDefinitionError(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
}

/**
 * @param {object} deps
 * @param {(exec) => Promise<string>} deps.resolveCwd  session working directory (the user's repo)
 * @param {() => boolean} deps.guardActive              write protection registered in this process
 * @param {(dir: string) => void} [deps.onProject]      told every project directory a tool used
 * @param {{headedRecording?: boolean, onRecordingPage?: Function}} [deps.testHooks]
 */
export function createToolSpecs({ resolveCwd, guardActive, onProject = () => {}, testHooks = {} }) {
  // (real project dir, caseId) -> case hash, for cases locked in THIS process: detects a
  // lock.json rewritten by a shell command together with the case (the file hash alone cannot).
  // Keyed by project too: the same case id in two repositories are two different cases.
  const lockedHere = new Map();
  const projectOf = async (exec) => { const cwd = await resolveCwd(exec); onProject(cwd); return cwd; };

  const record = {
    name: 'buggps_record',
    description: 'Open a real browser on the app so the USER can reproduce a bug once. The user marks the correct expectation (and optionally checkpoints and the key step) on the BugGPS toolbar, then presses stop. Blocks until then. Saves a draft under .buggps/drafts/ for buggps_lock. Password and token fields are never stored.',
    parameters: {
      url: { type: 'string', required: true, description: 'Base URL of the running dev server, e.g. http://localhost:5173/' },
      start_path: { type: 'string', description: 'Path to open first (default /)' },
      name: { type: 'string', description: 'Short name for the draft, e.g. "coupon-total"' },
    },
    timeoutMs: 30 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await projectOf(exec);
      if (!(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server (e.g. npm run dev) and pass its URL.'));
      return json(await withBrowser(exec.signal, { headless: testHooks.headedRecording === false }, async (env) => {
        const rec = await startRecording(env.browser, { baseUrl: args.url, startPath: args.start_path ?? '/', toolbar: true });
        testHooks.onRecordingPage?.(rec.page);
        const aborted = new Promise((r) => exec.signal?.addEventListener('abort', () => r('aborted'), { once: true }));
        const how = await Promise.race([rec.finished, aborted]);
        const steps = await rec.stop();
        if (how === 'aborted') return { status: 'ABORTED', message: 'recording cancelled; nothing saved', next: NEXT[Verdict.ABORTED] };
        const draftId = randomUUID();
        const file = join(cwd, '.buggps', 'drafts', `${draftId}.json`);
        await mkdir(join(cwd, '.buggps', 'drafts'), { recursive: true });
        const { expectation, also, expectedFrom } = rec.result;
        await writeFile(file, JSON.stringify({ schema: 'buggps.draft/v1', id: draftId, name: String(args.name ?? '').slice(0, 200), source: 'recorded', baseUrl: args.url, steps, expectation, ...(also.length ? { also } : {}), expectedFrom, recordedAt: new Date().toISOString(), endedBy: how }, null, 2), { flag: 'wx' });
        const draft = relative(cwd, file).replace(/\\/g, '/');
        if (!expectation) {
          return { status: 'NO_EXPECTATION', draft, steps: steps.length, next: 'The user did not set the correct expectation. Ask them to record again and use the toolbar ("预期文本 / 预期输入值 / 应可见 / 不应报错") before pressing stop. Do not invent one.' };
        }
        const secrets = [...new Set(steps.filter((s) => s.value?.secret).map((s) => s.value.secret))];
        return {
          status: 'RECORDED',
          draft,
          steps: steps.length,
          key_steps: steps.filter((s) => s.pinned).map(stepLabel),
          checkpoints: steps.filter((s) => s.check).map((s) => `${stepLabel(s)} -> ${expectationLabel(s.check)}`),
          expectation: expectationLabel(expectation),
          ...(also.length ? { also: also.map(expectationLabel) } : {}),
          user_saw: expectedFrom,
          ...(secrets.length ? { secret_inputs: secrets.map((n) => `BUGGPS_SECRET_${n}`), secret_note: 'These inputs were not stored. The user must set these environment variables before DSH starts, or replay is ENV_BLOCKED. Never ask for the values in chat.' } : {}),
          ...(hasPositiveCheck({ expectation, also }) ? {} : { warning: 'Only "no error" is checked. A fix that deletes the feature would pass too, so verify can return at most NEEDS_REVIEW. Suggest the user record again and also mark what SHOULD be visible.' }),
          next: `Call buggps_lock with draft="${draft}".`,
        };
      }));
    },
  };

  const lock = {
    name: 'buggps_lock',
    description: `Replay a recorded draft on the CURRENT code. Only if the bug shows in every run, shorten the steps (replay only, no model calls) and lock the case: content-hashed and write-protected. If the project has a serve command (${CONFIG_FILE} {"serve":{"command","url"}} or the serve/serve_url parameters), BugGPS starts its own server from the working tree for every run, which is required for a VERIFIED verdict later. Returns case_id for buggps_verify.`,
    parameters: {
      draft: { type: 'string', required: true, description: 'Draft path returned by buggps_record (relative to the repo)' },
      url: { type: 'string', description: 'Base URL of a running dev server. Only for cases without a serve command (verify can then say at most PASSED_UNBOUND).' },
      serve: { type: 'string', description: `Dev server command BugGPS runs from the repo root, e.g. "npm run dev -- --port 5199 --strictPort". Overrides ${CONFIG_FILE}. Ask the user; use a port that is free.` },
      serve_url: { type: 'string', description: 'URL that serve command answers on, e.g. http://127.0.0.1:5199/' },
      case_id: { type: 'string', description: 'Id for the locked case (default: draft name)' },
      minimize: { type: 'boolean', description: 'Shorten the steps (default true). The full recording stays authoritative either way.' },
      observe_ms: { type: 'number', description: `How long a passing result must keep passing after the last step (default ${DEFAULT_OBSERVE_MS} ms). Raise it for bugs that show up late.` },
    },
    timeoutMs: 20 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await projectOf(exec);
      const draftPath = isAbsolute(args.draft) ? args.draft : resolve(cwd, args.draft);
      let draft;
      try { draft = JSON.parse(await readFile(draftPath, 'utf8')); } catch (err) { return json({ status: 'TEST_INVALID', message: `cannot read draft ${args.draft}: ${err.message}` }); }
      let serve;
      let config;
      try {
        config = await readConfig(cwd);
        serve = normalizeServe(args.serve ? { command: args.serve, url: args.serve_url } : config.serve);
      } catch (err) { return json({ status: 'TEST_INVALID', message: err.message, next: 'Fix the serve command / URL with the user.' }); }
      if (!serve && !args.url) return json({ status: 'TEST_INVALID', message: 'need either a serve command (recommended) or the url of a running dev server', next: `Ask the user for the dev command and a free port, then pass serve and serve_url (or add "serve" to ${CONFIG_FILE}).` });
      if (!serve && !(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server and retry.'));
      const observeMs = args.observe_ms !== undefined ? Math.round(args.observe_ms) : config.observeMs;
      const testCase = { ...draft, ...(observeMs !== undefined ? { observeMs } : {}), ...(serve ? { serve } : {}) };
      const id = args.case_id ?? draftPath.split(/[\\/]/).pop().replace(/\.json$/, '');
      return json(await withBrowser(exec.signal, {}, async (env) => {
        validateCase(testCase);
        const work = async (url) => {
          const red = await reproduce(env.browser, testCase, { baseUrl: url, runs: 3, signal: exec.signal });
          if (red.status !== Status.REPRODUCED) {
            return { status: red.status, tally: red.tally, observed: red.observed, reason: red.reason, step: red.stepIndex !== null && draft.steps[red.stepIndex] ? stepLabel(draft.steps[red.stepIndex]) : null, next: LOCK_NEXT[red.status] ?? NEXT[red.status] };
          }
          let m = null;
          if (args.minimize !== false) // Shortening is a reading aid (the full recording decides), so it gets a fixed budget and
          // returns the best confirmed result so far instead of keeping the user waiting.
          m = await minimize(env.browser, testCase, { baseUrl: url, signature: red.signature, maxMs: 90_000, late: red.late, signal: exec.signal });
          const minimizedSteps = m?.confirmed && m.minimizedSteps < m.originalSteps ? m.testCase.steps : undefined;
          const locked = await lockCase(env.browser, env, cwd, { ...testCase, minimizedSteps }, { baseUrl: url, id, signal: exec.signal, serverReady: Boolean(serve) });
          return { red, m, minimizedSteps, locked };
        };
        let out;
        if (serve) {
          const b = await withManagedServer(cwd, serve, work, { warmup: warmupPage(env.browser, testCase) });
          if (b.treeAfter !== b.treeBefore) return { status: Verdict.STALE, message: 'files changed while locking', next: LOCK_NEXT[Verdict.STALE] };
          out = b.result;
        } else {
          out = await work(args.url);
        }
        if (!out.locked) return out;
        const { red, m, minimizedSteps, locked } = out;
        if (!locked.caseId) return { status: locked.status, message: 'the bug did not reproduce consistently at lock time', reason: locked.reason ?? null, next: LOCK_NEXT[locked.status] ?? NEXT[locked.status] };
        lockedHere.set(`${realKey(cwd)}|${id}`, locked.lock.caseSha256);
        const kept = Boolean(locked.lock.redMinimized?.kept);
        return {
          status: 'LOCKED',
          case_id: id,
          binding: serve ? `managed: BugGPS runs \`${serve.command.join(' ')}\` at ${serve.url}` : `external: ${args.url} (verify can say at most PASSED_UNBOUND)`,
          expectation: expectationLabel(draft.expectation),
          ...(draft.also?.length ? { also: draft.also.map(expectationLabel) } : {}),
          observe_ms: testCase.observeMs ?? DEFAULT_OBSERVE_MS,
          observed_now: red.observed,
          ...(red.late ? { note_late: `the failure appeared only during the ${testCase.observeMs ?? DEFAULT_OBSERVE_MS} ms observation window after the last step` } : {}),
          recorded_steps: draft.steps.length,
          ...(kept ? { shortest_steps: minimizedSteps.map(stepLabel) } : { steps: draft.steps.map(stepLabel) }),
          minimization: m ? { from: m.originalSteps, to: kept ? m.minimizedSteps : m.originalSteps, trials: m.stats.trials, probe_runs: m.stats.probeRuns, model_calls: 0, note: 'A verified shorter path that still shows the same failure, for reading the code. Not proven minimal and not a cause; the full recording decides verification.' } : 'skipped',
          ...(hasPositiveCheck(testCase) ? {} : { warning: 'Only "no error" is checked, so verify can return at most NEEDS_REVIEW.' }),
          next: `Find and fix the cause in the application code (never edit .buggps/), then call buggps_verify with case_id="${id}".`,
        };
      }));
    },
  };

  const verify = {
    name: 'buggps_verify',
    description: 'Decide whether a locked bug is fixed: replays the user\'s full recording on the current code (3 runs, each held for the observation window) and compares it with the RED evidence captured at lock time. For cases with a serve command it starts its own server from the working tree, so the verdict belongs to exactly this code. The ONLY way to claim a BugGPS case is fixed.',
    parameters: {
      case_id: { type: 'string', required: true, description: 'case_id from buggps_lock' },
      url: { type: 'string', description: 'Only for cases locked without a serve command: URL of the running dev server' },
    },
    timeoutMs: 15 * 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      if (!guardActive()) {
        return json({ status: 'ENV_BLOCKED', message: 'BugGPS write protection is not active in this DSH process, so a verdict cannot be trusted.', next: 'Check the dsh-bug-gps plugin loaded without warnings (dsh --profile <p> --dump-config).' });
      }
      const cwd = await projectOf(exec);
      const id = args.case_id;
      let lockFile;
      try { lockFile = await loadCase(cwd, id); } catch { return json({ status: 'TEST_INVALID', message: `no locked case "${id}" in ${cwd}/.buggps/cases`, next: 'Use buggps_status to list cases.' }); }
      const remembered = lockedHere.get(`${realKey(cwd)}|${id}`);
      if (remembered && remembered !== lockFile.lock.caseSha256) {
        return json({ status: Verdict.CASE_TAMPERED, message: 'lock.json was rewritten after locking in this session', next: NEXT[Verdict.CASE_TAMPERED] });
      }
      if (remembered && hashCase(lockFile.body) !== remembered) {
        return json({ status: Verdict.CASE_TAMPERED, message: 'case.json changed after locking', next: NEXT[Verdict.CASE_TAMPERED] });
      }
      const managed = Boolean(lockFile.body.serve);
      if (!managed) {
        if (!args.url) return json({ status: 'TEST_INVALID', message: 'this case was locked without a serve command; pass url (the result can be at most PASSED_UNBOUND)', next: NEXT[Verdict.PASSED_UNBOUND] });
        if (!(await reachable(args.url))) return json(envBlocked(`dev server not reachable at ${args.url}`, 'Start the dev server and retry.'));
      }
      return json(await withBrowser(exec.signal, {}, async (env) => {
        const r = await verifyCase(env.browser, env, cwd, id, { baseUrl: args.url, signal: exec.signal });
        return {
          status: r.verdict,
          case_id: id,
          binding: managed ? `managed (${lockFile.body.serve.url})` : `external (${args.url}): not tied to the patch`,
          expectation: expectationLabel(lockFile.body.expectation),
          ...(lockFile.body.also?.length ? { also: lockFile.body.also.map(expectationLabel) } : {}),
          observed_for_ms: r.observeMs,
          before_fix: lockFile.lock.red?.observed ?? null,
          now: r.check ? (r.check.observed ?? (r.check.status === Status.NOT_REPRODUCED ? 'all checks met' : null)) : null,
          runs: r.check?.tally ?? null,
          ...(r.check?.observation ? { observation: r.check.observation } : {}),
          ...(r.baselineControl ? { baseline_control: r.baselineControl } : {}),
          ...(r.check?.reason ? { reason: r.check.reason } : {}),
          ...(r.reviewReasons ? { review_reasons: r.reviewReasons.map((k) => `${k}: ${REVIEW_TEXT[k]}`) } : {}),
          ...(r.check?.disabledSteps ? { disabled_steps: r.check.disabledSteps.map((d) => stepLabel(d.step)) } : {}),
          ...(r.check?.looseSteps ? { loosely_matched_steps: r.check.looseSteps.map((i) => stepLabel(lockFile.body.steps[i])) } : {}),
          ...(r.check?.looseChecks ? { loosely_matched_checks: r.check.looseChecks } : {}),
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
    description: 'List locked BugGPS cases in this repo with their latest verdict (and whether that verdict still applies to the current code), and check the environment (write protection, serve config, dev server, browser).',
    parameters: {
      url: { type: 'string', description: 'Dev server URL to check (optional)' },
      check_browser: { type: 'boolean', description: 'Also check that Edge/Chrome can be launched' },
    },
    timeoutMs: 60 * 1000,
    output: OUTPUT,
    async execute(args, exec) {
      const cwd = await projectOf(exec);
      const casesDir = join(cwd, '.buggps', 'cases');
      const runsDir = join(cwd, '.buggps', 'runs');
      const ids = await readdir(casesDir).catch(() => []);
      const runs = (await readdir(runsDir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
      const latest = {};
      for (const f of runs) {
        try { const r = JSON.parse(await readFile(join(runsDir, f), 'utf8')); latest[r.caseId] = r; } catch { /* skip */ }
      }
      const tree = ids.length ? await snapshotTree(cwd).catch(() => null) : null;
      const cases = [];
      for (const id of ids) {
        try {
          const { body, lock } = await loadCase(cwd, id);
          const r = latest[id];
          cases.push({
            case_id: id,
            expectation: expectationLabel(body.expectation),
            binding: body.serve ? 'managed' : 'external',
            before_fix: lock.red?.observed ?? null,
            steps: body.steps.length,
            latest: r ? { verdict: r.verdict, at: r.finishedAt, applies_to_current_code: Boolean(tree && r.treeAfter && r.treeAfter === tree) } : null,
          });
        } catch { cases.push({ case_id: id, error: 'unreadable' }); }
      }
      let config;
      try { config = await readConfig(cwd); } catch (err) { config = { error: err.message }; }
      const out = { status: 'OK', repo: cwd, write_protection: guardActive() ? 'active' : 'NOT ACTIVE', serve: config.error ? `invalid ${CONFIG_FILE}: ${config.error}` : config.serve ? `${parseServeLabel(config.serve)}` : `none (add "serve" to ${CONFIG_FILE} for VERIFIED verdicts)`, cases };
      if (cases.some((c) => c.latest && !c.latest.applies_to_current_code)) out.note = 'A latest verdict with applies_to_current_code=false was given for different code; run buggps_verify again before relying on it.';
      if (args.url) out.dev_server = (await reachable(args.url)) ? 'reachable' : 'NOT reachable';
      if (args.check_browser) {
        try { const env = await launchBrowser(); out.browser = `${env.channel} ${env.version}`; await env.browser.close(); } catch (err) { out.browser = `NOT usable: ${err.message}`; }
      }
      return json(out);
    },
  };

  return [record, lock, verify, status];
}

function parseServeLabel(serve) {
  try { const s = normalizeServe(serve); return `${s.command.join(' ')} -> ${s.url}`; } catch (err) { return `invalid: ${err.message}`; }
}
