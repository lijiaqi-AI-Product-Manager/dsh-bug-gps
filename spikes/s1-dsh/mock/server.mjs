// Scripted Messages-API-compatible SSE server for driving `dsh --profile headless`
// without real credentials. Each agent request (one that carries tools) consumes the next
// step of the scenario; a step may read earlier tool results (e.g. to learn a job id).
// Usage: node server.mjs <port> <scenario> <logFile>
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const [port = '8765', scenario = 'probe', logFile = 'mock-requests.jsonl'] = process.argv.slice(2)

const toolResults = (body) => body.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'tool_result') : [])
const resultText = (r) => typeof r.content === 'string' ? r.content : (r.content ?? []).map(c => c.text ?? '').join('')
const lastResult = (body) => { const rs = toolResults(body); return rs.length ? resultText(rs[rs.length - 1]) : '' }
const jobIdFrom = (text) => (text.match(/\b(buggps-[0-9a-f]{16})\b/) ?? [])[1]

const PROJ_WIN = process.env.MOCK_PROJ ?? ''
const PROJ = PROJ_WIN.replace(/\\/g, '/')
const tool = (name, input, delay = 0) => ({ tool: { name, input }, delay })
const text = (t) => ({ text: t })

const scenarios = {
  probe: [text('probe done')],
  // ping, skill load, background job + job_kill, protected writes, shell writes.
  main: [
    tool('buggps_ping', { msg: 'hello from mock' }),
    tool('skill', { name: 'buggps' }),
    tool('buggps_sleep', { mode: 'subprocess', tag: 'S1TAG-sub' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill subprocess' }, 2500),
    tool('buggps_sleep', { mode: 'raw-kill', tag: 'S1TAG-rawkill' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill raw-kill' }, 2500),
    tool('buggps_sleep', { mode: 'raw-tree', tag: 'S1TAG-rawtree' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill raw-tree' }, 2500),
    tool('buggps_sleep', { mode: 'subprocess', detached: true, tag: 'S1TAG-subdet' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill subprocess detached' }, 2500),
    tool('buggps_sleep', { mode: 'raw-kill', detached: true, tag: 'S1TAG-rawkilldet' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill raw-kill detached' }, 2500),
    tool('buggps_sleep', { mode: 'raw-tree', detached: true, tag: 'S1TAG-rawtreedet' }),
    (body) => tool('job_kill', { job_id: jobIdFrom(lastResult(body)) ?? 'missing', reason: 'spike kill raw-tree detached' }, 2500),
    tool('buggps_sleep', { mode: 'subprocess', background: false, detached: true, tag: 'S1TAG-fg' }),
    tool('write', { file_path: '.buggps/cases/case1/check.json', content: '{"tampered":"relative"}' }),
    tool('write', { file_path: `${PROJ_WIN}\\.buggps\\cases\\case1\\check.json`, content: '{"tampered":"win-abs"}' }),
    tool('read', { file_path: `${PROJ}/.buggps/cases/case1/check.json` }),
    tool('edit', { file_path: `${PROJ}/.buggps/cases/case1/check.json`, old_string: 'true', new_string: 'false' }),
    tool('write', { file_path: `${PROJ}/.BugGPS/Cases/case1/check.json`, content: '{"tampered":"case"}' }),
    tool('write', { file_path: `${PROJ}/.buggps/cases/../cases/case1/check.json`, content: '{"tampered":"dotdot"}' }),
    tool('str_replace_editor', { command: 'create', path: `${PROJ}/.buggps/cases/case2/new.json`, file_text: '{"tampered":"editor-create"}' }),
    tool('str_replace_editor', { command: 'str_replace', path: `${PROJ_WIN}\\.buggps\\cases\\case1\\check.json`, old_str: 'true', new_str: 'false' }),
    tool('write', { file_path: `${PROJ}/src/ok.txt`, content: 'allowed write' }),
    tool('SHELL', { command: 'Set-Content -Path .buggps/cases/case1/check.json -Value tampered-direct', description: 'direct write' }),
    tool('SHELL', { command: '$p = ".bug" + "gps/ca" + "ses/case1/check.json"; Set-Content -Path $p -Value tampered-obfuscated', description: 'obfuscated write' }),
    tool('SHELL', { command: 'Get-Content .buggps/cases/case1/check.json', description: 'show file' }),
    text('main scenario done'),
  ],
}

let step = 0
const steps = scenarios[scenario]
if (!steps) throw new Error(`unknown scenario ${scenario}`)

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}

function reply(res, out, n) {
  const msg = { id: `msg_mock_${n}`, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }
  const ev = [['message_start', { type: 'message_start', message: msg }]]
  if (out.tool) {
    ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_mock_${n}`, name: out.tool.name, input: {} } }])
    ev.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(out.tool.input) } }])
  } else {
    ev.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }])
    ev.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: out.text } }])
  }
  ev.push(['content_block_stop', { type: 'content_block_stop', index: 0 }])
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: out.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }])
  ev.push(['message_stop', { type: 'message_stop' }])
  sse(res, ev)
}

createServer((req, res) => {
  let raw = ''
  req.on('data', d => { raw += d })
  req.on('end', () => {
    const rec = { t: new Date().toISOString(), method: req.method, url: req.url }
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      appendFileSync(logFile, JSON.stringify(rec) + '\n')
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'mock', type: 'model' }] }))
    }
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch {}
    const tools = (body.tools ?? []).map(t => t.name)
    rec.model = body.model
    rec.stream = body.stream
    rec.tools = tools
    rec.system = body.system
    rec.messages = body.messages
    // Requests without tools (e.g. session titles) get plain text and do not advance the script.
    let out
    if (tools.length === 0) {
      out = text('Spike title')
    } else {
      let s = steps[Math.min(step, steps.length - 1)]
      step++
      if (typeof s === 'function') s = s(body)
      if (s.tool?.name === 'SHELL') s = tool(tools.includes('pwsh') ? 'pwsh' : tools.includes('powershell') ? 'powershell' : 'bash', s.tool.input)
      out = s
    }
    rec.reply = out
    appendFileSync(logFile, JSON.stringify(rec) + '\n')
    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock', content: out.tool ? [{ type: 'tool_use', id: 'toolu_x', name: out.tool.name, input: out.tool.input }] : [{ type: 'text', text: out.text }], stop_reason: out.tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
    }
    setTimeout(() => reply(res, out, step), out.delay ?? 0)
  })
}).listen(Number(port), '127.0.0.1', () => console.log(JSON.stringify({ ready: `http://127.0.0.1:${port}/v1`, scenario })))
