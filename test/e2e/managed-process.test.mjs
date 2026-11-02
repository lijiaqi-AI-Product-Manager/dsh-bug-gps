import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
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
