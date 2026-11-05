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

// T821: in the scope view the monitor is a numbers-only strip in the black margin beside the 5:4 scope image
// (config.postfx.maskAspect / maskFill mirrored here, as in layout.spec); the collapse toggle persists.
const MASK_ASPECT = 1.25;
const MASK_FILL = 1;
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  test(`vitals ${viewport.width}×${viewport.height}: compact strip off the scope image, collapsible`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.goto('/?view=scope');
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    const monitor = page.getByRole('region', { name: 'Patient monitor (simulated values)' });
    await expect(monitor.locator('[data-vital=hr] dd')).toBeVisible();
    await expect(monitor.locator('.vitals-trace')).toBeHidden();
    const b = await monitor.boundingBox();
    const mh = MASK_FILL * Math.min(viewport.height, viewport.width / MASK_ASPECT);
    const scopeRight = (viewport.width + mh * MASK_ASPECT) / 2;
    expect(b?.x ?? 0, 'monitor left edge vs scope image right edge').toBeGreaterThanOrEqual(scopeRight);

    await page.screenshot({ path: `qa/screenshots/vitals-scope-${viewport.width}.png` });
    const toggle = monitor.getByRole('button', { name: 'Monitor details' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(monitor.locator('[data-vital=hr] dd')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('thorascope.vitalsCollapsed'))).toBe('1');
    await monitor.screenshot({ path: `qa/screenshots/vitals-collapsed.png` });
    await toggle.click();
    await expect(monitor.locator('[data-vital=hr] dd')).toBeVisible();

    // Outside view: the full panel with traces.
    await page.evaluate(() => window.__sim.setView('outside', true));
    await expect(monitor.locator('.vitals-trace')).toBeVisible();
  });
}
