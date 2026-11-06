// T834 division stumps: manifest pairing, junction fit on a synthetic Y-branch, morph-delta copy, visibility.
import { BufferAttribute, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import {
  buildStumpGeometry,
  buildStumps,
  copyMorphDeltas,
  fitJunction,
  geodesic,
  getStumps,
  stumpPairs,
} from '../../src/scene/stumps';
import { STUMPS } from '../../src/scene/stumps.config';

const R_PARENT = 0.005;
const R_BRANCH = 0.002;
/** Parent: closed cylinder along Y through the origin. */
const parentGeom = (): BufferGeometry => new CylinderGeometry(R_PARENT, R_PARENT, 0.06, 48, 60);
/** Branch: open cylinder from the parent axis outward along `dir` (overlapping into the parent like v7). */
function branchGeom(dir: Vector3): BufferGeometry {
  const g = new CylinderGeometry(R_BRANCH, R_BRANCH, 0.03, 32, 120, true).translate(0, 0.015, 0);
  const q = new Mesh().quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  return g.applyQuaternion(q);
}

describe('stump pairs (manifest)', () => {
  it('sub-branches hang on their common segment, commons on their group tree', () => {
    const m = new Map(stumpPairs());
    expect(m.size).toBe(9);
    expect(m.get('middle_lobe_vein')).toBe('pulmonary_vein_tree');
    expect(m.get('middle_lobe_vein_V4')).toBe('middle_lobe_vein');
    expect(m.get('middle_lobe_bronchus')).toBe('bronchial_tree');
    expect(m.get('middle_lobe_bronchus_B5')).toBe('middle_lobe_bronchus');
    expect(m.get('middle_lobe_artery')).toBe('pulmonary_artery_tree');
    expect(m.get('middle_lobe_artery_A4')).toBe('middle_lobe_artery');
  });
});

describe('junction fit (synthetic Y-branch)', () => {
  const bvh = new MeshBVH(parentGeom());
  for (const deg of [90, 60]) {
    it(`branch at ${deg}° to the parent: axis, radius, base`, () => {
      const t = (deg * Math.PI) / 180;
      const dir = new Vector3(Math.sin(t), Math.cos(t), 0);
      const j = fitJunction(branchGeom(dir).getAttribute('position') as BufferAttribute, bvh);
      expect(j).not.toBeNull();
      if (!j) return;
      expect((Math.acos(Math.min(1, j.axis.dot(dir))) * 180) / Math.PI).toBeLessThan(6);
      expect(j.radius).toBeGreaterThan(R_BRANCH * 0.85);
      expect(j.radius).toBeLessThan(R_BRANCH * 1.15);
      const exit = dir.clone().multiplyScalar(R_PARENT / Math.sin(t)); // axis meets the parent surface
      expect(j.base.distanceTo(exit)).toBeLessThan(0.0008);
    });
  }
  it('no junction when the segment does not touch the parent', () => {
    const far = branchGeom(new Vector3(1, 0, 0)).translate(0.05, 0, 0);
    expect(fitJunction(far.getAttribute('position') as BufferAttribute, bvh)).toBeNull();
  });
});

describe('stump geometry + morph-delta copy', () => {
  const parent = parentGeom();
  const n = parent.getAttribute('position').count;
  const shift = new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? 0.01 : 0)); // pure translation key
  const scale = Float32Array.from(parent.getAttribute('position').array as Float32Array, (v) => v * 0.5); // linear
  parent.morphAttributes.position = [new BufferAttribute(shift, 3), new BufferAttribute(scale, 3)];
  parent.morphTargetsRelative = true;
  const bvh = new MeshBVH(parent);
  const j = fitJunction(branchGeom(new Vector3(1, 0, 0)).getAttribute('position') as BufferAttribute, bvh);

  it('builds a closed tissue group + staples group + clip group, flush on the parent', () => {
    expect(j).not.toBeNull();
    const g = buildStumpGeometry(j as NonNullable<typeof j>);
    expect(g.groups).toHaveLength(3);
    expect(g.groups[1]?.count).toBeGreaterThan(0);
    expect(g.groups[2]?.count).toBeGreaterThan(0);
    // Pulse carrier: 0 on tissue, unit face normal on the metal.
    const car = g.getAttribute('carrier');
    const idx = g.index as BufferAttribute;
    expect(Math.hypot(car.getX(idx.getX(0)), car.getY(idx.getX(0)), car.getZ(idx.getX(0)))).toBe(0);
    const mv = idx.getX(g.groups[1]?.start ?? 0);
    expect(Math.hypot(car.getX(mv), car.getY(mv), car.getZ(mv))).toBeCloseTo(1, 5);
    g.computeBoundingBox();
    const box = g.boundingBox;
    expect(box?.min.x).toBeLessThan(R_PARENT); // starts inside the parent (no gap)
    expect(box?.max.x).toBeGreaterThan(R_PARENT + R_BRANCH); // sticks out a few mm
    expect(box?.max.x).toBeLessThan(R_PARENT + 0.01);
  });

  it('copies parent deltas at the nearest parent surface point', () => {
    const g = buildStumpGeometry(j as NonNullable<typeof j>);
    copyMorphDeltas(g, parent, bvh);
    const [a, b] = g.morphAttributes.position ?? [];
    expect(g.morphTargetsRelative).toBe(true);
    expect(a?.count).toBe(g.getAttribute('position').count);
    for (let i = 0; i < (a?.count ?? 0); i += 7) {
      expect(a?.getX(i)).toBeCloseTo(0.01, 6);
      expect(a?.getY(i)).toBeCloseTo(0, 6);
    }
    // Linear field: the delta is half the nearest parent point, so ≈ half the parent radius off-axis.
    const d = new Vector3().fromBufferAttribute(b as BufferAttribute, 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(R_PARENT * 0.5, 3);
  });
});

