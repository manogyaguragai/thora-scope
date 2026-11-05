import { RGBAFormat, RGFormat } from 'three';
import { describe, expect, it } from 'vitest';
import { instrumentTex as T } from '../../src/scene/instruments.config';
import { buildInstrumentTextures } from '../../src/scene/instrumentTextures';

describe('procedural instrument textures (T825)', () => {
  const a = buildInstrumentTextures();
  const sizes = {
    steel: [T.steel.size, T.steel.size],
    shaft: [T.shaft.size, T.shaft.size],
    gauze: [T.gauze.size, T.gauze.size],
    cartridge: [T.cartridge.width, T.cartridge.length],
  } as const;

  it('is deterministic (seeded): two builds give identical texels', () => {
    const b = buildInstrumentTextures();
    for (const k of Object.keys(sizes) as (keyof typeof sizes)[])
      for (const slot of ['map', 'roughnessMap', 'normalMap'] as const)
        expect(b[k][slot].image.data).toEqual(a[k][slot].image.data);
  });

  it('has config sizes, fixed formats and mipmaps', () => {
    for (const [k, [w, h]] of Object.entries(sizes)) {
      const s = a[k as keyof typeof sizes];
      for (const t of [s.map, s.roughnessMap, s.normalMap]) {
        expect([t.image.width, t.image.height]).toEqual([w, h]);
        expect(t.generateMipmaps).toBe(true);
      }
      expect(s.map.format).toBe(RGBAFormat);
      expect(s.roughnessMap.format).toBe(RGFormat);
      expect(s.map.image.data?.length).toBe(w * h * 4);
      expect(s.roughnessMap.image.data?.length).toBe(w * h * 2);
    }
  });

  it('soil / soak masks span 0…1 and normals point out of the surface', () => {
    for (const k of ['steel', 'gauze'] as const) {
      const d = a[k].map.image.data as Uint8Array;
      let [lo, hi] = [255, 0];
      for (let i = 3; i < d.length; i += 4) [lo, hi] = [Math.min(lo, d[i] ?? 0), Math.max(hi, d[i] ?? 0)];
      expect(lo).toBeLessThan(8); // stretched mask: soil starts somewhere at low amounts …
      expect(hi).toBeGreaterThan(247); // … and covers everything only at amount 1
    }
    for (const s of Object.values(a)) {
      const n = s.normalMap.image.data as Uint8Array;
      let minZ = 255;
      for (let i = 2; i < n.length; i += 4) minZ = Math.min(minZ, n[i] ?? 0);
      expect(minZ).toBeGreaterThanOrEqual(127); // tangent-space z ≥ 0
    }
  });
});
