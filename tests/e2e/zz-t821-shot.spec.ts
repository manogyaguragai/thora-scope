import { test } from '@playwright/test';
test.use({ viewport: { width: 1280, height: 720 } });
test('shots', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?view=scope&step=2');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  for (const s of [2, 3, 4, 5, 6]) {
    await page.evaluate((n) => window.__sim.setStep(n, true), s);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/claude-1000/-home-manogya-Desktop-surgery-teacher/fe8cd8b8-5675-45fd-abb0-80e292c75981/scratchpad/s${s}.png` });
  }
});
