import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T820/T832/T840: multi-instrument retraction on the v7 keys. Any drag direction blends retract_hilum /
// retract_RML_lateral / retract_fissure for the grasped lobe (directions measured from its morph deltas); grasps add
// up. Held (G) or left in place by a tool switch, a grasper keeps the pose while another tool works; Shift+G / a mode
// change ease it back. Guided (the T860 walkthrough) rebuilds its holding grasper per step. No new programs.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const RML = 'lung_middle_lobe_right';
const RUL = 'lung_upper_lobe_right';
const RLL = 'lung_lower_lobe_right';
const RET = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const SETTLE_MS = 600;
const RELEASE_MS = 1200; // retractionConfig.releaseMs (700) + margin
const OLV_MS = 5500; // config.physiology.olvMs (5000) + margin

const place = (page: Page, id: string, target: string, sub?: string, port?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s, p]) => window.__sim.placeTool?.(i as string, t as string, s, p) ?? 'no helper',
    [id, target, sub, port],
  );
const keys = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const s = window.__sim.state;
    return [s.retract_hilum, s.retract_RML_lateral, s.retract_fissure];
  });
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
const held = (page: Page) =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    if (!m4) throw new Error('not wired');
    return {
      holds: m4.occupancy.holds.map((h) => `${h.tool}@${h.port}`),
      shown: m4.heldShown(),
      tool: m4.tool,
      toolPort: m4.occupancy.activePort,
    };
  });
/** Pointer drag on the canvas, `px` of travel: straight up, along the screen image of world `dir`, or up across it
 *  (perpendicular to that image, the upward one, scaled to `px` of upward travel). */
const drag = (
  page: Page,
  px: number,
  dir: readonly [number, number, number],
  how: 'up' | 'along' | 'across',
): Promise<void> =>
  page.evaluate(
    ([d, h, w]) => {
      const e = window.__sim.rig?.camera.matrixWorld.elements ?? [];
      const sx = (e[0] ?? 1) * w[0] + (e[1] ?? 0) * w[1] + (e[2] ?? 0) * w[2]; // · camera right
      const sy = -((e[4] ?? 0) * w[0] + (e[5] ?? 1) * w[1] + (e[6] ?? 0) * w[2]); // · camera up (px +y down)
      const n = Math.hypot(sx, sy) || 1;
      const [ax, ay] = [sx / n, sy / n];
      const [cx, cy] = ax > 0 ? [ay, -ax] : [-ay, ax]; // perpendicular with an upward (−y) part
      const k = Math.min(10, 1 / Math.max(1e-3, -cy));
      const [ux, uy] = h === 'up' ? [0, -1] : h === 'along' ? [ax, ay] : [cx * k, cy * k];
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const [x0, y0] = [c.clientWidth / 2, c.clientHeight / 2];
      const ev = (t: number) =>
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + ux * t, clientY: y0 + uy * t }));
      ev(0); // baseline at the centre (see centre())
      for (let i = 1; i <= 10; i++) ev((d * i) / 10);
    },
    [px, how, dir] as const,
  );
const UP: readonly [number, number, number] = [1, 0, 0]; // RUL fissure-apart (head)
const RLL_APART: readonly [number, number, number] = [-1, 0, -0.6]; // retractionConfig.grasp.fissureApart.RLL
/** Pointer to the canvas centre before a press, so the next drag starts there (no jump from the last drag's end). */
const centre = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: c.clientWidth / 2, clientY: c.clientHeight / 2 }),
    );
  });
const grasp = async (page: Page, target: string, port?: string): Promise<void> => {
  expect(await place(page, 'grasper', target, 'retractor', port), `grasper → ${target}`).toBe('ok');
  await centre(page);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
};

