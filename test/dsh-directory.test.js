import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { apply } from '../src/dsh/index.js';

const argumentsFor = {
  buggps_record: { url: 'http://127.0.0.1:1/' },
  buggps_lock: { draft: '.buggps/drafts/probe.json' },
  buggps_verify: { case_id: 'probe' },
  buggps_status: {},
};

function toolsFor(service) {
  const tools = [];
  apply({
    get: (name) => name === 'workingDirectory' ? service : undefined,
    tools: { guard: () => {}, register: (tool) => tools.push(tool) },
    skills: { register: () => {} },
  });
  return tools;
}

async function executeWithoutFallback(tool, signal) {
  const original = process.cwd;
  let fallbacks = 0;
  try {
    process.cwd = () => { fallbacks++; throw new Error('Unexpected process-directory fallback'); };
    const result = await tool.execute(argumentsFor[tool.name], { agent: { session: {} }, signal });
    return { result, fallbacks };
  } finally { process.cwd = original; }
}

test('all tools report an unavailable session repository without choosing the process directory', async () => {
  let ensured = 0;
  const tools = toolsFor({ ensure: async () => { ensured++; throw new Error('Fixture directory missing'); } });
  for (const tool of tools) {
    const { result, fallbacks } = await executeWithoutFallback(tool, new AbortController().signal);
    assert.equal(result.status, 'ENV_BLOCKED', tool.name);
    assert.match(result.message, /Fixture directory missing/);
    assert.match(result.hint, /repository/);
    assert.equal(fallbacks, 0);
  }
  assert.equal(ensured, 4);
});

test('already-cancelled tasks stop before directory resolution for all tools', async () => {
  let ensured = 0;
  const tools = toolsFor({ ensure: async () => { ensured++; throw new Error('Directory resolution must not start'); } });
  const controller = new AbortController();
  controller.abort('Fixture cancellation');
  for (const tool of tools) {
    const { result, fallbacks } = await executeWithoutFallback(tool, controller.signal);
    assert.equal(result.status, 'ABORTED', tool.name);
    assert.equal(fallbacks, 0);
  }
  assert.equal(ensured, 0);
});

test('cancellation during directory resolution retains ABORTED for all tools', async () => {
  for (const name of Object.keys(argumentsFor)) {
    const controller = new AbortController();
    const tool = toolsFor({ ensure: async () => { controller.abort(); throw new Error('Fixture cancelled while resolving'); } }).find((t) => t.name === name);
    const { result, fallbacks } = await executeWithoutFallback(tool, controller.signal);
    assert.equal(result.status, 'ABORTED', name);
    assert.equal(fallbacks, 0);
  }
});

test('an absent or relative service result is blocked instead of using an implicit directory', async () => {
  for (const directory of [undefined, '', '.']) {
    const tools = toolsFor({ ensure: async () => directory });
    for (const tool of tools) {
      const { result, fallbacks } = await executeWithoutFallback(tool, new AbortController().signal);
      assert.equal(result.status, 'ENV_BLOCKED', tool.name);
      assert.equal(fallbacks, 0);
    }
  }
});

test('status uses the resolved session directory and preserves a service-free CLI directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'buggps-directory-'));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps-directory-'));
    await rm(target, { recursive: true, force: true });
  });
  const status = toolsFor({ ensure: async () => root }).find((t) => t.name === 'buggps_status');
  const session = await executeWithoutFallback(status, new AbortController().signal);
  assert.equal(session.result.status, 'OK');
  assert.equal(session.result.repo, root);
  assert.equal(session.fallbacks, 0);

  const cli = toolsFor(undefined).find((t) => t.name === 'buggps_status');
  const original = process.cwd;
  let fallbacks = 0;
  try {
    process.cwd = () => { fallbacks++; return root; };
    const result = await cli.execute({}, { agent: { session: {} }, signal: new AbortController().signal });
    assert.equal(result.status, 'OK');
    assert.equal(result.repo, root);
    assert.equal(fallbacks, 1);
  } finally { process.cwd = original; }
});
