import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

// T817 + T822: electrocautery acts only at contact. Free-space energy leaves nothing on tissue; a contact sweep on the
// hilar connective tissue opens it (shader openings, picking looks through them); energised contact seals a minor
// bleed (practice). ECG diathermy interference while energised; 0 new programs throughout.
test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: scope image clear of the panels

const HOLD_MS = 1200;
const SWEEP_STEPS = 12;
const SCOPE_IN_M = 0; // scope pushed in for the sweep screenshots
const CONTACT_CLEAR_M = 0.006; // free space: nothing this close to the tip (> cautery.config contact.distM)
const WITHDRAW_STEP_M = 0.005; // wheel-back increment while looking for free space

async function boot(page: Page, url: string): Promise<{ errors: string[]; programs: () => Promise<number> }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__perf?.ready === true && window.__vitals !== undefined, null, {
    timeout: 120_000,
  });
  return { errors, programs: () => page.evaluate(() => window.__perf.programs) };
}

const frames = (page: Page, n = 2): Promise<unknown> =>
  page.evaluate(
    (k) =>
      new Promise<void>((r) => {
        const tick = (i: number): unknown => (i <= 0 ? r() : requestAnimationFrame(() => tick(i - 1)));
        tick(k);
      }),
    n,
  );

const fxState = (page: Page) =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    return {
      smoke: m4?.fx.smoke.aliveCount ?? -1,
      chars: m4?.fx.char.count ?? -1,
      cuts: m4?.cuts.count ?? -1,
      contact: m4?.contact,
      haze: m4?.fx.fog.value ?? 1,
      interference: window.__vitals?.interference,
    };
  });

/** Mean RGB of a w×h crop. */
async function mean(png: Buffer, left: number, top: number, w: number, h: number): Promise<number[]> {
  const crop = sharp(await sharp(png).extract({ left, top, width: w, height: h }).toBuffer());
  return (await crop.stats()).channels.slice(0, 3).map((c) => c.mean);
}

test('cautery in free space: energy on, but no smoke, char, haze or dissection', async ({ page }) => {
  test.setTimeout(180_000); // SwiftShader
  const { errors, programs } = await boot(page, '/?view=scope&step=2');
  const before = await programs();
  expect(await page.evaluate(() => window.__sim.placeTool?.('cautery', 'hilar_connective_tissue'))).toBe(
    'ok',
  );
  // Wheel back until no surface is within contact range of the tip (on v8 the shaft from the access incision crosses
  // the CT mediastinal fat, so a fixed withdrawal can land the tip on tissue).
  const free = await page.evaluate(
    ({ distM, stepM }) => {
      const { m3, m4 } = window.__sim;
      if (!m3 || !m4) return false;
      for (let i = 0; i < 40; i++) {
        if (!m3.picker.nearest(m4.control.tipPos, distM)) return true;
        m4.control.insert(-stepM);
      }
      return false;
    },
    { distM: CONTACT_CLEAR_M, stepM: WITHDRAW_STEP_M },
  );
  expect(free).toBe(true);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await page.waitForTimeout(HOLD_MS);
  await frames(page);
  const s = await fxState(page);
  expect(s).toMatchObject({ smoke: 0, chars: 0, cuts: 0, contact: false, interference: true });
  expect(s.haze).toBe(0);
  await page.evaluate(() => window.__sim.m4?.press(false));
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

/** Longest straight run (rows + columns of an NDC grid) where the scope sees `prefix` meshes; null if none. */
const findRun = (page: Page, prefix: string) =>
  page.evaluate(
    ({ prefix, step }) => {
      const { m3, rig } = window.__sim;
      if (!m3 || !rig) return null;
      const n = Math.round(1.6 / step);
      const at = (i: number, j: number): boolean =>
        m3.picker.pick(-0.8 + i * step, -0.8 + j * step, rig.camera)?.nodeName.startsWith(prefix) ?? false;
      const grid = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => at(i, j)));
      let best = { len: 0, i: 0, j: 0, di: 0, dj: 0 };
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const)
        for (let i = 0; i <= n; i++)
          for (let j = 0; j <= n; j++) {
            let k = 0;
            while (grid[i + k * di]?.[j + k * dj]) k++;
            if (k > best.len) best = { len: k, i, j, di, dj };
          }
      if (best.len < 3) return null;
      const ndc = (k: number): [number, number] => [
        -0.8 + (best.i + k * best.di) * step,
        -0.8 + (best.j + k * best.dj) * step,
      ];
      // Trim one cell at each end: the path stays on the layer.
      return { from: ndc(1), to: ndc(best.len - 2), cells: best.len };
    },
    { prefix, step: 0.025 },
  );

