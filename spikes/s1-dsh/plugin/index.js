// S1 spike plugin for BugGPS (dsh-bug-gps). Throwaway code: it exists to prove
// which DSH plugin APIs work, not to be reused as-is.
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-bug-gps'
export const inject = ['tools', 'jobs', 'skills', 'subprocess']

const LOG = process.env.BUGGPS_SPIKE_LOG ?? join(tmpdir(), 'buggps-spike.log')
const DENY_VIA = process.env.BUGGPS_SPIKE_DENY_VIA ?? 'pre' // 'pre' | 'guard'

function log(event, data) {
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, event, ...data }) + '\n')
}

// Grandchild-spawning payload: parent node spawns a grandchild node, both idle forever.
// The tag lets the test harness find both processes by command line. A non-detached Node
// grandchild sits in libuv's kill-on-close job and dies with its parent anyway; `detached`
// escapes that, like a browser launched by a driver.
const childCode = (tag, detached) => [
  `/*${tag}*/`,
  `const g=require('child_process').spawn(process.execPath,['-e','/*${tag}-grandchild*/setInterval(()=>{},1000)'],{stdio:'ignore',detached:${detached}});`,
  `console.log(JSON.stringify({parent:process.pid,grandchild:g.pid}));`,
  `setInterval(()=>{},1000)`,
].join('')

const FS_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'powershell'])
const CASES = /(^|[\\/])\.buggps[\\/]+cases([\\/]|$)/i

/** Best-effort: which path(s) does this call target? */
function targetPaths(toolName, args) {
  if (args === null || typeof args !== 'object') return []
  if (FS_TOOLS.has(toolName)) return [args.file_path, args.path].filter(p => typeof p === 'string')
  return []
}

function protectedReason(exec) {
  const args = exec.arguments
  for (const p of targetPaths(exec.name, args)) {
    if (CASES.test(p)) return `BugGPS: ${p} is under .buggps/cases/ and is write-protected (acceptance check is locked).`
  }
  if (SHELL_TOOLS.has(exec.name) && args && typeof args.command === 'string' && /\.buggps[\\/]+cases/i.test(args.command)) {
    return `BugGPS: shell command mentions .buggps/cases/ (best-effort string match only).`
  }
  return undefined
}

