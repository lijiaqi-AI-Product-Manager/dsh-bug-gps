// Write protection for .buggps/ (locked cases, locks, run records). File tools are reliably
// guarded because their path argument is visible; shell commands are only a best-effort string
// match — the content hash checked by buggps_verify is what actually closes that hole.
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';

export const FILE_TOOLS = { write: ['file_path'], edit: ['file_path'], str_replace_editor: ['path'] };
export const SHELL_TOOLS = new Set(['pwsh', 'powershell', 'bash', 'sh']);

const SEGMENT = /^\.buggps$/i;
const SHELL_MENTION = /\.buggps/i;
const SHELL_WRITE = /(set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item|clear-content|\brm\b|\bdel\b|\bmv\b|\bcp\b|\btouch\b|\bsed\s+-i|>|\btee\b|writefile|\bgit\s+(checkout|restore|rm|clean))/i;

function hasProtectedSegment(p) {
  return normalize(p).split(/[\\/]+/).some((s) => SEGMENT.test(s));
}

// Follow junctions/symlinks of the nearest existing ancestor (a link named "x" pointing into
// .buggps would otherwise slip through).
function realish(abs) {
  let dir = abs;
  for (let i = 0; i < 64; i++) {
    try { return resolve(realpathSync.native(dir), abs.slice(dir.length).replace(/^[\\/]+/, '')); } catch { /* not there yet */ }
    const up = dirname(dir);
    if (up === dir) return abs;
    dir = up;
  }
  return abs;
}

/**
 * Returns a deny reason for this tool call, or undefined. `bases` are the directories a
 * relative path may resolve against (session directory first); a path is denied if it lands
 * in .buggps/ from any of them, after following junctions and symlinks.
 */
export function protectedReason(exec, bases = [process.cwd()]) {
  const args = exec?.arguments;
  if (!args || typeof args !== 'object') return undefined;
  const keys = FILE_TOOLS[exec.name];
  if (keys) {
    const dirs = [...new Set(Array.isArray(bases) ? bases : [bases])];
    for (const k of keys) {
      const p = args[k];
      if (typeof p !== 'string') continue;
      const abs = isAbsolute(p) ? [p] : dirs.map((d) => resolve(d, p));
      if (hasProtectedSegment(p) || abs.some((a) => hasProtectedSegment(a) || hasProtectedSegment(realish(a)))) {
        return `BugGPS: ${p} is inside .buggps/, which holds the locked acceptance case and its evidence. It is write-protected. Fix the application code instead; only buggps_verify decides whether the bug is fixed.`;
      }
    }
  }
  if (SHELL_TOOLS.has(exec.name) && typeof args.command === 'string' && SHELL_MENTION.test(args.command) && SHELL_WRITE.test(args.command)) {
    return 'BugGPS: this shell command appears to modify .buggps/ (locked acceptance case). Not allowed. Edits there are also detected by content hash at verification.';
  }
  return undefined;
}
