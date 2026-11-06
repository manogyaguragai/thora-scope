import { Box3, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, test } from 'vitest';
import procedure from '../../src/content/procedure_steps.json';
import { ANATOMY, hiddenAtStep } from '../../src/content/anatomy';
import { config } from '../../src/core/config';
import { keepOutside, lerpPose, makePose } from '../../src/scene/cameras';
import { createState, updateTweens } from '../../src/sim/state';
import { applyStep, applyVisibility, createStepVisibility, STEPS } from '../../src/sim/steps';
import type { Toggleable } from '../../src/sim/steps';

describe('lerpPose', () => {
  const a = makePose();
  const b = makePose();
  a.position.set(0, 0, 0);
  a.fov = 40;
  b.position.set(2, 4, -6);
  b.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  b.fov = 60;
  const out = makePose();

  test('endpoints and midpoint', () => {
    lerpPose(out, a, b, 0);
    expect(out.position.equals(a.position)).toBe(true);
    expect(out.quaternion.angleTo(a.quaternion)).toBeCloseTo(0);
    lerpPose(out, a, b, 1);
    expect(out.position.distanceTo(b.position)).toBeCloseTo(0);
    expect(out.quaternion.angleTo(b.quaternion)).toBeCloseTo(0);
    expect(out.fov).toBe(60);
    lerpPose(out, a, b, 0.5);
    expect(out.position.toArray()).toEqual([1, 2, -3]);
    expect(out.fov).toBe(50);
    // slerp: halfway rotation is a quarter turn about Y, still unit length
    const half = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    expect(out.quaternion.angleTo(half)).toBeCloseTo(0);
    expect(out.quaternion.length()).toBeCloseTo(1);
  });
});

describe('applyStep', () => {
  const objects = new Map<string, Toggleable>();
  const lookup = (name: string): Toggleable => {
    let o = objects.get(name);
    if (!o) objects.set(name, (o = { name, visible: true }));
    return o;
  };
  const vis = createStepVisibility(lookup);
  const shown = (name: string): boolean | undefined => objects.get(name)?.visible;

  test('instant: state targets, camera, port and hidden set', () => {
    const s = createState();
    const step = applyStep(vis, s, 3, true);
    expect(step.camera).toBe('cam_3_RML_vein_zoom');
    expect(step.aimAtHilum).toBe(true);
    expect(s).toMatchObject({ step: 3, camera: step.camera, port: 'port_utility_5ICS' });
    expect(s.deflate_RML).toBe(1);
    expect(s.retract_hilum).toBe(1);
    expect(s.retract_posterior).toBe(0); // legacy key, absent from the step table → 0
    for (const n of step.hidden) expect(shown(n)).toBe(false);
    const vein = Object.keys(ANATOMY.structures).filter((n) => ANATOMY.structures[n]?.divideStep === 3);
    expect(vein.length).toBeGreaterThan(0);
    for (const n of vein) expect(shown(n)).toBe(true); // divided in step 3: hidden from step 4 on
    applyStep(vis, s, 4, true);
    for (const n of vein) expect(shown(n)).toBe(false);
  });

  test('hidden sets derive from the manifest', () => {
    const always = Object.keys(ANATOMY.structures).filter((n) => ANATOMY.structures[n]?.hidden);
    for (const n of always) expect(hiddenAtStep(0)).toContain(n);
    for (const n of Object.keys(ANATOMY.structures)) {
      const x = ANATOMY.structures[n];
      const done = x?.divideStep ?? x?.clearStep ?? x?.dissectStep ?? x?.removedAfterStep;
      if (done === undefined || x?.hidden) continue;
      expect(STEPS.find((t) => t.step === done)?.hidden).not.toContain(n);
      for (const t of STEPS.filter((t) => t.step > done)) expect(t.hidden).toContain(n);
    }
    // step 9 (leak test) re-inflates RUL/RLL and drops the removed lobe
    const nine = STEPS.find((t) => t.step === 9);
    expect(nine?.state).toMatchObject({ deflate_RUL: 0, deflate_RML: 1, deflate_RLL: 0 });
    expect(nine?.hidden).toContain('lung_middle_lobe_right');
  });

  test('tweens over stateMs; later steps hide divided structures', () => {
    const s = createState();
    applyStep(vis, s, 9);
    expect(s.deflate_RUL).toBe(0); // starts from current value
    updateTweens(s, 0); // applied before the first tick: the tween starts on the first update
    updateTweens(s, config.steps.stateMs / 2);
    expect(s.deflate_RML).toBeGreaterThan(0);
    expect(s.deflate_RML).toBeLessThan(1);
    updateTweens(s, config.steps.stateMs);
    expect(s.deflate_RML).toBe(1);
    expect(shown('lung_middle_lobe_right')).toBe(false);
    applyStep(vis, s, 1, true);
    expect(shown('lung_middle_lobe_right')).toBe(true);
    for (const n of hiddenAtStep(1)) expect(shown(n)).toBe(false);
  });

  test('scope far-field set only while the scope view is in effect', () => {
    const s = createState();
    applyStep(vis, s, 1, true);
    vis.scope = true;
    applyVisibility(vis, s);
    for (const n of config.scope.hidden) expect(shown(n)).toBe(false);
    vis.scope = false;
    applyVisibility(vis, s);
    for (const n of config.scope.hidden) expect(shown(n)).toBe(true);
  });

  test('every step camera / scope-hidden name is a known node name', () => {
    const groups = Object.values(procedure.layer_groups).flat();
    for (const n of config.scope.hidden) expect(groups).toContain(n);
    expect(STEPS.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => applyStep(vis, createState(), 10)).toThrow(RangeError);
  });
});

describe('T843 keepOutside (orbit camera never inside the body)', () => {
  const sphere = (r: number): Mesh => {
    const g = new SphereGeometry(r, 32, 16);
    g.boundsTree = new MeshBVH(g);
    const m = new Mesh(g, new MeshBasicMaterial()); // FrontSide material: the guard tests both sides anyway
    m.position.set(0.5, 0, 0);
    m.scale.setScalar(2);
    m.updateMatrixWorld();
    return m;
  };
  const skin = sphere(1);
  const inner = sphere(0.98); // a solidified shell / deeper layer
  const box = new Box3().setFromObject(skin);
  const T = new Vector3(0.5, 0, 0);
  const M = 0.03;
  test('a camera inside is moved out along target → camera to the margin past the outermost layer', () => {
    const cam = new Vector3(0.5, 0, 1);
    expect(keepOutside(cam, T, [inner, skin], box, M)).toBe(true);
    expect(cam.x).toBeCloseTo(0.5, 6);
    expect(cam.z).toBeCloseTo(2 + M, 2); // tessellated radius ≈ 2
    expect(keepOutside(cam, T, [inner, skin], box, M)).toBe(false); // settled
  });
  test('a hole in the outer layer is covered by the deeper one', () => {
    const cam = new Vector3(0.5, 0, 1);
    expect(keepOutside(cam, T, [inner], box, M)).toBe(true);
    expect(cam.z).toBeCloseTo(1.96 + M, 2);
  });
  test('a camera outside stays put; a target outside the body box is unguarded', () => {
    const cam = new Vector3(0.5, 0, 3);
    expect(keepOutside(cam, T, [skin], box, M)).toBe(false);
    expect(cam.z).toBe(3);
    const near = new Vector3(0.5, 0, 1);
    expect(keepOutside(near, new Vector3(0.5, 0, 5), [skin], box, M)).toBe(false);
  });
});
