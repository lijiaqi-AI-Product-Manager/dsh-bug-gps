import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/core/browser.js';
import { startStaticServer } from '../examples/serve.js';
import { git } from '../src/core/snapshot.js';

export const EXAMPLE_DIR = fileURLToPath(new URL('../examples/cart-shop/', import.meta.url));

export async function withEnv(dir = EXAMPLE_DIR) {
  const env = await launchBrowser();
  const server = await startStaticServer(dir);
  return {
    ...env,
    url: server.url,
    async close() { await env.browser.close(); await server.close(); },
  };
}

export const SERVE_JS = fileURLToPath(new URL('../examples/serve.js', import.meta.url));

/** A port nothing listens on right now. */
export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

/** Managed serve spec: BugGPS itself starts the static server on `root`. */
export async function serveSpec(root) {
  const port = await freePort();
  return { command: ['node', SERVE_JS, root, String(port)], url: `http://127.0.0.1:${port}/` };
}

/** Copies the example into a fresh git repo (path contains a space on purpose). */
export async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), 'buggps repo '));
  await cp(EXAMPLE_DIR, root, { recursive: true });
  await git(root, ['init', '-q']);
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'seeded']);
  return { root, async cleanup() {
    const target = await realpath(root).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!target) return;
    if (dirname(target) !== await realpath(tmpdir()) || !basename(target).startsWith('buggps repo ')) throw new Error('Unexpected fixture cleanup path');
    await rm(target, { recursive: true, force: true });
  } };
}
