import { expect, test } from '@playwright/test';

test('?perf shows the live perf overlay with all metrics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?perf');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const overlay = page.locator('#perf-overlay');
  await expect(overlay).toBeVisible();
  for (const label of ['fps', 'p95 ms', 'draws', 'tris', 'programs', 'textures', 'px ratio', 'preset'])
    await expect(overlay).toContainText(label);
  // Values replace the '—' placeholders within a few overlay ticks.
  await expect(overlay).not.toContainText('—', { timeout: 10_000 });
  expect(errors).toEqual([]);
});
