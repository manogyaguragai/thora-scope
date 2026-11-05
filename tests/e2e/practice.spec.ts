import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T505: practice mode end to end. (1) The reference sequence PA01→PA32 through the M4 hooks, every action gated by
// the practice engine → debrief. (2) A stapler on a danger structure → complication, bleeding, view reddening.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const CAM = 'port_camera_8ICS';
const RET = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const FIRE_MS = 2500; // stapler close + fire + open (1.7 s) + margin
const PEANUT_MS = 4500; // dissection window: 1 / config.dissect.ratePerSec.peanut + margin
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
  return r;
}
/** Grasp + hold the retraction via its port (G). */
async function retract(page: Page, target: string, port: string): Promise<void> {
  expect(await place(page, 'grasper', target, 'retractor', port), `grasper → ${target}`).toBe('ok');
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await page.keyboard.press('KeyG');
}
const inspect = (page: Page, name: string): Promise<string | undefined> =>
  page.evaluate((n) => window.__sim.m5?.inspect(n), name);
/** Hands, then the scope into `port` (Hands + P); the M5 frame loop reports the move to the engine. */
async function moveScope(page: Page, port: string): Promise<void> {
  await page.evaluate((p) => {
    const m3 = window.__sim.m3;
    m3?.hotbar.select(0);
    m3?.scope.switchPort(p);
    m3?.syncScope();
  }, port);
  await page.waitForTimeout(SHORT_MS);
}
const isDone = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((a) => window.__sim.m5?.engine?.isDone(a) ?? false, id);
const engineErrors = (page: Page) =>
  page.evaluate(() =>
    (window.__sim.m5?.engine?.log ?? []).flatMap((e) =>
      e.type === 'error' ? [`${e.error} ${e.actionId ?? ''} ${e.attempt.tool}→${e.attempt.target}`] : [],
    ),
  );

test('practice: full reference run PA01→PA32 is accepted in order → scored debrief', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openPractice(page, errors);
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();

  // [action id, how] in the table's order (src/content/practice_actions.json, tests/unit/practice.test.ts SCRIPT).
  const run: [string, () => Promise<unknown>][] = [
    ['PA01', () => inspect(page, RML)],
    ['PA02', () => moveScope(page, RET)],
    ['PA03', () => retract(page, RUL, CAM)],
    [
      'PA04',
      async () => (await place(page, 'peanut', 'mediastinal_fat', undefined, UTIL), press(page, PEANUT_MS)),
    ],
    [
      'PA05',
      async () => (
        await place(page, 'peanut', 'phrenic_nerve_right', undefined, UTIL),
        press(page, SHORT_MS)
      ),
    ],
    [
      'PA06',
      async () => (
        await place(page, 'peanut', 'hilar_connective_tissue', undefined, UTIL),
        press(page, PEANUT_MS)
      ),
    ],
    ['PA07', async () => (await inspect(page, 'V_RML_common'), inspect(page, 'tree_pulm_vein_base'))],
    ['PA08', async () => (await place(page, 'clamp', 'V_RML_common', undefined, UTIL), press(page))],
    ['PA09', () => retract(page, RUL, UTIL)],
    [
      'PA10',
      async () => {
        expect(await place(page, 'stapler', 'V_RML_common', 'vascular-curved', CAM)).toBe('ok');
        await press(page);
        await page.waitForTimeout(FIRE_MS);
      },
    ],
    ['PA11', () => retract(page, RUL, CAM)],
    [
      'PA12',
      async () => (
        await place(page, 'peanut', 'hilar_connective_tissue', undefined, UTIL),
        press(page, SHORT_MS)
      ),
    ],
    [
      'PA13',
      async () => (
        await place(page, 'cautery', 'hilar_connective_tissue', undefined, UTIL),
        press(page, SHORT_MS)
      ),
    ],
    ['PA14', async () => (await place(page, 'grasper', 'LN_11R', 'ring', UTIL), press(page))],
    ['PA15', async () => (await place(page, 'grasper', 'LN_12R', 'ring', UTIL), press(page))],
    ['PA16', async () => (await place(page, 'clamp', 'B_RML_common', undefined, UTIL), press(page))],
    [
      'PA17',
      async () => {
        expect(await place(page, 'stapler', 'B_RML_common', 'bronchial')).toBe('ok');
        await press(page); // close
        await page.waitForTimeout(SHORT_MS);
      },
    ],
    ['PA18', () => page.keyboard.press('KeyA')],
    ['PA19', async () => (await press(page), page.waitForTimeout(FIRE_MS))],
    [
      'PA20',
      async () => {
        // The test breath (PA18) re-inflates RUL/RLL for a few seconds: retraction needs the lung down again.
        await page.waitForFunction(() => window.__sim.state.deflate_RUL >= 0.95, null, { timeout: 15_000 });
        await retract(page, RUL, UTIL);
      },
    ],
    ['PA21', async () => (await place(page, 'clamp', 'A_RML_common', undefined, UTIL), press(page))],
    [
      'PA22',
      async () => {
        expect(await place(page, 'stapler', 'A_RML_common', 'vascular-leader', CAM)).toBe('ok');
        await press(page);
        await page.waitForTimeout(FIRE_MS);
      },
    ],
    ['PA23', () => moveScope(page, CAM)],
    ['PA24', async () => (await retract(page, RML, UTIL), page.waitForTimeout(TWEEN_MS))],
    [
      'PA25',
      async () => {
        expect(await place(page, 'stapler', RML, 'parenchyma', RET)).toBe('ok');
        await press(page);
        await page.waitForTimeout(FIRE_MS);
      },
    ],
    ['PA26', () => inspect(page, 'tree_airway_base')],
    [
      'PA27',
      async () => {
        expect(await place(page, 'stapler', RML, 'parenchyma', RET)).toBe('ok');
        await press(page);
        await page.waitForTimeout(FIRE_MS);
      },
    ],
    ['PA28', () => page.keyboard.press('KeyB')],
    ['PA29', () => moveScope(page, RET)],
    ['PA32', async () => (await place(page, 'sucker', 'tree_airway_base', 'irrigation', UTIL), press(page))],
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

  // Completion opens the lazy debrief (rendering held behind it).
  const debrief = page.getByRole('dialog', { name: 'Case debrief' });
  await expect(debrief).toBeVisible({ timeout: 10_000 });
  await expect(debrief.getByText('Pending clinician review')).toBeVisible();
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

  await place(page, 'stapler', 'V_RML_common', 'vascular-curved');
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
