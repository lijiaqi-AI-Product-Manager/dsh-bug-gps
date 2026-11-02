import { TestDefinitionError } from './errors.js';

export function validateViewport(viewport) {
  if (!viewport || !['width', 'height'].every((key) => Number.isInteger(viewport[key]) && viewport[key] >= 1 && viewport[key] <= 16384)) {
    throw new TestDefinitionError('browser viewport width and height must be integers from 1 to 16384');
  }
  return { width: viewport.width, height: viewport.height };
}

// Accept only the portable, recorded context settings. Do not pass arbitrary context options
// from a draft through to Playwright (such as storage files or proxy credentials).
export function browserOptions(settings) {
  if (settings === undefined) return {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TestDefinitionError('browser must be an object');
  const allowed = ['viewport', 'locale', 'timezoneId', 'deviceScaleFactor'];
  for (const key of Object.keys(settings)) if (!allowed.includes(key)) throw new TestDefinitionError(`unsupported browser setting: ${key}`);
  const options = {};
  if (settings.viewport !== undefined) options.viewport = validateViewport(settings.viewport);
  if (settings.locale !== undefined) {
    try { if (typeof settings.locale !== 'string' || !settings.locale || Intl.getCanonicalLocales(settings.locale).length !== 1) throw new Error(); }
    catch { throw new TestDefinitionError('browser.locale must be a valid language tag'); }
    options.locale = settings.locale;
  }
  if (settings.timezoneId !== undefined) {
    try { if (typeof settings.timezoneId !== 'string' || !settings.timezoneId) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: settings.timezoneId }); }
    catch { throw new TestDefinitionError('browser.timezoneId must be a valid time zone'); }
    options.timezoneId = settings.timezoneId;
  }
  if (settings.deviceScaleFactor !== undefined) {
    if (!Number.isFinite(settings.deviceScaleFactor) || settings.deviceScaleFactor <= 0 || settings.deviceScaleFactor > 4) throw new TestDefinitionError('browser.deviceScaleFactor must be greater than 0 and at most 4');
    options.deviceScaleFactor = settings.deviceScaleFactor;
  }
  return options;
}
