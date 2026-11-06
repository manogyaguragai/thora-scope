import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// T409: scripted M4 action sequence (select tool → place on target → act), screenshots for the visual critic.
// placeTool aims the scope at the placed tip (T410), so every tool-*/stump-* shot frames its target.
test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: the scope image is clear of the panels

const SHOTS = 'qa/screenshots';
const FIRE_MS = 2500; // stapler close + fire + open (1.7 s) + margin
const SETTLE_MS = 600; // eased insertion / view settle before a screenshot
const OUTSIDE_ZOOM_OUT_PX = 1500; // wheel deltaY for the hands-outside shot

const place = (page: Page, id: string, target: string, sub?: string, port?: string): Promise<string> =>
  page.evaluate(
    ([i, t, s, p]) => window.__sim.placeTool?.(i as string, t as string, s, p) ?? 'no helper',
    [id, target, sub, port],
  );
const press = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    if (!m4) return 'not wired';
    const r = m4.press(true);
    m4.press(false);
    return r;
  });
const m4State = (page: Page) =>
  page.evaluate(() => {
    const m4 = window.__sim.m4;
    if (!m4) throw new Error('not wired');
    const o = m4.occupancy;
    return {
      tool: m4.tool,
      phase: m4.control.phase,
      scopePort: o.scopePort,
      toolPort: o.activePort,
      fin: { ...m4.finish },
      lines: m4.staples.lineCount,
      toast: m4.lastToast,
    };
  });

