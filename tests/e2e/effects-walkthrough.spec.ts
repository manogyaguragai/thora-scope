import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

// T861 walkthrough effects: the subject glow (rim + soft outline, pulsing), the fissure band, and the node-bed ooze
// (drop + gravity rivulet + pool, no decal circle, no particles) darkened to a coagulum. 0 new programs throughout.
test.use({ viewport: { width: 1280, height: 720 } }); // look screenshots

const SHOT = 'qa/screenshots/walkthrough';
const FADE_MS = 300;
const GLOW_MS = 900; // fade in + part of a pulse
const OOZE_MS = 7000; // drop, rivulet and part of the pool grown (config.effects.bed.oozeSec 10 s)
const COAG_MS = 1600; // > bed.coagSec
const SAMPLE_PX = 2; // half-size of the colour sample square
const SEARCH_PX = 40; // half-size of the window searched for the blood (barrel distortion shifts the projection)

const programs = (page: Page): Promise<number> => page.evaluate(() => window.__perf.programs);

/** Snap the scope (its current port) to look at world `at` from `share` of the way pleura → at (`fromLens`: from
 *  the current lens position, keeping the step view's line of sight). */
const aim = (page: Page, at: readonly number[], share: number, fromLens = false): Promise<void> =>
  page.evaluate(
    ([q, k, lens]) => {
      const m3 = window.__sim.m3;
      const cam = window.__sim.rig?.camera;
      if (!m3 || !cam) return;
      const target = m3.scope.port.pleura.clone().set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0);
      const position = (lens ? cam.position : m3.scope.port.pleura).clone().lerp(target, k as number);
      const m = cam.matrix.clone().lookAt(position, target, cam.up.clone().set(0, 1, 0));
      const quaternion = cam.quaternion.clone().setFromRotationMatrix(m);
      m3.scope.snapTo({ position, quaternion, fov: m3.scope.fovDeg }, m3.scope.port.id);
      m3.syncScope();
    },
    [at, share, fromLens] as const,
  );
const AIM_SHARE = 0.3; // from the step-1 lens, a third of the way in toward the subject
const BED_AIM_SHARE = 0.5; // half-way in from the step-4 lens toward the node bed

/** World centre of node `name`'s meshes (bounding spheres, mean). */
const centreOf = (page: Page, name: string): Promise<number[]> =>
  page.evaluate((n) => {
    const ms = window.__sim.m3?.picker.meshes.filter((m) => m.name === n || m.parent?.name === n) ?? [];
    const c = [0, 0, 0];
    for (const m of ms) {
      m.geometry.computeBoundingSphere();
      const p = m.geometry.boundingSphere?.center.clone().applyMatrix4(m.matrixWorld);
      if (p) p.toArray().forEach((v, i) => (c[i] = (c[i] ?? 0) + v / ms.length));
    }
    return c;
  }, name);

/** Screen pixel (CSS px) of world point `p` through the rig camera. */
const toPx = (page: Page, p: readonly number[]): Promise<[number, number]> =>
  page.evaluate((q) => {
    const cam = window.__sim.rig?.camera;
    const v = window.__sim.m4?.control.tipPos.clone().set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0);
    if (!cam || !v) return [0, 0];
    v.project(cam);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }, p) as Promise<[number, number]>;

const hex = (c: readonly number[]): string =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Reddest pixel (r − (g + b) / 2) within SEARCH_PX of `at`: the blood drop. */
async function reddest(png: Buffer, [x, y]: [number, number]): Promise<[number, number]> {
  const left = Math.max(0, Math.round(x) - SEARCH_PX);
  const top = Math.max(0, Math.round(y) - SEARCH_PX);
  const { data, info } = await sharp(png)
    .extract({ left, top, width: 2 * SEARCH_PX, height: 2 * SEARCH_PX })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let best: [number, number] = [x, y];
  let score = -Infinity;
  for (let j = 0; j < info.height; j++)
    for (let i = 0; i < info.width; i++) {
      const k = (j * info.width + i) * info.channels;
      const s = (data[k] ?? 0) - ((data[k + 1] ?? 0) + (data[k + 2] ?? 0)) / 2;
      if (s > score) [score, best] = [s, [left + i, top + j]];
    }
  return best;
}

