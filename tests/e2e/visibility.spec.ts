import { expect, test } from '@playwright/test';

// T703: the rAF loop stops rendering while the tab is hidden or the render gate is held.
const renders = (page: import('@playwright/test').Page): Promise<number> =>
  page.evaluate(() => window.__perf.renders);
const IDLE_MS = 600;

test('hidden tab and render gate stop renders; requestRender draws exactly one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });

  const a = await renders(page);
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBeGreaterThan(a);

  // Hidden tab: emulate visibilityState and fire visibilitychange.
  const setHidden = (hidden: boolean): Promise<number> =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (h ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__perf.renders;
    }, hidden);
  const h0 = await setHidden(true);
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBe(h0);
  const v0 = await setHidden(false);
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBeGreaterThan(v0);

  // Render gate: held → no renders; requestRender → exactly one; release → resumes.
  const g0 = await page.evaluate(() => {
    window.__render.hold('test');
    window.__render.hold('test2');
    return window.__perf.renders;
  });
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBe(g0);
  await page.evaluate(() => window.__render.request());
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBe(g0 + 1);
  await page.evaluate(() => window.__render.release('test'));
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBe(g0 + 1); // still held by 'test2'
  await page.evaluate(() => window.__render.release('test2'));
  await page.waitForTimeout(IDLE_MS);
  expect(await renders(page)).toBeGreaterThan(g0 + 1);
  expect(errors).toEqual([]);
});
