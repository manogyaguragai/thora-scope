import { expect, test } from '@playwright/test';
import { hideShell } from './pixels';

// T813: the static OT room is the default outside view; hidden in the scope view; toggling views compiles nothing.
test.use({ viewport: { width: 1280, height: 720 } });

const SETTLE_MS = 1500; // auto-exposure + a fresh __perf sample

test('OT room shows in the outside view, hides in the scope view, no new programs', async ({ page }) => {
  test.setTimeout(300_000); // SwiftShader at full size
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  expect(await page.evaluate(() => [window.__sim.rig?.mode, window.__sim.room?.visible])).toEqual([
    'outside',
    true,
  ]);
  // The room is not pickable: its meshes are not in the model the BVH is built from.
  expect(
    await page.evaluate(() => window.__sim.m3?.picker.meshes.some((m) => m.name.startsWith('ot_room'))),
  ).toBe(false);
  await hideShell(page);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: 'qa/screenshots/otroom.png' });

  await page.keyboard.press('o'); // keybindings.toggleView
  await page.waitForFunction(
    () => window.__sim.rig?.mode === 'scope' && !window.__sim.rig.transitioning,
    null,
    {
      timeout: 120_000,
    },
  );
  expect(await page.evaluate(() => window.__sim.room?.visible)).toBe(false);
  await page.keyboard.press('o');
  await page.waitForFunction(
    () => window.__sim.rig?.mode === 'outside' && !window.__sim.rig.transitioning,
    null,
    {
      timeout: 120_000,
    },
  );
  expect(await page.evaluate(() => window.__sim.room?.visible)).toBe(true);
  await page.waitForTimeout(SETTLE_MS); // > one __perf sample period
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});
