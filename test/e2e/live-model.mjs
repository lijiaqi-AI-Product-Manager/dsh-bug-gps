// Opt-in checks against the existing official account provider. No credentials are copied.
// The model receives only disposable seeded projects. Raw events stay in a private directory
// when BUGGPS_LIVE_RAW_DIR is supplied; the exported record contains structured facts only.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { tempRepo, freePort } from '../helpers.js';
import { startStaticServer } from '../../examples/serve.js';
import { launchBrowser } from '../../src/core/browser.js';
import { startRecording } from '../../src/core/recorder.js';
import { SESSIONS } from '../../bench/sessions.js';
import { lockCase, loadCase, hashCase, hashLock } from '../../src/core/caselock.js';

const source = fileURLToPath(new URL('../../', import.meta.url));
const host = process.env.BUGGPS_DSH_DIR;
assert.ok(host, 'set BUGGPS_DSH_DIR to an installed DSH directory');
const cli = join(host, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
assert.ok(existsSync(cli), 'DSH CLI not found');
const root = await mkdtemp(join(tmpdir(), 'bgl-'));
const profile = `buggps-eval-${basename(root)}`;
const profileDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile);
assert.ok(!existsSync(profileDir), 'refuse to replace an existing profile');
const rawDir = process.env.BUGGPS_LIVE_RAW_DIR ?? join(root, 'raw');
await mkdir(rawDir, { recursive: true });
const env = { ...process.env, PATH: `${join(host, 'node_modules/.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };
const command = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const record = { schema: 'buggps.provider-check/v1', at: new Date().toISOString(), provider: 'deepseek-account', model: 'deepseek-flash', input: 'scripted-recording', application: 'seeded-example', checks: [] };
const pluginSource = process.env.BUGGPS_LIVE_PACKAGE ? resolve(process.env.BUGGPS_LIVE_PACKAGE) : source;
if (pluginSource !== source) {
  assert.ok(pluginSource.endsWith('.tgz') && existsSync(pluginSource), 'BUGGPS_LIVE_PACKAGE must point to a local package tarball');
  const bytes = readFileSync(pluginSource);
  record.install = { kind: 'package-tarball', file: basename(pluginSource), sha256: sha(bytes), bytes: bytes.length };
} else record.install = { kind: 'linked-checkout' };
record.runnerSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
const destination = process.env.BUGGPS_E2E_OUT ?? join(source, 'bench/results', `live-provider-${record.at.replace(/[:.]/g, '-')}.json`);
record.expectedScenarios = ['stale-discount', 'changelog-crash'];
record.monetaryCost = null; // Token usage is reported; currency cost is not returned by this runner.
let profileHash;
let failure;

async function turn(project, name, prompt) {
  const output = createWriteStream(join(rawDir, `${name}.jsonl`), { flags: 'wx' });
  const diagnostics = createWriteStream(join(rawDir, `${name}.log`), { flags: 'wx' });
  // Subscribe before spawning: short-lived children can finish either stream before exit.
  const outputDone = finished(output);
  const diagnosticsDone = finished(diagnostics);
  const events = [];
  const calls = [];
  const byId = new Map();
  const fingerprints = [];
  let lockedId = existsSync(join(project, '.buggps/cases/case/case.json')) ? 'case' : null;
  const capture = () => {
    if (!lockedId || !/^[a-z0-9-]+$/i.test(lockedId)) return;
    try { fingerprints.push({ body: sha(readFileSync(join(project, '.buggps/cases', lockedId, 'case.json'))), lock: sha(readFileSync(join(project, '.buggps/cases', lockedId, 'lock.json'))) }); }
    catch { fingerprints.push(null); }
  };
  capture();
  const child = spawn(process.execPath, [cli, '--profile', profile, '--patch', join(root, 'provider.yml'), '--json', '-'], { cwd: project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.pipe(output); child.stderr.pipe(diagnostics);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    events.push(event);
    if (event.type === 'tool_call') { const call = { tool: event.tool }; calls.push(call); byId.set(event.callId, call); }
    if (event.type === 'tool_result') {
      const call = byId.get(event.callId);
      if (call) {
        call.status = String(event.result ?? '').match(/^BugGPS ([A-Z_]+)/)?.[1] ?? event.status;
        if (call.tool === 'buggps_lock' && call.status === 'LOCKED') lockedId = String(event.result).match(/^case_id: (.+)$/m)?.[1];
      }
      capture();
    }
  });
  const started = Date.now();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 15 * 60 * 1000);
  child.stdin.end(prompt);
  let exitCode;
  try { exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally { clearTimeout(timeout); }
  await Promise.all([outputDone, diagnosticsDone]);
  const final = events.findLast((e) => e.type === 'final')?.text ?? '';
  return { exitCode, timedOut, durationMs: Date.now() - started, calls, final, usageByStep: events.filter((e) => e.usage).map((e) => ({ step: e.step, ...e.usage })), rawSha256: sha(await readFile(join(rawDir, `${name}.jsonl`))), fingerprints };
}

async function scenario(name, prepare, prompt) {
  const project = await tempRepo();
  let browser;
  try {
    await copyFile(join(source, 'examples/serve.js'), join(project.root, 'serve.js'));
    const port = await freePort();
    await writeFile(join(project.root, 'buggps.config.json'), JSON.stringify({ serve: { command: [process.execPath, 'serve.js', '.', String(port)], url: `http://127.0.0.1:${port}/` } }));
    const server = await startStaticServer(project.root);
    browser = await launchBrowser();
    let definition;
    try {
      const rec = await startRecording(browser.browser, { baseUrl: server.url });
      await SESSIONS[name].drive(rec.page);
      definition = { steps: await rec.stop(), browser: rec.result.browser, expectation: SESSIONS[name].expectation, ...(rec.result.captureIssues.length ? { captureIssues: rec.result.captureIssues } : {}) };
      await mkdir(join(project.root, '.buggps/drafts'), { recursive: true });
      await writeFile(join(project.root, '.buggps/drafts/input.json'), JSON.stringify({ schema: 'buggps.draft/v1', source: 'scripted', ...definition }));
    } finally { await server.close(); }
    const before = await prepare(project.root, browser, definition);
    const configHash = sha(await readFile(join(project.root, 'buggps.config.json')));
    const result = await turn(project.root, name, prompt);
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    const verifyCalls = result.calls.filter((c) => c.tool === 'buggps_verify');
    const verdict = verifyCalls.at(-1)?.status;
    const { body, lock } = await loadCase(project.root, before?.id ?? 'case');
    const names = (await readdir(join(project.root, '.buggps/runs'))).filter((f) => f.endsWith('.json')).sort();
    const run = JSON.parse(await readFile(join(project.root, '.buggps/runs', names.at(-1)), 'utf8'));
    assert.equal(hashCase(body), lock.caseSha256);
    assert.equal(sha(await readFile(join(project.root, 'buggps.config.json'))), configHash);
    assert.ok(result.fingerprints.length > 0 && result.fingerprints.every((f) => f && f.body === result.fingerprints[0]?.body && f.lock === result.fingerprints[0]?.lock), 'protected files changed between tool results');
    if (before) { assert.equal(hashCase(body), before.caseHash); assert.equal(hashLock(lock), before.lockHash); }
    assert.ok(result.final.includes(verdict), 'final answer must retain the tool verdict');
    const { final, fingerprints, ...summary } = result;
    record.checks.push({ scenario: name, ...summary, recordedSteps: definition.steps.length, verdict, tally: run.check?.tally, reviewReasons: run.reviewReasons ?? [], baselineMatches: run.baselineControl?.matchesLockedFailure ?? null, caseSha256: hashCase(body), lockSha256: hashLock(lock), patchSha256: run.patch?.sha256 ?? null, finalNamesVerdict: true, protectedSnapshots: fingerprints.length, protectedSnapshotsUnchanged: true });
    console.log(JSON.stringify({ scenario: name, verdict, exitCode: result.exitCode, calls: result.calls.length }));
    return { result, verdict };
  } finally {
    await browser?.browser.close();
    const target = await realpath(project.root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps repo '));
    await project.cleanup();
  }
}

