import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const OLV_WAIT_MS = 5500; // config.physiology.olvMs + margin
const CLAMP_WAIT_MS = 4500; // config.physiology.clampMs + margin

/** Wall-clock wait, then until every tween has finished (SwiftShader frames can be slow). */
async function tweensDone(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => Object.values(window.__sim.state.tweens).every((t) => !t.active), null, {
    timeout: 120_000,
  });
}

test('physiology lab: one-lung ventilation, then the RML bronchus clamp test', async ({ page }) => {
  test.setTimeout(300_000); // SwiftShader: two tweens + screenshots
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=outside');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.click('button[data-mode=physiology]');
  const panel = page.getByRole('region', { name: 'Physiology lab' });
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Start one-lung ventilation' }).click();
  await tweensDone(page, OLV_WAIT_MS);
  await page.screenshot({ path: 'qa/screenshots/olv.png' });
  const olv = await page.evaluate(() => {
    const s = window.__sim.state;
    return [s.deflate_RUL, s.deflate_RML, s.deflate_RLL];
  });
  expect(olv).toEqual([1, 1, 1]);
  await expect(panel.getByLabel('RML collapse')).toHaveValue('1');

  await panel.getByRole('button', { name: 'Clamp RML bronchus + re-inflate' }).click();
  await tweensDone(page, CLAMP_WAIT_MS);
  await page.screenshot({ path: 'qa/screenshots/clamp-test.png' });
  const s = await page.evaluate(() => {
    const st = window.__sim.state;
    return { rul: st.deflate_RUL, rml: st.deflate_RML, rll: st.deflate_RLL };
  });
  expect(s.rul).toBeCloseTo(0, 2);
  expect(s.rll).toBeCloseTo(0, 2);
  expect(s.rml).toBeCloseTo(1, 2);
  await expect(panel.getByRole('status')).toContainText('RML stays collapsed');
  expect(errors).toEqual([]);
});

test('T843 ventilation switch in guided, practice and explore (hidden in the Physiology lab)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf?.programs ?? -1);
  await tweensDone(page, 0);
  const one = page.getByRole('button', { name: 'One-lung ventilation' });
  const two = page.getByRole('button', { name: 'Two-lung ventilation' });
  const lobes = () =>
    page.evaluate(() => {
      const s = window.__sim.state;
      return [s.deflate_RUL, s.deflate_RLL];
    });

  await expect(one).toHaveAttribute('aria-pressed', 'true'); // guided steps default to one-lung ventilation
  for (const mode of ['guided', 'practice', 'explore'] as const) {
    await page.click(`button[data-mode=${mode}]`);
    await tweensDone(page, 0);
    if ((await one.getAttribute('aria-pressed')) !== 'true') {
      await one.click();
      await tweensDone(page, OLV_WAIT_MS);
    }
    expect(await lobes()).toEqual([1, 1]);
    await two.focus();
    await page.keyboard.press('Enter'); // keyboard accessible
    await expect(two).toHaveAttribute('aria-pressed', 'true');
    await expect(one).toHaveAttribute('aria-pressed', 'false');
    await tweensDone(page, OLV_WAIT_MS);
    expect(await lobes()).toEqual([0, 0]);
    expect(await page.evaluate(() => window.__sim.m3?.twoLung())).toBe(true);
    await one.click();
    await expect(one).toHaveAttribute('aria-pressed', 'true');
    await tweensDone(page, OLV_WAIT_MS);
    expect(await lobes()).toEqual([1, 1]);
  }
  await page.click('button[data-mode=physiology]');
  await expect(two).toBeHidden();
  expect(await page.evaluate(() => window.__perf?.programs ?? -1)).toBe(programs);
  expect(errors).toEqual([]);
});
