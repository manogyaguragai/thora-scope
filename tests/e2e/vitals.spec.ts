import { expect, test } from '@playwright/test';

// T814 contract: main.ts mounts wireVitals and calls tick(now) from the frame loop (wiring by T813).
test('vitals monitor follows the Physiology panel and beeps when sound is on', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=outside');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const monitor = page.getByRole('region', { name: 'Patient monitor (simulated values)' });
  await expect(monitor).toBeVisible();
  const hr = monitor.locator('[data-vital=hr] dd');
  const hrBpm = await page.evaluate(() => window.__sim.state.hrBpm);
  await expect(hr).toHaveText(String(hrBpm));

  // HR set in the Physiology panel shows on the monitor within 1 s.
  await page.click('button[data-mode=physiology]');
  const panel = page.getByRole('region', { name: 'Physiology lab' });
  const input = panel.getByLabel('Heart rate (bpm)');
  await input.fill('110');
  await input.press('Tab'); // blur commits the change
  await expect(hr).toHaveText('110', { timeout: 1000 });
  expect(await page.evaluate(() => window.__vitals?.hr)).toBe(110);

  // Sound toggle (default off) → beeps scheduled on each beat.
  const sound = monitor.getByRole('button', { name: 'Pulse beep sound' });
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__vitals?.soundOn)).toBe(true);
  const before = await page.evaluate(() => window.__vitals?.beeps ?? 0);
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__vitals?.beeps ?? 0);
  expect(after).toBeGreaterThan(before);

  await monitor.screenshot({ path: 'qa/screenshots/vitals-monitor.png' });
  await page.screenshot({ path: 'qa/screenshots/vitals.png' });
  expect(errors).toEqual([]);
});
