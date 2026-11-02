import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { startDevServer } from '../../src/core/devserver.js';
import { freePort } from '../helpers.js';

const host = process.env.BUGGPS_DSH_DIR;
if (!host) throw new Error('Set BUGGPS_DSH_DIR to the tested DSH installation');
const { Context } = await import(pathToFileURL(join(resolve(host), 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')));
const { default: LocalRuntime } = await import(pathToFileURL(join(resolve(host), 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')));

test('host process range cleans a detached server after its launcher exits', { timeout: 20000 }, async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(LocalRuntime);
  await fiber.inertia;
  const root = await mkdtemp(join(tmpdir(), 'buggps-process-'));
  const pidFile = join(root, 'pid');
  const port = await freePort();
  const url = 'http://127.0.0.1:' + port + '/';
  const payload = 'require("http").createServer((q,r)=>r.end("ready")).listen(Number(process.argv[1]),"127.0.0.1");require("fs").writeFileSync(process.argv[2],String(process.pid));';
  const launcher = 'const child=require("child_process").spawn(process.execPath,["-e",' + JSON.stringify(payload) + ',' + JSON.stringify(String(port)) + ',' + JSON.stringify(pidFile) + '],{detached:true,stdio:"ignore"});child.unref();setTimeout(()=>process.exit(0),1200);';
  let server;
  try {
    server = await startDevServer({ cwd: root, argv: [process.execPath, '-e', launcher], url, subprocess: ctx.subprocess });
    await new Promise((done) => setTimeout(done, 1600));
    await server.stop();
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }));
  } finally {
    await server?.stop().catch(() => {});
    await ctx.fiber.dispose();
    // A backstop for the deliberately leaking regression path, scoped to this fixture's PID.
    const pid = await readFile(pidFile, 'utf8').then(Number, () => null);
    if (Number.isInteger(pid) && pid > 0) {
      if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      else { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps-process-'));
    await rm(target, { recursive: true, force: true });
  }
});

for (const manager of ['npm', 'pnpm']) test('host process range starts ' + manager + ' scripts from a directory containing Chinese and spaces', { timeout: 20000 }, async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(LocalRuntime);
  await fiber.inertia;
  const root = await mkdtemp(join(tmpdir(), 'buggps npm 中文 '));
  const port = await freePort();
  const url = 'http://127.0.0.1:' + port + '/';
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { dev: 'node "serve file.cjs"' } }));
  await writeFile(join(root, 'serve file.cjs'), 'require("http").createServer((q,r)=>r.end("ready")).listen(' + port + ',"127.0.0.1");');
  let server;
  try {
    const command = manager === 'npm' ? 'npm' : join(resolve(host), 'node_modules', '.bin', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    server = await startDevServer({ cwd: root, argv: [command, 'run', 'dev'], url, subprocess: ctx.subprocess });
    assert.equal(await (await fetch(url)).text(), 'ready');
    await server.stop();
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }));
  } finally {
    await server?.stop().catch(() => {});
    await ctx.fiber.dispose();
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps npm '));
    await rm(target, { recursive: true, force: true });
  }
});

test('cancelling startup waits for the real host-owned process to exit', { timeout: 15000 }, async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(LocalRuntime);
  await fiber.inertia;
  const root = await mkdtemp(join(tmpdir(), 'buggps-cancel-'));
  const marker = join(root, 'pid');
  const controller = new AbortController();
  const port = await freePort();
  const code = 'require("fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);';
  const startup = startDevServer({ cwd: root, argv: [process.execPath, '-e', code, marker], url: 'http://127.0.0.1:' + port + '/', subprocess: ctx.subprocess, signal: controller.signal }).then((server) => ({ server }), (error) => ({ error }));
  try {
    let pid;
    const deadline = Date.now() + 5000;
    while (!pid && Date.now() < deadline) {
      pid = await readFile(marker, 'utf8').then(Number, () => null);
      if (!pid) await new Promise((done) => setTimeout(done, 20));
    }
    assert.ok(pid, 'the owned process reached startup');
    controller.abort();
    const result = await startup;
    assert.equal(result.error?.name, 'AbortError');
    assert.throws(() => process.kill(pid, 0));
  } finally {
    controller.abort();
    await ctx.fiber.dispose();
    const result = await startup;
    await result.server?.stop().catch(() => {});
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('buggps-cancel-'));
    await rm(target, { recursive: true, force: true });
  }
});
