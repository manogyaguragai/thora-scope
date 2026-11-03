import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('viewer loads the optimised model with ?debug and exposes window.__perf', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader is slow
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' ? errors : logs).push(m.text()));

  const t0 = Date.now();
  await page.goto('/?debug');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  console.log(`ready after ${Date.now() - t0} ms`);

  const perf = await page.evaluate(() => ({ ...window.__perf }));
  console.log('__perf', JSON.stringify(perf));
  expect(perf.programs).toBeGreaterThan(0);
  expect(perf.triangles).toBeGreaterThan(0);
  expect(logs.some((l) => l.startsWith('[axis] PASS'))).toBe(true);

  // Hover pick (throttled raycast) names the node under the cursor.
  await page.mouse.move(640, 360);
  await expect(page.locator('#debug-overlay')).not.toContainText('hover: —', { timeout: 30_000 });

  await page.screenshot({ path: 'qa/screenshots/debug.png' });
  // Non-blank: the centre of the view (away from title/overlay) must show varied pixels, not a flat clear colour.
  const centre = await page.screenshot({ clip: { x: 340, y: 160, width: 600, height: 400 } });
  const { channels } = await sharp(centre).stats();
  expect(Math.max(...channels.map((c) => c.stdev))).toBeGreaterThan(5);

  expect(errors).toEqual([]);
});
