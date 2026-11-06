import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T850 (docs/FEEDBACK_v8_LIVE.md 1–4): "Insert via" each port (the shaft passes through it), right-click park, the
// tip stops at the chest wall, a pressed lung indents (uniform) without penetration, lymph-node sample recorded.
// 0 new shader programs after ready.
test.use({ viewport: { width: 1280, height: 720 } });

const CAM = 'port_camera_8ICS';
const ANT = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';

const sim = <T>(page: Page, fn: () => T): Promise<T> => page.evaluate(fn);
const tip = (page: Page): Promise<number[]> =>
  sim(page, () => window.__sim.m4?.control.tipPos.toArray() ?? []);
const gap = (a: number[], b: number[]): number => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));

/** Distance from the hand's port pleura point to the grasper's shaft line (rendered object: tip + its +Z). */
const shaftMiss = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    const root = window.__sim.rig?.camera.parent; // the scene (the scope headlight rides the camera)
    const o = root?.getObjectByName('instrument_grasper');
    const p = m4?.control.port?.pleura;
    if (!o || !p) return Infinity;
    o.updateMatrixWorld(true);
    const z = p.clone().setFromMatrixColumn(o.matrixWorld, 2).normalize();
    const v = p.clone().sub(p.clone().setFromMatrixPosition(o.matrixWorld));
    return v.addScaledVector(z, -v.dot(z)).length();
  });

/** Aim the hand's tip `beyondM` past the first surface of kind `want` along a shaft direction from its port (searched
 *  over the cone; dissectable layers looked through), wait, and report the surface distance + where the tip is. */
const pressInto = (page: Page, want: 'chest' | 'lung', beyondM: number) =>
  page.evaluate(
    async ([w, beyond]) => {
      const { m3, m4, anatomy } = window.__sim;
      const port = m4?.control.port;
      if (!m3 || !m4 || !port) throw new Error('not wired');
      const s = anatomy.structures;
      const dir = port.axis.clone();
      const side = port.axis
        .clone()
        .cross(dir.clone().set(0, 1, 0))
        .normalize();
      const up = side.clone().cross(port.axis).normalize();
      const C = m4.collision;
      for (let a = 0; a <= 60; a += 10)
        for (let b = 0; b < 360; b += 30) {
          const r = (a * Math.PI) / 180;
          const q = (b * Math.PI) / 180;
          dir
            .copy(port.axis)
            .multiplyScalar(Math.cos(r))
            .addScaledVector(side, Math.sin(r) * Math.cos(q))
            .addScaledVector(up, Math.sin(r) * Math.sin(q))
            .normalize();
          let h = m3.picker.ray(port.pleura, dir, 0.01, 0.2);
          while (h && s[h.nodeName]?.dissectable) h = m3.picker.ray(port.pleura, dir, h.distance + 1e-3, 0.2);
          if (!h || h.distance < 0.045) continue;
          const lung = s[h.nodeName]?.group === 'lungs';
          if ((w === 'lung') !== lung || (w === 'chest' && h.nodeName !== 'parietal_pleura_wall')) continue;
          const surface = h.distance;
          m4.control.stopFollow();
          m4.control.aimAt(h.point.clone().addScaledVector(dir, beyond as number));
          for (let f = 0; f < 20; f++) await new Promise(requestAnimationFrame);
          const p = m4.control.tipPos;
          return {
            surface,
            tipDepth: p.distanceTo(port.pleura),
            push: C.push,
            uniform: m4.push.uPushDir.value.length(),
          };
        }
      return null;
    },
    [want, beyondM] as const,
  );

