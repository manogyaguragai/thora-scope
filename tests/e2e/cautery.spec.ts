import { expect, test } from '@playwright/test';

// T817: electrocautery = smoke plume + char mark + ECG diathermy interference, no image warp; 0 new programs.
test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: scope image clear of the panels

const HOLD_MS = 1200;

test('cautery: smoke, char decal, ECG interference while energised; clears on release', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true && window.__vitals !== undefined, null, {
    timeout: 120_000,
  });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();

  expect(
    await page.evaluate(() => window.__sim.placeTool?.('cautery', 'hilar_connective_tissue') ?? 'no helper'),
  ).toBe('ok');
  expect(await page.evaluate(() => window.__vitals?.interference)).toBe(false);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await page.waitForTimeout(HOLD_MS);
  const on = await page.evaluate(() => {
    const fx = window.__sim.m4?.fx;
    return {
      smoke: fx?.smoke.aliveCount ?? 0,
      chars: fx?.char.count ?? 0,
      haze: fx?.fog.value ?? 1,
      interference: window.__vitals?.interference,
    };
  });
  expect(on.smoke).toBeGreaterThan(0);
  expect(on.chars).toBeGreaterThan(0);
  expect(on.haze).toBeLessThan(0.2); // light haze only, never a heavy veil
  expect(on.interference).toBe(true);
  await page.screenshot({ path: 'qa/screenshots/cautery.png' });

  await page.evaluate(() => window.__sim.m4?.press(false));
  await page.waitForFunction(() => window.__vitals?.interference === false, null, { timeout: 500 });
  expect(await page.evaluate(() => window.__sim.m4?.fx.energised)).toBe(false);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});
