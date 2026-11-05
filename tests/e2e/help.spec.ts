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
  // Credits footer: both names link to LinkedIn in a new tab (nothing fetched until clicked).
  const credits = dialog.locator('.help-credits');
  await expect(credits).toContainText('Built by Manogya Guragai and Dr. Mandeep Guragai');
  for (const [name, url] of [
    ['Manogya Guragai', 'https://www.linkedin.com/in/manogya-guragai'],
    ['Dr. Mandeep Guragai', 'https://www.linkedin.com/in/mandeep-guragai-280589117'],
  ] as const) {
    const link = credits.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await page.screenshot({ path: 'qa/screenshots/help.png' });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
