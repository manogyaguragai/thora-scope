import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T862 (FEEDBACK_GUIDED_v1 R5): every visible text panel (walkthrough panel with its step text open, side messages,
// the action toast, the practice bar) sits in the side dock: zero overlap with the central 85 % of the 5:4 scope
// aperture, and above the vitals monitor. One page load, three viewports (CSS-only layout follows the resize).
// Mirrors config.postfx.maskAspect/maskFill and config.viewing.dockClearFrac (config.ts can't load in Node).
const MASK_ASPECT = 1.25;
const MASK_FILL = 1;
const CLEAR = 0.85;
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
] as const;
const PANELS = ['.guided-caption', '.guided-msgs', '#action-toast', '.practice-bar'] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function central(w: number, h: number): Box {
  const mh = MASK_FILL * Math.min(h, w / MASK_ASPECT);
  const cw = CLEAR * mh * MASK_ASPECT;
  const ch = CLEAR * mh;
  return { x: (w - cw) / 2, y: (h - ch) / 2, width: cw, height: ch };
}

/** Part of `a` inside the scrolling dock `d` (what is actually painted). */
function clip(a: Box, d: Box): Box {
  const x = Math.max(a.x, d.x);
  const y = Math.max(a.y, d.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, d.x + d.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, d.y + d.height) - y),
  };
}

/** Visible panels' boxes (clipped to the dock's scroll box); asserts each one clears the central aperture, stays on
 *  screen and above the monitor. */
async function check(page: Page, w: number, h: number, label: string): Promise<string[]> {
  const keep = central(w, h);
  const vitals = await page.locator('.vitals').boundingBox();
  const dock = await page.locator('.shell-caption').boundingBox();
  expect(dock, 'side dock').not.toBeNull();
  const seen: string[] = [];
  for (const sel of PANELS) {
    const loc = page.locator(sel);
    if (!(await loc.isVisible())) continue;
    const raw = await loc.boundingBox();
    if (!raw || !dock) continue;
    const b = clip(raw, dock);
    if (b.width === 0 || b.height === 0) continue;
    seen.push(sel);
    const at = `${label} ${w}×${h} ${sel} ${JSON.stringify(b)}`;
    expect(overlaps(b, keep), `${at} over the central aperture`).toBe(false);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h, `${at} on screen`).toBe(true);
    if (vitals) expect(b.y + b.height, `${at} above the vitals monitor`).toBeLessThanOrEqual(vitals.y);
  }
  return seen;
}

test('walkthrough layout: text panels dock beside the scope aperture at 1920×1080, 1280×720, 1024×640', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('.vitals')).toBeVisible();
  const bar = page.getByRole('region', { name: 'Guided walkthrough' });
  await expect(bar).toBeVisible();

  // Collapsible: the step text folds away and back.
  const fold = bar.getByRole('button', { name: 'Step text' });
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(bar.locator('.guided-text')).toBeHidden();
  await fold.click();
  await expect(bar.locator('.guided-text')).toBeVisible();
  await bar.getByRole('button', { name: 'More' }).click(); // learning points open: the tallest panel

  // A side message (walkthrough 'msg' event: shown as the engine would) + the shared toast.
  await page.evaluate(() => {
    const ul = document.querySelector('.guided-msgs') as HTMLElement;
    const li = document.createElement('li');
    li.textContent = 'Lymph node 11R sent for pathology';
    ul.append(li);
    ul.hidden = false;
  });
  const toast = (): Promise<void> =>
    page.evaluate(() => window.__sim.m3?.portHooks.toast('Two-lung ventilation ON: clamp test'));

  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await toast();
    await page.waitForTimeout(300); // layout + one frame at the new size
    expect(await check(page, vp.width, vp.height, 'walkthrough')).toEqual([
      '.guided-caption',
      '.guided-msgs', // T878: practice toasts are suppressed in the walkthrough
    ]);
    // T881 U1: the orientation compass sits in the gutter, outside the central aperture.
    const compass = await page.locator('.scope-compass').boundingBox();
    expect(compass, `compass visible at ${vp.width}×${vp.height}`).not.toBeNull();
    if (compass) {
      expect(
        overlaps(compass, central(vp.width, vp.height)),
        `compass over the aperture ${JSON.stringify(compass)}`,
      ).toBe(false);
      expect(compass.x + compass.width <= vp.width && compass.y >= 0).toBe(true);
    }
    await page.screenshot({ path: `qa/screenshots/walkthrough/layout-${vp.width}x${vp.height}.png` });
  }

  // Practice bar (practice mode keeps its behaviour; only its placement is the side dock).
  await page.click('button[data-mode=practice]');
  await expect(page.getByRole('region', { name: 'Practice' })).toBeVisible();
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await toast();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `qa/screenshots/walkthrough/layout-practice-${vp.width}x${vp.height}.png`,
    });
    expect(await check(page, vp.width, vp.height, 'practice')).toEqual(['#action-toast', '.practice-bar']);
  }
  expect(errors).toEqual([]);
});
