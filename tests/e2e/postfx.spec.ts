import { expect, test } from '@playwright/test';
import { corners, hideShell, meanRGB, PATCH } from './pixels';

test.use({ viewport: { width: 1280, height: 720 } }); // full-look M1 screenshot

test('?scope renders through the scope optics: 5:4 mask blacks out the corners', async ({ page }) => {
  test.setTimeout(360_000); // SwiftShader: one full-size screenshot takes minutes when the other worker is busy
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scope');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await hideShell(page);
  await page.waitForTimeout(1000); // let auto-exposure settle
  const png = await page.screenshot({ path: 'qa/screenshots/postfx-scope.png' });

  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  for (const { x, y } of corners(width, height))
    expect(await meanRGB(png, x, y), `corner ${x},${y}`).toBeLessThan(2);
  expect(await meanRGB(png, (width - PATCH) / 2, (height - PATCH) / 2)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
