import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T505/T832/T844: practice mode end to end. (1) The 9-step reference sequence PA01→PA26 (same steps as Guided) through
// the M4 hooks, every action gated by the practice engine → debrief. (2) A stapler on a danger structure → complication, bleeding, view reddening.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const RET = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const RLL = 'lung_lower_lobe_right';
const VEIN = 'middle_lobe_vein';
const BR = 'middle_lobe_bronchus';
const ART = 'middle_lobe_artery';
const FIRE_MS = 2500; // stapler close + fire + open (1.7 s) + margin
const CAUTERY_TIMEOUT_MS = 30_000; // energy held until the dissection step is accepted
const TWEEN_MS = 1800; // result tween (config.practice.resultTweenMs) + margin
const SHORT_MS = 400;

async function openPractice(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?mode=practice');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__sim.m5?.engine != null, null, { timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Practice' })).toBeVisible();
}

const place = (page: Page, id: string, target: string, sub?: string, port?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s, p]) => window.__sim.placeTool?.(i as string, t as string, s, p) ?? 'no helper',
    [id, target, sub, port],
  );
/** Left button on the placed target, held `ms` (0 = click). */
async function press(page: Page, ms = 0): Promise<string> {
  const r = await page.evaluate(() => window.__sim.m4?.press(true) ?? 'not wired');
  if (ms) await page.waitForTimeout(ms);
  await page.evaluate(() => window.__sim.m4?.press(false));
  // A vessel takes two clicks (close, then fire); the bronchus waits for its ventilation test.
  await page.evaluate(() => {
    const m4 = window.__sim.m4;
    if (m4 && m4.stapleClosedOn === m4.target && m4.target !== 'middle_lobe_bronchus') {
      m4.press(true);
      m4.press(false);
    }
  });
  return r;
}
/** Grasp + hold the retraction via its port (G); `apart` drags along the lobe's fissure-opening direction first. */
async function retract(page: Page, target: string, port: string, apart = false): Promise<void> {
  expect(await place(page, 'grasper', target, 'retractor', port), `grasper → ${target}`).toBe('ok');
  await page.evaluate(() => {
    // Pointer at the canvas centre first: the drag below starts there (no jump from an earlier pointer position).
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    c.dispatchEvent(
      new PointerEvent('pointermove', { clientX: c.clientWidth / 2, clientY: c.clientHeight / 2 }),
    );
  });
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  if (apart)
    await page.evaluate(() => {
      // World +X (head: the upper lobe's fissure-apart direction) on screen = the camera's right / up columns.
      const e = window.__sim.rig?.camera.matrixWorld.elements ?? [];
      const [sx, sy] = [e[0] ?? 1, -(e[4] ?? 0)];
      const n = Math.hypot(sx, sy) || 1;
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const [x0, y0] = [c.clientWidth / 2, c.clientHeight / 2];
      const ev = (k: number) =>
        c.dispatchEvent(
          new PointerEvent('pointermove', { clientX: x0 + (sx / n) * k, clientY: y0 + (sy / n) * k }),
        );
      for (let k = 0; k <= 300; k += 30) ev(k);
    });
  await page.keyboard.press('KeyG');
}
type Bed = { __bed?: number[] };
/** T844 step 4: the node-bed ooze (started once the nodes are out) sealed by energised cautery contact on it. */
async function coagulateOoze(page: Page): Promise<void> {
  const sealed = await page.evaluate(() => window.__sim.m5?.complications?.coagulated ?? 0);
  const r = await page.evaluate(() => {
    const { m3, m4 } = window.__sim;
    if (!m3 || !m4) return 'not wired';
    const at = (window as unknown as Bed).__bed;
    if (!at) return 'no node removed';
    const bed = m3.picker.nearest(m4.control.tipPos.clone().fromArray(at), 0.008); // within the coag radius
    if (!bed) return 'no bed surface';
    m3.hotbar.select(4); // cautery
    return m4.snapTo(bed.nodeName, bed.point);
  });
  expect(r, 'cautery on the node bed').toBe('ok');
  await page.waitForFunction(() => window.__sim.m4?.control.phase !== 'inserting', null, { timeout: 10_000 });
  await page.evaluate(() => window.__sim.m4?.press(true));
  await page.waitForFunction((n) => (window.__sim.m5?.complications?.coagulated ?? 0) > n, sealed, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__sim.m4?.press(false));
}
const inspect = (page: Page, name: string): Promise<string | undefined> =>
  page.evaluate((n) => window.__sim.m5?.inspect(n), name);
