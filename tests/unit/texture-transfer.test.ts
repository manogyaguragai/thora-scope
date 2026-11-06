import { describe, expect, test } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import anatomy from '../../src/content/anatomy.json' with { type: 'json' };
import { TISSUES } from '../../src/scene/materials.config';
import type { TissueClass } from '../../src/scene/materials.config';

interface Transfer {
  projectUVs(
    src: { pos: number[]; idx: number[]; uv: number[] },
    dst: { pos: number[]; nrm: number[] },
    rayM: number,
  ): { uv: Float32Array; rayMiss: number };
  uvCoverage(uv: ArrayLike<number>, idx: ArrayLike<number>, size: number): Uint8Array;
  dilate(pixels: Uint8Array, channels: number, mask: Uint8Array, size: number): number;
  sampleBilinear(
    pixels: Uint8Array,
    channels: number,
    size: number,
    u: number,
    v: number,
    out: number[],
  ): number[];
}
// Plain .mjs build script (no .d.ts): typed via the interface above (pattern of paraphrase.test.ts).
const PATH = '../../scripts/texture-transfer.mjs';
const lib = (): Promise<Transfer> => import(PATH) as Promise<Transfer>;

// Unit square in the z = 0 plane, UV = (0.4 x, y).
const SRC = {
  pos: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  uv: [0, 0, 0.4, 0, 0.4, 1, 0, 1],
  idx: [0, 1, 2, 0, 2, 3],
};
const RAY_M = 0.01;

describe('T854 colour transfer', () => {
  test('a dst vertex takes the src UV along its normal, either side; closest point beyond the ray reach', async () => {
    const { projectUVs } = await lib();
    const r = projectUVs(
      SRC,
      { pos: [0.5, 0.25, 0.003, 0.25, 0.75, -0.003, 0.5, 0.5, 0.5], nrm: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
      RAY_M,
    );
    expect(Array.from(r.uv).map((x) => +x.toFixed(4))).toEqual([0.2, 0.25, 0.1, 0.75, 0.2, 0.5]);
    expect(r.rayMiss).toBe(1); // the vertex 0.5 m away
  });

  test('dilate fills the empty atlas from covered texels; bilinear sampling interpolates', async () => {
    const { uvCoverage, dilate, sampleBilinear } = await lib();
    const size = 8;
    const mask = uvCoverage([0, 0, 0.5, 0, 0, 0.5], [0, 1, 2], size);
    expect(mask[0]).toBe(1);
    expect(mask[size * size - 1]).toBe(0);
    const px = new Uint8Array(size * size * 3).map((_, i) => (mask[Math.floor(i / 3)] ? 200 : 0));
    const covered = dilate(px, 3, mask, size);
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(0.5);
    expect(px.every((v) => v === 200)).toBe(true);
    const ramp = Uint8Array.from({ length: 4 * 3 }, (_, i) => (Math.floor(i / 3) % 2 ? 100 : 0)); // 2×2, x ramp
    expect(sampleBilinear(ramp, 3, 2, 0.5, 0.5, [0, 0, 0])).toEqual([50, 50, 50]);
  });

  test('the built glb: transferred lobes carry COLOR_0 whose mean luma matches the class mapLuma', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read('public/models/thorax_sim.opt.glb');
    const names = Object.keys(anatomy.textureTransfer).filter((k) => !k.startsWith('$'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const prim = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === name)
        ?.getMesh()
        ?.listPrimitives()[0];
      const color = prim?.getAttribute('COLOR_0');
      expect(color, name).toBeTruthy();
      const c = [0, 0, 0];
      let luma = 0;
      const n = color?.getCount() ?? 1;
      for (let i = 0; i < n; i++) {
        color?.getElement(i, c);
        luma += (0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0)) / n;
      }
      const cls = (anatomy.structures as Record<string, { tissue?: TissueClass }>)[name]?.tissue;
      if (!cls) throw new Error(`${name}: no manifest tissue`);
      expect(Math.abs(luma - TISSUES[cls].mapLuma), name).toBeLessThan(0.03);
    }
  }, 60_000);
});
