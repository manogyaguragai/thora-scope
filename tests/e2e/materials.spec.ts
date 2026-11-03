import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import procedure from '../../src/content/procedure_steps.json' with { type: 'json' };

const SAMPLE_WAIT_MS = 800; // > one __perf sample period (4 Hz) + a few frames

async function shoot(page: Page, step: number, path: string): Promise<void> {
  const s = procedure.steps.find((x) => x.step === step);
  if (!s) throw new Error(`step ${step} missing`);
  await page.evaluate(([cam, hidden]) => window.__look?.view(cam, hidden), [s.camera, s.hidden] as const);
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await page.screenshot({ path });
}

// Small viewport: SwiftShader queues heavy physical-material frames, so each screenshot waits for the backlog.
test.use({ viewport: { width: 640, height: 360 } });

test('realism look: scope views (screenshots) + X-ray/opacity compile no new programs', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 180_000 });
  await page.evaluate(() => {
    for (const lobe of ['RUL', 'RML', 'RLL'] as const) window.__sim.cmd.setLobe(lobe, 1);
  });
  await shoot(page, 1, 'qa/screenshots/mat-step1.png');
  await shoot(page, 3, 'qa/screenshots/mat-step3.png');

  // Program creation happens synchronously in render(), so __perf.programs is current after a sample period.
  const before = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(() => window.__look?.setXray(true));
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await page.evaluate(() => {
    window.__look?.setXray(false);
    window.__look?.setOpacity('pericardium', 0.5);
  });
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  const after = await page.evaluate(() => window.__perf.programs);
  console.log(`programs ${before} → ${after}`);
  expect(before).toBeGreaterThan(0);
  expect(after).toBe(before);
  expect(errors).toEqual([]);
});
