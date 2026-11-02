// Launches an already-installed Chromium-family browser. BugGPS never downloads a browser:
// if no supported channel is installed the run is ENV_BLOCKED with a next step.
import { chromium } from 'playwright-core';
import { EnvBlockedError } from './errors.js';

const DEFAULT_CHANNELS = ['msedge', 'chrome'];

export async function launchBrowser({ channels = DEFAULT_CHANNELS, executablePath, headless = true } = {}) {
  const attempts = [];
  if (executablePath) {
    try {
      const browser = await chromium.launch({ executablePath, headless });
      return { browser, channel: 'custom', version: browser.version() };
    } catch (err) {
      attempts.push(`executablePath ${executablePath}: ${firstLine(err)}`);
    }
  } else {
    for (const channel of channels) {
      try {
        const browser = await chromium.launch({ channel, headless });
        return { browser, channel, version: browser.version() };
      } catch (err) {
        attempts.push(`${channel}: ${firstLine(err)}`);
      }
    }
  }
  throw new EnvBlockedError(
    `No usable browser. Tried ${attempts.join('; ')}`,
    'Install Microsoft Edge or Google Chrome, or pass executablePath to a Chromium-based browser.',
  );
}

function firstLine(err) {
  return String(err?.message ?? err).split('\n')[0];
}
