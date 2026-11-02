// Short human-readable labels for steps and expectations (reports, tool results).

export function stepLabel(s) {
  if (s.action === 'goto') return `open ${s.url}`;
  if (s.action === 'key') return `press ${s.value}`;
  if (s.action === 'viewport') return `resize viewport to ${s.width} × ${s.height} [key step]`;
  if (s.action === 'exit-fullscreen') return 'exit browser fullscreen [key step]';
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
    case 'text': return `${what} ${e.comparison === 'startsWith' ? 'starts with' : 'shows'} ${JSON.stringify(e.equals)}`;
    case 'value': return `${what} ${e.comparison === 'startsWith' ? 'has value starting with' : 'has value'} ${JSON.stringify(e.equals)}`;
    case 'count': return `${what} matches ${e.equals} elements`;
    case 'visible': return `${what} stays visible`;
    case 'hidden': return `${what} is not visible`;
    case 'no-page-error': return 'no uncaught page error';
    case 'no-console-error': return 'no console error';
    case 'no-failed-request': return 'no failed request (network error or HTTP 4xx/5xx)';
    default: return e.kind;
  }
}
