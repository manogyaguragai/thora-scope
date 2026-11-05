import { expect, test } from '@playwright/test';

test('help overlay: ? opens the binding list, Esc closes', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });

  await page.keyboard.press('Shift+Slash');
  const dialog = page.getByRole('dialog', { name: 'Controls' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Horizon lock')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Mouse' })).toBeVisible();
  await expect(dialog.locator('kbd').first()).toBeVisible();
  await page.screenshot({ path: 'qa/screenshots/help.png' });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
