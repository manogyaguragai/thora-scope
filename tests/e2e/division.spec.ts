import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T841: powered stapler on the middle lobe vein — jaws seat across the vein (⟂ its local axis), close, staples form
// heel → tip over time, the knife divides it into a proximal stump (on the vein tree) and a distal stump that stays
// with the lobe. Screenshots for the visual critic: t841-stapler-{open,closed,fired}.png, t841-stumps.png.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const SETTLE_MS = 600;
const CLOSE_MS = 450; // config.staple.closeMs + a frame
const VEIN = 'middle_lobe_vein';
/** T847b lens exclusion (interaction.config lens: 45 mm off the stapler's centre-line, 8 mm off slim instruments): no
 *  instrument vertex this close to the lens with the stapler in / in a step view. */
const STAPLER_CLEAR_MM = 35;
const LENS_CLEAR_MM = 5;
const STEP_COUNT = 9; // guided steps (src/content/procedure_steps.json)
/** Shots show the 3D canvas only. */
const HIDE_UI = '#app *{visibility:hidden!important}#app canvas{visibility:visible!important}';

const place = (page: Page, id: string, target: string, sub?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s]) => window.__sim.placeTool?.(i as string, t as string, s) ?? 'no helper',
    [id, target, sub],
  );
/** Nearest visible instrument vertex (of instrument group `only`, default any) to the scope lens, mm (+ which). */
const lensClearance = (page: Page, only = ''): Promise<{ mm: number; tool: string }> =>
  page.evaluate((only) => {
    const cam = window.__sim.rig?.camera;
    let root = window.__sim.stumps?.splits[0]?.segment as import('three').Object3D | undefined;
    while (root?.parent) root = root.parent;
    const inst = root?.getObjectByName('instruments');
    if (!cam || !inst) return { mm: -1, tool: 'not wired' };
    inst.updateMatrixWorld(true);
    const lens = cam.getWorldPosition(cam.position.clone());
    const v = lens.clone();
    let best = { mm: Infinity, tool: '' };
    for (const tool of inst.children)
      if (!only || tool.name === only)
        tool.traverseVisible((o) => {
          const m = o as import('three').Mesh;
          const p = m.isMesh ? m.geometry.getAttribute('position') : null;
          for (let i = 0; p && i < p.count; i++) {
            const mm = v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).distanceTo(lens) * 1000;
            if (mm < best.mm) best = { mm, tool: tool.name };
          }
        });
    return best;
  }, only);
const press = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    if (!m4) return 'not wired';
    const r = m4.press(true);
    m4.press(false);
    return r;
  });

/** Angle (deg) between the stapler jaws (head +Z, world) and the vein's local axis at the planned cut, measured
 *  independently of the app: principal axis of the vein vertices (current pose) within 3 radii of the cut (a tube
 *  segment several radii long, so the long axis dominates the cross-section). */
const jawAngle = (page: Page): Promise<number> =>
  page.evaluate((vein) => {
    const st = window.__sim.stumps;
    const sp = st?.split(vein);
    if (!st || !sp) return -1;
    let root = sp.segment as import('three').Object3D;
    while (root.parent) root = root.parent;
    const head = root.getObjectByName('stapler_head');
    if (!head) return -2;
    const jaw = head.getWorldDirection(head.position.clone());
    const c = jaw.clone();
    const r = st.cutAt(vein, c, jaw.clone());
    const seg = sp.segment;
    const pos = seg.geometry.getAttribute('position');
    const v = jaw.clone();
    const pts: number[][] = [];
    for (let i = 0; i < pos.count; i++) {
      seg.getVertexPosition(i, v).applyMatrix4(seg.matrixWorld);
      if (v.distanceTo(c) < 3 * r) pts.push([v.x, v.y, v.z]);
    }
    const m = [0, 1, 2].map((k) => pts.reduce((s, p) => s + (p[k] as number), 0) / pts.length);
    const cov = [0, 1, 2].map((a) =>
      [0, 1, 2].map(
        (b) =>
          pts.reduce(
            (s, p) => s + ((p[a] as number) - (m[a] as number)) * ((p[b] as number) - (m[b] as number)),
            0,
          ) / pts.length,
      ),
    );
    const diag = [0, 1, 2].map((k) => cov[k]?.[k] ?? 0);
    let x = [...(cov[diag.indexOf(Math.max(...diag))] ?? [1, 0, 0])]; // power iteration from the largest column
    for (let it = 0; it < 60; it++) {
      const y = [0, 1, 2].map((q) =>
        [0, 1, 2].reduce((s, k) => s + (cov[q]?.[k] ?? 0) * (x[k] as number), 0),
      );
      const n = Math.hypot(...y);
      x = y.map((q) => q / n);
    }
    const dot = Math.abs(jaw.x * (x[0] as number) + jaw.y * (x[1] as number) + jaw.z * (x[2] as number));
    const deg = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    console.log(
      `T841 jaws vs vein axis ${deg.toFixed(1)}° (r ${(r * 1000).toFixed(1)} mm, articulation ${((head.rotation.y * 180) / Math.PI).toFixed(1)}°)`,
    );
    return deg;
  }, VEIN);

