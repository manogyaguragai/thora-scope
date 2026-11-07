import { expect, test } from '@playwright/test';
import { SCALE, fmt, playStep } from './walkthroughShots';

// T865 walkthrough step 3 (FEEDBACK_GUIDED_v1 §2.5 step 3, R1, R3): seek(3) fast-forwarded; key frames (mid action,
// each beat's end) via the T882 shared harness → qa/screenshots/walkthrough/s03-bMM-<id>[-mid].png. Every frame: lung
// reflected, a grasper holding, scope inside the chest. Working / result beats pass the framing contract; the vein
// ends divided; no new shader programs.
test.use({ viewport: { width: 1280, height: 720 } });

test('walkthrough step 3: middle lobe vein — strands, peanut, stapler; framed, reflected, divided', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf.programs);
  await page.evaluate(() => {
    const w = window.__sim.walkthrough;
    if (!w) throw new Error('no walkthrough hook');
    const bad: string[] = [];
    (window as unknown as { __s03: string[] }).__s03 = bad;
    const frame = (): void => {
      requestAnimationFrame(frame);
      const s = w.state();
      if (s.step !== 3 || s.status === 'idle') return;
      if (!s.reflected) bad.push(`beat ${s.beat}: not reflected`);
      if (s.holds.length < 1) bad.push(`beat ${s.beat}: no hold`);
      if (!s.scopeInside && !bad.some((x) => x.startsWith(`beat ${s.beat}: scope`))) {
        // Lens depth past the first surface along its shaft (m) — the number the engine needs.
        const sc = window.__sim.m3?.scope;
        const d = sc?.port.pleura.clone();
        if (sc && d) {
          sc.writePose(d, window.__sim.rig?.camera.quaternion.clone() as never, { fov: 0 });
          d.sub(sc.port.pleura).normalize();
        }
        const over = sc?.limit && d ? (sc.depth - sc.limit(sc.port.pleura, d)).toFixed(3) : '?';
        bad.push(`beat ${s.beat}: scope outside / in tissue (over ${over})`);
      }
    };
    requestAnimationFrame(frame);
  });

  const t0 = Date.now();
  const r = await playStep(page, 3);
  for (const b of r.beats)
    if (b.kind === 'working' || b.kind === 'result') {
      console.log(`s03 ${b.id}: ${JSON.stringify(b.end.framing)}`); // T885a: held / near / spill too
      expect.soft(b.end.framing?.pass, `s03 ${b.id}: framing ${fmt(b.end)}`).toBe(true);
    }
  const end = await page.evaluate(() => ({
    bad: (window as unknown as { __s03: string[] }).__s03,
    vein: window.__sim.m4?.finish.veinDivided,
  }));
  console.log(`step 3: ${r.end.status} ${r.end.error ?? ''} in ${Date.now() - t0} ms (×${SCALE})`);
  expect(r.end.status, r.end.error ?? '').toBe('holding');
  expect([...new Set(end.bad)]).toEqual([]);
  expect(end.vein).toBe(true);
  expect(await page.evaluate(() => window.__perf.programs)).toBe(programs);
  expect(errors).toEqual([]);
});
