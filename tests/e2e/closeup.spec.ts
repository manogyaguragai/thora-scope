import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FALLBACK_TISSUE, STEP_FOCUS, TISSUE_RULES } from '../../src/scene/materials.config';
import { hideShell } from './pixels';

// T807: per-step scope close-ups (steps 2–7) + per-structure-class colour table from a pick-ray grid.
// Each grid ray names the node under that pixel (BVH pick, scope pose), the screenshot gives its colour.
test.use({ viewport: { width: 1280, height: 720 } });

const GRID = { x: 64, y: 40, extent: 0.85 }; // NDC samples per axis, ±extent (inside the 5:4 mask)
// Fraction of grid rays that must land on the step's focus structures (T807b: steps 4 and 7 use poseFix re-aims).
const MIN_FOCUS_HITS: Readonly<Record<number, number>> = {
  2: 0.03,
  3: 0.03,
  4: 0.03,
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
const MAX_DARK_LUNG = 0.03; // fraction of lung-lobe rays (rest normals: step 3 28 %, step 5 7 %, step 6 6 %)
const DARK_STEPS = [3, 5, 6];

const classOf = (name: string): string => TISSUE_RULES.find(([re]) => re.test(name))?.[1] ?? FALLBACK_TISSUE;
const lum = ([r, g, b]: number[]): number => 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
const hex = (c: number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

test('per-step scope close-ups: focus structures visible, structure colour table', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const table: Record<number, Record<string, { n: number; rgb: string; luma: number }>> = {};
  const focusHits: Record<number, number> = {};
  const darkLung: Record<number, number> = {};

  for (let step = 2; step <= 7; step++) {
    await page.goto(`/?view=scope&step=${step}`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    await hideShell(page);
    await page.waitForFunction(
      () => window.__sim.rig?.transitioning === false && !window.__sim.guided?.transitioning,
    );
    await page.waitForTimeout(SETTLE_MS);
    const png = await page.screenshot({ path: `qa/screenshots/closeup-step${step}.png` });
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
    focusHits[step] = onFocus / hits.length;
    darkLung[step] = lung ? dark / lung : 0;
    table[step] = Object.fromEntries(
      Object.entries(sum).map(([cls, s]) => {
        const n = s[3] ?? 1;
        const rgb = s.slice(0, 3).map((v) => v / n);
        return [cls, { n, rgb: hex(rgb), luma: Math.round(lum(rgb)) }];
      }),
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
