import { expect, test } from '@playwright/test';
import sharp from 'sharp';

// T816: surgeon-style scope navigation (held arrows pivot about the port, wheel inserts / withdraws), the
// orientation compass (scope view only) and the Inside / Outside view buttons.
test.use({ viewport: { width: 1280, height: 720 } });

const HOLD_MS = 500;

test('arrows pivot, wheel inserts, compass + Inside/Outside buttons', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?mode=explore&view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = await page.evaluate(() => window.__perf?.programs ?? -1);

  const rigState = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const s = window.__sim.m3?.scope;
      if (!s) throw new Error('not wired');
      return { pitch: s.pitch, yaw: s.yaw, depth: s.depth, lock: s.horizonLock };
    });
  const hold = async (key: string): Promise<void> => {
    await page.keyboard.down(key);
    await page.waitForTimeout(HOLD_MS);
    await page.keyboard.up(key);
  };

  const s0 = await rigState();
  expect(s0.lock).toBe(true); // levelled by default
  await hold('ArrowUp');
  const s1 = await rigState();
  expect(Math.abs(s1.pitch - s0.pitch)).toBeGreaterThan(1e-3);
  await hold('ArrowLeft');
  const s2 = await rigState();
  expect(Math.abs(s2.yaw - s1.yaw)).toBeGreaterThan(1e-3);
  // Released: no further drift.
  const s3 = await rigState();
  expect(s3.yaw).toBeCloseTo(s2.yaw, 6);

  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, 100); // withdraw
  await expect.poll(async () => (await rigState()).depth).toBeLessThan(s3.depth);

  const compass = page.locator('.scope-compass');
  await expect(compass).toBeVisible();
  await expect(compass.locator('[data-axis=head]')).toHaveText('Head');
  await expect(compass).toContainText('R: reset view');

  const inside = page.getByRole('button', { name: 'Inside (scope)' });
  const outside = page.getByRole('button', { name: 'Outside (theatre)' });
  await expect(inside).toHaveAttribute('aria-pressed', 'true');
  await outside.click();
  await expect(outside).toHaveAttribute('aria-pressed', 'true');
  await expect(inside).toHaveAttribute('aria-pressed', 'false');
  await expect(compass).toBeHidden();
  await page.waitForFunction(() => window.__sim.rig?.mode === 'outside');

  // Outside: arrows do not move the scope.
  const before = await rigState();
  await hold('ArrowUp');
  expect((await rigState()).pitch).toBeCloseTo(before.pitch, 6);

  await inside.click();
  await expect(inside).toHaveAttribute('aria-pressed', 'true');
  await expect(compass).toBeVisible();
  await page.keyboard.press('KeyO'); // O still toggles
  await expect(outside).toHaveAttribute('aria-pressed', 'true');

  expect(await page.evaluate(() => window.__perf?.programs ?? -1)).toBe(programs);
  expect(errors).toEqual([]);
});

// T843: world-space AABB centres from public/models/thorax_sim.opt.glb (tests/unit/compass.test.ts).
const HEART = [-0.0546, -0.0286, 0.0399] as const;
const SPINE = [-0.0632, -0.0186, -0.0392] as const;
const LOBE_CENTRES = [
  [-0.0721, 0.0415, -0.0088],
  [-0.0639, 0.0563, 0.0428],
  [0.0213, 0.0381, 0.0047],
] as const;