try {
  record.dshVersion = command(['--version']).trim();
  record.pluginCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  command(['--profile', profile, '--from-default-profile', 'headless', '--help']);
  command(['plugin', '--profile', profile, 'add', pluginSource]);
  profileHash = sha(await readFile(join(profileDir, 'package.json')));
  await writeFile(join(root, 'provider.yml'), `- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
- id: agent-default-model
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
- id: tool-bash
  disabled: true
- id: tool-pwsh
  disabled: true
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
`);
  const positive = await scenario('stale-discount', async () => null,
    'Fix the coupon calculation in this workspace using BugGPS. The scripted draft is .buggps/drafts/input.json; the expected total after removing Apple is $18.00. Load the buggps skill, check buggps_status, lock the draft as case_id="case", and verify NO_CODE_CHANGE before editing. Read and fix application source, then verify. Use file and BugGPS tools only; no shell, delegation or git. Never modify .buggps/, configuration, serve commands or checks. State the tool verdict and recorded-scenario scope. No interactive recording is required.');
  assert.equal(positive.verdict, 'VERIFIED');
  assert.equal(positive.result.calls.find((c) => c.tool === 'buggps_verify')?.status, 'NO_CODE_CHANGE');
  const negative = await scenario('changelog-crash', async (project, browser, definition) => {
    const configured = JSON.parse(await readFile(join(project, 'buggps.config.json'), 'utf8'));
    const locked = await lockCase(browser.browser, browser, project, { ...definition, also: [{ kind: 'visible', target: [{ by: 'role', role: 'heading', name: 'About' }] }], ...configured }, { id: 'case' });
    assert.equal(locked.caseId, 'case');
    const app = join(project, 'app.js');
    const original = await readFile(app, 'utf8');
    const changed = original.replace('state.changelog = undefined; // SEEDED BUG 2: second click dereferences undefined.', "state.changelog = undefined; $('#changelog-btn').disabled = true;");
    assert.notEqual(changed, original);
    await writeFile(app, changed);
    const { body, lock } = await loadCase(project, 'case');
    return { id: 'case', caseHash: hashCase(body), lockHash: hashLock(lock) };
  }, 'Evaluate the existing candidate using BugGPS only. Load the buggps skill and verify case_id="case". Do not edit any files or attempt another repair. Retain the exact verdict and its reasons in the final answer; if review is needed, explain what requires a business decision and stop. Do not report a confirmed fix on a review or blocked verdict. No interactive operation is required.');
  assert.equal(negative.verdict, 'NEEDS_REVIEW');
  assert.ok(record.checks.at(-1).reviewReasons.includes('disabled-control'));
  record.outcome = 'PASSED';
} catch (error) {
  failure = error;
  record.outcome = 'FAILED';
  record.failure = { name: error.name, code: error.code ?? null };
} finally {
  try {
  // Only remove the unique profile created by this run, and only while its manifest is ours.
  if (profileHash && sha(await readFile(join(profileDir, 'package.json'))) === profileHash) {
    const target = await realpath(profileDir);
    assert.equal(dirname(target), await realpath(dirname(profileDir)));
    assert.equal(basename(target), profile);
    const link = join(target, 'node_modules/dsh-bug-gps');
    if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
    await rm(target, { recursive: true, force: true });
  }
  const target = await realpath(root);
  assert.equal(dirname(target), await realpath(tmpdir()));
  assert.ok(basename(target).startsWith('bgl-'));
  if (!failure) await rm(target, { recursive: true, force: true });
  } catch (error) {
    failure ??= error;
    record.outcome = 'FAILED';
    record.cleanupFailure = { name: error.name, code: error.code ?? null };
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ checks: record.checks.length, passed: !failure }));
}
if (failure) throw failure;
