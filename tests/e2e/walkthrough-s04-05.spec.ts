import { expect, test } from '@playwright/test';
import { fmt, playStep } from './walkthroughShots';
import type { StepRun } from './walkthroughShots';

// T866 walkthrough steps 4 (nodes 11R/12R, bed ooze + coagulation) and 5 (bronchus passage, bronchial stapler, clamp
// test, fire). Key frames via the T882 shared harness → qa/screenshots/walkthrough/sNN-bMM-<id>[-mid].png. Every
// animation frame is sampled: lung reflected, a grasper holding, lens inside the chest. Working / result beats must
// pass the framing contract (R3).
test.use({ viewport: { width: 1280, height: 720 } });
/** T877: beats showing the outside-view inset (Beat.inset 'lungs': the middle lobe glowing, the others inflating). */
const INSET = new Set(['5:overview', '5:tlv']);
type Lobes = { RUL: number; RML: number; RLL: number };
interface Tally {
  frames: number;
  bad: string[];
  /** Deflation at the test breath's start (beat start) and at its height (first frame both other lobes filled). */
  tlv0: Lobes | null;
  clamp: Lobes | null;
  /** T885b: scope [depth m, zoom] at the end of step 5's close / overview beats; messages tagged with their beat. */
  lens: Record<string, [number, number]>;
  msgs: string[];
}

test('walkthrough steps 4–5: nodes out + bed sealed, bronchus clamp test then fire; framed, held, 0 new programs', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(() => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough');
    const st = window.__sim.state;
    const T: Tally = { frames: 0, bad: [], tlv0: null, clamp: null, lens: {}, msgs: [] };
    (window as unknown as { __t866: Tally }).__t866 = T;
    const lobes = (): Lobes => ({ RUL: st.deflate_RUL, RML: st.deflate_RML, RLL: st.deflate_RLL });
    const tlv = (): boolean => w.state().step === 5 && w.currentBeat()?.id === 'tlv';
    w.on('state', (s) => {
      if (!T.tlv0 && tlv()) T.tlv0 = lobes();
      const b = w.currentBeat();
      const sc = window.__sim.m3?.scope;
      if (s.step === 5 && sc && (b?.id === 'close' || b?.id === 'overview'))
        T.lens[b.id] = [sc.depth, sc.zoom];
    });
    w.on('msg', (s, text) => T.msgs.push(`s${s.step} ${w.currentBeat()?.id}: ${text}`));
    const frame = (): void => {
      requestAnimationFrame(frame);
      const s = w.state();
      if ((s.step !== 4 && s.step !== 5) || s.status === 'paused' || s.status === 'idle') return;
      T.frames++;
      if (!s.reflected || s.holds.length < 1 || !s.scopeInside)
        T.bad.push(
          `s${s.step} b${s.beat}: reflected ${s.reflected} holds ${s.holds.length} inside ${s.scopeInside}`,
        );
      if (!T.clamp && tlv() && st.deflate_RUL < 0.1 && st.deflate_RLL < 0.1) T.clamp = lobes();
    };
    requestAnimationFrame(frame);
  });
  const insets = (step: number, r: StepRun): void => {
    for (const x of r.shots)
      if (INSET.has(`${step}:${x.id}`))
        expect.soft(x.inset, `s${step} ${x.id} ${x.at}: outside-view inset shown`).not.toBeNull();
      else if (x.at !== 'end') expect.soft(x.inset, `s${step} ${x.id}: no inset`).toBeNull();
  };

  const s4 = await playStep(page, 4);
  insets(4, s4);
  for (const b of s4.beats) console.log(`s04 ${b.id}: ${JSON.stringify(b.end.framing)}`); // T885a: held / near too
  const after4 = await page.evaluate(() => ({
    specimens: window.__sim.m4?.finish.specimens ?? [],
    bed: (window.__sim.m4?.fx as { bed?: { state: string } } | undefined)?.bed?.state ?? null,
  }));
  const s5 = await playStep(page, 5);
  insets(5, s5);
  const after5 = await page.evaluate(() => ({
    divided: window.__sim.m4?.finish.bronchusDivided,
    tested: window.__sim.m4?.finish.bronchusTestPassed,
  }));
  const tally = await page.evaluate(() => (window as unknown as { __t866: Tally }).__t866);
  const framed = [s4, s5].flatMap((r) => r.beats).filter((b) => b.kind === 'working' || b.kind === 'result');
  for (const b of framed) console.log(`framing s${b.end.step} ${b.id}: ${fmt(b.end)}`);
  console.log(`frames ${tally.frames}, bad ${tally.bad.length}: ${tally.bad.slice(0, 5).join(' | ')}`);

  // R9: steps 4 and 5 start with the scope in the low camera port and the lobe held through the access incision.
  for (const [n, r] of [
    [4, s4],
    [5, s5],
  ] as const) {
    expect(r.start.scopePort, `step ${n} starts in the camera port`).toBe('port_camera_8ICS');
    expect(r.start.holds, `step ${n} hold`).toEqual([
      { port: 'port_utility_5ICS', target: 'lung_middle_lobe_right' },
    ]);
  }
  expect(s4.end.status, `step 4: ${s4.end.error}`).toBe('holding');
  expect(s5.end.status, `step 5: ${s5.end.error}`).toBe('holding');
  expect(after4.specimens).toEqual(expect.arrayContaining(['LN_11R', 'LN_12R']));
  if (after4.bed !== null) expect(after4.bed).toBe('coagulated');
  // T877: the lobe values change during the test-breath beat (seen in the inset): flat at its start, filled at height.
  console.log(`clamp test start (deflate): ${JSON.stringify(tally.tlv0)}`);
  console.log(`clamp test (deflate): ${JSON.stringify(tally.clamp)}`);
  expect(tally.tlv0?.RUL ?? 0).toBeGreaterThan(0.9);
  expect(tally.tlv0?.RLL ?? 0).toBeGreaterThan(0.9);
  expect(tally.tlv0?.RML ?? 0).toBeGreaterThan(0.9);
  expect(tally.clamp?.RUL ?? 1).toBeLessThan(0.15);
  expect(tally.clamp?.RLL ?? 1).toBeLessThan(0.15);
  expect(tally.clamp?.RML ?? 0).toBeGreaterThan(0.9);
  // T885b: the overview really eases back from the closed-stapler view (shallower lens or wider zoom); the clamp-test
  // message shows at the test breath's start.
  console.log(`s5 lens [depth, zoom]: ${JSON.stringify(tally.lens)}; msgs ${JSON.stringify(tally.msgs)}`);
  const [cd, cz] = tally.lens.close ?? [0, 0];
  const [od, oz] = tally.lens.overview ?? [1, 9];
  expect.soft(od < cd - 1e-4 || oz < cz - 1e-3, 's5 overview pulls back from the close view').toBe(true);
  expect.soft(tally.msgs).toContain('s5 tlv: Two-lung ventilation ON — clamp test');
  expect(after5.tested).toBe(true);
  expect(after5.divided).toBe(true);
  expect(tally.frames).toBeGreaterThan(0);
  expect(tally.bad).toEqual([]);
  for (const b of framed) expect.soft(b.end.framing?.pass, `framing s${b.end.step} ${b.id}`).toBe(true);
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});
