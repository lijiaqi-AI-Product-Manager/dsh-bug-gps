#!/usr/bin/env node
// End-to-end on the REAL DeepSeek Harness: installs this repo as a plugin into an isolated
// DSH_HOME, then runs `dsh --profile headless` against a scripted model (mock-model.mjs) that
// drives the BugGPS workflow on a temp copy of the seeded example app. The model is scripted;
// DSH's loader, tool pipeline, timeout policy, guard and skill system are real.
//
//   node test/e2e/dsh-e2e.mjs        (needs DSH from spikes/s1-dsh/dsh or BUGGPS_DSH_DIR)
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo } from '../helpers.js';
import { startStaticServer } from '../../examples/serve.js';
import { launchBrowser } from '../../src/core/browser.js';
import { recordSession } from '../../bench/sessions.js';

const REPO = realpathSync.native(fileURLToPath(new URL('../../', import.meta.url)));
const DSH_DIR = process.env.BUGGPS_DSH_DIR ?? join(REPO, 'spikes', 's1-dsh', 'dsh');
const DSH_BIN = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
// Short DSH_HOME: deep paths break `dsh plugin` on Windows (ENAMETOOLONG, see S1 report).
const DSH_HOME = join(process.env.LOCALAPPDATA ?? process.env.TMPDIR ?? '/tmp', 'Temp', 'bgr', 'dsh-home-e2e');
const PORT = 8766;
const APP_PORT = 8797; // the app server BugGPS itself starts for lock/verify (managed binding)
const WORK = join(process.env.LOCALAPPDATA ?? '/tmp', 'Temp', 'bgr', 'e2e-work');
if (!existsSync(DSH_BIN)) { console.error(`DSH not found at ${DSH_BIN}`); process.exit(2); }

const env = {
  ...process.env,
  DSH_HOME,
  PATH: `${join(DSH_DIR, 'node_modules', '.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
  DEEPSEEK_BASE_URL: `http://127.0.0.1:${PORT}/v1`,
  DEEPSEEK_API_KEY: 'mock-key',
};
const dsh = (args, opts = {}) => spawnSync(process.execPath, [DSH_BIN, ...args], { env, encoding: 'utf8', ...opts });
const out = { at: new Date().toISOString(), kind: 'REAL DSH, scripted model, SEEDED example app', checks: [] };
const check = (name, ok, detail) => { out.checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };

