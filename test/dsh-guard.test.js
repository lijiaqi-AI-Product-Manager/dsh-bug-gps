import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protectedReason } from '../src/dsh/guard.js';

const repo = mkdtempSync(join(tmpdir(), 'buggps guard '));
mkdirSync(join(repo, '.buggps', 'cases', 'c1'), { recursive: true });
mkdirSync(join(repo, 'src'), { recursive: true });
const call = (name, args) => protectedReason({ name, arguments: args }, repo);

test('file tools: every spelling of a path into .buggps/ is denied', () => {
  for (const p of [
    '.buggps/cases/c1/case.json',
    '.\\.buggps\\cases\\c1\\lock.json',
    join(repo, '.buggps', 'cases', 'c1', 'case.json'),
    join(repo, '.BugGPS', 'Cases', 'c1', 'case.json'),
    join(repo, 'src', '..', '.buggps', 'runs', 'x.json'),
    '.buggps/drafts/new.json',
  ]) {
    assert.ok(call('write', { file_path: p }), `write ${p}`);
    assert.ok(call('edit', { file_path: p }), `edit ${p}`);
    assert.ok(call('str_replace_editor', { command: 'create', path: p }), `str_replace_editor ${p}`);
  }
});

test('file tools: application code and reads are allowed', () => {
  assert.equal(call('write', { file_path: 'src/app.js' }), undefined);
  assert.equal(call('edit', { file_path: join(repo, 'src', 'app.js') }), undefined);
  assert.equal(call('write', { file_path: 'docs/buggps-notes.md' }), undefined);
  assert.equal(call('read', { file_path: '.buggps/cases/c1/case.json' }), undefined);
});

test('a junction that points into .buggps/ is followed and denied', (t) => {
  const link = join(repo, 'innocent');
  try { symlinkSync(join(repo, '.buggps', 'cases'), link, 'junction'); } catch (err) { t.skip(`cannot create junction: ${err.message}`); return; }
  assert.ok(call('write', { file_path: 'innocent/c1/case.json' }));
  assert.ok(call('write', { file_path: join(link, 'c1', 'new.json') }));
  rmSync(link, { force: true, recursive: false });
});

test('shell: obvious writes are denied, reads pass (best effort only; the hash is the real check)', () => {
  assert.ok(call('pwsh', { command: 'Set-Content -Path .buggps/cases/c1/case.json -Value x' }));
  assert.ok(call('bash', { command: 'echo {} > .buggps/cases/c1/lock.json' }));
  assert.ok(call('pwsh', { command: 'git checkout HEAD~1 -- .buggps' }));
  assert.equal(call('pwsh', { command: 'Get-Content .buggps/cases/c1/case.json' }), undefined);
  assert.equal(call('pwsh', { command: 'npm run dev' }), undefined);
});
