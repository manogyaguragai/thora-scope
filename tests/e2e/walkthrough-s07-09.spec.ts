import { expect, test } from '@playwright/test';
import { SCALE, fmt, playStep } from './walkthroughShots';

// T868 walkthrough steps 7–9 (FEEDBACK_GUIDED_v1 §2.5, R1, R3): key frames via the T882 shared harness
// (qa/screenshots/walkthrough/sNN-bMM-<id>[-mid].png). Step 7: lung reflected + a retractor holding in every frame;
// working / result beats pass the framing contract; scope inside the chest; step 9: the lens stays above the saline
// (≥ 5 mm above its full line until the sucker comes in); no new shader programs.
test.use({ viewport: { width: 1280, height: 720 } });
const LENS_ABOVE_M = 0.005; // T844
/** Working / result beats without a framing subject: the bag beat (its subject leaves with the bag) and step 9's
 *  saline beats, held in the authored leak-test view above the water (T844). */
const NO_SUBJECT = new Set(['s08:bag', 's09:irrigate', 's09:leak-test', 's09:suction']);
const SUCKER_BEAT = 4; // step 9: beats before it hold the leak-test view (irrigate, leak test, OLV)

test('walkthrough steps 7–9: fissures, lobe out, irrigate / leak test / suction; framed, held, lens dry', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(
    ([above, sucker]) => {
      const w = window.__sim.walkthrough;
      if (!w) throw new Error('no walkthrough hook');
      const bad: Record<number, string[]> = { 7: [], 8: [], 9: [] };
      (window as unknown as { __s0709: typeof bad }).__s0709 = bad;
      const lens = (): number =>
        (window.__sim.rig?.camera.position.y ?? 0) - (window.__sim.m4?.water.topY ?? 0);
      const frame = (): void => {
        requestAnimationFrame(frame);
        const s = w.state();
        const n = s.step;
        const t = bad[n];
        if (!t || s.status === 'idle' || s.status === 'paused' || s.status === 'holding') return;
        if (!s.scopeInside) {
          const sc = window.__sim.m3?.scope;
          const lensP = window.__sim.rig?.camera.position;
          const dir = sc && lensP ? lensP.clone().sub(sc.port.pleura).normalize() : null;
          const lim = sc && dir ? (sc.limit?.(sc.port.pleura, dir) ?? Infinity) : NaN;
          const ang = sc && dir ? (Math.acos(dir.dot(sc.port.axis)) * 180) / Math.PI : NaN;
          t.push(
            `beat ${s.beat}: scope outside / in tissue (${sc?.port.id} depth ${sc?.depth.toFixed(3)} limit ${lim.toFixed(3)} ${ang.toFixed(0)}°)`,
          );
        }
        if (n === 7 && !s.reflected) t.push(`beat ${s.beat}: not reflected`);
        if (n === 7 && s.holds.length < 1) t.push(`beat ${s.beat}: no retractor holding`);
        // Above the saline throughout; ≥ 5 mm above its full line (T844) until the sucker comes in.
        const y = window.__sim.rig?.camera.position.y ?? 0;
        const surface = window.__sim.m4?.water.surfaceY ?? 0;
        if (
          n === 9 &&
          (y <= surface || (s.beat < sucker && window.__sim.m4?.finish.fluidFilled && lens() < above))
        )
          t.push(`beat ${s.beat}: lens ${(lens() * 1000).toFixed(1)} mm from the saline line`);
      };
      requestAnimationFrame(frame);
    },
    [LENS_ABOVE_M, SUCKER_BEAT] as const,
  );
  const finish = () =>
    page.evaluate(() => {
      const f = window.__sim.m4?.finish;
      return { fires: f?.fissureFires, free: f?.lobeFree, removed: f?.lobeRemoved };
    });

  for (const step of [7, 8, 9]) {
    const t0 = Date.now();
    const r = await playStep(page, step);
    const bad = await page.evaluate(
      (n) => [...new Set((window as unknown as { __s0709: Record<number, string[]> }).__s0709[n])],
      step,
    );
    console.log(`step ${step}: ${r.end.status} ${r.end.error ?? ''} in ${Date.now() - t0} ms (×${SCALE})`);
    for (const b of r.beats) {
      const key = `s${String(step).padStart(2, '0')}:${b.id}`;
      if ((b.kind === 'working' || b.kind === 'result') && !NO_SUBJECT.has(key))
        expect.soft(b.end.framing?.pass, `${key}: framing ${fmt(b.end)}`).toBe(true);
    }
    expect.soft(r.end.status, r.end.error ?? '').toBe('holding');
    expect.soft(bad, `step ${step}`).toEqual([]);
    if (step === 7) expect.soft(await finish()).toMatchObject({ fires: 4, free: true });
    if (step === 8) expect.soft(await finish()).toMatchObject({ removed: true });
  }
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});
