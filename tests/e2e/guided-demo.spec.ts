import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Object3D } from 'three';
import sharp from 'sharp';
import { hideShell } from './pixels';

// T851 "Show me": every guided step's cinematic demonstration runs to the end through the real instrument paths,
// the scope stays inside the chest, instruments enter through their ports, and the step's action happens.
test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: the caption bar's buttons are clear
const DEMO_TIMEOUT_MS = 240_000; // SwiftShader frames can be slow
const MIN_STDEV = 6; // a rendered scope frame, not a flat fill
const AXIS_EPS_M = 1e-4;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const ready = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });

/** Click Show me at the current step, wait for the end; returns the demo's per-beat log. */
async function showMe(page: Page, step: number) {
  const programs = await page.evaluate(() => window.__perf.programs);
  const bar = page.getByRole('region', { name: 'Guided procedure' });
  await bar.getByRole('button', { name: 'Show me this step' }).click();
  await expect(bar.getByRole('button', { name: 'Stop the demonstration' })).toBeVisible();
  await page.waitForFunction(() => window.__demo !== undefined && window.__demo.status !== 'running', null, {
    timeout: DEMO_TIMEOUT_MS,
  });
  const demo = await page.evaluate(() => window.__demo);
  expect(demo?.status, `step ${step}: ${demo?.status}`).toBe('done');
  expect(demo?.step).toBe(step);
  const log = demo?.log ?? [];
  expect(log.length).toBeGreaterThan(0);
  for (const e of log) {
    expect(e.inside, `step ${step} beat ${e.beat}: scope outside the chest`).toBe(true);
    if (!e.want) continue;
    expect(e.tool, `step ${step} beat ${e.beat}`).not.toBeNull();
    expect(e.want, `step ${step} beat ${e.beat}: port ${e.port}`).toContain(e.port);
    expect(e.offAxisM, `step ${step} beat ${e.beat}: shaft off its port`).toBeLessThan(AXIS_EPS_M);
  }
  await expect(bar.getByRole('button', { name: 'Try this step yourself' })).toBeVisible();
  // Frame check on the canvas only (shell hidden), then the shader-program count (0 new after ready).
  await hideShell(page);
  const png = await page.locator('canvas').first().screenshot();
  const { channels } = await sharp(png).stats();
  expect(Math.max(...channels.slice(0, 3).map((c) => c.stdev)), `step ${step}: flat frame`).toBeGreaterThan(
    MIN_STDEV,
  );
  await page.screenshot({ path: `qa/screenshots/demo-step-${step}.png` });
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  return log;
}

test('guided starts at step 1; the first Next from the theatre enters the scope there; step 1 demo', async ({
  page,
}) => {
  test.setTimeout(DEMO_TIMEOUT_MS + 120_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await ready(page);
  const bar = page.getByRole('region', { name: 'Guided procedure' });
  expect(await page.evaluate(() => window.__sim.state.step)).toBe(1);
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(() => page.evaluate(() => window.__sim.rig?.target)).toBe('scope');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__sim.state.step)).toBe(1);
  await expect(page.locator('.guided-step[aria-current=step] .guided-step-num')).toHaveText('1');
  await showMe(page, 1);
  expect(errors).toEqual([]);
});

/** Per step: what the demonstration must have done to the case (beyond the generic checks). */
const CHECKS: Record<number, (page: Page) => Promise<void>> = {
  2: async (page) => {
    const s = await page.evaluate(() => ({
      lift: window.__sim.state.retract_hilum,
      opened: window.__sim.m4?.cuts.count ?? 0,
    }));
    expect(s.lift).toBeGreaterThan(0.5);
    expect(s.opened).toBeGreaterThan(0);
  },
  3: async (page) => expect(await divided(page, 'middle_lobe_vein')).toBe(true),
  4: async (page) =>
    expect(await page.evaluate(() => window.__sim.m4?.finish.specimens)).toEqual(
      expect.arrayContaining(['LN_11R', 'LN_12R']),
    ),
  5: async (page) => expect(await divided(page, 'middle_lobe_bronchus')).toBe(true),
  6: async (page) => expect(await divided(page, 'middle_lobe_artery')).toBe(true),
  7: async (page) => {
    const f = await page.evaluate(() => ({
      fired: window.__sim.fissure?.fired,
      n: window.__sim.fissure?.segments.length,
      need: window.__sim.m4?.finish.fissureFires,
      free: window.__sim.m4?.finish.lobeFree,
    }));
    expect(f.n).toBeGreaterThan(1);
    expect(f.fired).toBe(f.n);
    expect(f.need).toBe(f.n);
    expect(f.free).toBe(true);
  },
  8: async (page) =>
    expect(
      await page.evaluate(() => {
        const m = window.__sim.m3?.picker.meshes.find((x) => x.name === 'lung_middle_lobe_right');
        let shown = !!m;
        for (let o: Object3D | null = m ?? null; o && shown; o = o.parent) shown = o.visible;
        return { removed: window.__sim.m4?.finish.lobeRemoved, shown };
      }),
    ).toEqual({ removed: true, shown: false }),
};

const divided = (page: Page, n: string): Promise<boolean> =>
  page.evaluate((name) => window.__sim.m4?.flags.has(`divided:${name}`) ?? false, n);

for (const step of [2, 3, 4, 5, 6, 7, 8, 9])
  test(`step ${step} "Show me" runs to the end and performs the step`, async ({ page }) => {
    test.setTimeout(DEMO_TIMEOUT_MS + 120_000);
    const errors = watchErrors(page);
    await page.goto(`/?step=${step}&view=scope`);
    await ready(page);
    const log = await showMe(page, step);
    if (step === 9) expect(Math.max(...log.map((e) => e.water))).toBeGreaterThan(0);
    await CHECKS[step]?.(page);
    expect(errors).toEqual([]);
  });
