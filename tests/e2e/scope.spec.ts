import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { labelFor } from '../../src/content/labels';

test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: centre of the scope image is clear of panels

const SETTLE_MS = 2000; // ~1.5 s eased scope transition (port switch / snap / reset) + margin

const ready = async (page: Page, url: string, errors: string[]): Promise<void> => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
};

/** Rig + rendered-camera state after two more frames. */
const read = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const { rig, m3 } = window.__sim;
    if (!rig || !m3) throw new Error('not wired');
    const s = m3.scope;
    return {
      pos: rig.camera.position.toArray(),
      quat: rig.camera.quaternion.toArray(),
      fov: rig.camera.fov,
      lensToPleura: rig.camera.position.distanceTo(s.port.pleura),
      port: s.port.id,
      depth: s.depth,
      lock: s.horizonLock,
      lightPost: s.lightPostDeg,
      zoom: s.zoom,
    };
  });

test('scope controls: drag, wheel, Z/X, H, +/-, P, V, R (Hands only)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await ready(page, '/?view=scope&step=1', errors);
  const vp = page.viewportSize() ?? { width: 640, height: 400 };
  const cx = vp.width / 2;
  const cy = vp.height / 2;

  const s0 = await read(page);
  expect(s0.port).toBe('port_camera_8ICS');
  expect(s0.lock).toBe(true); // T816: the authored step view, levelled (H brings back its roll)

  // Left-drag pivots about the fulcrum: view turns, lens stays `depth` past the pleura point.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
  await page.mouse.up();
  const s1 = await read(page);
  expect(s1.quat).not.toEqual(s0.quat);
  expect(s1.lensToPleura).toBeCloseTo(s1.depth, 5);

  await page.mouse.wheel(0, 100); // withdraw
  await expect.poll(async () => (await read(page)).depth).toBeLessThan(s1.depth);

  await page.keyboard.press('KeyZ');
  expect((await read(page)).lightPost).not.toBeCloseTo(s1.lightPost, 3);

  await page.keyboard.press('KeyH');
  expect((await read(page)).lock).toBe(false);
  await page.keyboard.press('KeyH');
  expect((await read(page)).lock).toBe(true);
  await expect(page.locator('.port-chip[data-port=port_camera_8ICS]')).toContainText('level');

  await page.keyboard.press('Equal');
  const zoomed = await read(page);
  expect(zoomed.zoom).toBeGreaterThan(1);
  expect(zoomed.fov).toBeLessThan(s1.fov);

  await page.keyboard.press('Shift+KeyP');
  const moved = await read(page);
  expect(moved.port).not.toBe(s0.port);
  await expect(page.locator(`.port-chip[data-port=${moved.port}]`)).toContainText('Scope');
  await expect(page.locator('.port-chip[data-port=port_camera_8ICS]')).toContainText('—');

  // V: back to the authored step-1 view.
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(SETTLE_MS);
  const snapped = await read(page);
  expect(snapped.port).toBe(s0.port);
  snapped.pos.forEach((v, i) => expect(v).toBeCloseTo(s0.pos[i] ?? NaN, 4));

  await page.keyboard.press('KeyR');
  const reset = await read(page);
  expect(reset).toMatchObject({ port: 'port_camera_8ICS', zoom: 1, lock: true });

  // Another tool: scope keys and drag no longer move the scope.
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyH');
  expect((await read(page)).lock).toBe(true);
  await page.keyboard.press('Digit1');
  await page.screenshot({ path: 'qa/screenshots/scope.png' });
  expect(errors).toEqual([]);
});

test('picking: hover and click report the node under the cursor', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await ready(page, '/?view=scope&step=3', errors);
  const vp = page.viewportSize() ?? { width: 640, height: 400 };
  const cx = vp.width / 2;
  const cy = vp.height / 2;

  const expected = await page.evaluate(() => window.__sim.m3?.pickAt(0, 0) ?? null);
  expect(expected).not.toBeNull();
  expect(expected).not.toMatch(/^port_/);

  await page.mouse.move(cx - 5, cy);
  await page.mouse.move(cx, cy);
  await page.waitForFunction((n) => window.__sim.m3?.hover === n, expected, { timeout: 10_000 });

  await page.mouse.click(cx, cy);
  const pin = page.locator('.label3d-pin');
  await expect(pin).toBeVisible();
  await expect(pin.locator('strong')).toHaveText(labelFor(expected ?? '').name);
  expect(errors).toEqual([]);
});
