import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Expected a fixture port');
const baseline = basename(process.cwd()) === 'worktree';
let documents = 0;
const server = createServer(async (request, response) => {
  if (request.url !== '/') { response.writeHead(404).end(); return; }
  if (request.headers['sec-fetch-dest'] === 'document') documents++;
  let body = await readFile(join(process.cwd(), 'index.html'), 'utf8');
  // The warmup succeeds; the first measured baseline navigation loses its trigger.
  if (baseline && documents === 2) body = body.replace(/<button[^>]*>.*?<\/button>/s, '');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
});
server.listen(port, '127.0.0.1');
