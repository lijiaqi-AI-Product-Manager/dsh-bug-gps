// Scripted Messages-API SSE server (adapted from spikes/s1-dsh/mock/server.mjs). Each
// request that carries tools consumes the next scripted step; requests without tools (session
// titles) get plain text. With [watch-file], every logged request also records that file's
// sha256 at the moment the request arrived (null if absent), so a test can see changes made
// DURING the agent turn, not just before and after it.
// Usage: node mock-model.mjs <port> <scenario.json> <log.jsonl> [watch-file]
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [port, scenarioFile, logFile, watchFile, instance] = process.argv.slice(2);
const watchSha = () => { if (!watchFile) return undefined; try { return createHash('sha256').update(readFileSync(watchFile)).digest('hex'); } catch { return null; } };
const steps = JSON.parse(readFileSync(scenarioFile, 'utf8'));
let step = 0;

function sse(res, out, n) {
  const ev = [['message_start', { type: 'message_start', message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }]];
  if (out.tool) {
    ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name: out.tool, input: {} } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(out.input) } }]);
  } else {
    ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: out.text } }]);
  }
  ev.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: out.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }]);
  ev.push(['message_stop', { type: 'message_stop' }]);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [event, data] of ev) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ instance }));
  }
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock', type: 'model' }] }));
    }
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep empty */ }
    const tools = (body.tools ?? []).map((t) => t.name);
    const out = tools.length === 0 ? { text: 'BugGPS e2e' } : steps[Math.min(step++, steps.length - 1)];
    appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), tools, watchSha: watchSha(), messages: body.messages, reply: out }) + '\n');
    sse(res, out, step);
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`mock ready ${port}`));
