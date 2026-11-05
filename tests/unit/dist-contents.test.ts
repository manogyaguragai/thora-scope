import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// CLAUDE.md hard rules: nothing from assets_src/ (ref-frames, book, transcript, source glb) ships;
// the only model is thorax_sim.opt.glb; KTX2 decoders sit under decoders/. Reads whatever dist/ holds.
const DIST = 'dist';
const SRC = 'assets_src';
const MODEL = 'thorax_sim.opt.glb';
const DECODERS = ['basis_transcoder.js', 'basis_transcoder.wasm'];
const MODEL_EXT = /\.(glb|gltf)$/i;

const files = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const visible = (dir: string): string[] => readdirSync(dir).filter((f) => !f.startsWith('.'));

if (!existsSync(DIST)) console.warn('dist-contents: dist missing, skipping (run npm run build first)');

describe.skipIf(!existsSync(DIST))('dist/ release contents', () => {
  const dist = existsSync(DIST) ? files(DIST) : [];

  test('no assets_src / ref-frames paths', () => {
    const bad = dist.filter((p) => /assets_src|ref-frames/i.test(relative(DIST, p)));
    expect(bad).toEqual([]);
  });

  test.skipIf(!existsSync(SRC))('no assets_src file by name or content hash', () => {
    const src = files(SRC).filter((p) => !basename(p).startsWith('.'));
    const names = new Set(src.map((p) => basename(p)));
    expect(dist.filter((p) => names.has(basename(p)))).toEqual([]);
    const hashes = new Set(src.map(sha));
    expect(dist.filter((p) => hashes.has(sha(p))).map((p) => relative(DIST, p))).toEqual([]);
  });

  test(`models/ holds only ${MODEL}; no other model anywhere`, () => {
    expect(visible(join(DIST, 'models'))).toEqual([MODEL]);
    const models = dist.filter((p) => MODEL_EXT.test(p)).map((p) => relative(DIST, p));
    expect(models).toEqual([join('models', MODEL)]);
  });

  test('decoders sit under decoders/', () => {
    expect(visible(join(DIST, 'decoders')).sort()).toEqual(DECODERS);
  });

  test("no basis_transcoder copy outside decoders/ (vite.config strips three's bundled default)", () => {
    const dupes = dist
      .map((p) => relative(DIST, p))
      .filter((p) => /basis_transcoder/.test(p) && !p.startsWith('decoders'));
    expect(dupes).toEqual([]);
  });
});
