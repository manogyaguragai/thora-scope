// `?perf` overlay (§6.10 Tooling): reads window.__perf at overlay.hz, rewrites text nodes only when changed.
// Lazy-load with import('./ui/perfOverlay'); no three.js import (type-only below).
import type { PerfStats } from '../core/perf';
import { config } from '../core/config';

const ROWS: [string, (p: PerfStats, ratio: number) => string][] = [
  ['fps', (p) => p.fps.toFixed(0)],
  ['p95 ms', (p) => p.frameTimeP95.toFixed(1)],
  ['draws', (p) => String(p.drawCalls)],
  ['tris', (p) => String(p.triangles)],
  ['programs', (p) => String(p.programs)],
  ['textures', (p) => String(p.textures)],
  ['px ratio', (_, r) => r.toFixed(2)],
  ['preset', (p) => p.preset],
];

/** pixelRatio: the renderer's current ratio (adaptive), read at overlay.hz. */
export function mountPerfOverlay(pixelRatio: () => number, parent: HTMLElement = document.body): void {
  const root = document.createElement('div');
  root.id = 'perf-overlay';
  root.setAttribute('aria-hidden', 'true'); // dev readout; 4 Hz updates would flood a screen reader
  root.style.cssText = `position:fixed;top:var(--space-1);right:var(--space-1);z-index:10;pointer-events:none;
display:grid;grid-template-columns:auto auto;column-gap:var(--space-1);padding:var(--space-1);
background:var(--color-surface);color:var(--color-text);border:var(--border-width) solid var(--color-border);
border-radius:var(--radius-sm);font:var(--font-size-small)/1.4 var(--font-sans);font-variant-numeric:tabular-nums`;
  const nodes = ROWS.map(([label]) => {
    const name = document.createElement('span');
    name.textContent = label;
    name.style.color = 'var(--color-muted)';
    const value = document.createElement('span');
    value.style.textAlign = 'right';
    const text = value.appendChild(document.createTextNode('—'));
    root.append(name, value);
    return text;
  });
  parent.append(root);

  setInterval(() => {
    if (document.hidden || !window.__perf) return;
    const ratio = pixelRatio();
    for (let i = 0; i < ROWS.length; i++) {
      const s = ROWS[i]?.[1](window.__perf, ratio) ?? '';
      const node = nodes[i];
      if (node && node.data !== s) node.data = s;
    }
  }, 1000 / config.perf.overlayHz);
}
