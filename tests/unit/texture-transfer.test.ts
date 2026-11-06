import { describe, expect, test } from 'vitest';

interface Mesh {
  pos: number[];
  idx: number[];
}
interface Transfer {
  transferUVs(
    src: Mesh & { uv: number[] },
    dst: Mesh & { nrm: number[] },
    rayM: number,
    smooth: number,
  ): { remap: Uint32Array; uv: Float32Array; index: Uint32Array; seamTris: number; rayMiss: number };
  uvCoverage(uv: ArrayLike<number>, idx: ArrayLike<number>, size: number): Uint8Array;
  dilate(pixels: Uint8Array, channels: number, mask: Uint8Array, size: number): number;
}
// Plain .mjs build script (no .d.ts): typed via the interface above (pattern of paraphrase.test.ts).
const PATH = '../../scripts/texture-transfer.mjs';
const lib = (): Promise<Transfer> => import(PATH) as Promise<Transfer>;

// Two unit squares side by side in the z=0 plane (x 0..1 and 1..2), split at x=1 into two UV islands: the left
// square maps to u 0..0.4, the right to u 0.6..1 (vertices at x=1 duplicated, as glTF does at a seam).
const SRC = {
  pos: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0],
  uv: [0, 0, 0.4, 0, 0.4, 1, 0, 1, 0.6, 0, 1, 0, 1, 1, 0.6, 1],
  idx: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
};

const UP = [0, 0, 1, 0, 0, 1, 0, 0, 1]; // dst normals (+z)
const RAY_M = 0.01;

describe('T854 texture transfer', () => {
  test('a dst vertex takes the UV of its closest src point', async () => {
    const { transferUVs } = await lib();
    // One small triangle 3 mm above the left square, away from the seam.
    const r = transferUVs(
      SRC,
      { pos: [0.2, 0.2, 0.003, 0.4, 0.2, 0.003, 0.2, 0.5, 0.003], idx: [0, 1, 2], nrm: UP },
      RAY_M,
      0,
    );
    expect(r.seamTris).toBe(0);
    expect(Array.from(r.remap)).toEqual([0, 1, 2]);
    expect(r.uv[0]).toBeCloseTo(0.08);
    expect(r.uv[1]).toBeCloseTo(0.2);
    expect(r.uv[4]).toBeCloseTo(0.08);
    expect(r.uv[5]).toBeCloseTo(0.5);
  });

  test('a triangle straddling a UV seam is laid onto one island (no interpolation across the atlas)', async () => {
    const { transferUVs } = await lib();
    // Centroid x ≈ 0.93 (left island); the x=1.2 corner belongs to the right island and gets split + extrapolated.
    const r = transferUVs(
      SRC,
      { pos: [0.8, 0.2, 0, 1.2, 0.2, 0, 0.8, 0.6, 0], idx: [0, 1, 2], nrm: UP },
      RAY_M,
      0,
    );
    expect(r.seamTris).toBe(1);
    expect(r.remap.length).toBe(4);
    expect(r.remap[3]).toBe(1);
    expect(Array.from(r.index)).toEqual([0, 3, 2]);
    expect(r.uv[6]).toBeCloseTo(0.48); // left-island affine map at x = 1.2 (u = 0.4 x), not the right island's 0.64
    for (const u of r.uv) expect(u).toBeGreaterThanOrEqual(0);
  });

  test('dilate fills the empty atlas from the nearest covered texel', async () => {
    const { uvCoverage, dilate } = await lib();
    const size = 8;
    const mask = uvCoverage([0, 0, 0.5, 0, 0, 0.5], [0, 1, 2], size);
    expect(mask[0]).toBe(1);
    expect(mask[size * size - 1]).toBe(0);
    const px = new Uint8Array(size * size).map((_, i) => (mask[i] ? 200 : 0));
    const covered = dilate(px, 1, mask, size);
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(0.5);
    expect(px.every((v) => v === 200)).toBe(true);
  });
});
