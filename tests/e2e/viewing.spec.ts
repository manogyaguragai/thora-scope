import { expect, test } from '@playwright/test';

const SAMPLE_WAIT_MS = 800; // > one __perf sample period (4 Hz) + a few frames

test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: centre of the scope image is clear of panels

test('viewing aids: layers, opacity, X-ray, cut-away and labels compile no new programs', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();

  await page.locator('.viewing-panel summary', { hasText: 'Layers' }).click();
  const lobes = page.locator('details[data-group="lungs"]');
  await lobes.locator('summary').click();
  const showLobes = lobes.getByLabel('Show Lungs');
  await showLobes.uncheck();
  await expect(lobes.getByLabel('Show Right middle lobe')).not.toBeChecked();
  await showLobes.check();
  await expect(lobes.getByLabel('Show Right middle lobe')).toBeChecked();
  await lobes.getByLabel('Lungs opacity').fill('0.3');

  const xray = page.getByLabel('X-ray');
  await xray.check();
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await xray.uncheck();
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  expect(await programs()).toBe(before);

  await page.getByLabel('Cut-away plane').check();
  await page.getByLabel('Cut-away axis').selectOption('2');
  // Range min isn't on the 1 mm grid around 0, so fill('0') is rejected: set a snapped value + input event.
  await page.getByLabel('Cut-away position').evaluate((el: HTMLInputElement) => {
    el.value = String((Number(el.min) + Number(el.max)) / 2);
    el.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  await page.getByLabel('Cut-away plane').uncheck();
  await page.waitForTimeout(SAMPLE_WAIT_MS);
  expect(await programs()).toBe(before);

  // Click-to-label (Hands mode is the default slot): centre of the scope image hits tissue at step 1.
  await page.mouse.click(640, 360);
  const pin = page.locator('.label3d-pin');
  await expect(pin).toBeVisible();
  await expect(pin.locator('strong')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(pin).toBeHidden();

  await page.keyboard.press('KeyL');
  await expect(page.locator('.label3d-tag:visible').first()).toBeVisible();
  await page.screenshot({ path: 'qa/screenshots/viewing.png' });

  expect(errors).toEqual([]);
});
