// Print each scripted tool call next to the tool_result DSH sent back for it.
// Usage: node summarize.mjs <mock-requests.jsonl>
import { readFileSync } from 'node:fs'

const recs = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.tools?.length)
const last = recs[recs.length - 1]
const byId = new Map()
for (const m of last.messages) {
  if (!Array.isArray(m.content)) continue
  for (const c of m.content) {
    if (c.type === 'tool_use') byId.set(c.id, { name: c.name, input: c.input })
    if (c.type === 'tool_result') {
      const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map(x => x.text ?? '').join('')
      Object.assign(byId.get(c.tool_use_id) ?? (byId.set(c.tool_use_id, {}), byId.get(c.tool_use_id)), { isError: c.is_error ?? false, result: text })
    }
  }
}
for (const [id, v] of byId) {
  console.log(`## ${id} ${v.name} ${JSON.stringify(v.input)}`)
  console.log(`   is_error=${v.isError} -> ${String(v.result).replace(/\s+/g, ' ').slice(0, 400)}`)
}
