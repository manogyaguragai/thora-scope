import { expect, test } from '@playwright/test';
import { fmt, playStep } from './walkthroughShots';

// T867 walkthrough step 6 (FEEDBACK_GUIDED_v1 §2.5 step 6, R1, R3): middle lobe arteries A4/A5. Key frames via the
// T882 shared harness (s06-bMM-<id>[-mid].png). Framing passes on working / result beats; the lung stays reflected
// with a grasper holding and the lens inside the chest on every frame; the artery ends divided.
test.use({ viewport: { width: 1280, height: 720 } });

test('walkthrough step 6: arteries framed, tunnel, square stapler, divided; reflection held every frame', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.text().includes('[stumps]')) console.log(`s06 page: ${m.text()}`);
  });
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(() => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough hook');
    const rec = { frames: 0, bad: [] as string[] };
    (window as unknown as { __s06: typeof rec }).__s06 = rec;
    // Lens outside: shaft angle off the port axis (pivot cone) and lens depth vs the tissue limit along the shaft.
    const why = (): string => {
      const sc = window.__sim.m3?.scope;
      const cam = window.__sim.rig?.camera;
      if (!sc || !cam) return '';
      const d = cam.position.clone().sub(sc.port.pleura);
      const depth = d.length();
      d.divideScalar(depth);
      const cone = (Math.acos(d.dot(sc.port.axis)) * 180) / Math.PI;
      const lim = sc.limit ? sc.limit(sc.port.pleura, d) : Infinity;
      return ` (${sc.port.id} cone ${cone.toFixed(0)}° depth ${depth.toFixed(3)} limit ${lim.toFixed(3)})`;
    };
    const tick = (): void => {
      requestAnimationFrame(tick);
      const s = w.state();
      if (s.step !== 6 || s.status === 'idle' || s.status === 'holding') return;
      rec.frames++;
      if (!s.reflected || s.holds.length < 1)
        rec.bad.push(`b${s.beat} refl ${s.reflected} holds ${s.holds.length}`);
      if (!s.scopeInside) rec.bad.push(`b${s.beat} outside${why()}`);
    };
    requestAnimationFrame(tick);
  });
  const run = await playStep(page, 6);
  const r = await page.evaluate(() => {
    const m4 = window.__sim.m4;
    const o = m4?.occupancy;
    const ports = ['port_camera_8ICS', 'port_utility_5ICS', 'port_retraction_8ICS'];
    return {
      rec: (window as unknown as { __s06: { frames: number; bad: string[] } }).__s06,
      divided: m4?.flags.has('divided:middle_lobe_artery'),
      finish: m4?.finish.arteryDivided,
      angles: ports.map((p) => `${p} ${o?.approachDeg('middle_lobe_artery', p).toFixed(0)}°`).join(', '),
      // Division pieces (stumps.ts split): proximal hidden, its stump shown; the distal piece + cap stay on the lobe.
      pieces: ['middle_lobe_artery', 'middle_lobe_artery_A4', 'middle_lobe_artery_A5'].map((n) => {
        const sp = window.__sim.stumps?.split(n);
        const shown = (m: { visible: boolean; parent: unknown } | null | undefined): boolean => {
          for (let x = m as { visible: boolean; parent: unknown } | null; x; x = x.parent as typeof x)
            if (!x.visible) return false;
          return !!m;
        };
        return sp
          ? `${n}: proximal ${shown(sp.proximal)} distal ${shown(sp.distal)} cap ${shown(sp.cap)} divided ${sp.divided} carried ${sp.carried}`
          : `${n}: no split`;
      }),
    };
  });
  console.log(`s06 artery stapler approach (rest point): ${r.angles}`);
  console.log(`s06 division: ${r.pieces.join(' | ')}`);
  for (const b of run.beats) {
    // Hand instrument + its port at the beat end (withdrawal check).
    const tool = `${b.end.tool ?? '-'}@${b.end.toolPort ?? '-'}`;
    console.log(`s06 b${b.index} ${b.id} (${b.kind}): ${fmt(b.end)}; hand ${tool}`);
    if (b.kind === 'withdraw') expect.soft(tool, `${b.id}: instrument withdrawn`).toMatch(/^-@/);
  }
  console.log(`s06: ${run.end.status} ${run.end.error ?? ''}; ${r.rec.frames} frames`);
  expect(run.end.status, run.end.error ?? '').toBe('holding');
  for (const b of run.beats)
    if (b.kind === 'working' || b.kind === 'result')
      expect.soft(b.end.framing?.pass, `framing ${b.id}: ${JSON.stringify(b.end.framing)}`).toBe(true);
  expect(r.rec.frames).toBeGreaterThan(0);
  const bad = [...new Set(r.rec.bad)].map((x) => `${x} ×${r.rec.bad.filter((y) => y === x).length}`);
  expect.soft(bad, 'reflected + a grasper holding + lens inside, every frame').toEqual([]);
  expect(r.divided).toBe(true);
  expect(r.finish).toBe(true);
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});
