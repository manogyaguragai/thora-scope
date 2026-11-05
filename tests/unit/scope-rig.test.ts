import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { makePose } from '../../src/scene/cameras';
import { readPorts } from '../../src/sim/ports';
import { SCOPE_RIG_CONFIG, ScopeRig } from '../../src/sim/scopeRig';

// Blender-space port extras as exported (docs/ASSETS.md "Ports (extras)").
const RAW: Record<string, Record<string, number[]>> = {
  port_camera_8ICS: {
    skin_point: [-0.163, -0.0332, 0.138],
    pleura_point: [-0.163, -0.0136, 0.0842],
    axis_into_chest: [0, 0.342, -0.9397],
  },
  port_retraction_8ICS: {
    skin_point: [-0.084, 0.102, 0.0535],
    pleura_point: [-0.084, 0.0749, 0.0345],
    axis_into_chest: [0, -0.8192, -0.5736],
  },
  port_utility_5ICS: {
    skin_point: [-0.095, -0.0992, 0.0969],
    pleura_point: [-0.095, -0.0856, 0.0833],
    axis_into_chest: [0, 0.7071, -0.7071],
  },
};

function fakeRoot(raw = RAW): Object3D {
  const root = new Object3D();
  for (const [name, extras] of Object.entries(raw)) {
    const o = new Object3D();
    o.name = name;
    o.position.set(9, 9, 9); // node transform must be ignored
    o.userData = { ...extras };
    root.add(o);
  }
  return root;
}

const ports = readPorts(fakeRoot());
const pose = makePose();
const fwd = (): Vector3 => new Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
const camUp = (): Vector3 => new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
const camRight = (): Vector3 => new Vector3(1, 0, 0).applyQuaternion(pose.quaternion);

function shaftDir(rig: ScopeRig): Vector3 {
  rig.writePose(pose.position, pose.quaternion, pose);
  return pose.position.clone().sub(rig.port.pleura).normalize();
}

describe('readPorts', () => {
  test('converts Blender (x, y, z) to glTF (x, z, −y), labels per ADR-004', () => {
    const cam = ports.find((p) => p.id === 'port_camera_8ICS');
    expect(cam?.label).toBe('Camera port');
    expect(cam?.skin.toArray()).toEqual([-0.163, 0.138, 0.0332]);
    expect(cam?.pleura.toArray()).toEqual([-0.163, 0.0842, 0.0136]);
    expect(cam?.axis.y).toBeCloseTo(-0.9397, 3);
    expect(cam?.axis.z).toBeCloseTo(-0.342, 3);
    expect(cam?.axis.length()).toBeCloseTo(1);
    expect(ports.map((p) => p.label)).toContain('Anterior working port');
  });

  test('rejects missing or inconsistent extras', () => {
    const bare = new Object3D();
    const n = new Object3D();
    n.name = 'port_camera_8ICS';
    bare.add(n);
    expect(() => readPorts(bare)).toThrow(/No port extras.*port_camera_8ICS/);
    const bent = { port_x: { ...RAW.port_camera_8ICS, axis_into_chest: [1, 0, 0] } };
    expect(() => readPorts(fakeRoot(bent))).toThrow(/not parallel/);
  });
});