test('M4 actions: tools, port swap, vein + bronchus staple-divide, hands, PiP — no new programs', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const programs = (): Promise<number> => page.evaluate(() => window.__perf.programs);
  const before = await programs();

  // Each instrument placed on a structure it acts on (tool-*.png).
  const tools: [string, string, string?][] = [
    ['grasper', 'lung_upper_lobe_right', 'retractor'],
    ['sponge', 'lung_upper_lobe_right'],
    ['peanut', 'hilar_connective_tissue'],
    ['cautery', 'hilar_connective_tissue'],
    ['clamp', 'middle_lobe_vein'],
    ['clip', 'middle_lobe_vein_V4'],
    ['sucker', 'bronchial_tree'],
  ];
  for (const [id, target, sub] of tools) {
    await page.evaluate(() => window.__sim.m4?.withdraw()); // T840: placed tools stay in their ports otherwise
    expect(await place(page, id, target, sub), `${id} → ${target}`).toBe('ok');
    expect((await m4State(page)).tool).toBe(id);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: `${SHOTS}/tool-${id}.png` });
  }

  // Cautery hold: smoke + lens fog; Esc withdraws the tool to its port.
  expect(await place(page, 'cautery', 'hilar_connective_tissue')).toBe('ok');
  await page.evaluate(() => window.__sim.m4?.press(true));
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/tool-cautery-smoke.png` }); // smoke wisps + lens fog mid-hold
  await page.evaluate(() => window.__sim.m4?.press(false));
  await page.keyboard.press('Escape');
  expect((await m4State(page)).phase).toMatch(/withdrawing|parked/);

  // Vein (practice PA07–PA09): passage behind it with the peanut (the clamp only clamps), the retractor held (G) via
  // the anterior working port, then moved to the access incision, which frees the anterior working port for the
  // stapler (the v8 vein's stapling angle). Scope in the camera port.
  await page.evaluate(() => {
    window.__sim.m3?.scope.switchPort('port_camera_8ICS');
    window.__sim.m3?.syncScope();
  });
  expect(await place(page, 'peanut', 'middle_lobe_vein', undefined, 'port_utility_5ICS')).toBe('ok');
  expect(await press(page)).toMatch(/^Passage made/);
  expect(await place(page, 'grasper', 'lung_upper_lobe_right', 'retractor', 'port_retraction_8ICS')).toBe(
    'ok',
  );
  await page.keyboard.press('KeyG');
  expect(await place(page, 'grasper', 'lung_upper_lobe_right', 'retractor', 'port_utility_5ICS')).toBe('ok');
  await page.keyboard.press('KeyG');
  expect(await page.evaluate(() => window.__sim.m4?.occupancy.swaps)).toBe(1); // the same lobe re-held from another port: a retraction swap (two graspers on different targets are not)
  expect(await place(page, 'stapler', 'middle_lobe_vein', 'vascular-curved', 'port_retraction_8ICS')).toBe(
    'ok',
  );
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/port-swap.png` });
  expect(await press(page)).toBe('ok');
  await page.waitForTimeout(FIRE_MS);
  const vein = await m4State(page);
  expect(vein.fin.veinDivided).toBe(true);
  expect(vein.lines).toBe(1);
  await page.screenshot({ path: `${SHOTS}/stump-vein.png` });

  // Bronchus: nodes 11R/12R out (ring clamp), clamp passage, stapler closed → test ventilation (A) → fire.
  for (const node of ['LN_11R', 'LN_12R']) {
    expect(await place(page, 'grasper', node, 'ring', 'port_utility_5ICS')).toBe('ok');
    expect(await press(page)).toBe('ok');
  }
  expect(await place(page, 'clamp', 'middle_lobe_bronchus')).toBe('ok');
  await press(page);
  expect(await place(page, 'stapler', 'middle_lobe_bronchus', 'bronchial')).toBe('ok');
  await press(page); // close
  await page.waitForTimeout(SETTLE_MS);
  expect((await m4State(page)).fin.bronchusClamped).toBe(true);
  await page.keyboard.press('KeyA');
  expect((await m4State(page)).fin.bronchusTestPassed).toBe(true);
  expect(await press(page)).toBe('ok'); // fire
  await page.waitForTimeout(FIRE_MS);
  const bronchus = await m4State(page);
  expect(bronchus.fin.bronchusDivided).toBe(true);
  expect(bronchus.lines).toBe(2);
  await page.screenshot({ path: `${SHOTS}/stump-bronchus.png` });

  // PiP inset (I) in the scope view, then the hands in the outside view.
  await page.keyboard.press('KeyI');
  await expect(page.locator('#pip-inset')).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  await page.keyboard.press('KeyI');
  await page.evaluate(() => window.__sim.setView('outside', true));
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, OUTSIDE_ZOOM_OUT_PX); // orbit dolly out: the hands sit ~35 cm out along the shafts
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/hands-outside.png` });

  expect(await programs()).toBe(before);
  expect(errors).toEqual([]);
});

// T847b (FEEDBACK_v7_LIVE 2, 4): the clamp stays closed after the button comes up and while another instrument is
// used; two graspers left holding lobes both stay when the cautery goes in through the access incision.
test('T847b clamp stays on; two held graspers persist under the cautery', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?view=scope&step=3');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => {
    window.__sim.m3?.scope.switchPort('port_camera_8ICS');
    window.__sim.m3?.syncScope();
  });
  const clamp = () =>
    page.evaluate(() => ({
      clamped: window.__sim.m4?.clamped ?? null,
      phase: window.__sim.m4?.control.phase,
    }));

  expect(await place(page, 'clamp', 'middle_lobe_vein', undefined, 'port_utility_5ICS')).toBe('ok');
  expect(await page.evaluate(() => window.__sim.m4?.press(true))).toBe('ok');
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__sim.m4?.press(false));
  expect(await clamp()).toMatchObject({ clamped: 'middle_lobe_vein' }); // closed on press, not reopened on release
  const shown = await page.evaluate(() => window.__sim.m4?.heldShown() ?? 0);
  await page.keyboard.press('Digit4'); // peanut in hand: the clamp stays on in its port
  expect(await clamp()).toMatchObject({ clamped: 'middle_lobe_vein' });
  expect(await page.evaluate(() => window.__sim.m4?.heldShown() ?? 0)).toBe(shown + 1);
  await page.keyboard.press('Digit6'); // the clamp back in hand, still closed; a click on it opens it
  expect(await clamp()).toMatchObject({ clamped: 'middle_lobe_vein' });
  expect(await press(page)).toBe('ok');
  expect(await clamp()).toMatchObject({ clamped: null });
  await page.evaluate(() => window.__sim.m4?.withdraw());

  // Two lung graspers left holding (anterior working port: RUL, access incision: RLL), then the cautery joins the
  // second one in the access incision (it takes two; the scope is in the camera port).
  for (const [lobe, port] of [
    ['lung_upper_lobe_right', 'port_retraction_8ICS'],
    ['lung_lower_lobe_right', 'port_utility_5ICS'],
  ] as const) {
    expect(await place(page, 'grasper', lobe, 'retractor', port)).toBe('ok');
    expect(await press(page)).toBe('ok');
    await page.keyboard.press('KeyG');
  }
  expect(await place(page, 'cautery', 'hilar_connective_tissue', undefined, 'port_utility_5ICS')).toBe('ok');
  const inv = await page.evaluate(() => {
    const o = window.__sim.m4?.occupancy;
    return { holds: o?.holds.map((h) => `${h.tool}@${h.port}`) ?? [], graspers: o?.inUse('grasper') ?? 0 };
  });
  expect(inv).toEqual({
    holds: ['grasper@port_retraction_8ICS', 'grasper@port_utility_5ICS'],
    graspers: 2,
  });
  expect(errors).toEqual([]);
});
