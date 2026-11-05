import { expect, test } from '@playwright/test';

test('hotbar: 1–9, Q/E and sub-option re-press', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const bar = page.getByRole('toolbar', { name: 'Instruments' });
  await expect(bar).toBeVisible();
  const pressed = bar.locator('[aria-pressed=true]');

  for (let k = 1; k <= 9; k++) {
    await page.keyboard.press(`Digit${k}`);
    await expect(pressed).toHaveAttribute('aria-label', new RegExp(`\\(key ${k}\\)$`));
  }
  await page.keyboard.press('KeyE'); // 9 → 1 (wrap)
  await expect(pressed).toHaveAttribute('data-slot', 'hands');
  await page.keyboard.press('KeyQ'); // 1 → 9 (wrap)
  await expect(pressed).toHaveAttribute('data-slot', 'sucker');

  await page.keyboard.press('Digit7');
  await page.keyboard.press('Digit7'); // re-press: next stapler cartridge
  await expect(pressed).toHaveAttribute('data-slot', 'stapler');
  await expect(pressed).toHaveAttribute('aria-label', /Vascular \+ silicone leader/);
  await expect(bar.locator('[aria-pressed]')).toHaveCount(9);
  await expect(bar.locator('[aria-pressed=true]')).toHaveCount(1);

  await page.screenshot({ path: 'qa/screenshots/hotbar.png' });
  expect(errors).toEqual([]);
});