test('T843: scope stops at organ surfaces and inside the chest wall; orbit stays outside; compass Ant → heart', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?mode=explore&view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => Object.values(window.__sim.state.tweens).every((t) => !t.active), null, {
    timeout: 120_000,
  });
  const programs = await page.evaluate(() => window.__perf?.programs ?? -1);

  // Compass: the Ant mark lies on the heart's side of the image (heart − spine in camera space).
  await page.waitForTimeout(300);
  const ant = await page.evaluate(
    ([h, s]) => {
      const cam = window.__sim.rig?.camera;
      const mark = document.querySelector<HTMLElement>('.scope-compass-mark[data-axis=anterior]');
      if (!cam || !mark) throw new Error('not wired');
      const d = cam.position.clone().set(h[0] - s[0], h[1] - s[1], h[2] - s[2]);
      d.applyQuaternion(cam.quaternion.clone().invert());
      const x = Number(mark.style.getPropertyValue('--x'));
      const y = -Number(mark.style.getPropertyValue('--y')); // CSS y grows down
      return (d.x * x + d.y * y) / Math.hypot(d.x, d.y);
    },
    [HEART, SPINE] as const,
  );
  expect(ant).toBeGreaterThan(0.5);

  // Aim the shaft straight at a lobe (first centre whose surface lies within reach), then hold wheel-in.
  const aimed = await page.evaluate((centres) => {
    const m3 = window.__sim.m3;
    const cam = window.__sim.rig?.camera;
    if (!m3 || !cam) throw new Error('not wired');
    const s = m3.scope;
    for (const c of centres) {
      const dir = s.port.pleura.clone().set(c[0], c[1], c[2]).sub(s.port.pleura).normalize();
      const hit = m3.picker.ray(s.port.pleura, dir, 0.003, 0.2);
      if (!hit?.nodeName.startsWith('lung_') || hit.distance < 0.03 || hit.distance > 0.15) continue;
      const pos = s.port.pleura.clone().addScaledVector(dir, 0.015);
      s.snapTo({ position: pos, quaternion: cam.quaternion.clone(), fov: s.fovDeg }, s.port.id);
      m3.syncScope();
      return { name: hit.nodeName, dist: hit.distance };
    }
    return null;
  }, LOBE_CENTRES);
  expect(aimed).not.toBeNull();
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -100); // ≈ 25 cm in: far past the surface
  await page.waitForTimeout(300);
  const stop = await page.evaluate(() => {
    const m3 = window.__sim.m3;
    const cam = window.__sim.rig?.camera;
    if (!m3 || !cam) throw new Error('not wired');
    const s = m3.scope;
    const lens = cam.position.clone();
    const shaft = lens.clone().sub(s.port.pleura);
    const depth = shaft.length();
    shaft.normalize();
    const ahead = m3.picker.ray(s.port.pleura, shaft, 0.003, 0.3); // shared result: read before the next ray
    const surface = ahead?.distance ?? Infinity;
    const name = ahead?.nodeName ?? '';
    // Inside test: a ray from the lens along the shaft must meet the surface's front face first.
    const front = m3.picker.ray(lens, shaft, 0, 0.3);
    return { depth, surface, name, frontDot: front ? front.normal.dot(shaft) : 1 };
  });
  expect(stop.name).toBe(aimed?.name);
  expect(stop.depth).toBeGreaterThan(0.02); // it did go in …
  expect(stop.depth).toBeLessThan(stop.surface); // … and stopped short of the lobe
  expect(stop.surface - stop.depth).toBeLessThan(0.02);
  expect(stop.frontDot).toBeLessThan(0);

  // Held arrows can't swing the shaft out through the chest wall.
  await page.evaluate(() => {
    window.__sim.m3?.scope.reset();
    window.__sim.m3?.syncScope();
  });
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(3500); // 0.5 rad/s → well past 90°
    await page.keyboard.up(key);
    const wall = await page.evaluate(() => {
      const s = window.__sim.m3?.scope;
      const cam = window.__sim.rig?.camera;
      if (!s || !cam) throw new Error('not wired');
      const d = cam.position.clone().sub(s.port.pleura).normalize();
      return (Math.acos(d.dot(s.port.axis)) * 180) / Math.PI;
    });
    expect(wall).toBeLessThan(90);
  }

  // Outside: zooming all the way in stops outside the body (nothing behind the camera; the first surface ahead is
  // a front face beyond the guard margin).
  await page.getByRole('button', { name: 'Outside (theatre)' }).click();
  await page.waitForFunction(() => window.__sim.rig?.mode === 'outside' && !window.__sim.rig.transitioning);
  const camDist = () => page.evaluate(() => window.__sim.rig?.camera.position.length() ?? 0);
  const d0 = await camDist();
  await page.mouse.down(); // a short orbit drag first (OrbitControls ignores the wheel until it has seen a pointer)
  await page.mouse.move(vp.width / 2 + 60, vp.height / 2, { steps: 4 });
  await page.mouse.up();
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -400);
  await page.waitForTimeout(500);
  expect(await camDist()).toBeLessThan(d0 / 2); // it did zoom in
  const orbit = await page.evaluate(() => {
    const m3 = window.__sim.m3;
    const cam = window.__sim.rig?.camera;
    if (!m3 || !cam) throw new Error('not wired');
    const f = cam.position.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = m3.picker.ray(cam.position, f, 0, 5);
    const ahead = { dot: hit ? hit.normal.dot(f) : 1, dist: hit?.distance ?? -1 };
    const behind = m3.picker.ray(cam.position, f.negate(), 0, 5)?.nodeName ?? null;
    return { ...ahead, behind };
  });
  expect(orbit.behind).toBeNull();
  expect(orbit.dot).toBeLessThan(0);
  expect(orbit.dist).toBeGreaterThan(0.02);

  expect(await page.evaluate(() => window.__perf?.programs ?? -1)).toBe(programs);
  expect(errors).toEqual([]);
});

