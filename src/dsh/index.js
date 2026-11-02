// dsh-bug-gps: DeepSeek Harness (Cordis) plugin entry. Registers the BugGPS tools, the skill,
// and the final write-protection guard for .buggps/. API facts from spikes/s1-dsh/REPORT.md.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createToolSpecs } from './tools.js';
import { protectedReason } from './guard.js';
import { SKILL } from './skill.js';

export const name = 'dsh-bug-gps';
export const inject = ['tools', 'skills', 'subprocess'];

// Set only after the guard registered successfully. DSH loads a broken plugin silently (stderr
// warning, exit 0), so buggps_verify checks this before giving any verdict.
let guardActive = false;

export function apply(ctx) {
  const wd = () => ctx.get?.('workingDirectory');
  // Session working directory when the service exists (dsh web/desktop), else the process cwd.
  const resolveCwd = async (exec) => {
    if (wd() && exec?.agent) {
      try { return await wd().ensure(exec.agent, exec.signal); } catch { /* fall back */ }
    }
    return process.cwd();
  };
  // Relative paths in file tools resolve against the SESSION directory (dsh-tool-fs does the
  // same), which can differ from this process's cwd. The guard is synchronous, so it reads the
  // committed directory with get(); every project a BugGPS tool used is checked as well.
  const projects = new Set();
  const bases = (exec) => {
    const out = [];
    try { const d = exec?.agent?.session && wd()?.get(exec.agent.session); if (d) out.push(d); } catch { /* no session */ }
    return [...out, process.cwd(), ...projects];
  };

  ctx.tools.guard((exec) => protectedReason(exec, bases(exec)));
  guardActive = true;

  for (const spec of createToolSpecs({ resolveCwd, guardActive: () => guardActive, onProject: (d) => projects.add(d), subprocess: ctx.subprocess })) {
    ctx.tools.register(defineTool(spec));
  }
  ctx.skills.register({ ...SKILL, source: 'runtime' });
}