/** Mean colour of the (2·SAMPLE_PX+1)² square at `at`. */
async function hexAt(png: Buffer, [x, y]: [number, number]): Promise<string> {
  const crop = await sharp(png)
    .extract({ left: x - SAMPLE_PX, top: y - SAMPLE_PX, width: 2 * SAMPLE_PX + 1, height: 2 * SAMPLE_PX + 1 })
    .toBuffer();
  return hex((await sharp(crop).stats()).channels.slice(0, 3).map((c) => c.mean));
}

test('T861 highlight glow, fissure band, node-bed ooze → coagulum: no new programs', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?mode=explore&view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true && window.__sim.highlight != null, null, {
    timeout: 120_000,
  });
  await page.addStyleTag({ content: '.shell, #action-toast { visibility: hidden !important; }' });
  const before = await programs(page);

  await aim(page, await centreOf(page, 'lung_middle_lobe_right'), AIM_SHARE, true);
  await page.evaluate((ms) => window.__sim.highlight?.show(['lung_middle_lobe_right'], ms), FADE_MS);
  await page.waitForTimeout(GLOW_MS);
  expect(await page.evaluate(() => window.__sim.highlight?.active)).toBe('lung_middle_lobe_right');
  await page.screenshot({ path: `${SHOT}/fx-highlight.png` });
  const glowPrograms = await programs(page);

  // The oblique fissure band faces the step-1 lens (the horizontal one is framed by the walkthrough's own move).
  await page.evaluate(() => window.__sim.setStep(1, true));
  await page.evaluate((ms) => window.__sim.highlight?.show({ fissure: 'oblique' }, ms), FADE_MS);
  await page.waitForFunction(() => window.__sim.highlight?.active === 'fissure:oblique');
  await page.waitForTimeout(GLOW_MS);
  await page.screenshot({ path: `${SHOT}/fx-fissure.png` });
  await page.evaluate((ms) => window.__sim.highlight?.hide(ms), FADE_MS);
  await page.waitForFunction(() => window.__sim.highlight?.active === null);

  // Node bed: step 4, node 11R taken away (hidden), the bed = the nearest visible surface under its centre.
  await page.evaluate(() => window.__sim.setStep(4, true));
  await page.waitForTimeout(500); // step pose + pick BVH settle
  const bed = await page.evaluate(() => {
    const m3 = window.__sim.m3;
    const node = m3?.picker.meshes.find((m) => m.name === 'LN_11R');
    if (!m3 || !node) return null;
    node.geometry.computeBoundingSphere();
    const c = node.geometry.boundingSphere?.center.clone().applyMatrix4(node.matrixWorld);
    node.visible = false;
    const hit = c ? m3.picker.nearest(c, 0.03) : null;
    return hit ? hit.point.toArray() : null;
  });
  expect(bed).not.toBeNull();
  if (!bed) return;
  await aim(page, bed, BED_AIM_SHARE, true);
  await page.evaluate(([x, y, z]) => window.__sim.m4?.fx.bed.ooze({ x, y, z }), bed);
  expect(await page.evaluate(() => window.__sim.m4?.fx.bed.state)).toBe('oozing');
  await page.waitForTimeout(OOZE_MS);
  const px = await toPx(page, bed);
  const ooze = await page.screenshot({ path: `${SHOT}/fx-ooze.png` });
  const particles = await page.evaluate(() => window.__sim.m4?.fx.ooze.aliveCount);
  expect(particles).toBe(0);

  await page.evaluate(() => window.__sim.m4?.fx.bed.coagulate());
  await page.waitForTimeout(COAG_MS);
  expect(await page.evaluate(() => window.__sim.m4?.fx.bed.state)).toBe('coagulated');
  const coag = await page.screenshot({ path: `${SHOT}/fx-coag.png` });
  const at = await reddest(ooze, px);
  console.log(`bed px ${at.join(',')} · ooze ${await hexAt(ooze, at)} · coagulum ${await hexAt(coag, at)}`);

  await page.evaluate(() => window.__sim.m4?.fx.bed.set('none'));
  expect(glowPrograms).toBe(before);
  expect(await programs(page)).toBe(before);
  expect(errors).toEqual([]);
});

