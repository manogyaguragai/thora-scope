import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WALK_STEPS } from '../../src/app/walkthrough/steps';
import type { WalkState } from '../../src/app/walkthrough/types';

// T860 walkthrough engine (FEEDBACK_GUIDED_v1 §2.1): guided mode plays the step timelines in place. seek(N) rebuilds
// steps 1…N-1 instantly (no reload: a window marker survives), the reflection is held by a grasper in its port, the
// scope stays inside the chest, and every step plays to its final pose. Fast-forwarded with timeScale.
test.use({ viewport: { width: 1280, height: 720 } });
const SHOTS = 'qa/screenshots/walkthrough';
const SCALE = 10;

const ready = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });

interface Run {
  s: WalkState;
  ms: number;
  marker: unknown;
  /** Graspers drawn (left in ports + in hand), min / max over the step's frames (a hand-off shows both). */
  held: [number, number];
  framing: {
    step: number;
    beat: number;
    id: string;
    pass: boolean;
    cov: number;
    off: number[];
    un: number;
    spill: number;
    nearM: number;
  }[];
}

/** seek(step) at timeScale `k`, Next through pause beats, until the step holds (or fails). */
const play = (page: Page, step: number, k = SCALE): Promise<Run> =>
  page.evaluate(
    async ([n, scale]) => {
      const w = window.__sim.walkthrough;
      if (!w) throw new Error('no walkthrough hook');
      w.timeScale = scale as number;
      const framing: Run['framing'] = [];
      let seen = 0;
      const off = w.on('state', (s) => {
        const b = w.currentBeat();
        if (s.done <= seen) return;
        seen = s.done; // a beat just finished: its framing
        if (s.framing && b)
          framing.push({
            step: s.step,
            beat: s.beat,
            id: b.id,
            pass: s.framing.pass,
            cov: Math.round(s.framing.coverage * 1000) / 1000,
            off: s.framing.offset.map((v) => Math.round(v * 100) / 100),
            un: Math.round(s.framing.unoccluded * 100) / 100,
            // T870 extras (MutableFraming): spill past the aperture, lens-to-subject distance.
            spill: Math.round(((s.framing as { spill?: number }).spill ?? -1) * 100) / 100,
            nearM: Math.round(((s.framing as { nearM?: number }).nearM ?? -1) * 1000) / 1000,
          });
      });
      const held: [number, number] = [Infinity, 0];
      let sampling = true;
      const sample = (): void => {
        const m4 = window.__sim.m4;
        const h = (m4?.heldShown() ?? 0) + (m4?.tool === 'grasper' ? 1 : 0); // graspers drawn
        held[0] = Math.min(held[0], h);
        held[1] = Math.max(held[1], h);
        if (sampling) requestAnimationFrame(sample);
      };
      const t0 = performance.now();
      await w.seek(n as number);
      sample();
      let s = await w.settle('step');
      while (s.status === 'waiting') {
        w.next();
        s = await w.settle('step');
      }
      off();
      sampling = false;
      return {
        s,
        ms: performance.now() - t0,
        marker: (window as unknown as { __marker?: unknown }).__marker,
        held,
        framing,
      };
    },
    [step, k] as const,
  );

