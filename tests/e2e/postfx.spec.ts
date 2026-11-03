import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const PATCH = 24; // px sampled per corner / centre

/** Brightest channel mean of a PATCH×PATCH crop (one screenshot; each SwiftShader frame takes seconds).
 * stats() reads the input, not the pipeline, so the crop is materialised first. */
async function meanRGB(png: Buffer, left: number, top: number): Promise<number> {
  const crop = sharp(await sharp(png).extract({ left, top, width: PATCH, height: PATCH }).toBuffer());
  const { channels } = await crop.stats();
  return Math.max(...channels.slice(0, 3).map((c) => c.mean));
}

test('?scope renders through the scope optics: 5:4 mask blacks out the corners', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader is slow
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?scope');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(1000); // let auto-exposure settle
  const png = await page.screenshot({ path: 'qa/screenshots/postfx-scope.png' });

  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const corners = [
    { x: 0, y: 0 },
    { x: width - PATCH, y: 0 },
    { x: 0, y: height - PATCH },
    { x: width - PATCH, y: height - PATCH },
  ];
  for (const { x, y } of corners) expect(await meanRGB(png, x, y), `corner ${x},${y}`).toBeLessThan(2);
  expect(await meanRGB(png, (width - PATCH) / 2, (height - PATCH) / 2)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
