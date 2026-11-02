// Scripted sessions for the REAL apps, used to confirm each historical bug and to dry-run the
// pipeline before a human records. They drive the page through the recorder, so the recorded
// steps come from real DOM events, but results from them must be labeled "scripted".
export const REAL_SESSIONS = {
  'drawdb-943': {
    expectation: { kind: 'value', target: [{ by: 'role', role: 'spinbutton' }], equals: '220' },
    async drive(page) {
      await page.getByText('MySQL', { exact: true }).click();
      await page.getByRole('button', { name: 'confirm' }).click();
      await page.getByRole('button', { name: /添加表/ }).click();
      await page.getByRole('tab', { name: /关系/ }).click();
      await page.getByRole('tab', { name: /^表/ }).click();
      await page.getByText('设置', { exact: true }).hover();
      await page.getByRole('menuitem', { name: '表格宽度' }).click();
      await page.getByRole('spinbutton').fill('300');
      await page.getByRole('button', { name: 'cancel' }).click();
      await page.getByText('设置', { exact: true }).hover();
      await page.getByRole('menuitem', { name: '表格宽度' }).click();
    },
  },
  'qwerty-842': {
    startPath: '/gallery',
    expectation: { kind: 'visible', target: [{ by: 'role', role: 'heading', name: '第 1 章' }] },
    async drive(page) {
      await page.getByRole('radio', { name: '日语' }).click();
      await page.getByRole('radio', { name: '英语' }).click();
      await page.getByRole('radio', { name: '考研' }).click();
      await page.getByRole('radio', { name: '大学英语' }).click();
      await page.getByRole('button', { name: /^CET-4 大学英语四级词库/ }).click();
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('button', { name: /^CET-6 大学英语六级词库/ }).click();
      await page.getByRole('heading', { name: '第 2 章' }).hover();
      await page.getByRole('radio', { name: '章节选择' }).click();
    },
  },
  'chartdb-896': {
    expectation: { kind: 'value', target: [{ by: 'role', role: 'textbox', name: 'No default' }], equals: '' },
    async drive(page) {
      const fieldMenu = () => page.locator('aside button:has(svg.lucide-ellipsis)').first();
      await page.getByRole('radio').filter({ has: page.getByRole('img', { name: 'PostgreSQL', exact: true }) }).click();
      await page.getByRole('button', { name: 'Empty diagram', exact: true }).click();
      await page.getByRole('button', { name: 'Skip & Empty' }).click();
      await page.getByRole('button', { name: 'Add Table' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add Table' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Refs' }).click();
      await page.getByRole('button', { name: 'Tables' }).click();
      await fieldMenu().click();
      await page.getByRole('textbox', { name: 'No default' }).fill('0');
      await page.keyboard.press('Escape');
      await page.getByText('bigint', { exact: true }).first().click();
      await page.getByRole('option', { name: 'text', exact: true }).click();
      await fieldMenu().click();
    },
  },
};
