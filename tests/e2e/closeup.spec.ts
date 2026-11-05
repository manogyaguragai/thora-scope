import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FALLBACK_TISSUE, STEP_FOCUS, TISSUE_RULES } from '../../src/scene/materials.config';
import { hideShell } from './pixels';

// T807: per-step scope close-ups (steps 2–7) + per-structure-class colour table from a pick-ray grid.
// Each grid ray names the node under that pixel (BVH pick, scope pose), the screenshot gives its colour.
test.use({ viewport: { width: 1280, height: 720 } });

const GRID = { x: 64, y: 40, extent: 0.85 }; // NDC samples per axis, ±extent (inside the 5:4 mask)
const MIN_FOCUS_HITS = 0.03; // fraction of grid rays that must land on the step's focus structures
const SETTLE_MS = 1500; // auto-exposure

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

  for (let step = 2; step <= 7; step++) {
    await page.goto(`/?view=scope&step=${step}`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    await hideShell(page);
    await page.waitForFunction(() => window.__sim.rig?.transitioning === false && !window.__sim.guided?.transitioning);
    await page.waitForTimeout(SETTLE_MS);
    const png = await page.screenshot({ path: `qa/screenshots/closeup-step${step}.png` });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const hits = await page.evaluate((g) => {
      const out: (string | null)[] = [];
      for (let j = 0; j < g.y; j++)
        for (let i = 0; i < g.x; i++)
          out.push(
            window.__sim.m3?.pickAt(-g.extent + (2 * g.extent * i) / (g.x - 1), g.extent - (2 * g.extent * j) / (g.y - 1)) ??
              null,
          );
      return out;
    }, GRID);
    const sum: Record<string, number[]> = {};
    const focus = STEP_FOCUS[step] ?? [];
    let onFocus = 0;
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
      s[3] = (s[3] ?? 0) + 1;
    });
    focusHits[step] = onFocus / hits.length;
    table[step] = Object.fromEntries(
      Object.entries(sum).map(([cls, s]) => {
        const n = s[3] ?? 1;
        const rgb = s.slice(0, 3).map((v) => v / n);
        return [cls, { n, rgb: hex(rgb), luma: Math.round(lum(rgb)) }];
      }),
    );
  }
  writeFileSync('qa/closeup-colours.json', JSON.stringify({ focusHits, table }, null, 2));
  for (const [step, row] of Object.entries(table))
    console.log(
      `step ${step} focus ${(100 * (focusHits[Number(step)] ?? 0)).toFixed(1)}% · ` +
        Object.entries(row)
          .sort((a, b) => b[1].n - a[1].n)
          .map(([c, v]) => `${c} ${v.rgb} L${v.luma} n${v.n}`)
          .join(' · '),
    );
  for (let step = 2; step <= 7; step++) expect(focusHits[step], `step ${step} focus`).toBeGreaterThan(MIN_FOCUS_HITS);
  expect(errors).toEqual([]);
});
