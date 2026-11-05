import { expect, test } from '@playwright/test';

test('loading screen paints within 1 s of navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#loading .lens')).toBeVisible();
  const fcp = await page
    .waitForFunction(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0)
    .then((h) => h.jsonValue());
  console.log(`FCP ${Math.round(fcp)} ms`);
  expect(fcp).toBeLessThan(1000);
});

test('?holdload freezes at the download stage (screenshot)', async ({ page }) => {
  await page.goto('/?holdload');
  await expect(page.locator('#load-stage')).toHaveText('Downloading model · 40%');
  await expect(page.locator('#load-tip')).not.toBeEmpty();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'qa/screenshots/loading.png' });
});

test('?failload shows the in-theme error card; buttons focusable, Low quality reloads low', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?failload');
  await expect(page.locator('#load-error')).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry' });
  const low = page.getByRole('button', { name: 'Low quality' });
  await expect(retry).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(low).toBeFocused();
  // visible focus ring (tokens.css :focus-visible)
  expect(await low.evaluate((b) => getComputedStyle(b).boxShadow)).not.toBe('none');
  await page.keyboard.press('Shift+Tab');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'qa/screenshots/error-card.png' });
  await low.click();
  await page.waitForURL(/quality=low/);
  await expect(page.locator('#load-error')).toBeVisible(); // ?failload is kept
  expect(await page.evaluate(() => window.__perf.preset)).toBe('low');
  expect(errors).toEqual([]);
});

test('?nowebgl2 shows the WebGL2-missing card', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?nowebgl2');
  await expect(page.locator('#load-error')).toBeVisible();
  await expect(page.locator('#load-error-msg')).toContainText('WebGL2 is not available');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Low quality' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'qa/screenshots/error-card-webgl2.png' });
  expect(errors).toEqual([]);
});

test('quality override from the help overlay persists across reload', async ({ page }) => {
  // playwright.config seeds { preset: 'low', locked: true }; the control must show it, then switch to medium.
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const openHelp = (): Promise<void> => page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await openHelp();
  await expect(page.locator('#help-quality')).toHaveValue('low');
  await expect(page.locator('#help-quality-lock')).toBeChecked();
  await page.locator('#help-quality').selectOption('medium');
  await page.locator('#help-quality-lock').uncheck();
  await Promise.all([page.waitForEvent('load'), page.locator('#help-quality-apply').click()]);
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__perf.preset)).toBe('medium');
  expect(await page.evaluate(() => localStorage.getItem('thorascope.quality'))).toBe(
    JSON.stringify({ preset: 'medium', locked: false }),
  );
  await openHelp();
  await expect(page.locator('#help-quality')).toHaveValue('medium');
  await expect(page.locator('#help-quality-lock')).not.toBeChecked();
});

test('?quality=high overrides the device check', async ({ page }) => {
  // ?failload stops right after the renderer is created, so the preset is already chosen.
  await page.goto('/?quality=high&failload');
  await expect(page.locator('#load-error')).toBeVisible();
  expect(await page.evaluate(() => window.__perf.preset)).toBe('high');
});

test('normal load reaches ready and removes the loading screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const unusedPreloads: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (/preload/i.test(m.text())) unusedPreloads.push(m.text()); // "preloaded ... but not used" (glb, font)
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toHaveCount(0);
  // the glb + font preloads must be consumed by the loader's fetch / @font-face (one request each)
  const fetched = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /thorax_sim\.opt\.glb|inter-latin-400/.test(n)),
  );
  expect(fetched).toHaveLength(2);
  const { log, timings, preset } = await page.evaluate(() => ({
    log: window.__loadStageLog,
    timings: window.__perf.loadStages,
    preset: window.__perf.preset,
  }));
  console.log(`preset ${preset} · ${timings.map((t) => `${t.name} ${t.ms} ms`).join(' · ')}`);
  expect(log).toEqual([
    'Downloading model',
    'Decoding',
    'Uploading textures',
    'Compiling shaders',
    'Warming up',
  ]);
  expect(timings.map((t) => t.name)).toEqual(['download', 'decode', 'upload', 'compile', 'warmup']);
  expect(errors).toEqual([]);
  expect(unusedPreloads).toEqual([]);
});