test('T843: the CT mediastinal fat never takes a label; the lung surface behind it does', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/?mode=explore&view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  let fatOverLung = 0;
  // Several angles: step views, plus the step-1 view swung down toward the inferior lung surface.
  for (const [step, pitch] of [
    [1, 0],
    [1, -0.35],
    [2, 0],
  ] as const) {
    await page.evaluate(
      ([n, p]) => {
        window.__sim.setStep(n, true);
        window.__sim.setView('scope', true);
        if (p) window.__sim.m3?.scope.pivot(0, p);
        window.__sim.m3?.syncScope();
      },
      [step, pitch] as const,
    );
    await page.waitForFunction(() => Object.values(window.__sim.state.tweens).every((t) => !t.active), null, {
      timeout: 120_000,
    });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const m3 = window.__sim.m3;
      const cam = window.__sim.rig?.camera;
      if (!m3 || !cam) throw new Error('not wired');
      cam.updateMatrixWorld();
      const picked = new Set<string>();
      let fatOverLung = 0;
      const N = 15;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const x = (i / (N - 1)) * 1.8 - 0.9;
          const y = (j / (N - 1)) * 1.8 - 0.9;
          const name = m3.pickAt(x, y);
          if (name) picked.add(name);
          const d = cam.position.clone().set(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
          const solid = m3.picker.ray(cam.position, d, 0, 5)?.nodeName;
          if (solid === 'mediastinal_fat_ct' && name?.startsWith('lung_')) fatOverLung++;
        }
      return { picked: [...picked], fatOverLung };
    });
    expect(r.picked).not.toContain('mediastinal_fat_ct');
    expect(r.picked.some((n) => n.startsWith('lung_'))).toBe(true);
    fatOverLung += r.fatOverLung;
  }
  test.info().annotations.push({
    type: 'T843',
    description: `CT fat over a labelled lobe at ${fatOverLung} grid points`,
  });
});

// T847a: wheel-in never takes the lens into (or flat against) tissue: guided steps 1/3/6 + the Practice audit case.
test('T847a: 60 wheel-in notches keep the lens outside every mesh and the view readable', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const vp = { width: 1280, height: 720 };
  const cases = [
    ['', 1],
    ['', 3],
    ['', 6],
    ['&mode=practice', 1],
  ] as const;
  for (const [mode, step] of cases) {
    await page.goto(`/?view=scope&step=${step}${mode}`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    await page.waitForFunction(() => Object.values(window.__sim.state.tweens).every((t) => !t.active), null, {
      timeout: 120_000,
    });
    await page.waitForTimeout(300); // picking re-bake + settle
    await page.mouse.move(vp.width / 2, vp.height / 3);
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -100);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const m3 = window.__sim.m3;
      const cam = window.__sim.rig?.camera;
      if (!m3 || !cam) throw new Error('not wired');
      const lens = cam.position.clone();
      const shaft = lens.clone().sub(m3.scope.port.pleura).normalize();
      const fwd = lens.clone().set(0, 0, -1).applyQuaternion(cam.quaternion);
      const dirs = [
        shaft,
        fwd,
        ...[0, 1, 2].flatMap((a) => [-1, 1].map((s) => lens.clone().set(0, 0, 0).setComponent(a, s))),
      ];
      const inside: string[] = [];
      for (const d of dirs) {
        const h = m3.picker.ray(lens, d.normalize(), 0, 1);
        if (h && h.normal.dot(d) > 0) inside.push(h.nodeName); // first surface met from behind
      }
      const near = m3.picker.nearest(lens, 0.0015)?.nodeName ?? null;
      return { inside, near, depth: m3.scope.depth };
    });
    const png = await page.screenshot({ clip: { x: 420, y: 100, width: 560, height: 260 } });
    const stdev = Math.max(...(await sharp(png).stats()).channels.slice(0, 3).map((c) => c.stdev));
    test.info().annotations.push({
      type: 'T847a',
      description: `${mode || 'guided'} step ${step}: ${JSON.stringify(r)} stdev ${stdev.toFixed(1)}`,
    });
    expect(r.inside, `step ${step}${mode}`).toEqual([]);
    expect(r.near, `step ${step}${mode}`).toBeNull();
    expect(stdev, `step ${step}${mode}: flat frame`).toBeGreaterThan(12);
  }
  expect(errors).toEqual([]);
});