test('T850 insert via each port, right-click park, tissue stop + lung push, LN sample — no new programs', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.click('button[data-mode=explore]');
  const before = await sim(page, () => window.__perf.programs);

  // Scope into the access incision (room for one instrument beside it): every port is open to the grasper.
  await sim(page, () => window.__sim.m3?.moveScope('port_utility_5ICS'));
  await page.keyboard.press('Digit2');
  await expect(page.locator('.port-picker')).toBeVisible();
  await expect(page.locator('.port-pick')).toHaveCount(3);
  const box = await page.locator('canvas[data-engine]').boundingBox();
  const [cx, cy] = [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2];
  for (const [id, key] of [
    [CAM, ''],
    [ANT, 'KeyN'],
    [UTIL, ''],
  ] as const) {
    if (key) await page.keyboard.press(key);
    else await page.click(`.port-pick[data-port=${id}]`);
    await expect.poll(() => sim(page, () => window.__sim.m4?.occupancy.activePort)).toBe(id);
    await expect(page.locator(`.port-pick[data-port=${id}]`)).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(cx + 40, cy + 20); // the tip follows the cursor, pivoting about that port
    await page.waitForTimeout(500);
    expect(await shaftMiss(page), `shaft through ${id}`).toBeLessThan(1e-3);
  }

  // Right click parks: the cursor moves, the tool stays; re-selecting it (hotbar) resumes following.
  await page.click(`.port-pick[data-port=${ANT}]`);
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(500);
  await page.mouse.click(cx, cy, { button: 'right' });
  expect(await sim(page, () => window.__sim.m4?.parked)).toBe(true);
  const held = await tip(page);
  await page.mouse.move(cx + 200, cy - 120, { steps: 5 });
  await page.waitForTimeout(400);
  expect(gap(await tip(page), held)).toBeLessThan(1e-6);
  await page.keyboard.press('Digit2');
  expect(await sim(page, () => window.__sim.m4?.parked)).toBe(false);
  expect(await sim(page, () => window.__sim.m4?.tool)).toBe('grasper'); // re-select: no sub-option cycle
  await page.mouse.move(cx - 150, cy + 100, { steps: 5 });
  await page.waitForTimeout(500);
  expect(gap(await tip(page), held)).toBeGreaterThan(1e-3);

  // A full port is greyed with its reason: scope back to the camera port.
  await sim(page, () => window.__sim.m3?.moveScope('port_camera_8ICS'));
  await expect(page.locator(`.port-pick[data-port=${CAM}]`)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(`.port-pick[data-port=${CAM}]`)).toHaveAttribute('title', /full/);
  await page.click(`.port-pick[data-port=${ANT}]`);

  // Chest wall: never past it. Lung: pressed in, it indents (uniform > 0) and the tip stays within the indent.
  const wall = await pressInto(page, 'chest', 0.03);
  expect(wall, 'a chest-wall direction from the anterior port').not.toBeNull();
  expect(wall?.tipDepth ?? Infinity).toBeLessThanOrEqual((wall?.surface ?? 0) + 1e-4);
  const lung = await pressInto(page, 'lung', 0.03);
  expect(lung, 'a lung direction from the anterior port').not.toBeNull();
  expect(lung?.uniform ?? 0).toBeGreaterThan(0);
  expect(lung?.push ?? 0).toBeGreaterThan(0);
  expect((lung?.tipDepth ?? Infinity) - (lung?.surface ?? 0)).toBeLessThanOrEqual((lung?.push ?? 0) + 1e-4);
  await page.screenshot({ path: 'qa/screenshots/lung-push.png' });

  // Lymph node: grasped (ring forceps, access incision) → "Record sample" → toast, listed, gone from the tip.
  await sim(page, () => window.__sim.setStep(4, true));
  const placed = await page.evaluate(
    () => window.__sim.placeTool?.('grasper', 'LN_11R', 'ring', 'port_utility_5ICS') ?? 'no helper',
  );
  expect(placed).toBe('ok');
  expect(await sim(page, () => window.__sim.m4?.press(true))).toBe('ok');
  await sim(page, () => window.__sim.m4?.press(false));
  expect(await sim(page, () => window.__sim.m4?.grasped)).toBe('LN_11R');
  const btn = page.locator('.retraction-btn[data-action=sample]');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Record sample: Station 11R');
  await btn.click();
  await expect(page.locator('#action-toast')).toContainText('Sample recorded: station 11R');
  const after = await sim(page, () => {
    const root = window.__sim.rig?.camera.parent; // the scene (the scope headlight rides the camera)
    return {
      samples: [...(window.__sim.m4?.samples ?? [])],
      grasped: window.__sim.m4?.grasped,
      shown: root?.getObjectByName('LN_11R')?.visible,
    };
  });
  expect(after).toEqual({ samples: ['11R'], grasped: null, shown: false });
  await expect(btn).toBeHidden();

  expect(await sim(page, () => window.__perf.programs)).toBe(before);
  expect(errors).toEqual([]);
});
