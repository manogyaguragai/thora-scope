// T816 / T843: orientation compass: patient axes (config.viewing.compassAxes, glTF world) projected into camera space.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { config } from '../../src/core/config';
import { projectAxes } from '../../src/ui/compass';

/** Camera at the origin looking along `fwd` with image up `up` (world frame). */
const cam = (fwd: Vector3, up: Vector3): Quaternion =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), fwd, up));

// World-space AABB centres measured from public/models/thorax_sim.opt.glb (node world matrices applied; T843).
const CENTROID = {
  heart_rest: [-0.0546, -0.0286, 0.0399],
  spine: [-0.0632, -0.0186, -0.0392],
  sternum: [0.0075, -0.0086, 0.0725],
  lung_upper_lobe_right: [0.0213, 0.0381, 0.0047],
  lung_lower_lobe_right: [-0.0721, 0.0415, -0.0088],
  lung_upper_lobe_left: [-0.0326, -0.0823, 0.0214],
  lung_middle_lobe_right: [-0.0639, 0.0563, 0.0428],
} as const;
const c = (n: keyof typeof CENTROID): Vector3 => new Vector3(...CENTROID[n]);
const HEAD = new Vector3(...config.viewing.compassAxes.head);
const ANT = new Vector3(...config.viewing.compassAxes.anterior);

describe('compass axes match the scene', () => {
  test('anterior points from the spine to the heart and sternum', () => {
    expect(c('heart_rest').sub(c('spine')).dot(ANT)).toBeGreaterThan(0.05);
    expect(c('sternum').sub(c('spine')).dot(ANT)).toBeGreaterThan(0.05);
  });
  test('head points from the lower to the upper lobe; head ⟂ anterior', () => {
    expect(c('lung_upper_lobe_right').sub(c('lung_lower_lobe_right')).dot(HEAD)).toBeGreaterThan(0.05);
    expect(HEAD.dot(ANT)).toBe(0);
    // Right side up (left lateral decubitus): head × anterior = patient left, i.e. toward the left lung (down).
    const left = new Vector3().crossVectors(HEAD, ANT);
    expect(c('lung_upper_lobe_left').sub(c('lung_middle_lobe_right')).dot(left)).toBeGreaterThan(0.05);
  });
});

describe('projectAxes', () => {
  test('looking down at the patient (−Y) with the head at the top: anterior is sideways', () => {
    const out = new Float32Array(4);
    projectAxes(cam(new Vector3(0, -1, 0), new Vector3(1, 0, 0)), out);
    expect(out[0]).toBeCloseTo(0, 5); // head: straight up
    expect(out[1]).toBeCloseTo(1, 5);
    expect(Math.abs(out[2] ?? 0)).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(0, 5);
  });

  test('camera up = anterior puts Ant at the top and the heart above the spine', () => {
    const out = new Float32Array(4);
    const q = cam(new Vector3(0, -1, 0), ANT);
    projectAxes(q, out);
    expect(Math.abs(out[0] ?? 0)).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(1, 5); // anterior up
    const heartUp = c('heart_rest').sub(c('spine')).applyQuaternion(q.clone().invert());
    expect(heartUp.y * (out[3] ?? 0)).toBeGreaterThan(0); // Ant mark on the heart's side of the image
  });

  test('an axis along the view keeps its previous direction', () => {
    const out = new Float32Array([0.6, 0.8, 1, 0]);
    projectAxes(cam(new Vector3(1, 0, 0), new Vector3(0, 1, 0)), out); // looking at the head
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
  });
});
