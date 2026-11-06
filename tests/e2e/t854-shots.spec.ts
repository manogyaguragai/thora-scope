import { test } from '@playwright/test';
import { hideShell } from './pixels';
test.use({ viewport: { width: 1280, height: 720 } });
for (const palette of ['realistic', 'teaching'])
  for (const step of [1, 3, 6])
    test(`t854 ${palette} s${step}`, async ({ page }) => {
      await page.goto(`/?view=scope&step=${step}&palette=${palette}`);
      await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
      await hideShell(page);
      await page.waitForFunction(
        () => window.__sim.rig?.transitioning === false && !window.__sim.guided?.transitioning,
      );
      await page.waitForTimeout(1500);
      const tag = process.env.T854_TAG ?? '';
      const names = await page.evaluate(() => {
        const out: Record<string, number> = {};
        for (let j = 0; j < 9; j++)
          for (let i = 0; i < 9; i++) {
            const n = window.__sim.m3?.pickAt(-0.8 + 0.2 * i, 0.8 - 0.2 * j) ?? 'none';
            out[n] = (out[n] ?? 0) + 1;
          }
        return out;
      });
      console.log(`s${step}`, JSON.stringify(names));
      await page.screenshot({
        path: `qa/screenshots/t854-lung${palette === 'teaching' ? '-teaching' : ''}-s${step}${tag}.png`,
      });
    });