describe('buildStumps visibility', () => {
  it('stump shows iff the segment is divided (hidden) and the parent is shown; follows material swaps', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial();
    const tree = new Mesh(parentGeom(), mat);
    tree.name = 'pulmonary_vein_tree';
    const seg = new Mesh(branchGeom(new Vector3(1, 0, 0)), mat);
    seg.name = 'middle_lobe_vein';
    root.add(tree, seg);
    const stumps = buildStumps(root);
    expect(stumps.list).toHaveLength(1); // V4/V5 + other groups absent from this scene → skipped
    const s = stumps.list[0];
    if (!s) return;
    expect(s.mesh.parent).toBe(tree);
    stumps.sync();
    expect(s.mesh.visible).toBe(false);
    seg.visible = false;
    const xray = new MeshStandardMaterial();
    tree.material = xray;
    stumps.sync();
    expect(s.mesh.visible).toBe(true);
    expect(s.mats[0]).toBe(xray);
    tree.visible = false; // parent hidden → stump hidden through the hierarchy
    let shown = true;
    s.mesh.traverseAncestors((o) => (shown &&= o.visible));
    expect(shown).toBe(false);
  });
});

describe('T841 two-stump split', () => {
  it('geodesic distances grow along a tube from its seed ring', () => {
    const g = new CylinderGeometry(0.002, 0.002, 0.03, 16, 30, true); // seams: UV-split vertices get welded
    const pos = g.getAttribute('position') as BufferAttribute;
    const seeds: number[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.0149) seeds.push(i);
    const d = geodesic(pos, g.index ? (g.index.array as ArrayLike<number>) : null, seeds);
    for (let i = 0; i < pos.count; i += 13)
      expect(d[i] ?? 0).toBeGreaterThanOrEqual(pos.getY(i) + 0.015 - 1e-6);
    let max = 0;
    for (const v of d) max = Math.max(max, v);
    expect(max).toBeGreaterThan(0.029);
    expect(max).toBeLessThan(0.036);
  });

  it('splits a segment into proximal + distal pieces; division hides the proximal one and shows both caps', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial();
    const tree = new Mesh(parentGeom(), mat);
    tree.name = 'pulmonary_vein_tree';
    const seg = new Mesh(branchGeom(new Vector3(1, 0, 0)), mat);
    seg.name = 'middle_lobe_vein';
    root.add(tree, seg);
    const stumps = buildStumps(root);
    expect(getStumps()).toBe(stumps);
    expect(stumps.splits).toHaveLength(1);
    const sp = stumps.split('middle_lobe_vein');
    if (!sp) return;
    const tris = (m: Mesh): number => (m.geometry.index?.count ?? 0) / 3;
    expect(tris(sp.proximal) + tris(sp.distal)).toBe(tris(seg));
    expect(seg.layers.isEnabled(0)).toBe(false); // the logical mesh no longer draws itself
    expect(seg.layers.isEnabled(STUMPS.split.layer)).toBe(true);
    // Proximal piece = the junction side (small x), distal = the far end.
    sp.proximal.geometry.computeBoundingBox();
    sp.distal.geometry.computeBoundingBox();
    expect(sp.proximal.geometry.boundingBox?.min.x).toBeLessThan(R_PARENT);
    expect(sp.distal.geometry.boundingBox?.max.x).toBeGreaterThan(0.028);
    stumps.sync();
    expect([sp.proximal.visible, sp.distal.visible, sp.cap.visible, sp.stump?.mesh.visible]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // Live cut point sits between the pieces, axis points back to the parent.
    const p = new Vector3();
    const a = new Vector3();
    expect(stumps.cutAt('middle_lobe_vein', p, a)).toBeGreaterThan(R_BRANCH * 0.8);
    expect(a.x).toBeLessThan(-0.95);
    expect(p.x).toBeGreaterThan(sp.proximal.geometry.boundingBox?.min.x ?? 0);
    expect(p.x).toBeLessThan(sp.distal.geometry.boundingBox?.min.x ?? 0);
    expect(stumps.divide('middle_lobe_vein', 'clip')).toBe(true);
    seg.visible = false;
    stumps.sync();
    expect([sp.proximal.visible, sp.distal.visible, sp.cap.visible, sp.stump?.mesh.visible]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(sp.capMats[1]?.visible).toBe(false); // clip mode: staple rows off, clip on
    expect(sp.capMats[2]?.visible).toBe(true);
    // Cap closes the distal piece's open end: its dome reaches back to the cut.
    sp.cap.geometry.computeBoundingBox();
    expect(sp.cap.geometry.boundingBox?.min.x).toBeLessThan(p.x + 0.0015);
    stumps.reset();
    expect(sp.capMats[1]?.visible).toBe(true);
    stumps.sync(); // guided steps: hidden segment, shown tree = divided
    expect(sp.cap.visible).toBe(true);
    tree.visible = false; // whole group off: nothing of it shows
    stumps.sync();
    expect(sp.distal.visible).toBe(false);
  });
});
