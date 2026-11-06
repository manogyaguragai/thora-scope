import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T852 (docs/FEEDBACK_v8_LIVE.md items 8–10) through the real UI path: hotbar key → port → cursor over the field →
// held left button. The sucker clears smoke + haze and drains the irrigation saline; the peanut opens the hilar
// pleura bluntly (no char, no smoke) and its dissection completes. 0 new programs after ready.
test.use({ viewport: { width: 1280, height: 720 } });

const SUCKER_KEY = 'Digit9';
const PEANUT_KEY = 'Digit4';
const CAUTERY_KEY = 'Digit5';
const HAZE_HEAVY = 0.6; // stands in for ~25 s of cumulative energy (cautery.config haze.riseRate)
const HAZE_CLEAR = 0.05;
const HAZE_CLEAR_MS = 6000; // HAZE_HEAVY / suction.hazeClearPerSec + margin
const DRAIN_MS = 20_000; // full level / water.config drainPerSec + margin
const SWEEP_STEPS = 16;
const SWEEP_PX = 14; // short back-and-forth stroke on the layer, within the peanut's reach
const TIP_FOLLOW_MS = 800; // the cursor-driven tip eases in through its port before the click acts there
const PEANUT_DONE_MS = 12_000; // 1 / config.dissect.ratePerSec.peanut of contact + margin

async function boot(page: Page, url: string): Promise<{ errors: string[]; programs: () => Promise<number> }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__perf?.ready === true && window.__sim.m4 !== undefined, null, {
    timeout: 120_000,
  });
  return { errors, programs: () => page.evaluate(() => window.__perf.programs) };
}

const toPx = ([x, y]: [number, number]) => ({ x: ((x + 1) / 2) * 1280, y: ((1 - y) / 2) * 720 });
/** Panels off so the pointer reaches the canvas (visibility: hidden is not hit-tested). */
const clearShell = (page: Page) =>
  page.addStyleTag({ content: '.shell, #action-toast { visibility: hidden !important; }' });

/** NDC grid cell where the scope sees a `prefix` mesh: the lowest point the saline sucker reaches (`byLowY`), else
 *  the one nearest the view centre whose raw picks ± `spanX` (NDC) also hit it (a stroke stays on the layer). */
const findCell = (page: Page, prefix: string, byLowY: boolean, spanX = 0) =>
  page.evaluate(
    ({ prefix, byLowY, spanX }) => {
      const { m3, m4, rig } = window.__sim;
      if (!m3 || !m4 || !rig) return null;
      let best: [number, number] | null = null;
      let bestScore = Infinity;
      for (let x = -0.7; x <= 0.7; x += 0.05)
        for (let y = -0.7; y <= 0.7; y += 0.05) {
          const h = m3.picker.pick(x, y, rig.camera);
          if (!h || !h.nodeName.startsWith(prefix)) continue;
          if (byLowY && !m4.water.reaches(h.point)) continue;
          let along = true;
          for (let k = -4; spanX > 0 && k <= 4; k++)
            along &&=
              m3.picker.pick(x + (k / 4) * spanX, y, rig.camera, true)?.nodeName.startsWith(prefix) === true;
          if (!along) continue;
          const s = byLowY ? h.point.y : Math.hypot(x, y);
          if (s < bestScore) {
            bestScore = s;
            best = [x, y];
          }
        }
      return best;
    },
    { prefix, byLowY, spanX },
  );

test('sucker held over the field clears smoke and haze (hotbar → port → cursor → hold)', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, programs } = await boot(page, '/?view=scope&step=2');
  const before = await programs();
  const cell = await findCell(page, 'mediastinal_pleura_hilum', false);
  expect(cell).not.toBeNull();
  if (!cell) return;
  const at = toPx(cell);
  await clearShell(page);
  // Real cautery contact first (smoke plume), then the haze topped up to "heavy" (long cumulative energy).
  await page.keyboard.press(CAUTERY_KEY);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(TIP_FOLLOW_MS);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  const smoke = await page.evaluate((h) => {
    const fx = window.__sim.m4?.fx;
    if (fx) fx.fog.value = h;
    return fx?.smoke.aliveCount ?? 0;
  }, HAZE_HEAVY);
  expect(smoke).toBeGreaterThan(0);

  await page.keyboard.press(SUCKER_KEY);
  expect(await page.evaluate(() => window.__sim.m4?.tool)).toBe('sucker');
  await page.mouse.move(at.x + 4, at.y + 4);
  await page.mouse.down();
  await page.waitForFunction(() => window.__sim.m4?.fx.sucking === true, null, { timeout: 2000 });
  await page.waitForFunction((t) => (window.__sim.m4?.fx.fog.value ?? 1) <= t, HAZE_CLEAR, {
    timeout: HAZE_CLEAR_MS,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__sim.m4?.fx.sucking)).toBe(false);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('sucker held in the irrigated field drains the saline to dry', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, programs } = await boot(page, '/?view=scope&step=9');
  const before = await programs();
  await page.keyboard.press('KeyW'); // water.config key: "Irrigate the field"
  await page.waitForFunction(() => window.__sim.m4?.water.level === 1, null, { timeout: 15_000 });
  const cell = await findCell(page, '', true);
  expect(cell).not.toBeNull();
  if (!cell) return;
  await clearShell(page);
  await page.keyboard.press(SUCKER_KEY);
  expect(await page.evaluate(() => window.__sim.m4?.tool)).toBe('sucker');
  const at = toPx(cell);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForFunction(() => (window.__sim.m4?.water.level ?? 1) < 0.9, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__sim.m4?.water.level === 0, null, { timeout: DRAIN_MS });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__sim.m4?.water.mesh.visible)).toBe(false);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('peanut sweep over the hilar pleura opens it bluntly: no char, no smoke; the dissection completes', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { errors, programs } = await boot(page, '/?view=scope&step=2');
  const before = await programs();
  const cell = await findCell(page, 'mediastinal_pleura_hilum', false, (2 * SWEEP_PX) / 1280);
  expect(cell).not.toBeNull();
  if (!cell) return;
  const c = toPx(cell);
  const a = { x: c.x - SWEEP_PX, y: c.y };
  const b = { x: c.x + SWEEP_PX, y: c.y };
  await clearShell(page);
  await page.keyboard.press(PEANUT_KEY);
  expect(await page.evaluate(() => window.__sim.m4?.tool)).toBe('peanut');
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(TIP_FOLLOW_MS);
  await page.mouse.down();
  const t0 = Date.now();
  let done = false;
  for (let lap = 0; !done && Date.now() - t0 < PEANUT_DONE_MS; lap++) {
    for (let i = 0; i <= SWEEP_STEPS; i++) {
      const t = lap % 2 ? 1 - i / SWEEP_STEPS : i / SWEEP_STEPS;
      await page.mouse.move(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      await page.waitForTimeout(40);
    }
    done = await page.evaluate(() => /dissected/.test(window.__sim.m4?.lastToast ?? ''));
  }
  const s = await page.evaluate(() => {
    const m4 = window.__sim.m4;
    return {
      cuts: m4?.cuts.count ?? 0,
      chars: m4?.fx.char.count ?? -1,
      smoke: m4?.fx.smoke.aliveCount ?? -1,
      haze: m4?.fx.fog.value ?? -1,
      toast: m4?.lastToast ?? '',
    };
  });
  await page.mouse.up();
  expect(s.cuts).toBeGreaterThan(0);
  expect(s.chars).toBe(0);
  expect(s.smoke).toBe(0);
  expect(s.haze).toBe(0);
  expect(s.toast).toMatch(/dissected/);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});