export function apply(ctx) {
  log('apply', { injected: inject.map(k => [k, ctx[k] !== undefined]) })

  // 1. Sync tool returning a typed object.
  ctx.tools.register(defineTool({
    name: 'buggps_ping',
    description: 'BugGPS spike: returns a typed pong object.',
    parameters: { msg: { type: 'string', description: 'Text to echo back' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          echo: { type: 'string', required: true },
          pid: { type: 'integer', required: true },
          agent: { type: 'string', required: true },
        },
      },
      render: (_args, v) => [{ type: 'text', text: `pong ${JSON.stringify(v)}` }],
    },
    execute(args, exec) {
      const value = { ok: true, echo: args.msg ?? '', pid: process.pid, agent: String(exec.agent?.id ?? 'none') }
      log('ping', value)
      return value
    },
  }))

  // 2. Long-running work: background job (job_kill) or foreground (exec.signal).
  const startProcess = (mode, tag, signal, detached = false) => {
    if (mode === 'subprocess') {
      const handle = ctx.subprocess.spawn({
        argv: [process.execPath, '-e', childCode(tag, detached)],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
        graceMs: 1000,
        ...(signal ? { signal } : {}),
      })
      return {
        stop: () => handle.terminate(),
        exited: handle.waitForExit().then(() => undefined, () => undefined),
        stdout: () => { try { return JSON.stringify(handle.collected.stdout?.readFrom(0)) } catch (e) { return String(e) } },
      }
    }
    const child = spawn(process.execPath, ['-e', childCode(tag, detached)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    child.stdout.on('data', d => { out += d })
    const exited = new Promise(resolve => child.once('exit', () => resolve(undefined)))
    const stop = () => {
      if (mode === 'raw-tree' && process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
      } else {
        child.kill()
      }
    }
    signal?.addEventListener('abort', stop, { once: true })
    return { stop, exited, stdout: () => out }
  }

  ctx.tools.register(defineTool({
    name: 'buggps_sleep',
    description: 'BugGPS spike: start an idle child process tree (node parent + node grandchild).',
    parameters: {
      mode: { type: 'string', enum: ['subprocess', 'raw-tree', 'raw-kill'], description: 'How the tree is spawned and stopped' },
      background: { type: 'boolean', description: 'Register as a background job (default true)' },
      tag: { type: 'string', description: 'Marker placed in the child command lines' },
      detached: { type: 'boolean', description: 'Spawn the grandchild detached (default false)' },
    },
    timeoutMs: 4000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          jobId: { type: 'string' },
          tag: { type: 'string', required: true },
          aborted: { type: 'boolean' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: v.kind === 'background' ? `started background job ${v.jobId} tag=${v.tag}` : `foreground ended tag=${v.tag} aborted=${v.aborted}` }],
    },
    async execute(args, exec) {
      const mode = args.mode ?? 'subprocess'
      const tag = args.tag ?? `buggps-spike-${Date.now()}`
      if (args.background === false) {
        // Foreground: coupled to exec.signal (the timeout policy aborts it after timeoutMs).
        log('sleep-fg-start', { mode, tag })
        const proc = startProcess(mode, tag, exec.signal, args.detached === true)
        await new Promise(resolve => {
          if (exec.signal.aborted) return resolve(undefined)
          exec.signal.addEventListener('abort', resolve, { once: true })
        })
        proc.stop()
        await proc.exited
        log('sleep-fg-aborted', { mode, tag, reason: String(exec.signal.reason) })
        return { kind: 'foreground', tag, aborted: true }
      }
      if (exec.agent === undefined) throw new Error('buggps_sleep: background mode needs an agent owner')
      const jobId = ctx.jobs.start({
        kind: 'buggps',
        label: `buggps_sleep ${mode} ${tag}`,
        owner: exec.agent.id,
        toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
        run(job) {
          const proc = startProcess(mode, tag, undefined, args.detached === true)
          log('sleep-bg-run', { mode, tag, jobId: job.id })
          let reason
          const done = proc.exited.then(() => {
            log('sleep-bg-exited', { mode, tag, jobId: job.id, stdout: proc.stdout().trim(), reason })
            return { status: reason === undefined ? 'completed' : 'killed', detail: reason ?? 'child exited' }
          })
          return {
            done,
            cancel(r) {
              if (reason !== undefined) return
              reason = r ?? 'cancelled'
              log('sleep-bg-cancel', { mode, tag, jobId: job.id, reason })
              proc.stop()
            },
          }
        },
      })
      return { kind: 'background', jobId: String(jobId), tag }
    },
  }))

  // 3. Embedded skill.
  ctx.skills.register({
    name: 'buggps',
    description: 'BugGPS: fix a recorded browser bug; only buggps_verify may declare RED->GREEN.',
    source: 'runtime',
    content: '# BugGPS skill body\n\nMARKER-BUGGPS-SKILL-BODY-7f3a. Never edit files under .buggps/cases/.',
  })

  // 4. Policy: log every call, deny writes under .buggps/cases/.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const watched = FS_TOOLS.has(exec.name) || SHELL_TOOLS.has(exec.name)
    log('pre-execute', { tool: exec.name, args: watched ? exec.arguments : '(not logged)', paths: targetPaths(exec.name, exec.arguments) })
    if (DENY_VIA === 'pre') {
      const reason = protectedReason(exec)
      if (reason) { log('deny', { via: 'pre-execute', tool: exec.name, reason }); return { kind: 'deny', reason } }
    }
    return next()
  })
  if (DENY_VIA === 'guard') {
    ctx.tools.guard((exec) => {
      const reason = protectedReason(exec)
      if (reason) log('deny', { via: 'guard', tool: exec.name, reason })
      return reason
    })
  }
}
