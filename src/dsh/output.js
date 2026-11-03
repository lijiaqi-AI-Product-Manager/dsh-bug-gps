const PREVIEW_LIMIT = 12000;
const FIELD_LIMIT = 1600;
const NOTICE = 'output_preview: abbreviated / 预览已省略；完整结构化结果和引用的文件保持原样。Read draft, run_record, patch_file or saved .buggps/ evidence for details.';
const priority = ['case_id', 'draft', 'run_record', 'patch_file', 'next', 'runs', 'review_reasons', 'warning', 'reason', 'hint', 'baseline_control'];

function safeSlice(text, start, end) {
  if (start > 0 && text.charCodeAt(start) >= 0xDC00 && text.charCodeAt(start) <= 0xDFFF) start++;
  if (end < text.length && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) end--;
  return text.slice(start, end);
}

function excerpt(text, limit, state) {
  if (text.length <= limit) return text;
  state.abbreviated = true;
  const marker = ` … [preview abbreviated; ${text.length} characters] … `;
  const room = Math.max(0, limit - marker.length);
  const head = Math.ceil(room / 2);
  return safeSlice(text, 0, head) + marker + safeSlice(text, text.length - (room - head), text.length);
}

function importantFirst(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = new Map(Object.entries(value));
  const first = names.filter((name) => entries.has(name));
  return Object.fromEntries([...new Set([...first, ...entries.keys()])].map((name) => [name, entries.get(name)]));
}

function valueText(key, value) {
  if (typeof value === 'string') return value;
  // Keep conclusions ahead of potentially large observations, expectations or profiles.
  if (key === 'baseline_control') value = importantFirst(value, ['status', 'tally', 'matchesLockedFailure', 'reason', 'stepIndex', 'trialIssues', 'trialIssuesOmitted']);
  if (key === 'cases' && Array.isArray(value)) value = value.map((item) => importantFirst(item, ['case_id', 'latest', 'error', 'binding', 'steps']));
  return JSON.stringify(value) ?? String(value);
}

/** Bound the presentation only. The SDK's complete structured value stays unchanged. */
export function renderToolText(value) {
  const state = { abbreviated: false };
  const status = excerpt(String(value.status), 64, state);
  const message = value.message ? ': ' + excerpt(valueText('message', value.message), 768, state) : '';
  const lines = [`BugGPS ${status}${message}`];
  let length = lines[0].length;
  const entries = new Map(Object.entries(value).filter(([key]) => key !== 'status' && key !== 'message'));
  const first = priority.filter((key) => entries.has(key));
  const keys = [...new Set([...first, ...entries.keys()])];
  for (const key of keys) {
    const label = excerpt(key, 96, state);
    const available = PREVIEW_LIMIT - NOTICE.length - 2 - length - label.length - 2;
    if (available < 96) { state.abbreviated = true; break; }
    const text = excerpt(valueText(key, entries.get(key)), Math.min(FIELD_LIMIT, available), state);
    const line = `${label}: ${text}`;
    lines.push(line);
    length += line.length + 1;
  }
  if (state.abbreviated) lines.push(NOTICE);
  return lines.join('\n');
}
