// ChartDB benchmark fixture: suppress only the timed promotional dialog.
// Database state, imports, controls and all check definitions remain those of the checkout.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a local benchmark port');
process.env.CI = 'true';
const require = createRequire(join(process.cwd(), 'package.json'));
const module = await import(pathToFileURL(require.resolve('vite')).href);
const createServer = module.createServer ?? module.default?.createServer;
const server = await createServer({ root: process.cwd(), cacheDir: join(process.cwd(), '.buggps/vite-cache'), clearScreen: false, plugins: [{ name: 'benchmark-promotional-dialog-fixture', transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', children: 'localStorage.setItem("github_repo_opened", "true");', injectTo: 'head-prepend' }] } }], server: { host: '127.0.0.1', port, strictPort: true, open: false } });
await server.listen();
server.printUrls();
let stopping;
const stop = () => stopping ??= server.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
