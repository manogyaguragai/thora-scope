import { Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import procedure from '../../src/content/procedure_steps.json';
import { config } from '../../src/core/config';
import { lerpPose, makePose } from '../../src/scene/cameras';
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
    expect(s).toMatchObject({ step: 3, camera: step.camera, port: 'port_retraction_8ICS' });
    expect(s.deflate_RML).toBe(1);
    expect(s.retract_posterior).toBe(1);
    for (const n of step.hidden) expect(shown(n)).toBe(false);
    // step 3 swaps intact tissue for the `_window` cut-outs (default_hidden before any step)
    for (const n of procedure.default_hidden) expect(shown(n)).toBe(true);
    expect(shown('V_RML_common')).toBe(true); // hidden from step 4 on
  });

  test('tweens over stateMs; later steps hide divided structures', () => {
    const s = createState();
    applyStep(vis, s, 7);
    expect(s.deflate_RUL).toBe(0); // starts from current value
    updateTweens(s, config.steps.stateMs / 2);
    expect(s.deflate_RML).toBeGreaterThan(0);
    expect(s.deflate_RML).toBeLessThan(1);
    updateTweens(s, config.steps.stateMs);
    expect(s.deflate_RML).toBe(1);
    expect(shown('lung_middle_lobe_right')).toBe(false);
    applyStep(vis, s, 1, true);
    expect(shown('lung_middle_lobe_right')).toBe(true);
    for (const n of procedure.default_hidden) expect(shown(n)).toBe(false);
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
    expect(STEPS.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(() => applyStep(vis, createState(), 8)).toThrow(RangeError);
  });
});
