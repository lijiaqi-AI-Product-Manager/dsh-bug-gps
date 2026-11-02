import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeServe } from './caselock.js';
import { TestDefinitionError } from './errors.js';
import { validateObserveMs } from './observation.js';

export const CONFIG_FILE = 'buggps.config.json';

export async function readProjectConfig(repoDir) {
  let config;
  try { config = JSON.parse(await readFile(join(repoDir, CONFIG_FILE), 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new TestDefinitionError(`${CONFIG_FILE}: ${err.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TestDefinitionError(`${CONFIG_FILE} must contain an object`);
  validateObserveMs(config.observeMs);
  return { ...config, ...(config.serve !== undefined ? { serve: normalizeServe(config.serve) } : {}) };
}

export function applyProjectConfig(definition, config, { observeMs = config.observeMs } = {}) {
  return { ...definition, ...(observeMs !== undefined ? { observeMs } : {}) };
}