test('walkthrough: seek 1…9 in place (no reload), each step plays to its final pose; holds, reflection, scope inside', async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let navigations = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && navigations++);
  await page.goto('/?view=scope&step=1');
  await ready(page);
  const nav0 = navigations;
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 860));
  const programs = await page.evaluate(() => window.__perf.programs);
  // Stapler approach per target and port (rest points): which ports the step data may use.
  console.log(
    await page.evaluate(() => {
      const o = window.__sim.m4?.occupancy;
      const ports = ['port_camera_8ICS', 'port_utility_5ICS', 'port_retraction_8ICS'];
      const ts = ['middle_lobe_vein', 'middle_lobe_artery', 'middle_lobe_bronchus'];
      return ts
        .map((t) => `${t}: ${ports.map((p) => `${p} ${o?.approachDeg(t, p).toFixed(0)}°`).join(', ')}`)
        .join('\n');
    }),
  );
  for (let step = 1; step <= 9; step++) {
    const r = await play(page, step);
    console.log(
      `step ${step}: ${r.s.status} ${r.s.error ?? ''} in ${Math.round(r.ms)} ms (×${SCALE}); held ${r.held}; scope ${r.s.scopePort}; holds ${JSON.stringify(r.s.holds)}; reflected ${r.s.reflected}; inside ${r.s.scopeInside}`,
    );
    for (const f of r.framing) console.log(`  framing s${f.step} ${f.id}: ${JSON.stringify(f)}`);
    await page.screenshot({ path: `${SHOTS}/engine-s${String(step).padStart(2, '0')}.png` });
    expect(r.marker, 'no page reload').toBe(860);
    expect.soft(r.s.status, `step ${step}: ${r.s.error}`).toBe('holding');
    expect.soft(r.s.step).toBe(step);
    expect.soft(r.s.scopeInside, `step ${step}: scope inside the chest`).toBe(true);
    if (step >= 3 && step <= 7)
      expect.soft(r.held[0], `step ${step}: the lung is never let go`).toBeGreaterThan(0);
    // R9 (T874): hand-offs are step data; assert both graspers only where a step still plays one.
    if (WALK_STEPS.find((x) => x.step === step)?.beats.some((b) => b.act?.k === 'handoff'))
      expect.soft(r.held[1], `step ${step}: hand-off shows both graspers`).toBe(2);
    if (step >= 2 && step <= 7) {
      expect.soft(r.s.holds.length, `step ${step}: a grasper holds the lung`).toBeGreaterThan(0);
      expect.soft(r.s.reflected, `step ${step}: lung reflected`).toBe(true);
    }
  }
  const f = await page.evaluate(() => ({
    vein: window.__sim.m4?.flags.has('divided:middle_lobe_vein'),
    nodes: window.__sim.m4?.finish.specimens,
    lobeRemoved: window.__sim.m4?.finish.lobeRemoved,
  }));
  expect(f.vein).toBe(true);
  expect(f.nodes).toEqual(expect.arrayContaining(['LN_11R', 'LN_12R']));
  expect(f.lobeRemoved).toBe(true);
  expect(navigations).toBe(nav0);
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});

test('walkthrough: seek(3) rebuilds in place (grasper holding, reflected, scope inside); seek(5) then Prev replays step 4', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.goto('/?view=scope&step=1');
  await ready(page);
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 3));
  const s3 = await page.evaluate(async () => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough hook');
    w.timeScale = 12;
    await w.seek(3);
    return { s: w.state(), marker: (window as unknown as { __marker?: number }).__marker };
  });
  expect(s3.marker).toBe(3);
  expect(s3.s.step).toBe(3);
  // Step data is the authors': expect what step 2 leaves and where step 3 starts.
  const s2 = WALK_STEPS.find((x) => x.step === 2);
  expect(s3.s.holds).toEqual((s2?.end.holds ?? []).map((h) => ({ port: h.port, target: h.target })));
  expect(s3.s.reflected).toBe(true);
  expect(s3.s.scopeInside).toBe(true);
  expect(s3.s.scopePort).toBe(WALK_STEPS.find((x) => x.step === 3)?.scopePort);
  const s4 = await page.evaluate(async () => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough hook');
    await w.seek(5);
    w.prev();
    await new Promise((r) => setTimeout(r, 200));
    return w.state();
  });
  expect(s4.step).toBe(4);
  expect(['playing', 'holding']).toContain(s4.status);
  expect(s4.beat).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__sim.m4?.finish.specimens.length)).toBe(0); // step 4 replays from its start
});

test('walkthrough: pause freezes the engine and m4 (instrument tip still), play resumes', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?view=scope&step=1');
  await ready(page);
  const tip = () =>
    page.evaluate(() => ({
      tip: window.__sim.m4?.control.tipPos.toArray() ?? [],
      beat: window.__sim.walkthrough?.state().beat,
    }));
  await page.evaluate(async () => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough hook');
    w.timeScale = 1;
    await w.seek(3);
  });
  await page.waitForFunction(() => window.__sim.m4?.tool !== null, null, { timeout: 120_000 }); // cautery coming in
  await page.evaluate(() => window.__sim.walkthrough?.pause());
  const a = await tip();
  await page.waitForTimeout(1500);
  const b = await tip();
  expect(b.beat).toBe(a.beat);
  b.tip.forEach((v, i) => expect(v).toBeCloseTo(a.tip[i] ?? NaN, 9)); // frozen (re-aimed from the same pose)
  expect(await page.evaluate(() => window.__sim.walkthrough?.state().status)).toBe('paused');
  await page.evaluate(() => window.__sim.walkthrough?.play());
  await expect.poll(async () => (await tip()).tip, { timeout: 30_000 }).not.toEqual(a.tip);
});
