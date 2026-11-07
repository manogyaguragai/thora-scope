import { expect, test } from '@playwright/test';
import { labelFor } from '../../src/content/labels';

// T862 (FEEDBACK_GUIDED_v1 R2): in the Guided walkthrough, hovering a structure names it in a tooltip by the cursor
// (BVH hover pick ≤ 30 Hz, no click); it hides when the pointer leaves the canvas and outside the walkthrough
// (Explore / Practice keep click-to-label).
test.use({ viewport: { width: 1280, height: 720 } }); // the scope centre is clear of every panel

test('walkthrough hover label: names the structure under the cursor, hides off the canvas', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });

  const expected = await page.evaluate(() => window.__sim.m3?.pickAt(0, 0) ?? null);
  expect(expected).not.toBeNull();
  const tip = page.locator('.hover-label');
  await expect(tip).toBeHidden();

  await page.mouse.move(630, 360);
  await page.mouse.move(640, 360);
  await page.waitForFunction((n) => window.__sim.m3?.hover === n, expected, { timeout: 10_000 });
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(labelFor(expected ?? '').name);
  const box = await tip.boundingBox();
  expect(box && Math.abs(box.x - 640) < 60 && Math.abs(box.y - 360) < 60, 'tooltip near the cursor').toBe(
    true,
  );
  await page.screenshot({ path: 'qa/screenshots/walkthrough/hover-label.png' });

  // Pointer leaves the canvas (onto the top bar): hidden.
  await page.mouse.move(640, 30);
  await expect(tip).toBeHidden();

  // Explore keeps click-to-label: no hover tooltip there.
  await page.click('button[data-mode=explore]');
  await page.mouse.move(630, 360);
  await page.mouse.move(640, 360);
  await page.waitForTimeout(300); // several hover ticks
  await expect(tip).toBeHidden();
  expect(errors).toEqual([]);
});