/** Walkthrough: seek(step, beat) at ×WALK_SCALE and pause as soon as the beat after `beat` starts (end of `beat`)
 *  or the step holds at its end. */
const WALK_SCALE = 10;
const runTo = (page: Page, step: number, beat: number, from = beat): Promise<void> =>
  page.evaluate(
    ([n, b, f, scale]) =>
      new Promise<void>((resolve) => {
        const w = window.__sim.walkthrough;
        if (!w) throw new Error('no walkthrough');
        w.timeScale = scale as number;
        let started = false; // seek's own rebuild states come first
        const off = w.on('state', (s) => {
          if (s.step === n && s.status === 'playing') started = true;
          if (!started) return;
          if (
            (s.step === n && (s.beat > (b as number) || s.status === 'holding')) ||
            s.step > (n as number)
          ) {
            w.pause();
            off();
            resolve();
          }
        });
        void w.seek(n as number, f as number);
      }),
    [step, beat, from, WALK_SCALE] as const,
  );
const STEP_END = 99; // runTo(step, STEP_END, 0) plays the whole step (it pauses when the step holds)
const SETTLE_MS = 400; // a few rendered frames after a pose change
/** Bag progress per screenshot (retrievalBag phase ends: open 0.25, lobe in 0.6, closed 0.72). */
const BAG_LOBE_FROM = 0.25; // retrievalBag phase.open: the lobe (and its carrier) starts moving after this
const BAG_SHOTS = [
  ['open', 0.24],
  ['lobe-in', 0.5],
  ['out', 0.78],
] as const;

