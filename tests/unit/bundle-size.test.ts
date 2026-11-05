import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';

// docs/PERF.md: initial JS (gzip, before lazy chunks) ≤ 250 KB.
const INITIAL_JS_BUDGET_KB = 250;
const DIST = 'dist';
const html = `${DIST}/index.html`;
const strict = Boolean(process.env.CI_STRICT);
const LAZY_CHUNKS = [
  'physiologyPanel',
  'perfOverlay',
  'wireM3',
  'wireM4',
  'helpOverlay',
  'wireM6',
  'quiz',
  'wireM5',
  'debrief',
  'wireM7',
]; // dynamic import()

if (!existsSync(html) && !strict)
  console.warn('bundle-size: dist missing, skipping (run npm run build first)');

test.skipIf(!existsSync(html) && !strict)('initial JS (entry + modulepreload) gzip within budget', () => {
  expect(existsSync(html), 'dist/index.html missing: run npm run build first').toBe(true);
  const src = readFileSync(html, 'utf8');
  const entries = [
    ...src.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
    ...src.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  ].map((m) => m[1] ?? '');
  expect(entries.length).toBeGreaterThan(0);
  const bytes = entries.reduce((sum, p) => sum + gzipSync(readFileSync(`${DIST}${p}`)).length, 0);
  const kb = bytes / 1024;
  console.log(`initial JS gzip: ${kb.toFixed(1)} KB / ${INITIAL_JS_BUDGET_KB} KB (${entries.join(', ')})`);
  expect(kb).toBeLessThanOrEqual(INITIAL_JS_BUDGET_KB);
});

test.skipIf(!existsSync(html) && !strict)('panel chunks are lazy (emitted, not in the initial JS)', () => {
  const src = readFileSync(html, 'utf8');
  const assets = readdirSync(`${DIST}/assets`);
  for (const name of LAZY_CHUNKS) {
    const chunk = assets.find((f) => f.startsWith(`${name}-`) && f.endsWith('.js'));
    expect(chunk, `${name} chunk missing`).toBeDefined();
    expect(src).not.toContain(chunk);
  }
});
