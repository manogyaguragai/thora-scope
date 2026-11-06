import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { FALLBACK_TISSUE, STEP_FOCUS, TISSUE_RULES } from '../../src/scene/materials.config';
import { hideShell } from './pixels';

// T807: per-step scope close-ups (steps 2–7) + per-structure-class colour table from a pick-ray grid.
// Each grid ray names the node under that pixel (BVH pick, scope pose), the screenshot gives its colour.
// T826: the T807 gates run on the Teaching palette; Realistic gets a light sanity check (vein + artery steps).
test.use({ viewport: { width: 1280, height: 720 } });

const GRID = { x: 64, y: 40, extent: 0.85 }; // NDC samples per axis, ±extent (inside the 5:4 mask)
// Fraction of grid rays that must land on the step's focus structures (T807b: steps 4 and 7 use poseFix re-aims).
const MIN_FOCUS_HITS: Readonly<Record<number, number>> = {
  2: 0.03,
  3: 0.03,
  4: 0.008, // T846b v8: LN_11R/12R are ~1 cm and half-buried; the best shaft-clear lens from the step port reaches 1.1 %
  5: 0.03,
  6: 0.03,
  7: 0.1,
};
// Translucent veils (connective tissue, opacity 0.4) are seen through: rays skip them, so a pixel is
// attributed to the structure behind the veil.
const VEILS = ['hilar_connective_tissue', 'hilar_connective_tissue_window'];
const SETTLE_MS = 1500; // auto-exposure
// T818: lung pixels in this luma band read as the black/purple "V" the rest-pose normals made on the retracted RLL
// (V ≈ L35; distant lobes ≥ L85; below L15 = scope mask / vitals monitor over the canvas).
const DARK_LUMA = [15, 60] as const;
const MAX_DARK_LUNG = 0.03; // fraction of lung-lobe rays (T818 rest normals, old 7-step list: 3 28 %, 5 7 %, 6 6 %)
const DARK_STEPS = [3, 6, 7]; // T846b 9-step list: vein, arteries, fissures (retracted lobes in view)
// qa/screenshots/palette-{realistic,teaching}-s{2,3,6}.png (T846b 9-step list: 2 pleura, 3 vein, 6 arteries)
const PALETTE_STEPS = [2, 3, 6];
const VEIN_STEP = 3;
const ARTERY_STEP = 6;
const MAX_ARTERY_SAT = 0.35; // realistic artery: grey-pink, not the saturated teaching blue (HSV S ≈ 0.4)