test('T872 retrieval bag, horizontal fissure on the camera side, vein close-up: no new programs', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope');
  await page.waitForFunction(() => window.__perf?.ready === true && window.__sim.walkthrough != null, null, {
    timeout: 120_000,
  });
  await page.addStyleTag({ content: '.shell, #action-toast { visibility: hidden !important; }' });
  const before = await programs(page);

  // Vein (step 3, end of the peanut beat: the freed vein, highlighted).
  await runTo(page, 3, 7);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-vein-closeup.png` });
  const vein = await centreOf(page, 'middle_lobe_vein');
  console.log(`vein centre px ${(await toPx(page, vein)).map(Math.round).join(',')}`);

  // Step 4 played whole (both nodes out, ooze, cautery in → coagulate → out): every bed sealed, nothing left wet.
  await runTo(page, 4, STEP_END, 0);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-coag-walk.png` });
  console.log(
    'after step-4 coag: ' +
      (await page.evaluate(() => {
        const m4 = window.__sim.m4;
        return `cuts ${m4?.cuts.count} char ${m4?.fx.char.count} beds ${m4?.fx.beds.map((b) => b.timeline.state).join(',')}`;
      })),
  );
  expect(await page.evaluate(() => window.__sim.m4?.fx.oozing)).toBe(0);

  // Horizontal fissure (step 7): the guide beat, then after its two fires.
  await runTo(page, 7, 1);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-fissure-horizontal.png` });
  /** Per guide segment: some of it in the aperture and not hidden (first surface along the line of sight, 4 mm
   *  slack: the staples sit on the surface). */
  const segView = (): Promise<{ inView: boolean; seen: boolean; tag: string }[]> =>
    page.evaluate(() => {
      const cam = window.__sim.rig?.camera;
      const m3 = window.__sim.m3;
      return (window.__sim.fissure?.segments ?? []).map((s) => {
        if (!cam || !m3) return { inView: false, seen: false, tag: 'no camera' };
        // Any point of the staple line (its ends + path points) in the aperture and unhidden counts.
        let inView = false;
        let seen = false;
        let by = '';
        for (const p of s.points) {
          const v = p.clone().project(cam);
          if (Math.abs(v.x) >= 1 || Math.abs(v.y) >= 1) continue;
          inView = true;
          const hit = m3.picker.pick(v.x, v.y, cam);
          if (!hit || hit.point.distanceTo(cam.position) >= cam.position.distanceTo(p) - 0.004) seen = true;
          else by = hit.nodeName;
        }
        const m = s.mid.clone().project(cam);
        return { inView, seen, tag: `${m.x.toFixed(2)},${m.y.toFixed(2)} ${seen ? 'seen' : `hid(${by})`}` };
      });
    });
  const logView = async (at: string): Promise<{ inView: boolean; seen: boolean }[]> => {
    const v = await segView();
    console.log(
      `${at}: guide segments ${v.map((x, i) => `${i}:${x.tag}${x.inView ? '' : ' OUT'}`).join(' · ')}`,
    );
    return v;
  };
  await logView('guide beat');
  await runTo(page, 7, 4);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-fissure-horizontal-fired.png` });
  expect(await page.evaluate(() => window.__sim.fissure?.fired)).toBeGreaterThanOrEqual(2);
  // R8: both horizontal fires lie on the side the step-7 lens sees.
  for (const x of (await logView('after seg-2')).slice(0, 2)) expect(x.inView && x.seen).toBe(true);
  await runTo(page, 7, 8);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-fissure-all-fired.png` });
  await logView('after seg-4');
  await runTo(page, 7, STEP_END, 9); // stapler out: the four staple lines in the step's last view
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-fissure-stapled.png` });
  await logView('step 7 end');

  // Bag (step 8): the engine plays the bag beat through m4.fx.bag.play(lobe, port, t); paused at chosen t.
  await runTo(page, 8, 3);
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOT}/fx-bag-released.png` }); // lobe dropped: its staple rows on it
  for (const [name, t] of BAG_SHOTS) {
    await page.evaluate(
      (k) =>
        new Promise<void>((resolve) => {
          const w = window.__sim.walkthrough;
          const bag = window.__sim.m4?.fx.bag;
          if (!w || !bag) throw new Error('no bag');
          const play = bag.play.bind(bag);
          bag.play = (lobe, port, e) => {
            const r = play(lobe, port, e);
            if (e >= k) {
              bag.play = play;
              w.pause();
              resolve();
            }
            return r;
          };
          w.play();
        }),
      t,
    );
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: `${SHOT}/fx-bag-${name}.png` });
    // T872b: what sits on the specimen (lobe-side fissure rows, distal stumps) rides the carrier with the lobe.
    const carried = await page.evaluate(() => {
      const lobe = window.__sim.m3?.picker.meshes.find((m) => m.name === 'lung_middle_lobe_right');
      const c = lobe?.parent?.getObjectByName('carrier_lung_middle_lobe_right');
      return c ? !c.matrix.equals(c.matrix.clone().identity()) : null;
    });
    expect(carried).not.toBeNull();
    if (t > BAG_LOBE_FROM) expect(carried).toBe(true);
  }
  await runTo(page, 8, 4, 4); // replays the bag beat to its end
  expect(await page.evaluate(() => window.__sim.m4?.fx.bag?.playing)).toBe(false);
  expect(await page.evaluate(() => window.__sim.m4?.finish.lobeRemoved)).toBe(true);
  expect(await programs(page)).toBe(before);
  expect(errors).toEqual([]);
});