test('T841 division: stapler across the vein, progressive staples, two stumps — no new programs', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('console', (m) => /^\[stumps\]|^T841/.test(m.text()) && console.log(m.text())); // split diagnostics
  await page.goto('/?mode=explore&view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  const splits = await page.evaluate(() => window.__sim.stumps?.splits.map((s) => s.segment.name) ?? []);
  console.log(`T841 split segments (${splits.length}): ${splits.join(', ')}`);
  expect(splits).toContain(VEIN);

  // Passage behind the vein (clamp), then the vascular stapler seats open across it.
  await page.evaluate(() => {
    window.__sim.m3?.scope.switchPort('port_camera_8ICS');
    window.__sim.m3?.syncScope();
  });
  expect(await place(page, 'clamp', VEIN)).toBe('ok');
  await press(page); // closes on it (passage made)
  await press(page); // opens again
  expect(await place(page, 'stapler', VEIN, 'vascular-curved')).toBe('ok');
  await page.addStyleTag({ content: HIDE_UI });
  await page.waitForTimeout(SETTLE_MS);
  // T847b: placeTool aims the lens ~45 mm short of the tip; the lens exclusion backs it off the 5 cm jaws.
  const clear = await lensClearance(page, 'instrument_stapler');
  console.log(`T847b stapler lens clearance ${clear.mm.toFixed(1)} mm (${clear.tool})`);
  expect(clear.mm).toBeGreaterThan(STAPLER_CLEAR_MM);
  const open = await jawAngle(page);
  expect(Math.abs(open - 90), `jaws vs vein axis ${open.toFixed(1)}°`).toBeLessThan(15);
  await page.screenshot({ path: `${SHOTS}/t841-stapler-open.png` });

  // Fire: close → compression pause → staples form over time → knife → two stumps. Staples formed are recorded
  // every frame in the page (screenshots stall the test side).
  await page.evaluate((v) => {
    const w = window as unknown as { t841: number[] };
    w.t841 = [];
    const tick = (): void => {
      const m4 = window.__sim.m4;
      if (!m4 || m4.flags.has(`divided:${v}`)) return;
      w.t841.push(m4.staples.revealed);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, VEIN);
  expect(await press(page)).toBe('ok');
  await page.waitForTimeout(CLOSE_MS);
  await page.screenshot({ path: `${SHOTS}/t841-stapler-closed.png` });
  await page.waitForFunction((v) => window.__sim.m4?.flags.has(`divided:${v}`) === true, VEIN, {
    timeout: 10_000,
  });
  const seen = await page.evaluate(() => (window as unknown as { t841: number[] }).t841);
  const perLine = await page.evaluate(() => window.__sim.m4?.staples.perLine ?? 0);
  const partial = seen.filter((n) => n > 0 && n < perLine);
  expect(partial.length, `revealed samples ${seen.join(',')}`).toBeGreaterThan(0); // formed progressively
  for (let i = 1; i < seen.length; i++)
    expect(seen[i] as number).toBeGreaterThanOrEqual(seen[i - 1] as number);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/t841-stapler-fired.png` });

  const st = await page.evaluate((vein) => {
    const s = window.__sim.stumps?.split(vein);
    if (!s) return null;
    const shown = (o: import('three').Object3D | null): boolean => {
      for (; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    // Distal piece still joined to the specimen: within 2 mm of the V4/V5 branches or the lobe (current pose).
    let root = s.segment as import('three').Object3D;
    while (root.parent) root = root.parent;
    const v = s.segment.position.clone();
    const pts = (m: import('three').Mesh, every: number): number[][] => {
      const out: number[][] = [];
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += every) {
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
        out.push([v.x, v.y, v.z]);
      }
      return out;
    };
    const others = ['middle_lobe_vein_V4', 'middle_lobe_vein_V5']
      .flatMap((n) => {
        const sp = window.__sim.stumps?.split(n);
        return sp ? [sp.proximal, sp.distal].filter((m) => shown(m)) : [];
      })
      .concat([root.getObjectByName('lung_middle_lobe_right') as import('three').Mesh]);
    const near = others.flatMap((m) => pts(m, 3));
    let gap = Infinity;
    for (const [ax = 0, ay = 0, az = 0] of pts(s.distal, 2))
      for (const [bx = 0, by = 0, bz = 0] of near) gap = Math.min(gap, Math.hypot(ax - bx, ay - by, az - bz));
    return {
      proximalPiece: shown(s.proximal),
      distalPiece: shown(s.distal),
      proximalStump: s.stump ? shown(s.stump.mesh) : false,
      distalStump: shown(s.cap),
      gapMm: gap * 1000,
    };
  }, VEIN);
  expect(st).toMatchObject({
    proximalPiece: false,
    distalPiece: true,
    proximalStump: true,
    distalStump: true,
  });
  expect(st?.gapMm ?? Infinity).toBeLessThan(2);

  await page.keyboard.press('Escape'); // stapler out: both stumps in view
  await page.waitForTimeout(SETTLE_MS * 2);
  await page.screenshot({ path: `${SHOTS}/t841-stumps.png` });

  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

// T847b: in every guided step view (static grasper, instruments the step shows) nothing sits at the lens.
test('T847b lens clearance in each step view', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?mode=explore&view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  for (let n = 1; n <= STEP_COUNT; n++) {
    await page.evaluate((k) => window.__sim.setStep(k, true), n);
    await page.waitForTimeout(SETTLE_MS); // the exclusion backs the lens off, easing (rig transition)
    await page.waitForFunction(() => window.__sim.rig?.transitioning === false);
    const c = await lensClearance(page);
    console.log(`T847b step ${n} lens clearance ${c.mm.toFixed(1)} mm (${c.tool || 'no instrument'})`);
    expect(c.mm, `step ${n}: ${c.tool}`).toBeGreaterThan(LENS_CLEAR_MM);
  }
});
