import { expect, test } from '@playwright/test';

test('loading screen paints within 1 s of navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#loading .lens')).toBeVisible();
  const fcp = await page
    .waitForFunction(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0)
    .then((h) => h.jsonValue());
  console.log(`FCP ${Math.round(fcp)} ms`);
  expect(fcp).toBeLessThan(1000);
});

test('?holdload freezes at the download stage (screenshot)', async ({ page }) => {
  await page.goto('/?holdload');
  await expect(page.locator('#load-stage')).toHaveText('Downloading model · 40%');
  await expect(page.locator('#load-tip')).not.toBeEmpty();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'qa/screenshots/loading.png' });
});

test('?failload shows the in-theme error card', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?failload');
  await expect(page.locator('#load-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Low quality' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('normal load reaches ready and removes the loading screen', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader is slow
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toHaveCount(0);
  expect(errors).toEqual([]);
});
