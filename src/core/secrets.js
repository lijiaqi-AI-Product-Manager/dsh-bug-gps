// Sensitive inputs (passwords, tokens, card numbers) are never written into a recording. The
// step stores a reference, { secret: 'NAME' }, and replay reads BUGGPS_SECRET_NAME from the
// environment of the process that replays. Nothing that holds the value reaches the model.

export const secretEnvVar = (name) => `BUGGPS_SECRET_${name}`;

export function secretName(label) {
  const n = String(label ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, 40);
  return n || 'FIELD';
}

export const isSecretRef = (v) => Boolean(v && typeof v === 'object' && typeof v.secret === 'string');

/** Returns { ok: true, value } or { ok: false, reason } when the secret is not provided. */
export function resolveValue(v, env = process.env) {
  if (!isSecretRef(v)) return { ok: true, value: v };
  const value = env[secretEnvVar(v.secret)];
  if (value === undefined) return { ok: false, reason: `secret input "${v.secret}" is not provided: set the environment variable ${secretEnvVar(v.secret)} for the process that replays (it is never stored in the case)` };
  return { ok: true, value };
}
