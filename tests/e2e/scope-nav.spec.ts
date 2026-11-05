import { expect, test } from '@playwright/test';

// T816: surgeon-style scope navigation (held arrows pivot about the port, wheel inserts / withdraws), the
// orientation compass (scope view only) and the Inside / Outside view buttons.
test.use({ viewport: { width: 1280, height: 720 } });

const HOLD_MS = 500;

test('arrows pivot, wheel inserts, compass + Inside/Outside buttons', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf?.programs ?? -1);

  const rigState = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const s = window.__sim.m3?.scope;
      if (!s) throw new Error('not wired');
      return { pitch: s.pitch, yaw: s.yaw, depth: s.depth, lock: s.horizonLock };
    });
  const hold = async (key: string): Promise<void> => {
    await page.keyboard.down(key);
    await page.waitForTimeout(HOLD_MS);
    await page.keyboard.up(key);
  };

  const s0 = await rigState();
  expect(s0.lock).toBe(true); // levelled by default
  await hold('ArrowUp');
  const s1 = await rigState();
  expect(Math.abs(s1.pitch - s0.pitch)).toBeGreaterThan(1e-3);
  await hold('ArrowLeft');
  const s2 = await rigState();
  expect(Math.abs(s2.yaw - s1.yaw)).toBeGreaterThan(1e-3);
  // Released: no further drift.
  const s3 = await rigState();
  expect(s3.yaw).toBeCloseTo(s2.yaw, 6);

  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, 100); // withdraw
  await expect.poll(async () => (await rigState()).depth).toBeLessThan(s3.depth);

  const compass = page.locator('.scope-compass');
  await expect(compass).toBeVisible();
  await expect(compass.locator('[data-axis=head]')).toHaveText('Head');
  await expect(compass).toContainText('R: reset view');

  const inside = page.getByRole('button', { name: 'Inside (scope)' });
  const outside = page.getByRole('button', { name: 'Outside (theatre)' });
  await expect(inside).toHaveAttribute('aria-pressed', 'true');
  await outside.click();
  await expect(outside).toHaveAttribute('aria-pressed', 'true');
  await expect(inside).toHaveAttribute('aria-pressed', 'false');
  await expect(compass).toBeHidden();
  await page.waitForFunction(() => window.__sim.rig?.mode === 'outside');

  // Outside: arrows do not move the scope.
  const before = await rigState();
  await hold('ArrowUp');
  expect((await rigState()).pitch).toBeCloseTo(before.pitch, 6);

  await inside.click();
  await expect(inside).toHaveAttribute('aria-pressed', 'true');
  await expect(compass).toBeVisible();
  await page.keyboard.press('KeyO'); // O still toggles
  await expect(outside).toHaveAttribute('aria-pressed', 'true');

  expect(await page.evaluate(() => window.__perf?.programs ?? -1)).toBe(programs);
  expect(errors).toEqual([]);
});
