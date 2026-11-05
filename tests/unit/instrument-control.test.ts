import { Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  INSTRUMENT_CONTROL_CONFIG as CFG,
  InstrumentController,
  SNAP_REASONS,
} from '../../src/sim/instrumentControl';
import type { Port } from '../../src/sim/ports';

const port: Port = {
  id: 'port_utility_5ICS',
  label: 'Access incision',
  skin: new Vector3(0.1, 0.02, 0),
  pleura: new Vector3(0.08, 0.02, 0),
  axis: new Vector3(-1, 0, 0),
};
const target = new Vector3(-0.02, 0.05, 0.04);

/** Distance from p to the line through `o` along unit `d`. */
function lineDist(p: Vector3, o: Vector3, d: Vector3): number {
  const v = p.clone().sub(o);
  return v.sub(d.clone().multiplyScalar(v.dot(d))).length();
}

function snapped(): InstrumentController {
  const c = new InstrumentController();
  c.park(port);
  expect(c.snapTo(port, target).ok).toBe(true);
  for (let i = 0; i < 200 && c.phase === 'inserting'; i++) c.update(16);
  return c;
}

describe('InstrumentController', () => {
  test('snap keeps the shaft through the pleura and lands exactly on the nearest valid point', () => {
    const c = new InstrumentController();
    c.park(port);
    const valid = [new Vector3(-0.03, 0.05, 0.04), target.clone().addScalar(0.005), new Vector3()];
    const r = c.snapTo(port, target, valid);
    expect(r).toEqual({ ok: true, point: valid[1] });
    let frames = 0;
    while (c.phase === 'inserting') {
      c.update(16);
      frames++;
      expect(Math.abs(c.shaftDir.length() - 1)).toBeLessThan(1e-9);
      // Shaft line = tip − depth·dir; pleura must lie on it.
      expect(lineDist(port.pleura, c.tipPos, c.shaftDir)).toBeLessThan(1e-6);
      expect(c.tipPos.distanceTo(port.pleura) - c.depth).toBeLessThan(1e-9);
    }
    expect(frames).toBeGreaterThan(10);
    expect(c.phase).toBe('placed');
    expect(c.tipPos.equals(valid[1] as Vector3)).toBe(true);
  });

  test('snap radius: a valid point just inside snaps, just outside is rejected', () => {
    const r = CFG.snapRadiusM;
    const inside = target.clone().add(new Vector3(0, 0, r * 0.99));
    const outside = target.clone().add(new Vector3(0, 0, r * 1.01));
    expect(new InstrumentController().snapTo(port, target, [outside, inside])).toEqual({
      ok: true,
      point: inside,
    });
    expect(new InstrumentController().snapTo(port, target, [outside])).toEqual({
      ok: false,
      reason: SNAP_REASONS.noPoint,
    });
  });

  test('invalid clicks return a reason', () => {
    const c = new InstrumentController();
    expect(c.snapTo(port, target, [new Vector3(1, 1, 1)])).toEqual({
      ok: false,
      reason: SNAP_REASONS.noPoint,
    });
    expect(c.snapTo(port, new Vector3(-0.5, 0, 0))).toEqual({ ok: false, reason: SNAP_REASONS.reach });
    expect(c.snapTo(port, new Vector3(0.08, 0.1, 0))).toEqual({ ok: false, reason: SNAP_REASONS.angle });
    expect(c.port).toBeNull();
  });

  test('steer is mirrored and pivots about the pleura; cone limit holds', () => {
    const c = snapped();
    c.viewRight.set(0, 0, 1);
    c.viewUp.set(0, 1, 0);
    const before = c.tipPos.clone();
    c.steer(20, 0); // hand right
    expect(c.phase).toBe('manual');
    expect(c.tipPos.z).toBeLessThan(before.z); // tip left
    expect(c.tipPos.distanceTo(port.pleura)).toBeCloseTo(c.depth, 9);
    const y = c.tipPos.y;
    c.steer(0, -20); // hand up
    expect(c.tipPos.y).toBeLessThan(y); // tip down
    c.steer(0, -1e5);
    const cos = Math.cos((CFG.coneDeg * Math.PI) / 180);
    expect(c.shaftDir.dot(port.axis)).toBeGreaterThanOrEqual(cos - 1e-9);
  });

  test('depth clamps', () => {
    const c = snapped();
    c.insert(10);
    expect(c.depth).toBe(CFG.depthM.max);
    c.insert(-10);
    expect(c.depth).toBe(CFG.depthM.min);
    expect(c.tipPos.distanceTo(port.pleura)).toBeCloseTo(CFG.depthM.min, 9);
  });

  test('withdraw animates back to parked at the port', () => {
    const c = snapped();
    c.activate(true);
    c.withdraw();
    expect(c.phase).toBe('withdrawing');
    expect(c.active).toBe(false);
    c.steer(50, 0); // ignored mid-animation
    for (let i = 0; i < 200 && c.phase === 'withdrawing'; i++) {
      c.update(16);
      expect(lineDist(port.pleura, c.tipPos, c.shaftDir)).toBeLessThan(1e-6);
    }
    expect(c.phase).toBe('parked');
    expect(c.shaftDir.distanceTo(port.axis)).toBeLessThan(1e-12);
    const parked = port.pleura.clone().addScaledVector(port.axis, CFG.depthM.min);
    expect(c.tipPos.distanceTo(parked)).toBeLessThan(1e-12);
  });

  test('activation eases the jaw', () => {
    const c = snapped();
    c.activate(true);
    c.update(1000);
    expect(c.jaw).toBe(1);
    c.activate(false);
    c.update(1000);
    expect(c.jaw).toBe(0);
  });

  test('writeTransform: origin at the tip, +Z along shaftDir', () => {
    const c = snapped();
    c.steer(30, -10);
    const pos = new Vector3();
    const q = new Quaternion();
    c.writeTransform(pos, q);
    expect(pos.equals(c.tipPos)).toBe(true);
    expect(new Vector3(0, 0, 1).applyQuaternion(q).distanceTo(c.shaftDir)).toBeLessThan(1e-9);
  });
});
