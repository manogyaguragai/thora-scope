import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

// T808: the scope moves between ports from the port chips (any tool / mode) and P; each port gives its own view;
// a full port refuses with a toast; Explore keeps the chosen port across a step change, Guided re-snaps.
test.use({ viewport: { width: 1280, height: 720 } });

const SETTLE_MS = 2000; // ~1.5 s eased scope transition + margin
const MIN_DIFF = 4; // mean |Δ| per channel (0–255) that counts as "a different view" (grain alone stays ~1)
const SHOTS: Record<string, string> = {
  port_camera_8ICS: 'qa/screenshots/port-camera.png',
  port_retraction_8ICS: 'qa/screenshots/port-anterior.png',
  port_utility_5ICS: 'qa/screenshots/port-access.png',
};

const scopePort = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__sim.m3?.scope.port.id);
const chip = (page: Page, id: string) => page.locator(`.port-chip[data-port=${id}]`);

async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer()));
  if (!x || !y || x.length !== y.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs((x[i] ?? 0) - (y[i] ?? 0));
  return sum / x.length;
}

test('ports: chips + Shift+P move the scope through every port in Explore; refusal toasts', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.click('button[data-mode=explore]');

  const ids = await page.$$eval('.port-chip', (els) => els.map((e) => (e as HTMLElement).dataset.port ?? ''));
  expect(ids).toHaveLength(3);
  const start = await scopePort(page);
  await expect(chip(page, start ?? '')).toHaveAttribute('aria-pressed', 'true');

  // Chips, with an instrument in hand (grasper waits in the access incision, which has room for the scope too).
  await page.keyboard.press('Digit2');
  const order = [...ids.filter((id) => id !== start), start ?? ''];
  let prev = await page.screenshot();
  for (const id of order) {
    await chip(page, id).click();
    await expect.poll(() => scopePort(page)).toBe(id);
    await expect(chip(page, id)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.port-chip[aria-pressed=true]')).toHaveCount(1);
    await page.waitForTimeout(SETTLE_MS);
    const shot = await page.screenshot({ path: SHOTS[id] });
    expect(await meanDiff(prev, shot), `view from ${id} differs`).toBeGreaterThan(MIN_DIFF);
    prev = shot;
  }

  // Shift+P with the instrument: the scope moves, the instrument stays put.
  const toolPort = await page.evaluate(() => window.__sim.m4?.occupancy.activePort);
  await page.keyboard.press('Shift+KeyP');
  await expect.poll(() => scopePort(page)).not.toBe(start);
  expect(await page.evaluate(() => window.__sim.m4?.occupancy.activePort)).toBe(toolPort);

  // Only Shift+P moves the scope: plain P with Hands leaves it put; Shift+P cycles all three ports.
  await page.keyboard.press('Digit1');
  const stay = await scopePort(page);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  expect(await scopePort(page)).toBe(stay);
  const seen = new Set<string>();
  for (let k = 0; k < 3; k++) {
    const before = await scopePort(page);
    await page.keyboard.press('Shift+KeyP');
    await expect.poll(() => scopePort(page)).not.toBe(before);
    seen.add((await scopePort(page)) ?? '');
  }
  expect(seen.size).toBe(3);

  // Explore keeps the chosen port across a step change.
  const kept = await scopePort(page);
  await page.evaluate(() => window.__sim.setStep(4, true));
  expect(await scopePort(page)).toBe(kept);

  // Refusal: an instrument in a 1-instrument port blocks the scope there, with the reason in the toast.
  // T840: placed instruments persist across tool switches — withdraw everything left from the steps above first.
  await page.evaluate(() => {
    const m4 = window.__sim.m4;
    for (const p of window.__sim.m3?.scope.ports ?? []) m4?.withdrawPort(p.id);
  });
  await page.keyboard.press('Digit2');
  // Wait until the tool is actually in hand, then step it one port per poll until it sits in the retraction port.
  await page.waitForFunction(() => window.__sim.m4?.tool != null);
  await page.evaluate(() => window.__sim.m3?.moveScope('port_utility_5ICS'));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m4 = window.__sim.m4;
        if (!m4) throw new Error('not wired');
        if (m4.occupancy.activePort !== 'port_retraction_8ICS') m4.nextToolPort();
        return m4.occupancy.activePort;
      }),
    )
    .toBe('port_retraction_8ICS');
  await chip(page, 'port_retraction_8ICS').click();
  await expect(page.locator('#action-toast')).toContainText('occupied');
  await expect(page.locator('#action-toast')).toBeVisible();
  expect(await scopePort(page)).toBe('port_utility_5ICS');
  expect(errors).toEqual([]);
});

test('ports: Guided step change re-snaps to the authored port, hint shown once', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const authored = await scopePort(page);
  const other = await page.evaluate(
    (a) => window.__sim.m3?.scope.ports.find((p) => p.id !== a)?.id ?? '',
    authored,
  );
  await chip(page, other).press('Enter');
  await expect.poll(() => scopePort(page)).toBe(other);
  await page.evaluate(() => {
    window.__sim.setStep(2, true);
    window.__sim.setStep(1, true);
  });
  expect(await scopePort(page)).toBe(authored);
  await expect(page.locator('#action-toast')).toContainText('port chip');
});
