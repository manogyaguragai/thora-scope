import { expect, test } from '@playwright/test';
import { fmt, playStep } from './walkthroughShots';

// T864 guided walkthrough steps 1–2 (FEEDBACK_GUIDED_v1 §2.5, §4, R1/R3/R4). Step 1: six parts advanced by Next,
// each framed (R3) with the rail at n/6. Step 2: scope back to the low camera port, retractor in through the access
// incision, the lung reflected and held, the hilum framed, the mediastinal pleura opened with the hook. Key frames →
// qa/screenshots/walkthrough/s01-… / s02-… (T882 shared harness: walkthroughShots.ts).
test.use({ viewport: { width: 1280, height: 720 } });
/** Step-2 beats from which the lung must stay reflected + held on every frame. */
const HELD = new Set(['hilum', 'cautery-in', 'pleura', 'cautery-out']);

test('walkthrough steps 1–2: parts framed n/6; scope moves, retractor reflects and holds, pleura opened', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  // Every frame, per 'step:beat': lens outside the chest / in tissue; lung not reflected + held (HELD beats).
  await page.evaluate(
    (held) => {
      const w = window.__sim.walkthrough;
      if (!w) throw new Error('walkthrough not wired');
      const c = { outside: {} as Record<string, number>, unheld: {} as Record<string, number> };
      (window as unknown as { __s0102: typeof c }).__s0102 = c;
      const tick = (): void => {
        requestAnimationFrame(tick);
        const s = w.state();
        const id = w.currentBeat()?.id;
        if (s.status === 'idle' || !id) return;
        const key = `${s.step}:${id}`;
        if (!s.scopeInside) c.outside[key] = (c.outside[key] ?? 0) + 1;
        if (s.step === 2 && held.includes(id) && (!s.reflected || s.holds.length === 0))
          c.unheld[key] = (c.unheld[key] ?? 0) + 1;
      };
      requestAnimationFrame(tick);
    },
    [...HELD],
  );
  const counts = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __s0102: { outside: Record<string, number>; unheld: Record<string, number> };
          }
        ).__s0102,
    );

  // ── Step 1: each part is a pause beat; framed, rail n/6, Next for the following part ──
  // T877: the model hides the upper lobe and both fissures from every port at full collapse, even through
  // ghosted lobes (FEEDBACK_GUIDED_v1 R7 outcome). Those two parts show their subject glowing in the outside-view
  // inset; the scope keeps its best inside view (the middle lobe from the camera port), so their framing contract is
  // measured on that view, and the subject itself is checked in the inset: shown, docked, glowing.
  const parts = ['rul', 'rml', 'rll', 'horizontal', 'oblique', 'phrenic'];
  // T885a: the horizontal fissure too (band glow in the inset, no ghost wash).
  const insetGlow: Record<string, string> = {
    rul: 'lung_upper_lobe_right',
    horizontal: 'fissure:horizontal',
    oblique: 'fissure:oblique',
  };
  const s1 = await playStep(page, 1);
  const c1 = await counts();
  for (let i = 0; i < parts.length; i++) {
    const id = parts[i] as string;
    const b = s1.beats.find((x) => x.id === id);
    const shot = s1.shots.find((x) => x.id === id && x.at === 'end');
    expect.soft(b, `s01 ${id} played`).toBeDefined();
    if (!b) continue;
    console.log(`s01 ${id}: ${b.end.status} ${fmt(b.end)} sub ${JSON.stringify(b.end.sub)}`);
    expect.soft(b.end.error).toBeNull();
    expect.soft(b.end.framing?.pass, `s01 ${id}: ${fmt(b.end)}`).toBe(true);
    expect.soft(b.end.sub).toEqual({ at: i + 1, of: 6 });
    expect.soft(c1.outside[`1:${id}`] ?? 0, `s01 ${id}: scope inside every frame`).toBe(0);
    const glow = insetGlow[id];
    const box = shot?.inset ?? null;
    if (glow) {
      expect.soft(box, `s01 ${id}: outside-view inset shown`).not.toBeNull();
      const dock = shot?.dock;
      console.log(`s01 ${id} inset ${JSON.stringify(box)}`);
      expect
        .soft(box && dock && box.x >= dock.x - 1 && box.x + box.width <= dock.x + dock.width + 1)
        .toBe(true);
      expect
        .soft(box?.height ?? 0, `s01 ${id}: inset taller than the PiP`)
        .toBeGreaterThan((box?.width ?? 0) * 0.8);
      expect.soft(shot?.highlight).toBe(glow);
    } else expect.soft(box, `s01 ${id}: no inset`).toBeNull();
  }
  await page.evaluate(() => window.__sim.walkthrough?.next()); // after the phrenic nerve → step 2
  await page.waitForFunction(() => window.__sim.walkthrough?.state().step === 2);

  // ── Step 2 ──
  const s2 = await playStep(page, 2);
  const c2 = await counts();
  expect
    .soft(s2.beats.map((b) => b.id))
    .toEqual(expect.arrayContaining(['scope-move', 'grasper-in', 'rml', 'grasp', ...HELD]));
  for (const b of s2.beats) {
    const s = b.end;
    console.log(`s02 ${b.id}: ${fmt(s)} tool ${s.tool} holds ${s.holds.length} refl ${s.reflected}`);
    expect.soft(s.error, `s02 ${b.id}`).toBeNull();
    expect.soft(c2.outside[`2:${b.id}`] ?? 0, `s02 ${b.id}: scope inside every frame`).toBe(0);
    if (b.kind === 'working' || b.kind === 'result')
      expect.soft(s.framing?.pass, `s02 ${b.id}: ${fmt(s)}`).toBe(true);
    if (HELD.has(b.id)) {
      expect.soft(c2.unheld[`2:${b.id}`] ?? 0, `s02 ${b.id}: lung reflected + held every frame`).toBe(0);
      expect.soft(s.reflected).toBe(true);
      expect.soft(s.holds.length).toBeGreaterThanOrEqual(1);
    }
  }
  const end = s2.end;
  expect(end.status).toBe('holding');
  expect(end.scopePort).toBe('port_camera_8ICS');
  expect(end.holds).toEqual([{ port: 'port_utility_5ICS', target: 'lung_middle_lobe_right' }]);
  expect(end.reflected).toBe(true);
  expect(await page.evaluate(() => window.__perf.programs), '0 new programs').toBe(programs);
  expect(errors).toEqual([]);
});
