import { TestDefinitionError } from './errors.js';

export function validateCaseId(id) {
  if (typeof id !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u.test(id)
    || id.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw new TestDefinitionError('case id must be 1–64 letters, numbers, dots, underscores or hyphens, start with a letter or number, and use a valid filename');
  }
  return id;
}