// 1. Fresh isolated DSH_HOME, real plugin install (linked checkout).
rmSync(DSH_HOME, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const ver = dsh(['--version']);
out.dshVersion = ver.stdout.trim();
// BUGGPS_E2E_TARBALL=1: install what `npm pack` produces (what users get from npm) instead of
// the linked checkout. pnpm then installs playwright-core into the profile itself.
let source = REPO;
if (process.env.BUGGPS_E2E_TARBALL) {
  const pack = spawnSync(`npm pack --pack-destination "${WORK}" --json`, { cwd: REPO, encoding: 'utf8', shell: true });
  const info = JSON.parse(pack.stdout)[0];
  source = join(WORK, info.filename);
  out.tarball = { file: info.filename, bytes: info.size, files: info.entryCount };
  check('npm pack', pack.status === 0, `${info.entryCount} files, ${info.size} bytes`);
}
out.install = source === REPO ? 'linked checkout' : 'npm pack tarball';
const add = dsh(['plugin', '--profile', 'headless', 'add', source]);
check(`dsh plugin --profile headless add (${out.install})`, add.status === 0, add.status === 0 ? out.dshVersion : (add.stderr || add.stdout).slice(-600));
const dump = dsh(['--profile', 'headless', '--dump-config']);
check('--dump-config shows the dsh-bug-gps layer', /dsh-bug-gps/.test(dump.stdout));

// 2. Project: git repo copy of the seeded app, served, plus a draft as buggps_record saves it.
const project = await tempRepo();
const server = await startStaticServer(project.root);
const b = await launchBrowser();
const s = await recordSession(b.browser, server.url, 'stale-discount');
await b.browser.close();
mkdirSync(join(project.root, '.buggps', 'drafts'), { recursive: true });
writeFileSync(join(project.root, '.buggps', 'drafts', 'coupon.json'), JSON.stringify({ schema: 'buggps.draft/v1', steps: s.steps, expectation: s.expectation }));
const appJs = join(project.root, 'app.js');
// How BugGPS starts the app from the working tree. Locked into the case at buggps_lock.
copyFileSync(join(REPO, 'examples', 'serve.js'), join(project.root, 'serve.js'));
writeFileSync(join(project.root, 'buggps.config.json'), JSON.stringify({ serve: { command: ['node', 'serve.js', '.', String(APP_PORT)], url: `http://127.0.0.1:${APP_PORT}/` } }, null, 2));
const caseFile = join(project.root, '.buggps', 'cases', 'coupon', 'case.json');

// 3. Scripted agent turn.
const url = server.url;
const scenario = [
  { tool: 'skill', input: { name: 'buggps' } },
  { tool: 'buggps_status', input: { url, check_browser: true } },
  { tool: 'buggps_lock', input: { draft: '.buggps/drafts/coupon.json', case_id: 'coupon' } },
  { tool: 'buggps_verify', input: { case_id: 'coupon' } },
  { tool: 'write', input: { file_path: '.buggps/cases/coupon/case.json', content: '{"expectation":{"kind":"no-page-error"}}' } },
  { tool: 'read', input: { file_path: appJs } }, // DSH's edit tool requires a prior read
  { tool: 'edit', input:{ file_path: appJs, old_string: 'let total = subtotal() - state.discount;', new_string: 'let total = Math.max(0, subtotal() - state.discount);' } },
  { tool: 'buggps_verify', input: { case_id: 'coupon' } },
  { tool: 'edit', input: { file_path: appJs, old_string: '// SEEDED BUG 1: should call recompute(); the discount stays computed from the old subtotal.', new_string: 'recompute(); return; // fix' } },
  { tool: 'buggps_verify', input: { case_id: 'coupon' } },
  { text: 'BugGPS e2e scenario finished.' },
];
const scenarioFile = join(WORK, 'scenario.json');
const logFile = join(WORK, 'mock.jsonl');
writeFileSync(scenarioFile, JSON.stringify(scenario));
const mock = spawn(process.execPath, [fileURLToPath(new URL('./mock-model.mjs', import.meta.url)), String(PORT), scenarioFile, logFile, caseFile], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const caseHashNow = () => { try { return createHash('sha256').update(readFileSync(caseFile)).digest('hex'); } catch { return null; } };
const t0 = Date.now();
const turn = await new Promise((done) => {
  const p = spawn(process.execPath, [DSH_BIN, '--profile', 'headless', '--json', 'Fix the coupon total bug using BugGPS.'], { cwd: project.root, env });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  const kill = setTimeout(() => p.kill(), 15 * 60 * 1000);
  p.on('exit', (code) => { clearTimeout(kill); done({ code, stdout, stderr }); });
});
out.turnSeconds = Math.round((Date.now() - t0) / 1000);
mock.kill();
await server.close();

// 4. Read back what DSH actually returned for each tool call.
const reqs = readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.tools?.length);
const last = reqs[reqs.length - 1];
const calls = [];
const byId = new Map();
for (const m of last.messages ?? []) {
  for (const c of Array.isArray(m.content) ? m.content : []) {
    if (c.type === 'tool_use') { const e = { name: c.name, input: c.input }; byId.set(c.id, e); calls.push(e); }
    if (c.type === 'tool_result') {
      const e = byId.get(c.tool_use_id);
      if (e) { e.isError = Boolean(c.is_error); e.result = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join(''); }
    }
  }
}
const statusOf = (e) => (e?.result?.match(/^BugGPS (\S+)/) ?? [])[1] ?? (e?.isError ? 'ERROR' : '?');
out.calls = calls.map((c) => ({ tool: c.name, status: c.name.startsWith('buggps_') ? statusOf(c) : (c.isError ? 'ERROR' : 'ok'), result: String(c.result ?? '').slice(0, 300) }));

check('dsh exited 0 with no plugin load warnings', turn.code === 0 && !/skipping profile bundle|did not activate/i.test(turn.stderr), `exit=${turn.code}`);
check('tools offered to the model include the 4 BugGPS tools', ['buggps_record', 'buggps_lock', 'buggps_verify', 'buggps_status'].every((t) => reqs[0].tools.includes(t)));
check('skill catalog lists buggps; body loads on demand', /buggps/.test(JSON.stringify(reqs[0].messages)) && /BugGPS workflow/.test(calls[0]?.result ?? ''));
check('status: write protection active, serve configured, browser usable', /write_protection: active/.test(calls[1]?.result ?? '') && /serve: node .*-> http:\/\/127\.0\.0\.1:8797\//.test(calls[1]?.result ?? '') && /browser: (msedge|chrome)/.test(calls[1]?.result ?? ''));
check('lock: LOCKED, managed binding, model_calls 0', statusOf(calls[2]) === 'LOCKED' && /binding: managed/.test(calls[2]?.result ?? '') && /"model_calls":0/.test(calls[2]?.result ?? ''), statusOf(calls[2]));
check('verify before any change: NO_CODE_CHANGE', statusOf(calls[3]) === 'NO_CODE_CHANGE');
check('agent write into .buggps/ denied by the guard', calls[4]?.isError === true && /write-protected/.test(calls[4]?.result ?? ''), (calls[4]?.result ?? '').slice(0, 120));
check('edits by the agent applied', calls[6]?.isError === false && calls[8]?.isError === false);
check('wrong fix: STILL_FAILING', statusOf(calls[7]) === 'STILL_FAILING');
check('real fix: VERIFIED', statusOf(calls[9]) === 'VERIFIED', (calls[9]?.result ?? '').split('\n').find((l) => l.startsWith('patch:')));
// The case hash as the model saw the world DURING the turn: right after lock (request 3), right
// after the attempted write (request 5), at the last request, and after the turn.
const seen = [reqs[3]?.watchSha, reqs[5]?.watchSha, reqs[reqs.length - 1]?.watchSha, caseHashNow()];
check('locked case unchanged at every point of the turn', seen[0] && seen.every((h) => h === seen[0]), seen.map((h) => String(h).slice(0, 8)).join(' '));

out.passed = out.checks.every((c) => c.ok);
mkdirSync(join(REPO, 'bench', 'results'), { recursive: true });
const file = join(REPO, 'bench', 'results', `dsh-e2e-${out.at.replace(/[:.]/g, '-')}.json`);
// Results are committed: replace local directories (they contain the user name) with placeholders.
const esc = (p) => JSON.stringify(p).slice(1, -1);
writeFileSync(file, JSON.stringify({ ...out, stderrTail: turn.stderr.slice(-1500) }, null, 2).split(esc(REPO)).join('<repo>').split(esc(tmpdir() + sep)).join('%TEMP%\\\\'));
console.log(`\n${out.passed ? 'ALL PASS' : 'FAILURES'} — dsh ${out.dshVersion}, turn ${out.turnSeconds}s — ${file}`);
await project.cleanup();
process.exit(out.passed ? 0 : 1);
