import { TestDefinitionError } from './errors.js';

export const DEFAULT_OBSERVE_MS = 1000;

export function validateObserveMs(value) {
  if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 30_000)) {
    throw new TestDefinitionError('observeMs must be an integer between 0 and 30000');
  }
}
