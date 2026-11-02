// Short human-readable labels for steps and expectations (reports, tool results).

export function stepLabel(s) {
  if (s.action === 'goto') return `open ${s.url}`;
  if (s.action === 'key') return `press ${s.value}`;
  const t = s.target?.[0] ?? {};
  const what = t.name ?? t.value ?? t.role ?? '?';
  const where = t.within ? ` (in ${t.within.name})` : '';
  const val = s.value?.secret ? ` = <secret ${s.value.secret}>`
    : s.action === 'fill' || s.action === 'select' ? ` = ${JSON.stringify(s.value)}` : s.action === 'check' ? ` = ${s.value}` : '';
  return `${s.action} "${what}"${where}${val}${s.pinned ? ' [key step]' : ''}${s.check ? ' [checkpoint]' : ''}`;
}

export function expectationLabel(e) {
  if (!e) return '(none)';
  const t = e.target?.[0];
  const what = t ? `"${t.name ?? t.value ?? t.role}"` : '';
  switch (e.kind) {
    case 'text': return `${what} shows ${JSON.stringify(e.equals)}`;
    case 'value': return `${what} has value ${JSON.stringify(e.equals)}`;
    case 'visible': return `${what} stays visible`;
    case 'hidden': return `${what} is not visible`;
    case 'no-page-error': return 'no uncaught page error';
    case 'no-console-error': return 'no console error';
    case 'no-failed-request': return 'no failed (4xx/5xx) request';
    default: return e.kind;
  }
}
