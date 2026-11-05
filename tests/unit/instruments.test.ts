import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { instrumentGeom, instrumentLook } from '../../src/scene/instruments.config';
import { TOOL_IDS, buildInstruments } from '../../src/scene/instruments';
import { SLOTS } from '../../src/sim/hotbar';

function census(root: Object3D): { objects: number; geos: Set<BufferGeometry>; mats: Set<Material> } {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<Material>();
  let objects = 0;
  root.traverse((o) => {
    objects++;
    if ((o as Mesh).isMesh) {
      geos.add((o as Mesh).geometry);
      mats.add((o as Mesh).material as Material);
    }
  });
  return { objects, geos, mats };
}
const visibleTools = (set: ReturnType<typeof buildInstruments>): string[] =>
  TOOL_IDS.filter((id) => set.tools[id].visible);
const deepVisible = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

describe('instruments (CONTEXT §6.4)', () => {
  const set = buildInstruments();
  const before = census(set.root);

  it('covers every hotbar instrument slot and starts hidden', () => {
    expect(SLOTS.filter((s) => s.id !== 'hands').map((s) => s.id)).toEqual([...TOOL_IDS]);
    expect(visibleTools(set)).toEqual([]);
    expect(set.active).toBeNull();
  });

  it('shares a handful of geometries and materials; no clipping, transparency fixed', () => {
    expect(before.geos.size).toBeLessThanOrEqual(6);
    expect(before.mats.size).toBeLessThanOrEqual(7); // + white cautery shaft (T410), same program
    const programKeys = new Set<string>();
    for (const m of before.mats) {
      expect(m).toBeInstanceOf(MeshStandardMaterial);
      expect(m.clippingPlanes ?? []).toHaveLength(0);
      programKeys.add(String(m.transparent));
    }
    expect(programKeys.size).toBeLessThanOrEqual(2); // ≤ 2 programs (opaque + leader)
  });

  it('show/hide and sub-options only toggle visibility (counts stable)', () => {
    for (let round = 0; round < 3; round++) {
      for (const slot of SLOTS) {
        for (let sub = 0; sub < Math.max(1, slot.subOptions.length); sub++) {
          set.show(slot.id, sub);
          set.setJaw(round % 2);
          set.setGlow(round % 2);
          expect(visibleTools(set)).toEqual(slot.id === 'hands' ? [] : [slot.id]);
        }
      }
    }
    set.show(null);
    expect(visibleTools(set)).toEqual([]);
    const after = census(set.root);
    expect(after.objects).toBe(before.objects);
    expect([...after.geos]).toEqual([...before.geos]);
    expect([...after.mats]).toEqual([...before.mats]);
  });

  it('stapler sub-options swap curved tip / leader and cartridge colour', () => {
    const leaderOf = (): Mesh | undefined => {
      let found: Mesh | undefined;
      set.tools.stapler.traverse((o) => {
        if ((o as Mesh).isMesh && ((o as Mesh).material as Material).transparent) found = o as Mesh;
      });
      return found;
    };
    const cart = [...before.mats].find((m) => m.name === 'instrument:cartridge') as MeshStandardMaterial;
    set.show('stapler', 1);
    expect(deepVisible(leaderOf() as Mesh)).toBe(true);
    set.show('stapler', 2);
    expect(deepVisible(leaderOf() as Mesh)).toBe(false);
    expect(cart.color.getHexString()).toBe(instrumentLook.cartridge[2].slice(1));
  });

  it('jaws open by pivot rotation; tip stays near the origin when closed', () => {
    const box = new Box3();
    const size = new Vector3();
    set.show('clip');
    set.setJaw(0);
    set.root.updateMatrixWorld(true);
    box.setFromObject(set.tools.clip);
    const closed = box.getSize(size).y;
    expect(box.max.z).toBeCloseTo(0, 3);
    set.setJaw(1);
    set.root.updateMatrixWorld(true);
    box.setFromObject(set.tools.clip);
    const c = instrumentGeom.clip;
    expect(box.getSize(size).y).toBeGreaterThan(closed + c.jawLength * Math.sin(c.open / 2));
    set.setJaw(0);
  });

  it('cautery glow drives the emissive uniform only', () => {
    const mat = [...before.mats].find((m) => m.name === 'instrument:cautery') as MeshStandardMaterial;
    const v = mat.version;
    set.setGlow(1);
    expect(mat.emissiveIntensity).toBe(instrumentLook.cauteryGlow);
    set.setGlow(0);
    expect(mat.emissiveIntensity).toBe(0);
    expect(mat.version).toBe(v); // no needsUpdate → no recompile
  });
});
