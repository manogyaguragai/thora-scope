import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { describe, expect, it } from 'vitest';
import { applyMaterials } from '../../src/scene/materials';
import { pickNearest, projectLabel } from '../../src/ui/labels3d';
import { combineVisible, createLayers, cutawayPlane, groupLabel } from '../../src/ui/layersPanel';
import type { CutAxis, ViewingMaterials } from '../../src/ui/layersPanel';

function scene(names: string[]): Group {
  const g = new Group();
  for (const name of names) {
    const m = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    m.name = name;
    g.add(m);
  }
  return g;
}

function fakes() {
  const calls: string[] = [];
  const mat: ViewingMaterials = {
    setXray: (on) => calls.push(`xray:${on}`),
    setOpacity: (mesh, a) => calls.push(`opacity:${mesh.name}:${a}`),
    setCutawayPlane: (n, c) => calls.push(`plane:${n.toArray().join(',')}:${c}`),
    parkCutaway: () => calls.push('park'),
  };
  return { calls, mat };
}

const LOBES = ['lung_middle_lobe_right', 'lung_upper_lobe_right'];

describe('visibility combine rule: visible = stepVisible && userVisible', () => {
  it('truth table', () => {
    expect([combineVisible(true, true), combineVisible(true, false), combineVisible(false, true)]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('a user "show" never un-hides a step-hidden node; a user "hide" sticks', () => {
    const root = scene(LOBES);
    const stepHidden = new Set(['lung_upper_lobe_right']);
    const layers = createLayers({
      lookup: (n) => root.getObjectByName(n),
      stepVisible: (n) => !stepHidden.has(n),
      bounds: new Box3(),
      materials: fakes().mat,
    });
    const rml = root.getObjectByName('lung_middle_lobe_right') as Mesh;
    const rul = root.getObjectByName('lung_upper_lobe_right') as Mesh;
    layers.setVisible('lung_upper_lobe_right', true);
    expect(rul.visible).toBe(false);
    layers.setVisible('lung_middle_lobe_right', false);
    expect(rml.visible).toBe(false);
    expect(layers.isUserVisible('lung_middle_lobe_right')).toBe(false);
    layers.setVisible('lung_middle_lobe_right', true);
    expect(rml.visible).toBe(true);
    expect(layers.groups.get('Lobes')).toEqual(LOBES.slice().sort());
  });
});

describe('opacity / X-ray swap pre-compiled variants', () => {
  it('opacity calls setOpacity per mesh of the node (fakes)', () => {
    const root = scene(LOBES);
    const { calls, mat } = fakes();
    const layers = createLayers({
      lookup: (n) => root.getObjectByName(n),
      stepVisible: () => true,
      bounds: new Box3(),
      materials: mat,
    });
    layers.setOpacity('lung_middle_lobe_right', 0.3);
    layers.setXray(true);
    layers.setXray(false);
    expect(calls).toEqual(['opacity:lung_middle_lobe_right:0.3', 'xray:true', 'xray:false']);
  });

  it('real variants: opacity < 1 swaps to the transparent variant; no material flag ever changes', () => {
    const root = scene(LOBES);
    applyMaterials(root);
    const mesh = root.getObjectByName('lung_middle_lobe_right') as Mesh;
    const opaque = mesh.material as Material;
    const layers = createLayers({
      lookup: (n) => root.getObjectByName(n),
      stepVisible: () => true,
      bounds: new Box3(),
    });
    layers.setOpacity('lung_middle_lobe_right', 0.3);
    const transparent = mesh.material as Material;
    expect(transparent).not.toBe(opaque);
    expect([opaque.transparent, transparent.transparent]).toEqual([false, true]);
    expect(transparent.opacity).toBeCloseTo(0.3);
    const versions = [opaque.version, transparent.version];
    layers.setOpacity('lung_middle_lobe_right', 1);
    expect(mesh.material).toBe(opaque);
    layers.setXray(true);
    expect(mesh.material).toBe(transparent);
    layers.setXray(false);
    expect(mesh.material).toBe(opaque);
    expect([opaque.transparent, transparent.transparent]).toEqual([false, true]);
    expect([opaque.version, transparent.version]).toEqual(versions); // no needsUpdate → no recompile
  });
});

describe('cut-away plane math', () => {
  it.each([0, 1, 2] as CutAxis[])('axis %i: default clips beyond pos, flip clips below', (axis) => {
    const n = new Vector3();
    const pos = 0.05;
    const above = new Vector3().setComponent(axis, pos + 0.01);
    const below = new Vector3().setComponent(axis, pos - 0.01);
    const plane = new Plane(n, cutawayPlane(axis, pos, false, n));
    expect(n.getComponent(axis)).toBe(-1);
    expect(plane.distanceToPoint(above)).toBeLessThan(0); // clipped
    expect(plane.distanceToPoint(below)).toBeGreaterThan(0);
    plane.constant = cutawayPlane(axis, pos, true, n);
    expect(plane.distanceToPoint(above)).toBeGreaterThan(0);
    expect(plane.distanceToPoint(below)).toBeLessThan(0);
  });

  it('controller: disabled parks the plane, enabled sets normal/constant', () => {
    const { calls, mat } = fakes();
    const layers = createLayers({
      lookup: () => undefined,
      stepVisible: () => true,
      bounds: new Box3(),
      materials: mat,
    });
    layers.setCutaway(true, 2, 0.1, false);
    layers.setCutaway(true, 0, 0.1, true);
    layers.setCutaway(false, 0, 0, false);
    expect(calls).toEqual(['plane:0,0,-1:0.1', 'plane:1,0,0:-0.1', 'park']);
  });
});

describe('label projection culling', () => {
  const cam = new PerspectiveCamera(90, 1000 / 400, 0.01, 10); // at origin looking −Z
  cam.updateMatrixWorld();
  const out = { x: 0, y: 0 };
  const W = 1000;
  const H = 400;

  it('centre point lands mid-viewport', () => {
    expect(projectLabel(new Vector3(0, 0, -1), cam, W, H, true, out)).toBe(true);
    expect(out.x).toBeCloseTo(500);
    expect(out.y).toBeCloseTo(200);
  });

  it('behind the camera / off-screen are culled', () => {
    expect(projectLabel(new Vector3(0, 0, 1), cam, W, H, false, out)).toBe(false);
    expect(projectLabel(new Vector3(10, 0, -1), cam, W, H, false, out)).toBe(false);
  });

  it('outside the 5:4 scope mask is culled only when masked', () => {
    // NDC x ≈ 0.9 → 950 px; the 5:4 mask in a 1000×400 viewport spans x 250–750.
    const p = new Vector3(0.9 * 2.5, 0, -1);
    expect(projectLabel(p, cam, W, H, false, out)).toBe(true);
    expect(out.x).toBeCloseTo(950);
    expect(projectLabel(p, cam, W, H, true, out)).toBe(false);
  });
});

describe('label budget + group names', () => {
  it('pickNearest keeps the k lowest finite scores', () => {
    const chosen = new Uint8Array(5);
    pickNearest(new Float64Array([5, Infinity, 1, 3, 9]), 2, chosen);
    expect([...chosen]).toEqual([0, 0, 1, 1, 0]);
    pickNearest(new Float64Array([Infinity, 2]), 2, chosen.subarray(0, 2));
    expect([...chosen.subarray(0, 2)]).toEqual([0, 1]);
  });
  it('pickNearest declutters: overlapping tags are nudged a row, else skipped', () => {
    const f = (...v: number[]): Float64Array => new Float64Array(v);
    // Three 40×10 tags on one spot: best stays, second moves up a row, third moves down, fourth (no row left) skipped.
    const d = {
      x: f(100, 100, 100, 100),
      y: f(50, 50, 50, 50),
      w: f(40, 40, 40, 40),
      h: f(10, 10, 10, 10),
      placed: new Float64Array(16),
      gap: 2,
      nudges: 1,
      maxY: 200,
    };
    const chosen = new Uint8Array(4);
    pickNearest(f(0, 1, 2, 3), 4, chosen, d);
    expect([...chosen]).toEqual([1, 1, 1, 0]);
    expect([...d.y.subarray(0, 3)]).toEqual([50, 38, 62]);
  });
  it('groupLabel maps ids to readable names', () => {
    expect(groupLabel('Hilar_vessels_airway')).toBe('Hilar vessels & airway');
    expect(groupLabel('Lobes')).toBe('Lobes');
  });
});
