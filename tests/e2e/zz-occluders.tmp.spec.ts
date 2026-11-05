import { test } from '@playwright/test';
import { STEP_FOCUS } from '../../src/scene/materials.config';
test.use({ viewport: { width: 1280, height: 720 } });
test('occluders', async ({ page }) => {
  test.setTimeout(300_000);
  for (let step = 2; step <= 7; step++) {
    await page.goto(`/?view=scope&step=${step}`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
    const r = await page.evaluate((focus) => {
      const m3 = window.__sim.m3!;
      const all = [...m3.layers.groups.values()].flat();
      const grid = (): (string | null)[] => {
        const o: (string | null)[] = [];
        for (let j = 0; j < 40; j++) for (let i = 0; i < 64; i++) o.push(m3.pickAt(-0.85 + (1.7 * i) / 63, 0.85 - (1.7 * j) / 39));
        return o;
      };
      const base = grid();
      for (const n of all) if (!focus.includes(n)) m3.layers.setVisible(n, false);
      const only = grid();
      for (const n of all) m3.layers.setVisible(n, true);
      const occ: Record<string, number> = {};
      const tgt: Record<string, number> = {};
      let cells = 0;
      only.forEach((n, k) => {
        if (!n) return;
        cells++;
        tgt[n] = (tgt[n] ?? 0) + 1;
        const b = base[k] ?? 'none';
        if (!focus.includes(b)) occ[b] = (occ[b] ?? 0) + 1;
      });
      const vis: Record<string, number> = {};
      base.forEach((n) => n && (vis[n] = (vis[n] ?? 0) + 1));
      return { cells, tgt, occ, vis };
    }, [...(STEP_FOCUS[step] ?? [])]);
    const top = (o: Record<string, number>): string => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`STEP ${step} focusCells ${r.cells} tgt[${top(r.tgt)}]\n  occ[${top(r.occ)}]\n  vis[${top(r.vis)}]`);
  }
});
