import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T820: multi-instrument retraction. A lung grasper on the middle lobe is dragged (retract_fissure), held in its
// port (G), the hand switches to cautery in another port while the lung stays retracted; Shift+G releases and the
// morph eases back. Guided steps 2–6 show a static held grasper. No new shader programs.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const RML = 'lung_middle_lobe_right';
const RUL = 'lung_upper_lobe_right';
const UTIL = 'port_utility_5ICS';
const SETTLE_MS = 600;
const RELEASE_MS = 1200; // retractionConfig.releaseMs (700) + margin
const OLV_MS = 5500; // config.physiology.olvMs (5000) + margin

const place = (page: Page, id: string, target: string, sub?: string, port?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s, p]) => window.__sim.placeTool?.(i as string, t as string, s, p) ?? 'no helper',
    [id, target, sub, port],
  );
const fissure = (page: Page): Promise<number> => page.evaluate(() => window.__sim.state.retract_fissure);
const posterior = (page: Page): Promise<number> => page.evaluate(() => window.__sim.state.retract_posterior);
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
/** Pointer drag on the canvas, straight up by `px` (config.retract.dragAxis: up lifts the lung). */
const dragUp = (page: Page, px: number): Promise<void> =>
  page.evaluate((d) => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const x = c.clientWidth / 2;
    const y0 = c.clientHeight * 0.7;
    const ev = (y: number) => c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
    ev(y0); // baseline after the scripted press (lastX/lastY)
    for (let k = 1; k <= 10; k++) ev(y0 - (d * k) / 10);
  }, px);

test('retraction: grasp → drag → hold → cautery in another port → release eases back; no new programs', async ({
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
    s.retract_fissure = s.retract_posterior = s.deflate_RUL = s.deflate_RML = s.deflate_RLL = 0;
  });

  // Grasp the middle lobe and lift it (retract_fissure: RUL up, RLL down, RML lifted).
  expect(await place(page, 'grasper', RML, 'retractor', 'port_retraction_8ICS')).toBe('ok');
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('One-lung ventilation started');
  await page.waitForTimeout(OLV_MS); // button still down: the grasp lands once the lung is down
  expect(await page.evaluate(() => window.__sim.state.deflate_RML)).toBe(1);
  await dragUp(page, 300);
  const target = await fissure(page);
  expect(target).toBeGreaterThan(0.9);

  // Hold (G): the grasper stays in its port, the hand is free.
  await page.keyboard.press('KeyG');
  const h1 = await held(page);
  expect(h1.holds).toHaveLength(1);
  expect(h1.shown).toBe(1);
  expect(h1.tool).toBeNull();
  const heldPort = h1.holds[0]?.split('@')[1];
  await expect(page.locator('.retraction-btn[data-action=release]')).toContainText('(1)');

  // Second held instrument: the upper lobe pushed posteriorly via the access incision (anterior hilum).
  expect(await place(page, 'grasper', RUL, 'retractor', UTIL)).toBe('ok');
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await dragUp(page, 300);
  await page.keyboard.press('KeyG');
  expect((await held(page)).holds).toEqual([`grasper@${heldPort}`, `grasper@${UTIL}`]);
  expect(await posterior(page)).toBeGreaterThan(0.9);
  await expect(page.locator('.retraction-btn[data-action=release]')).toContainText('(2)');

  // Cautery through another port; the lung stays retracted and the held grasper stays drawn.
  expect(await place(page, 'cautery', 'hilar_connective_tissue', undefined, UTIL)).toBe('ok');
  const h2 = await held(page);
  expect(h2.tool).toBe('cautery');
  expect(h2.toolPort).not.toBe(heldPort);
  expect(h2.shown).toBe(2); // 2 held + the active cautery
  await page.waitForTimeout(SETTLE_MS);
  expect(await fissure(page)).toBeCloseTo(target, 2);
  await page.evaluate(() => {
    // Step-6 view (fissure open, interlobar artery in sight), cautery still in.
    const { m3, rig } = window.__sim;
    if (m3 && rig) m3.scope.snapTo(rig.scopePoseOf('cam_6_fissures'), 'port_camera_8ICS');
    m3?.syncScope();
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/retraction-fissure.png` });
  await page.evaluate(() => {
    // Step-2 view: lung held back, anterior hilum (superior pulmonary vein, phrenic nerve) in sight.
    const { m3, rig } = window.__sim;
    if (m3 && rig) m3.scope.snapTo(rig.scopePoseOf('cam_2_anterior_hilum'), 'port_camera_8ICS');
    m3?.syncScope();
  });
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/retraction-hilum.png` });

  // Release (Shift+G, most recent first): the upper lobe grasper, then the middle lobe one; the lung eases back.
  await page.keyboard.press('Shift+KeyG');
  await page.waitForTimeout(RELEASE_MS);
  expect(await posterior(page)).toBe(0);
  expect(await fissure(page)).toBeCloseTo(target, 2);
  await page.keyboard.press('Shift+KeyG');
  await page.waitForTimeout(RELEASE_MS / 4);
  const mid = await fissure(page);
  expect(mid).toBeLessThan(target);
  expect(mid).toBeGreaterThan(0);
  await page.waitForTimeout(RELEASE_MS);
  expect(await fissure(page)).toBe(0);
  expect((await held(page)).shown).toBe(0);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('guided: steps 2–6 show the static held grasper, step 1 and 7 do not', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?view=scope&step=2');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  for (const [step, shown] of [
    [2, 1],
    [6, 1],
    [7, 0],
    [1, 0],
    [3, 1],
  ] as const) {
    await page.evaluate((n) => window.__sim.setStep(n, true), step);
    await page.waitForTimeout(SETTLE_MS);
    expect((await held(page)).shown, `step ${step}`).toBe(shown);
  }
  for (const step of [2, 3, 4, 5, 6]) {
    await page.evaluate((n) => window.__sim.setStep(n, true), step);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: `${SHOTS}/guided-grasper-s${step}.png` }); // T821: grasper framed in 3, 5, 6
  }
  expect(await programs()).toBe(before);
});