test('retraction: key per lobe + drag → hold → cautery in another port → release eases back; no new programs', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Step 2 (anterior hilum), lung re-expanded and un-retracted: the first grab starts one-lung ventilation.
  await page.goto('/?mode=explore&view=scope&step=2');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  await expect(page.getByRole('button', { name: 'Hold · G' })).toBeVisible();
  await expect(page.locator('.retraction-btn[data-action=release]')).toBeDisabled();

  await page.evaluate(() => {
    const s = window.__sim.state;
    s.retract_hilum = s.retract_RML_lateral = s.retract_fissure = 0;
    s.deflate_RUL = s.deflate_RML = s.deflate_RLL = 0;
    // T840: the access incision's two positions go to the second grasper + the cautery.
    window.__sim.m3?.scope.switchPort('port_camera_8ICS');
    window.__sim.m3?.syncScope();
  });

  // Middle lobe grasp (collapse guard: OLV starts first, the grasp lands once the lung is down).
  expect(await place(page, 'grasper', RML, 'retractor', RET)).toBe('ok');
  await centre(page);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('One-lung ventilation started');
  await page.waitForTimeout(OLV_MS); // button still down
  expect(await page.evaluate(() => window.__sim.state.deflate_RML)).toBe(1);
  await drag(page, 300, UP, 'up');
  const k1 = await keys(page);
  expect(Math.max(...k1)).toBeGreaterThan(0.3);

  // Hold (G): the grasper stays in its port, the hand is free.
  await page.keyboard.press('KeyG');
  const h1 = await held(page);
  expect(h1.holds).toHaveLength(1);
  expect(h1.shown).toBe(1);
  expect(h1.tool).toBeNull();
  const heldPort = h1.holds[0]?.split('@')[1];
  await expect(page.locator('.retraction-btn[data-action=release]')).toContainText('(1)');

  // Second grasper on the upper lobe; switching to the cautery leaves it in place (no G needed).
  await grasp(page, RUL, UTIL);
  await drag(page, 300, UP, 'across');
  await page.evaluate(() => window.__sim.m4?.press(false));
  const k2 = await keys(page);
  expect(sum(k2)).toBeGreaterThan(sum(k1) + 0.1); // the two grasps add up

  // Cautery through the access incision's second position; the lung stays retracted, both graspers drawn.
  expect(await place(page, 'cautery', 'hilar_connective_tissue', undefined, UTIL)).toBe('ok');
  const h2 = await held(page);
  expect(h2.holds).toEqual([`grasper@${heldPort}`, `grasper@${UTIL}`]);
  expect(h2.tool).toBe('cautery');
  expect(h2.toolPort).toBe(UTIL);
  expect(h2.shown).toBe(2);
  await expect(page.locator('.retraction-btn[data-action=release]')).toContainText('(2)');
  await page.waitForTimeout(SETTLE_MS);
  expect(await keys(page)).toEqual(k2);
  await page.screenshot({ path: `${SHOTS}/retraction-hilum.png` });

  // Release (Shift+G, most recent first): the upper lobe grasper, then the middle lobe one; the lung eases back.
  await page.keyboard.press('Shift+KeyG');
  await page.waitForTimeout(RELEASE_MS);
  (await keys(page)).forEach((v, i) => expect(v).toBeCloseTo(k1[i] ?? 0, 2));
  await page.keyboard.press('Shift+KeyG');
  await page.waitForTimeout(RELEASE_MS / 4);
  const mid = sum(await keys(page));
  expect(mid).toBeLessThan(sum(k1));
  expect(mid).toBeGreaterThan(0);
  await page.waitForTimeout(RELEASE_MS);
  expect(sum(await keys(page))).toBeCloseTo(0, 6);
  expect((await held(page)).shown).toBe(0);

  // Lower lobe pulled apart along the fissure; a mode change while holding eases it back.
  await page.keyboard.press('Escape');
  await grasp(page, RLL); // first port with a workable angle
  await drag(page, 300, RLL_APART, 'along');
  expect(Math.max(...(await keys(page)))).toBeGreaterThan(0.3);
  await page.keyboard.press('KeyG');
  expect((await held(page)).holds).toHaveLength(1);
  await page.evaluate(() => {
    // Step-6 view (fissure open, interlobar artery in sight).
    const { m3, rig } = window.__sim;
    if (m3 && rig) m3.scope.snapTo(rig.scopePoseOf('cam_6_fissures'), 'port_camera_8ICS');
    m3?.syncScope();
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/retraction-fissure.png` });
  await page.click('button[data-mode=physiology]');
  await page.waitForTimeout(RELEASE_MS);
  expect(sum(await keys(page))).toBeCloseTo(0, 6);
  expect((await held(page)).holds).toHaveLength(0);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('guided walkthrough (T860): entering steps 3–8 rebuilds the holding grasper in its port; steps 1, 2 and 9 start without', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/?view=scope&step=2');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  for (const [step, shown] of [
    [3, 1],
    [7, 1],
    [9, 0],
    [1, 0],
    [2, 0],
    [8, 1],
  ] as const) {
    const s = await page.evaluate(async (n) => {
      await window.__sim.walkthrough?.seek(n);
      return { reflected: window.__sim.walkthrough?.state().reflected, shown: window.__sim.m4?.heldShown() };
    }, step);
    expect(s.shown, `step ${step}`).toBe(shown);
    if (shown) expect(s.reflected, `step ${step}`).toBe(true);
  }
  for (const step of [3, 4, 5, 6, 7]) {
    await page.evaluate((n) => window.__sim.walkthrough?.seek(n), step);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: `${SHOTS}/guided-grasper-s${step}.png` });
  }
  expect(await programs()).toBe(before);
});
