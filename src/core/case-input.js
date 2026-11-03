import { TestDefinitionError } from './errors.js';

export function parseCaseText(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new TestDefinitionError('Case file must contain valid JSON; check its syntax.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TestDefinitionError('Case definition must be an object');
  return value;
}
