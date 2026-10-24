import { readFile } from 'node:fs/promises';
import { test, type Page } from '@playwright/test';

const scenarios = [
  { name: 'notification-center', fixture: 'notification-center' },
  { name: 'notification-popups', fixture: 'notification-center' },
  { name: 'operational-notifications', fixture: 'notification-center' },
  { name: 'rdo-equipment-categories', fixture: 'rdo-equipment-categories' }
];

for (const { name, fixture } of scenarios) {
  test(name, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/test/browser/${fixture}.html`);
    const source = await readFile(new URL(`../test/browser/${name}.js`, import.meta.url), 'utf8');
    const run = new Function(`return (${source})`)() as (page: Page) => Promise<string>;
    await run(page);
  });
}
