import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

// T826: Layers → Colours (Realistic default / Teaching). Toggle by keyboard → an artery pixel changes colour,
// no program compiles, the choice persists across a reload.
test.use({ viewport: { width: 1280, height: 720 } });

const SETTLE_MS = 1500; // auto-exposure + the step-focus fade
const GRID = 24; // pick rays per axis over the central ±0.5 NDC (clear of the side panels)
const MIN_DELTA = 20; // summed |Δrgb| (0–765) between palettes at the artery pixel

async function arteryPixel(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate((g) => {
    for (let j = 0; j < g; j++)
      for (let i = 0; i < g; i++) {
        const x = -0.5 + i / (g - 1);
        const y = 0.5 - j / (g - 1);
        if (/^(A\d|A_)/.test(window.__sim.m3?.pickAt(x, y) ?? '')) return { x, y };
      }
    return null;
  }, GRID);
}

async function rgbAt(page: Page, ndc: { x: number; y: number }): Promise<number[]> {
  const style = await page.addStyleTag({ content: '.shell { visibility: hidden !important; }' });
  await page.waitForTimeout(SETTLE_MS);
  const png = await page.screenshot();
  await style.evaluate((el) => (el as Element).remove());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const px = Math.round(((ndc.x + 1) / 2) * (info.width - 1));
  const py = Math.round(((1 - ndc.y) / 2) * (info.height - 1));
  const o = (py * info.width + px) * info.channels;
  return [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0];
}

test('colour palette toggle: recolours without compiling, persists', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const ready = async (): Promise<void> => {
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    await page.waitForFunction(
      () => window.__sim.rig?.transitioning === false && !window.__sim.guided?.transitioning,
    );
  };

  await page.goto('/?view=scope&step=5');
  await ready();
  const at = await arteryPixel(page);
  expect(at, 'an artery under the central pick grid').not.toBeNull();
  if (!at) return;
  const realistic = await rgbAt(page, at);
  const before = await page.evaluate(() => window.__perf.programs);

  await page.locator('.viewing-panel summary', { hasText: 'Layers' }).click();
  const realisticRadio = page.getByRole('radio', { name: 'Realistic' });
  await expect(realisticRadio).toBeChecked();
  await realisticRadio.focus();
  await page.keyboard.press('ArrowDown'); // native radio group: arrow keys select the next option
  await expect(page.getByRole('radio', { name: 'Teaching' })).toBeChecked();
  const teaching = await rgbAt(page, at);
  expect(await page.evaluate(() => window.__perf.programs)).toBe(before);
  const dist = (a: number[], b: number[]): number => a.reduce((s, v, k) => s + Math.abs(v - (b[k] ?? 0)), 0);
  console.log(
    `artery @ ndc ${at.x.toFixed(2)},${at.y.toFixed(2)}: realistic ${realistic} → teaching ${teaching}`,
  );
  expect(dist(realistic, teaching)).toBeGreaterThan(MIN_DELTA);

  await page.reload();
  await ready();
  await page.locator('.viewing-panel summary', { hasText: 'Layers' }).click();
  await expect(page.getByRole('radio', { name: 'Teaching' })).toBeChecked();
  const reloaded = await rgbAt(page, at);
  console.log(`after reload ${reloaded}`);
  expect(dist(reloaded, teaching), 'reloaded pixel reads teaching').toBeLessThan(dist(reloaded, realistic));
  expect(errors).toEqual([]);
});