const toPx = ([x, y]: [number, number]) => ({ x: ((x + 1) / 2) * 1280, y: ((1 - y) / 2) * 720 });

test('cautery contact sweep opens the hilar pleura (v7 sheet): openings, smoke, ECG interference; picks see through', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { errors, programs } = await boot(page, '/?view=scope&step=2');
  const before = await programs();
  await page.addStyleTag({ content: '.shell, #action-toast { visibility: hidden !important; }' });
  await page.evaluate((m) => {
    window.__sim.m3?.scope.insert(m); // closer than the step view: the opening fills more of the frame
    window.__sim.m3?.syncScope();
  }, SCOPE_IN_M);
  await frames(page, 3);
  const run = await findRun(page, 'mediastinal_pleura_hilum');
  expect(run).not.toBeNull();
  if (!run) return;
  const a = toPx(run.from);
  const b = toPx(run.to);
  await frames(page);
  const pre = await page.screenshot({ path: 'qa/screenshots/cautery-dissection-before.png' });

  // Cautery in hand, tip snapped onto the start of the run (the scope stays on the step view).
  const placed = await page.evaluate(async ([x, y]) => {
    const { m3, m4, rig } = window.__sim;
    if (!m3 || !m4 || !rig) return 'not wired';
    for (let i = 0; i < 10 && m4.tool !== 'cautery'; i++) m3.hotbar.select(i);
    const hit = m3.picker.pick(x, y, rig.camera);
    if (!hit) return 'no hit';
    const name = hit.nodeName;
    const point = hit.point.clone();
    let r = '';
    for (let k = 0; k < m3.scope.ports.length && r !== 'ok'; k++) {
      r = m4.snapTo(name, point);
      if (r !== 'ok') m4.nextToolPort();
    }
    while (m4.control.phase === 'inserting') await new Promise((f) => requestAnimationFrame(f));
    return r;
  }, run.from);
  expect(placed).toBe('ok');
  expect(await page.evaluate(() => window.__vitals?.interference)).toBe(false);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await frames(page);
  const touch = await fxState(page);
  expect(touch.contact).toBe(true);
  expect(touch.cuts).toBeGreaterThan(0);
  // Drag while energised: the hook rides the layer along the run.
  for (let i = 0; i <= SWEEP_STEPS; i++) {
    const t = i / SWEEP_STEPS;
    await page.mouse.move(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    await frames(page);
  }
  await page.waitForTimeout(HOLD_MS);
  const on = await fxState(page);
  expect(on.cuts).toBeGreaterThan(touch.cuts + 2); // openings laid along the path
  expect(on.smoke).toBeGreaterThan(0);
  expect(on.chars).toBeLessThan(on.cuts / 4); // the layer opens (rim, not decals); a sear only where it left it
  expect(on.haze).toBeLessThan(0.2); // light haze only, never a heavy veil
  expect(on.interference).toBe(true);
  await page.evaluate(() => window.__sim.m4?.press(false));
  await page.evaluate(() => {
    window.__sim.m4?.fx.suction(); // clear smoke + haze for the comparison
    window.__sim.m4?.fx.fog.clear();
    window.__sim.m4?.control.withdraw(); // tool out of the compared path
  });
  await page.waitForTimeout(800);
  await frames(page, 3);
  const post = await page.screenshot({ path: 'qa/screenshots/cautery-dissection-after.png' });

  // The swept path changed (opened layer + coagulated rim) and a click there reaches the structure beneath.
  const box = {
    left: Math.round(Math.min(a.x, b.x)) - 3,
    top: Math.round(Math.min(a.y, b.y)) - 3,
    width: Math.round(Math.abs(b.x - a.x)) + 6,
    height: Math.round(Math.abs(b.y - a.y)) + 6,
  };
  const m0 = await mean(pre, box.left, box.top, box.width, box.height);
  const m1 = await mean(post, box.left, box.top, box.width, box.height);
  expect(Math.max(...m0.map((v, i) => Math.abs(v - (m1[i] ?? v))))).toBeGreaterThan(6);
  const mid: [number, number] = [(run.from[0] + run.to[0]) / 2, (run.from[1] + run.to[1]) / 2];
  const through = await page.evaluate(([x, y]) => {
    const { m3, rig } = window.__sim;
    return rig ? (m3?.picker.pick(x, y, rig.camera)?.nodeName ?? null) : null;
  }, mid);
  expect(through).not.toBeNull();
  expect(through).not.toMatch(/^mediastinal_pleura_hilum/);
  await page.waitForFunction(() => window.__vitals?.interference === false, null, { timeout: 500 });
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('practice: energised contact on a minor bleed seals it ("Bleeding controlled")', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors, programs } = await boot(page, '/?mode=practice&view=scope');
  await page.waitForFunction(() => window.__sim.m5?.complications != null, null, { timeout: 60_000 });
  const before = await programs();
  await page.evaluate(() => window.__sim.setStep(3, true));
  expect(await page.evaluate(() => window.__sim.placeTool?.('cautery', 'hilar_connective_tissue'))).toBe(
    'ok',
  );
  // A minor bleed right under the tip (over-traction tear while an artery is encircled).
  const bleeds = await page.evaluate(() => {
    const c = window.__sim.m5?.complications;
    const p = window.__sim.m4?.control.tipPos;
    if (!c || !p) return -1;
    c.onAction({
      tool: 'clamp',
      subOption: null,
      target: 'middle_lobe_artery_A4',
      kind: 'encircle',
      point: p.clone(),
    });
    c.update(0.01, { suction: false, pressure: false, retract: 1 });
    return c.activeBleeds;
  });
  expect(bleeds).toBe(1);
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await page.waitForFunction(() => window.__sim.m5?.complications?.activeBleeds === 0, null, {
    timeout: 120_000,
  });
  expect(await page.evaluate(() => window.__sim.m5?.complications?.coagulated)).toBe(1);
  expect(await page.evaluate(() => window.__sim.m4?.lastToast)).toMatch(/^Bleeding controlled/);
  await page.evaluate(() => window.__sim.m4?.press(false));
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

test('switching mode while energised releases the cautery: ECG interference clears within 0.5 s', async ({
  page,
}) => {
  test.setTimeout(180_000); // SwiftShader
  const { errors, programs } = await boot(page, '/?view=scope&step=2');
  const before = await programs();
  expect(await page.evaluate(() => window.__sim.placeTool?.('cautery', 'hilar_connective_tissue'))).toBe(
    'ok',
  );
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await expect.poll(() => page.evaluate(() => window.__vitals?.interference)).toBe(true);
  await page.click('button[data-mode=explore]');
  await expect
    .poll(() => page.evaluate(() => window.__vitals?.interference), { timeout: 500, intervals: [50] })
    .toBe(false);
  expect(
    await page.evaluate(() => [window.__sim.state.cauteryActive, window.__sim.m4?.fx.energised]),
  ).toEqual([false, false]);
  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});