const classOf = (name: string): string => TISSUE_RULES.find(([re]) => re.test(name))?.[1] ?? FALLBACK_TISSUE;
const lum = ([r, g, b]: number[]): number => 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
const hex = (c: number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

type Row = Record<string, { n: number; rgb: number[] }>;
/** Load a step on a palette, screenshot it, and attribute grid pixels to structure classes (mean rgb per class). */
async function sample(
  page: Page,
  step: number,
  palette: string,
  shots: string[],
): Promise<{ row: Row; onFocus: number; dark: number }> {
  await page.goto(`/?view=scope&step=${step}&palette=${palette}`);
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await hideShell(page);
  await page.waitForFunction(
    () => window.__sim.rig?.transitioning === false && !window.__sim.guided?.transitioning,
  );
  await page.waitForTimeout(SETTLE_MS);
  const png = await page.screenshot();
  for (const path of shots) writeFileSync(path, png);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const hits = await page.evaluate(
    ([g, veils]) => {
      const m3 = window.__sim.m3;
      const shown = veils.filter((n) => m3?.layers.isUserVisible(n));
      for (const n of shown) m3?.layers.setVisible(n, false);
      const out: (string | null)[] = [];
      for (let j = 0; j < g.y; j++)
        for (let i = 0; i < g.x; i++)
          out.push(
            m3?.pickAt(
              -g.extent + (2 * g.extent * i) / (g.x - 1),
              g.extent - (2 * g.extent * j) / (g.y - 1),
            ) ?? null,
          );
      for (const n of shown) m3?.layers.setVisible(n, true);
      return out;
    },
    [GRID, VEILS] as const,
  );
  const sum: Record<string, number[]> = {};
  const focus = STEP_FOCUS[step] ?? [];
  let onFocus = 0;
  let lung = 0;
  let dark = 0;
  hits.forEach((name, k) => {
    if (!name) return;
    if (focus.includes(name)) onFocus++;
    const i = k % GRID.x;
    const j = Math.floor(k / GRID.x);
    const ndcX = -GRID.extent + (2 * GRID.extent * i) / (GRID.x - 1);
    const ndcY = GRID.extent - (2 * GRID.extent * j) / (GRID.y - 1);
    const px = Math.round(((ndcX + 1) / 2) * (info.width - 1));
    const py = Math.round(((1 - ndcY) / 2) * (info.height - 1));
    const o = (py * info.width + px) * info.channels;
    const s = (sum[classOf(name)] ??= [0, 0, 0, 0]);
    for (let c = 0; c < 3; c++) s[c] = (s[c] ?? 0) + (data[o + c] ?? 0);
    if (name.startsWith('lung_')) {
      lung++;
      const l = lum([data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0]);
      if (l >= DARK_LUMA[0] && l < DARK_LUMA[1]) dark++;
    }
    s[3] = (s[3] ?? 0) + 1;
  });
  const row = Object.fromEntries(
    Object.entries(sum).map(([cls, s]) => {
      const n = s[3] ?? 1;
      return [cls, { n, rgb: s.slice(0, 3).map((v) => v / n) }];
    }),
  );
  return { row, onFocus: onFocus / hits.length, dark: lung ? dark / lung : 0 };
}

test('per-step scope close-ups: focus structures visible, structure colour table', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const table: Record<number, Record<string, { n: number; rgb: string; luma: number }>> = {};
  const focusHits: Record<number, number> = {};
  const darkLung: Record<number, number> = {};

  for (let step = 2; step <= 7; step++) {
    const shots = [`qa/screenshots/closeup-step${step}.png`];
    if (PALETTE_STEPS.includes(step)) shots.push(`qa/screenshots/palette-teaching-s${step}.png`);
    const r = await sample(page, step, 'teaching', shots);
    focusHits[step] = r.onFocus;
    darkLung[step] = r.dark;
    table[step] = Object.fromEntries(
      Object.entries(r.row).map(([cls, v]) => [
        cls,
        { n: v.n, rgb: hex(v.rgb), luma: Math.round(lum(v.rgb)) },
      ]),
    );
  }
  writeFileSync('qa/closeup-colours.json', JSON.stringify({ focusHits, darkLung, table }, null, 2));
  for (const [step, row] of Object.entries(table))
    console.log(
      `step ${step} focus ${(100 * (focusHits[Number(step)] ?? 0)).toFixed(1)}% · ` +
        `dark lung ${(100 * (darkLung[Number(step)] ?? 0)).toFixed(1)}% · ` +
        Object.entries(row)
          .sort((a, b) => b[1].n - a[1].n)
          .map(([c, v]) => `${c} ${v.rgb} L${v.luma} n${v.n}`)
          .join(' · '),
    );
  for (let step = 2; step <= 7; step++)
    expect(focusHits[step], `step ${step} focus`).toBeGreaterThan(MIN_FOCUS_HITS[step] ?? 0);
  for (const step of DARK_STEPS) expect(darkLung[step], `step ${step} dark lung`).toBeLessThan(MAX_DARK_LUNG);
  expect(errors).toEqual([]);
});

test('realistic palette: vein darker than lung, artery not saturated blue', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const rows: Record<number, Row> = {};
  for (const step of PALETTE_STEPS)
    rows[step] = (
      await sample(page, step, 'realistic', [
        `qa/screenshots/palette-realistic-s${step}.png`,
        `qa/screenshots/t846-realistic-s${step}.png`,
      ])
    ).row;
  const sat = ([r, g, b]: number[]): number => {
    const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
    return max ? (max - Math.min(r ?? 0, g ?? 0, b ?? 0)) / max : 0;
  };
  for (const [step, row] of Object.entries(rows))
    console.log(
      `realistic step ${step} · ` +
        Object.entries(row)
          .map(([c, v]) => `${c} ${hex(v.rgb)} L${Math.round(lum(v.rgb))} S${sat(v.rgb).toFixed(2)} n${v.n}`)
          .join(' · '),
    );
  expect(rows[VEIN_STEP]?.vein, 'vein in the vein-step view').toBeDefined();
  expect(rows[ARTERY_STEP]?.artery, 'artery in the artery-step view').toBeDefined();
  const vein = rows[VEIN_STEP]?.vein?.rgb ?? [];
  const lung = rows[VEIN_STEP]?.collapsedLung?.rgb ?? [];
  const artery = rows[ARTERY_STEP]?.artery?.rgb ?? [];
  expect(lum(vein), 'vein darker than lung').toBeLessThan(lum(lung));
  expect(sat(artery), 'artery saturation').toBeLessThan(MAX_ARTERY_SAT);
  expect(artery[2] ?? 0, 'artery not blue-dominant').toBeLessThanOrEqual(artery[0] ?? 0);
  expect(errors).toEqual([]);
});
