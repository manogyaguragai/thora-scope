import { expect, test } from '@playwright/test';

test('app shell loads and WebGL2 is available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/ThoraScope/);
  await expect(page.locator('#loading h1')).toHaveText('ThoraScope');
  const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  expect(webgl2).toBe(true);
  await page.screenshot({ path: 'qa/screenshots/T001-smoke.png' });
  expect(errors).toEqual([]);
});
