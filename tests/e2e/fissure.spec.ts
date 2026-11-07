import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T853: the user's powered stapler at step 7 seats on the dotted fissure guide's next segment (jaws along it); each
// fire divides that segment, in order (its staple line drawn by the guide, not M4); after the last one the lobe is free.
// Cap-1 instruments move between ports through "Insert via" instead of being refused.
const RML = 'lung_middle_lobe_right';
const RET = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const FIRE_MS = 2500; // stapler close + fire + open + margin

async function open(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?mode=explore&step=7&view=scope');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  // Earlier steps done (bronchus, artery divided); the step pose holds the fissure open.
  await page.evaluate(() =>
    Object.assign(window.__sim.m4?.finish ?? {}, {
      veinDivided: true,
      bronchusClamped: true,
      bronchusTestPassed: true,
      bronchusDivided: true,
      arteryDivided: true,
    }),
  );
  await page.waitForFunction(() => window.__sim.fissure?.active === true, null, { timeout: 10_000 });
}
const place = (page: Page, id: string, target: string, sub?: string, port?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s, p]) => window.__sim.placeTool?.(i as string, t as string, s, p) ?? 'no helper',
    [id, target, sub, port],
  );

test('4 user stapler fires divide the 4 guide segments in order → the lobe is free', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await open(page, errors);
  const n = await page.evaluate(() => window.__sim.fissure?.segments.length ?? 0);
  expect(n).toBe(4);
  const lines = await page.evaluate(() => window.__sim.m4?.staples.lineCount);
  for (let k = 0; k < n; k++) {
    if (k === n - 1)
      await page.evaluate(() => window.__sim.m4 && (window.__sim.m4.finish.undersideConfirmed = true));
    expect(await place(page, 'stapler', RML, 'parenchyma', RET), `fire ${k + 1}: place`).toBe('ok');
    const seated = await page.evaluate((i) => {
      const s = window.__sim.fissure?.segments[i];
      const m4 = window.__sim.m4;
      return s && m4 ? m4.control.tipPos.distanceTo(s.mid) : -1;
    }, k);
    expect(seated, `fire ${k + 1}: on segment ${k}`).toBeGreaterThanOrEqual(0);
    expect(seated).toBeLessThan(0.002);
    expect(await page.evaluate(() => window.__sim.m4?.press(true)), `fire ${k + 1}`).toBe('ok');
    await page.evaluate(() => window.__sim.m4?.press(false));
    await page.waitForTimeout(FIRE_MS);
    const fired = await page.evaluate(
      (m) => Array.from({ length: m }, (_, i) => window.__sim.fissure?.isFired(i) ?? false),
      n,
    );
    expect(fired, `after fire ${k + 1}`).toEqual(Array.from({ length: n }, (_, i) => i <= k));
  }
  expect(await page.evaluate(() => window.__sim.m4?.finish.lobeFree)).toBe(true);
  expect(await page.evaluate(() => window.__sim.fissure?.active)).toBe(false);
  expect(await page.evaluate(() => window.__sim.m4?.staples.lineCount), 'no extra M4 staple lines').toBe(
    lines,
  );
  expect(errors).toEqual([]);
});

test('a cap-1 stapler left in one port moves to another via Insert via', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await open(page, errors);
  expect(await place(page, 'stapler', RML, 'parenchyma', RET)).toBe('ok');
  await page.evaluate(() => window.__sim.m3?.hotbar.select(1)); // another instrument: the stapler stays in its port
  expect(await page.evaluate(() => window.__sim.m4?.occupancy.inUse('stapler'))).toBe(1);
  const r = await page.evaluate((u) => {
    const { m3, m4 } = window.__sim;
    if (!m3 || !m4) return null;
    m3.hotbar.select(6); // stapler (slot 6) again: the one in the chest comes back into the hand
    const via = m4.insertVia(u);
    return { via, port: m4.occupancy.activePort, used: m4.occupancy.inUse('stapler'), toast: m4.lastToast };
  }, UTIL);
  expect(r?.via, r?.toast).toBe('ok');
  expect(r?.port).toBe(UTIL);
  expect(r?.used).toBe(1);
  expect(errors).toEqual([]);
});

test('a parked grasper (spare inventory) resumes when its slot is selected again', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await open(page, errors);
  expect(await place(page, 'grasper', RML, 'retractor', UTIL)).toBe('ok');
  const r = await page.evaluate(() => {
    const { m3, m4 } = window.__sim;
    if (!m3 || !m4) return null;
    m4.park(); // right click: it stays where it is
    m3.hotbar.select(4); // cautery: the parked grasper stays in its port
    const left = m4.occupancy.holds.length;
    m3.hotbar.select(1); // grasper again: the parked one resumes (no second grasper)
    return {
      left,
      port: m4.occupancy.activePort,
      used: m4.occupancy.inUse('grasper'),
      parked: m4.parked,
      held: m4.occupancy.holds.length,
    };
  });
  expect(r).toEqual({ left: 1, port: UTIL, used: 1, parked: false, held: 0 });
  expect(errors).toEqual([]);
});
