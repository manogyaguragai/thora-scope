// T816: orientation compass axis projection (patient axes, CONTEXT §7.1, into camera space).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { projectAxes } from '../../src/ui/compass';

/** Camera at the origin looking along `fwd` with image up `up` (world = thorax_root frame). */
const cam = (fwd: Vector3, up: Vector3): Quaternion =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), fwd, up));

const ID = new Quaternion();

describe('projectAxes', () => {
  test('looking down at the patient (−Y, right side up) with the head at the top', () => {
    const out = new Float32Array(4);
    projectAxes(ID, cam(new Vector3(0, -1, 0), new Vector3(1, 0, 0)), out);
    expect(out[0]).toBeCloseTo(0, 5); // head: straight up
    expect(out[1]).toBeCloseTo(1, 5);
    expect(Math.abs(out[2] ?? 0)).toBeCloseTo(1, 5); // anterior: sideways
    expect(out[3]).toBeCloseTo(0, 5);
  });

  test('camera rolled 90° moves the head mark to the side; root rotation is honoured', () => {
    const out = new Float32Array(4);
    projectAxes(ID, cam(new Vector3(0, -1, 0), new Vector3(0, 0, 1)), out);
    expect(Math.abs(out[0] ?? 0)).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(1, 5); // anterior now up
    // Root turned 90° about Y: its head (+X) now points along world −Z = image down.
    const root = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    projectAxes(root, cam(new Vector3(0, -1, 0), new Vector3(0, 0, 1)), out);
    expect(out[1]).toBeCloseTo(-1, 5);
  });

  test('an axis along the view keeps its previous direction', () => {
    const out = new Float32Array([0.6, 0.8, 1, 0]);
    projectAxes(ID, cam(new Vector3(1, 0, 0), new Vector3(0, 1, 0)), out); // looking at the head
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
  });
});
