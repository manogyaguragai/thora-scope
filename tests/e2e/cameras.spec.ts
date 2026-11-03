import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { corners, meanRGB, PATCH } from './pixels';

const SCOPE_DRAW_CALL_BUDGET = 250; // docs/PERF.md / CONTEXT §6.10
const SETTLE_MS = 1500; // auto-exposure + a fresh __perf sample

/** Camera transition and state tweens finished, then settle. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__sim.rig?.transitioning === false &&
      Object.values(window.__sim.state.tweens).every((t) => !t.active),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(SETTLE_MS);
}

const drawCalls = (page: Page): Promise<number> => page.evaluate(() => window.__perf.drawCalls);

async function expectScopeImage(page: Page, path: string): Promise<void> {
  const png = await page.screenshot({ path });
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  for (const { x, y } of corners(width, height))
    expect(await meanRGB(png, x, y), `${path} corner ${x},${y}`).toBeLessThan(2);
  expect(await meanRGB(png, (width - PATCH) / 2, (height - PATCH) / 2), `${path} centre`).toBeGreaterThan(10);
}

test('step cameras through the scope, smooth step change, outside view; scope draw calls in budget', async ({
  page,
}) => {
  test.setTimeout(480_000); // SwiftShader is slow; this test renders ~10 settled views
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  expect(await page.evaluate(() => [window.__sim.rig?.mode, window.__sim.state.step])).toEqual(['scope', 1]);
  await settled(page);
  await expectScopeImage(page, 'qa/screenshots/scope-step1.png');
  const scope1 = await drawCalls(page);

  await page.evaluate(() => window.__sim.setStep(3)); // eased camera transition + state tweens
  expect(await page.evaluate(() => window.__sim.rig?.transitioning)).toBe(true);
  await settled(page);
  expect(await page.evaluate(() => window.__sim.state.port)).toBe('port_retraction_8ICS');
  await expectScopeImage(page, 'qa/screenshots/scope-step3.png');
  const scope3 = await drawCalls(page);

  await page.keyboard.press('o'); // keybindings.toggleView
  expect(await page.evaluate(() => window.__sim.rig?.target)).toBe('outside');
  await settled(page);
  expect(await page.evaluate(() => window.__sim.rig?.mode)).toBe('outside');
  const png = await page.screenshot({ path: 'qa/screenshots/outside.png' });
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  expect(await meanRGB(png, (width - PATCH) / 2, (height - PATCH) / 2), 'outside centre').toBeGreaterThan(10);
  const outside3 = await drawCalls(page);
  await page.evaluate(() => window.__sim.setStep(1, true));
  await settled(page);
  const outside1 = await drawCalls(page);

  console.log(
    `draw calls — scope: step1 ${scope1}, step3 ${scope3} · outside: step1 ${outside1}, step3 ${outside3}`,
  );
  expect(scope1).toBeLessThanOrEqual(SCOPE_DRAW_CALL_BUDGET);
  expect(scope3).toBeLessThanOrEqual(SCOPE_DRAW_CALL_BUDGET);
  expect(scope1).toBeLessThan(outside1); // far-field set is hidden in scope view only
  expect(errors).toEqual([]);
});
