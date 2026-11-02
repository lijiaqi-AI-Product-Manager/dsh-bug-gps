// Scripted "user sessions" against the SEEDED cart-shop example. A script drives a real page
// through the recorder, so the recorded steps come from real DOM events — but the session
// itself is scripted, not a human recording. Reports must label them that way.
import { startRecording } from '../src/core/recorder.js';

export const SESSIONS = {
  // Seeded bug 1: stale coupon discount after removing an item. Correct total is $18.00.
  'stale-discount': {
    expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$18.00' },
    async drive(page) {
      await page.getByRole('button', { name: 'Add Cherry' }).click();
      await page.getByRole('searchbox', { name: 'Search' }).fill('ban');
      await page.getByRole('combobox', { name: 'Sort' }).selectOption('price');
      await page.getByRole('searchbox', { name: 'Search' }).fill('');
      await page.getByRole('checkbox', { name: 'Dark mode' }).check();
      await page.getByRole('button', { name: 'Remove Cherry' }).click();
      await page.getByText('Shipping info').click();
      await page.getByRole('button', { name: 'Add Apple' }).click();
      await page.getByRole('link', { name: 'About' }).click();
      await page.getByRole('button', { name: 'Show changelog' }).click();
      await page.getByRole('link', { name: 'Shop' }).click();
      await page.getByRole('button', { name: 'Add Banana' }).click();
      await page.getByRole('combobox', { name: 'Sort' }).selectOption('name');
      await page.getByRole('textbox', { name: 'Coupon' }).pressSequentially('SAVE10');
      await page.getByRole('checkbox', { name: 'Dark mode' }).uncheck();
      await page.getByRole('button', { name: 'Apply coupon' }).click();
      await page.getByText('Shipping info').click();
      await page.getByRole('button', { name: 'Remove Apple' }).click();
    },
  },
  // Seeded bug 2: second "Show changelog" click throws an uncaught TypeError.
  'changelog-crash': {
    expectation: { kind: 'no-page-error' },
    async drive(page) {
      await page.getByRole('button', { name: 'Add Apple' }).click();
      await page.getByRole('checkbox', { name: 'Dark mode' }).check();
      await page.getByRole('link', { name: 'About' }).click();
      await page.getByRole('button', { name: 'Show changelog' }).click();
      await page.getByRole('link', { name: 'Shop' }).click();
      await page.getByRole('searchbox', { name: 'Search' }).fill('cher');
      await page.getByRole('button', { name: 'Add Cherry' }).click();
      await page.getByRole('searchbox', { name: 'Search' }).fill('');
      await page.getByRole('combobox', { name: 'Sort' }).selectOption('price');
      await page.getByRole('link', { name: 'About' }).click();
      await page.getByRole('checkbox', { name: 'Dark mode' }).uncheck();
      await page.getByRole('button', { name: 'Show changelog' }).click();
    },
  },
  // Seeded bug 3 (flaky): with ?flaky=1 the total is sometimes off by $1.
  'flaky-total': {
    startPath: '/?flaky=1',
    expectation: { kind: 'text', target: [{ by: 'testId', value: 'total' }], equals: '$10.00' },
    async drive(page) {
      await page.getByRole('button', { name: 'Add Apple' }).click();
    },
  },
};

export async function recordSession(browser, baseUrl, name) {
  const s = SESSIONS[name];
  const rec = await startRecording(browser, { baseUrl, startPath: s.startPath ?? '/' });
  await s.drive(rec.page);
  const steps = await rec.stop();
  return { name, steps, expectation: s.expectation, dropped: rec.dropped.length, ...(rec.result.captureIssues.length ? { captureIssues: rec.result.captureIssues } : {}) };
}
