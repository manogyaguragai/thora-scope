import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

// T819: every instrument tip in the scope view + handles in the outside view (gloves hidden), as two contact sheets
// for the visual critic. 0 new shader programs after ready.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOTS = 'qa/screenshots';
const SETTLE_MS = 600;
const OUTSIDE_ORBIT_PX = 260;
const OUTSIDE_ZOOM_IN_PX = -2400; // orbit dolly in (≈ 2.7 → 0.6 m), done with no tool held (wheel = tool insertion)
const TILE = 640;
const STAPLER_BACK_OFF_M = -0.03; // the 12 mm stapler fills placeTool's 4.5 cm aim: withdraw the scope
/** Contact-sheet shots show the 3D canvas only: every DOM overlay is hidden for the screenshot. */
const HIDE_UI = '#app *{visibility:hidden!important}#app canvas{visibility:visible!important}';

const place = (page: Page, id: string, target: string, sub?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s]) => window.__sim.placeTool?.(i as string, t as string, s) ?? 'no helper',
    [id, target, sub],
  );

/** Labelled grid of screenshots rendered in a scratch page (nothing extra in the app). */
async function sheet(browser: Browser, tiles: [string, Buffer][], cols: number, path: string): Promise<void> {
  const p = await browser.newPage({ viewport: { width: cols * TILE, height: TILE / 2 } });
  const cells = tiles
    .map(
      ([label, png]) =>
        `<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${label}</figcaption></figure>`,
    )
    .join('');
  await p.setContent(
    `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${TILE}px)}
     figure{margin:0;position:relative}img{width:${TILE}px;display:block}
     figcaption{position:absolute;left:6px;top:4px;color:#fff;font:14px sans-serif;text-shadow:0 0 3px #000}</style>${cells}`,
  );
  await p.screenshot({ path, fullPage: true });
  await p.close();
}

test('T819 instruments: tips in the scope, handles outside, no gloves — no new programs', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();
  await page.addStyleTag({ content: HIDE_UI });

  const tools: [string, string, string?, number?][] = [
    ['grasper', 'lung_upper_lobe_right', 'retractor'],
    ['grasper', 'LN_11R', 'ring'],
    ['sponge', 'lung_upper_lobe_right'],
    ['peanut', 'hilar_connective_tissue'],
    ['cautery', 'hilar_connective_tissue'],
    ['clamp', 'V_RML_common'],
    ['stapler', 'V_RML_common', 'vascular-curved', STAPLER_BACK_OFF_M],
    ['clip', 'V4_lateral'],
    ['sucker', 'tree_airway_base'],
  ];
  const scope: [string, Buffer][] = [];
  for (const [id, target, sub, back] of tools) {
    expect(await place(page, id, target, sub), `${id} → ${target}`).toBe('ok');
    if (back)
      await page.evaluate((d) => {
        window.__sim.m3?.scope.insert(d);
        window.__sim.m3?.syncScope();
      }, back);
    await page.waitForTimeout(SETTLE_MS);
    scope.push([`${id}${sub ? ` · ${sub}` : ''}`, await page.screenshot()]);
  }
  await sheet(browser, scope, 3, `${SHOTS}/t819-instruments-scope.png`);

  const outside: [string, Buffer][] = [];
  await page.evaluate(() => {
    window.__sim.m3?.hotbar.select(0); // hands slot: no tool, so the wheel reaches the orbit camera
    window.__sim.setView('outside', true);
  });
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(640 + OUTSIDE_ORBIT_PX, 360, { steps: 8 }); // orbit round to the patient's side
  await page.mouse.up();
  await page.mouse.wheel(0, OUTSIDE_ZOOM_IN_PX);
  for (const [id, target, sub] of [tools[1], tools[4], tools[6]] as [string, string, string?][]) {
    expect(await place(page, id, target, sub)).toBe('ok');
    await page.waitForTimeout(SETTLE_MS);
    outside.push([`${id} (outside)`, await page.screenshot()]);
  }
  await sheet(browser, outside, 3, `${SHOTS}/t819-instruments-outside.png`);

  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});