const isDone = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((a) => window.__sim.m5?.engine?.isDone(a) ?? false, id);
const engineErrors = (page: Page) =>
  page.evaluate(() =>
    (window.__sim.m5?.engine?.log ?? []).flatMap((e) =>
      e.type === 'error' ? [`${e.error} ${e.actionId ?? ''} ${e.attempt.tool}→${e.attempt.target}`] : [],
    ),
  );

test('practice: full reference run PA01→PA26 is accepted in the 9 guided steps, in order → scored debrief', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  await openPractice(page, errors);
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  const tool =
    (id: string, target: string, sub?: string, port?: string, ms = 0) =>
    async () => {
      expect(await place(page, id, target, sub, port), `${id} → ${target}`).toBe('ok');
      await press(page, ms);
    };
  // Cautery dissection progress is capped per frame, so a fixed hold is flaky on a loaded machine: hold the energy
  // until the action is accepted (or the timeout), then release (same rule as scripts/perf-probe.mjs).
  const cauteryUntil = (aid: string, target: string) => async () => {
    expect(await place(page, 'cautery', target, undefined, UTIL), `cautery → ${target}`).toBe('ok');
    await page.evaluate(() => window.__sim.m4?.press(true));
    await expect.poll(() => isDone(page, aid), { timeout: CAUTERY_TIMEOUT_MS }).toBe(true);
    await page.evaluate(() => window.__sim.m4?.press(false));
  };
  const staple = (target: string, sub: string, port?: string) => async () => {
    await tool('stapler', target, sub, port)();
    await page.waitForTimeout(FIRE_MS);
  };

  // [action id, how] in the table's order (src/content/practice_actions.json, tests/unit/practice.test.ts SCRIPT).
  const run: [string, () => Promise<unknown>][] = [
    ['PA01', async () => (await inspect(page, RUL), await inspect(page, RML), inspect(page, RLL))],
    ['PA02', () => retract(page, RUL, RET)],
    ['PA03', tool('peanut', 'phrenic_nerve_right', undefined, UTIL, SHORT_MS)],
    ['PA04', cauteryUntil('PA04', 'mediastinal_pleura_hilum')],
    ['PA05', cauteryUntil('PA05', 'hilar_connective_tissue')],
    ['PA06', async () => (await inspect(page, VEIN), inspect(page, 'pulmonary_vein_tree'))],
    ['PA07', tool('peanut', VEIN, undefined, UTIL)],
    ['PA08', () => retract(page, RUL, UTIL)], // retraction swap: frees the posterior port
    ['PA09', staple(VEIN, 'vascular-curved', RET)],
    [
      'PA10',
      async () => {
        // T840: the node follows the forceps and comes out when the instrument moves on / is withdrawn.
        await page.evaluate(() =>
          window.__sim.m4?.onNodeRemoved.push((_n, p) => ((window as unknown as Bed).__bed = p.toArray())),
        );
        await tool('grasper', 'LN_11R', 'ring', UTIL)();
        await tool('grasper', 'LN_12R', 'ring', UTIL)();
        await page.evaluate(() => window.__sim.m4?.withdraw());
      },
    ],
    ['PA11', () => coagulateOoze(page)],
    ['PA12', async () => (await page.keyboard.press('Shift+KeyG'), retract(page, RML, UTIL))], // UTIL takes two
    ['PA13', tool('clamp', BR, undefined, UTIL)],
    [
      'PA14',
      async () => {
        await tool('stapler', BR, 'bronchial', RET)(); // close
        await page.waitForTimeout(SHORT_MS);
      },
    ],
    ['PA15', () => page.keyboard.press('KeyA')],
    ['PA16', async () => (await press(page), page.waitForTimeout(FIRE_MS))],
    ['PA17', tool('peanut', ART, undefined, UTIL)],
    ['PA18', staple(ART, 'vascular-leader', RET)],
    [
      'PA19',
      async () => {
        // The test breath (PA15) re-inflates RUL/RLL for a few seconds: retraction needs the lung down again.
        await page.waitForFunction(() => window.__sim.state.deflate_RUL >= 0.95, null, { timeout: 15_000 });
        await retract(page, RML, UTIL);
        await page.waitForTimeout(TWEEN_MS);
      },
    ],
    ['PA20', staple(RML, 'parenchyma', RET)], // T851: one fire per dotted fissure segment
    ['PA29', staple(RML, 'parenchyma', RET)],
    ['PA21', () => inspect(page, 'bronchial_tree')],
    ['PA30', staple(RML, 'parenchyma', RET)],
    ['PA22', staple(RML, 'parenchyma', RET)],
    ['PA23', () => page.keyboard.press('KeyB')],
    ['PA24', () => page.evaluate(() => window.__sim.m4?.irrigate())], // T842 "Irrigate the field"
    ['PA25', () => page.keyboard.press('KeyA')],
    ['PA26', tool('sucker', 'bronchial_tree', 'suction', UTIL, SHORT_MS)],
  ];
  for (const [id, act] of run) {
    await act();
    expect(
      await isDone(page, id),
      `${id} not accepted: ${(await engineErrors(page)).join('; ')} · toast "${await page.evaluate(() => window.__sim.m4?.lastToast)}"`,
    ).toBe(true);
  }
  expect(await page.evaluate(() => window.__sim.m5?.engine?.finished)).toBe(true);
  expect(await engineErrors(page)).toEqual([]);
  // Same 9 steps as Guided, entered in order.
  const steps = await page.evaluate(() =>
    (window.__sim.m5?.engine?.log ?? []).flatMap((e) => (e.type === 'step' ? [e.step] : [])),
  );
  expect(steps).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  // Manifest roles: every divided segment is gone (the dissected layers stay, with local openings).
  const shown = await page.evaluate(() =>
    ['middle_lobe_vein_V4', 'middle_lobe_bronchus_B5', 'middle_lobe_artery_A5'].map((n) => {
      let o: { visible: boolean; parent: unknown } | null | undefined = window.__sim.m3?.picker.meshes.find(
        (m) => m.name === n,
      );
      let vis = !!o;
      for (; o; o = o.parent as typeof o) if (!o.visible) vis = false;
      return vis;
    }),
  );
  // T841: the specimen side (branches, distal pieces, distal caps) leaves with the lobe.
  expect(shown, 'divided segments gone once the lobe is out').toEqual([false, false, false]);
  const specimen = await page.evaluate(() =>
    (window.__sim.stumps?.splits ?? []).flatMap((s) =>
      [s.proximal, s.distal, s.cap]
        .filter((m) => {
          for (let o: import('three').Object3D | null = m; o; o = o.parent) if (!o.visible) return false;
          return true;
        })
        .map((m) => m.name),
    ),
  );
  expect(specimen, 'split pieces / distal caps left after the lobe is out').toEqual([]);
  expect(await page.evaluate(() => window.__sim.state.retract_fissure)).toBeGreaterThan(0.9);

  // Completion opens the lazy debrief (rendering held behind it).
  const debrief = page.getByRole('dialog', { name: 'Case debrief' });
  await expect(debrief).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/practice-complete.png` });
  const renders = (): Promise<number> => page.evaluate(() => window.__perf.renders);
  const held = await renders();
  await page.waitForTimeout(SHORT_MS);
  expect(await renders()).toBe(held); // T703: no frames while the debrief is up
  expect(Number(await debrief.locator('.debrief-total strong').textContent())).toBeGreaterThanOrEqual(90);

  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('practice: stapler on a danger structure → complication, bleeding, view reddening', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openPractice(page, errors);
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();

  await place(page, 'stapler', VEIN, 'vascular-curved');
  expect(await page.evaluate(() => window.__sim.m4?.tool)).toBe('stapler');
  // Strike at a visible surface point (as a click would), so the blood decal shows in the shot.
  const hit = await page.evaluate(() => {
    const { m3, m5, rig } = window.__sim;
    const h = rig && m3?.picker.pick(0, 0, rig.camera);
    return h ? m5?.strike('superior_vena_cava', h.point) : 'no surface at centre';
  });
  expect(hit).toBe('complication');
  const log = await page.evaluate(() => window.__sim.m5?.complications?.log.map((e) => e.type) ?? []);
  expect(log).toContain('danger-hit');
  expect(log).toContain('bleed');
  // Ooze pools until the view reddens; vitals warning in the practice bar.
  await page.waitForFunction(() => (window.__sim.m5?.complications?.redden ?? 0) > 0.6, null, {
    timeout: 20_000,
  });
  await expect(page.locator('.practice-vitals')).not.toBeEmpty();
  await page.screenshot({ path: `${SHOTS}/complication.png` });
  // The engine logged the wrong action for the debrief.
  expect(
    await page.evaluate(() => window.__sim.m5?.engine?.log.some((e) => e.type === 'error') ?? false),
  ).toBe(true);

  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});
