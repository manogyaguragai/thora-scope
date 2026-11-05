import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { hideShell } from './pixels';

test('viewer loads the optimised model with ?debug and exposes window.__perf', async ({ page }) => {
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

  // Hover pick (throttled raycast) names the node under the cursor; hidden shell lets the canvas get the pointer.
  await hideShell(page);
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  await page.mouse.move(width / 2, height / 2);
  await expect(page.locator('#debug-overlay')).not.toContainText('hover: —', { timeout: 30_000 });

  // One screenshot (each waits for SwiftShader's frame backlog); crop it for the check.
  const shot = await page.screenshot({ path: 'qa/screenshots/debug.png' });
  // Non-blank: the centre of the view (away from title/overlay) must show varied pixels, not a flat clear colour.
  const box = {
    left: Math.round(width / 4),
    top: Math.round(height / 4),
    width: Math.round(width / 2),
    height: Math.round(height / 2),
  };
  const centre = await sharp(shot).extract(box).toBuffer();
  const { channels } = await sharp(centre).stats();
  expect(Math.max(...channels.map((c) => c.stdev))).toBeGreaterThan(5);

  // M1 gate: hover picking, overlay and frames since "ready" compiled no new shader programs (PERF.md baseline).
  await page.waitForTimeout(1000); // > one __perf sample period (config.perf.sampleHz), so programs is fresh
  expect(await page.evaluate(() => window.__perf.programs)).toBe(perf.programs);

  expect(errors).toEqual([]);
});