describe('ScopeRig', () => {
  test('aimFrom: every port looks at the target through the oblique optic, level', () => {
    const target = new Vector3(-0.04, 0.03, 0.03); // hilum-ish, inside the chest of the fake ports
    const rig = new ScopeRig(ports);
    for (const p of ports) {
      rig.aimFrom(p.id, target);
      expect(rig.port.id).toBe(p.id);
      expect(rig.horizonLock).toBe(true);
      expect(rig.opticAngleDeg).toBeGreaterThan(0);
      const lens = shaftDir(rig).multiplyScalar(rig.depth).add(p.pleura);
      const want = target.clone().sub(lens).normalize();
      expect(fwd().angleTo(want)).toBeLessThan(1e-3);
    }
  });

  test('lens stays on the shaft line through the pleura point; depth clamps', () => {
    const rig = new ScopeRig(ports);
    rig.drag(40, -25);
    rig.insert(0.02);
    rig.writePose(pose.position, pose.quaternion, pose);
    const s = shaftDir(rig);
    const off = pose.position.clone().sub(rig.port.pleura);
    expect(off.length()).toBeCloseTo(SCOPE_RIG_CONFIG.depthM.default + 0.02, 6);
    expect(off.normalize().angleTo(s)).toBeCloseTo(0, 6);
    rig.insert(10);
    expect(rig.depth).toBe(SCOPE_RIG_CONFIG.depthM.max);
    rig.insert(-10);
    expect(rig.depth).toBe(SCOPE_RIG_CONFIG.depthM.min);
  });

  test('drag right → view swings left (mirrored fulcrum); drag down → view up', () => {
    const rig = new ScopeRig(ports);
    rig.writePose(pose.position, pose.quaternion, pose);
    const [f0, r0, u0] = [fwd(), camRight(), camUp()];
    rig.drag(30, 0);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(fwd().dot(r0)).toBeLessThan(-0.01);
    rig.drag(-30, 0);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(fwd().angleTo(f0)).toBeLessThan(0.05); // approximately reversible
    rig.drag(0, 30);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(fwd().dot(u0)).toBeGreaterThan(0.01);
  });

  test('shaft stays inside the cone around the port axis', () => {
    const rig = new ScopeRig(ports);
    for (let i = 0; i < 200; i++) rig.drag(50, 0);
    const deg = (shaftDir(rig).angleTo(rig.port.axis) * 180) / Math.PI;
    expect(deg).toBeLessThanOrEqual(SCOPE_RIG_CONFIG.coneDeg + 1e-6);
  });

  test('optic rotation turns the view, not the lens or shaft; no effect at 0°', () => {
    const rig = new ScopeRig(ports);
    rig.drag(20, 10);
    const s0 = shaftDir(rig);
    const p0 = pose.position.clone();
    const f0 = fwd();
    rig.rotateOptic(90);
    const s1 = shaftDir(rig);
    expect(s1.angleTo(s0)).toBeCloseTo(0, 6);
    expect(pose.position.distanceTo(p0)).toBeCloseTo(0, 9);
    expect(fwd().angleTo(f0)).toBeGreaterThan(0.3);
    expect((fwd().angleTo(s1) * 180) / Math.PI).toBeCloseTo(SCOPE_RIG_CONFIG.opticDefaultDeg, 4);

    rig.opticAngleDeg = 0;
    rig.writePose(pose.position, pose.quaternion, pose);
    const a = fwd();
    rig.rotateOptic(120);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(fwd().angleTo(a)).toBeCloseTo(0, 6);
  });

  test('horizon lock keeps image up as close to world +Y as possible', () => {
    const rig = new ScopeRig(ports);
    rig.headRollDeg = 70;
    for (const lp of [0, 45, 130, -100]) {
      rig.lightPostDeg = lp;
      rig.writePose(pose.position, pose.quaternion, pose);
      const f = fwd();
      expect(camUp().y).toBeCloseTo(Math.sqrt(1 - f.y * f.y), 6); // max possible for this view dir
      expect(camRight().y).toBeCloseTo(0, 6); // level horizon
    }
    rig.setHorizonLock(false);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(Math.abs(camRight().y)).toBeGreaterThan(0.05); // head roll now tilts the image
  });

  test('rollHead releases the lock and rolls the image about a fixed view axis', () => {
    const rig = new ScopeRig(ports);
    rig.writePose(pose.position, pose.quaternion, pose);
    const f0 = fwd();
    const up0 = camUp();
    rig.rollHead(30);
    expect(rig.horizonLock).toBe(false);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(fwd().angleTo(f0)).toBeCloseTo(0, 6);
    rig.rollHead(-30);
    rig.rollHead(30);
    expect(rig.headRollDeg).toBeCloseTo(30, 9);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(camUp().angleTo(up0)).toBeGreaterThan(0.01);
  });

  test('zoom divides fov within limits', () => {
    const rig = new ScopeRig(ports);
    rig.zoomBy(2);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(pose.fov).toBeCloseTo(SCOPE_RIG_CONFIG.fovDeg / 2);
    rig.zoomBy(100);
    expect(rig.zoom).toBe(SCOPE_RIG_CONFIG.zoom.max);
  });

  test('switchPort pivots about the new pleura point; unknown port throws', () => {
    const rig = new ScopeRig(ports);
    rig.insert(5);
    rig.switchPort('port_utility_5ICS');
    rig.writePose(pose.position, pose.quaternion, pose);
    const u = ports.find((p) => p.id === 'port_utility_5ICS');
    if (!u) throw new Error('missing port');
    const off = pose.position.clone().sub(u.pleura);
    expect(off.length()).toBeCloseTo(SCOPE_RIG_CONFIG.depthM.max, 6);
    expect(off.normalize().angleTo(u.axis)).toBeCloseTo(0, 6);
    expect(() => rig.switchPort('nope')).toThrow(/Unknown port/);
  });

  test('snapTo reproduces a synthetic oblique camera (nearest port, roll, optic angle)', () => {
    const src = new ScopeRig(ports);
    src.switchPort('port_retraction_8ICS');
    src.drag(-60, 35);
    src.insert(0.03);
    src.opticAngleDeg = 44;
    src.lightPostDeg = -65;
    src.setHorizonLock(false);
    src.headRollDeg = 25;
    const target = makePose();
    src.writePose(target.position, target.quaternion, target);

    const rig = new ScopeRig(ports);
    rig.opticAngleDeg = 44; // the step's scope_angle_deg guides the port pick
    rig.snapTo(target);
    expect(rig.port.id).toBe('port_retraction_8ICS');
    expect(rig.horizonLock).toBe(false);
    expect(rig.opticAngleDeg).toBeCloseTo(44, 4);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(pose.position.distanceTo(target.position)).toBeLessThan(1e-6);
    expect(pose.quaternion.angleTo(target.quaternion)).toBeLessThan(1e-4);
    expect(pose.fov).toBeCloseTo(target.fov);

    // An arbitrary (not rig-made) pose: lens + forward reproduced, given the port explicitly.
    const p = ports[0];
    if (!p) throw new Error('missing port');
    target.position.copy(p.pleura).addScaledVector(new Vector3(0.6, -0.7, 0.2).normalize(), 0.07);
    const m = new Matrix4().lookAt(target.position, new Vector3(0, 0, 0), new Vector3(0.3, 1, 0));
    target.quaternion.copy(new Quaternion().setFromRotationMatrix(m));
    rig.snapTo(target, p.id);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(pose.position.distanceTo(target.position)).toBeLessThan(1e-6);
    expect(pose.quaternion.angleTo(target.quaternion)).toBeLessThan(1e-4);
  });

  // Authored step cameras (glTF world pose, rounded) + their procedure_steps.json ports.
  const CAMS: [string, number[], number[]][] = [
    ['port_camera_8ICS', [-0.122529, 0.062783, 0.02851], [0.048518, -0.638486, -0.303867, 0.70544]],
    ['port_camera_8ICS', [-0.076872, 0.01018, 0.016999], [-0.343294, -0.547699, -0.447243, 0.618182]],
    ['port_retraction_8ICS', [-0.039651, 0.027217, -0.013784], [-0.694677, -0.707063, -0.007875, 0.131999]],
    ['port_utility_5ICS', [-0.036006, 0.027665, 0.036374], [0.022256, -0.125189, -0.695937, 0.706757]],
    ['port_utility_5ICS', [-0.04252, 0.059126, 0.045222], [-0.150326, -0.406757, -0.578402, 0.690943]],
    ['port_camera_8ICS', [-0.118514, 0.08392, 0.026835], [-0.276285, -0.69996, -0.100277, 0.650897]],
    ['port_camera_8ICS', [-0.082784, 0.074109, -0.005219], [-0.273851, -0.702151, -0.083571, 0.651925]],
  ];
  test.each(CAMS)('snapTo picks %s for an authored step camera and reproduces it', (port, p, q) => {
    const target = makePose();
    target.position.fromArray(p);
    target.quaternion.fromArray(q).normalize();
    target.fov = 45;
    const rig = new ScopeRig(ports);
    rig.snapTo(target);
    expect(rig.port.id).toBe(port);
    rig.writePose(pose.position, pose.quaternion, pose);
    expect(pose.position.distanceTo(target.position)).toBeLessThan(1e-6);
    expect(pose.quaternion.angleTo(target.quaternion)).toBeLessThan(1e-4);
  });
});
