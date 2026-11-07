import { expect, test } from '@playwright/test';

// T308: overlay panels never overlap each other; at 1280×720 the side panels/chips stay in the black margin beside
// the 5:4 scope image (only the caption bar and the §6.3 bottom-centred hotbar sit over it); tags stay off the dock.
// T880: runs in Explore, where the hotbar + port chips exist and the scope frames the lobes (T878 hides those controls
// in Guided; layout-walkthrough.spec covers the Guided layout, incl. the steps rail and walkthrough caption).
const PARTS = {
  inspector: '.shell-inspector',
  hotbar: '.hotbar',
  chips: '.port-chips',
} as const;
const MARGIN_ONLY = ['inspector', 'chips'] as const;
// Mirrors config.postfx.maskAspect/maskFill and config.viewing.labelMaxCount (config.ts reads import.meta.env, so
// it can't be imported into a Node-side spec).
const MASK_ASPECT = 1.25;
const MASK_FILL = 1;
const LABEL_MAX = 12;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
]) {
  test(`layout ${viewport.width}×${viewport.height}: no overlay overlaps, labels off the dock`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.goto('/?mode=explore&view=scope&step=1');
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    await page.locator('.viewing-panel summary', { hasText: 'Layers' }).click();
    await page.keyboard.press('KeyL');
    await expect(page.locator('.label3d-tag:visible').first()).toBeVisible();

    const boxes = {} as Record<keyof typeof PARTS, Box>;
    for (const [k, sel] of Object.entries(PARTS) as [keyof typeof PARTS, string][]) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      boxes[k] = { x: b?.x ?? 0, y: b?.y ?? 0, w: b?.width ?? 0, h: b?.height ?? 0 };
    }
    const keys = Object.keys(PARTS) as (keyof typeof PARTS)[];
    for (const [i, a] of keys.entries())
      for (const b of keys.slice(i + 1)) expect(overlaps(boxes[a], boxes[b]), `${a} × ${b}`).toBe(false);

    if (viewport.width === 1280) {
      const mh = MASK_FILL * Math.min(viewport.height, viewport.width / MASK_ASPECT);
      const mw = mh * MASK_ASPECT;
      const scope = { x: (viewport.width - mw) / 2, y: (viewport.height - mh) / 2, w: mw, h: mh };
      for (const k of MARGIN_ONLY) expect(overlaps(boxes[k], scope), `${k} over the scope image`).toBe(false);
    }

    const dockTop = Math.min(boxes.hotbar.y, boxes.chips.y);
    const tagBottoms = await page.$$eval('.label3d-tag:not([hidden])', (els) =>
      els.map((el) => el.getBoundingClientRect().bottom),
    );
    expect(tagBottoms.length).toBeLessThanOrEqual(LABEL_MAX);
    for (const y of tagBottoms) expect(y).toBeLessThanOrEqual(dockTop);
    await page.screenshot({ path: `qa/screenshots/layout-${viewport.width}.png` });
  });
}
