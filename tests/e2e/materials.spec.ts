import { expect, test } from '@playwright/test';

const SAMPLE_WAIT_MS = 800; // > one __perf sample period (4 Hz) + a few frames

test('realism look: X-ray/opacity swaps and cut-away plane moves compile no new programs', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(SAMPLE_WAIT_MS);

  // Program creation happens synchronously in render(), so __perf.programs is current after a sample period.
  const before = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(() => window.__look?.setXray(true));
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await page.evaluate(() => {
    window.__look?.setXray(false);
    window.__look?.setOpacity('pericardium', 0.5);
  });
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  const afterXray = await page.evaluate(() => window.__perf.programs);

  await page.evaluate(() => window.__look?.setCutaway([0, 0, -1], 0)); // through the origin
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await page.evaluate(() => window.__look?.parkCutaway());
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  const afterCut = await page.evaluate(() => window.__perf.programs);

  console.log(`programs ${before} → x-ray ${afterXray} → cut-away ${afterCut}`);
  expect(before).toBeGreaterThan(0);
  expect(afterXray).toBe(before);
  expect(afterCut).toBe(before);
  expect(errors).toEqual([]);
});
