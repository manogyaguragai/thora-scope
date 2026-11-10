import { describe, expect, test } from 'vitest';
import { PORT_CONFIG, PortOccupancy } from '../../src/sim/portOccupancy';
import { TARGETS } from '../../src/content/targets';

// Pleura points of public/models/thorax_sim.opt.glb (glTF coords, from the port extras), rounded.
const PORTS = [
  { id: 'port_camera_8ICS', pleura: { x: -0.163, y: 0.0842, z: 0.0136 } },
  { id: 'port_retraction_8ICS', pleura: { x: -0.084, y: 0.0345, z: -0.0749 } },
  { id: 'port_utility_5ICS', pleura: { x: -0.095, y: 0.0833, z: 0.0856 } },
];
const CAM = 'port_camera_8ICS';
const ANT = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';

describe('port occupancy', () => {
  test('T840 capacities: access incision 2 positions (scope included), 1 cm ports 1', () => {
    const o = new PortOccupancy(PORTS);
    expect(o.capacity(UTIL)).toBe(2);
    expect(o.capacity(CAM)).toBe(1);
    expect(o.moveScope(UTIL)).toBe(true);
    expect(o.insert('grasper', UTIL)).toBe(true);
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.used(UTIL)).toBe(2);
    expect(o.hasRoom(UTIL)).toBe(false);
    expect(o.insert('peanut', UTIL)).toBe(false);
    expect(o.moveScope(CAM)).toBe(true);
    expect(o.insert('peanut', UTIL)).toBe(true);
    expect(o.insert('grasper', CAM)).toBe(false); // scope is there
  });

  test('v7 practice ports: lung held via the posterior port, tools via the access incision, fissure swap', () => {
    const o = new PortOccupancy(PORTS);
    o.moveScope(CAM);
    expect(o.insert('grasper', ANT)).toBe(true); // PA02: retract_hilum grasper on the upper lobe, held
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.hasRoom(ANT)).toBe(false);
    expect(o.insert('clamp', UTIL)).toBe(true); // PA07: encircle the vein via the access incision
    expect(o.canFire('clamp', 'middle_lobe_vein', UTIL)).toBe('ok');
    // 2026-11-10: the vascular stapler head articulates: no angle refusal from any port (the posterior port still
    // holds the retraction until it is swapped to the access incision, PA08).
    expect(o.canFire('stapler', 'middle_lobe_vein', UTIL, 'vascular-curved')).toBe('ok');
    expect(o.canFire('stapler', 'middle_lobe_vein', ANT, 'vascular-curved')).toBe('retraction-in-port');
    expect(o.canFire('stapler', 'middle_lobe_vein', CAM, 'vascular-curved')).toBe('port-full'); // the scope's port
    expect(o.insert('stapler', UTIL)).toBe(true);
    expect(o.canFire('stapler', 'middle_lobe_vein', UTIL, 'bronchial')).toBe('wrong-tool');
    expect(o.canFire('stapler', 'middle_lobe_bronchus', ANT, 'bronchial')).toBe('retraction-in-port'); // v8: needs the swap
    expect(o.canFire('stapler', 'middle_lobe_artery', UTIL, 'vascular-leader')).toBe('ok'); // PA17
    // PA11: middle lobe grasper (retract_RML_lateral) held via the access incision.
    expect(o.insert('grasper', UTIL)).toBe(true);
    expect(o.hold('lung_middle_lobe_right')).toBe(true);
    expect(o.swaps).toBe(0);
    // PA18: the upper lobe re-grasped via the access incision to open the fissure = one swap; frees the posterior port.
    expect(o.insert('grasper', UTIL)).toBe(true);
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.swaps).toBe(1);
    expect([o.lastSwapFrom, o.lastSwapTo]).toEqual([ANT, UTIL]);
    expect(o.used(UTIL)).toBe(2);
    expect(o.canFire('stapler', 'lung_middle_lobe_right', ANT, 'parenchyma')).toBe('ok'); // PA19 / PA21
  });

  test('holding again in the same port is not a swap; release frees the port', () => {
    const o = new PortOccupancy(PORTS);
    o.insert('grasper', UTIL);
    o.hold('lung_upper_lobe_right');
    o.insert('grasper', UTIL);
    o.hold('lung_upper_lobe_right');
    expect(o.swaps).toBe(0);
    expect(o.holds).toHaveLength(1);
    o.insert('grasper', UTIL);
    o.hold('lung_middle_lobe_right');
    expect(o.heldTarget).toBe('lung_middle_lobe_right');
    expect(o.release()?.target).toBe('lung_middle_lobe_right'); // most recent first
    expect(o.release('lung_upper_lobe_right')?.port).toBe(UTIL);
    expect(o.used(UTIL)).toBe(0);
    expect(o.release()).toBeNull();
    expect(o.hold('x')).toBe(false); // nothing inserted
  });

  test('T840: instruments left in ports, inventory caps, pick-up and per-port withdraw', () => {
    const o = new PortOccupancy(PORTS);
    o.moveScope(CAM);
    expect(o.insert('grasper', ANT, 'retractor')).toBe(true); // lung grasper on the upper lobe
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.insert('grasper', UTIL, 'retractor')).toBe(true); // second lung grasper on the lower lobe
    expect(o.hold('lung_lower_lobe_right')).toBe(true);
    expect(o.inUse('grasper')).toBe(2);
    expect(o.canTake('grasper', 'retractor')).toBe(false); // 2 lung graspers in the set
    expect(o.canTake('grasper', 'ring')).toBe(true); // the ring forceps are their own instrument
    expect(o.insert('cautery', UTIL)).toBe(true); // third position
    expect([o.used(CAM), o.used(ANT), o.used(UTIL)]).toEqual([1, 1, 2]);
    expect(o.canTake('cautery')).toBe(false);
    expect(o.insert('peanut', ANT)).toBe(false); // the left grasper fills the posterior port
    expect(o.canFire('stapler', 'lung_middle_lobe_right', ANT, 'parenchyma')).toBe('retraction-in-port');
    expect(o.pickUp(0)).toBeNull(); // the hand is busy
    o.withdraw();
    expect(o.pickUp(0)?.target).toBe('lung_upper_lobe_right');
    expect([o.activeTool, o.activePort, o.activeSub]).toEqual(['grasper', ANT, 'retractor']);
    expect(o.holds).toHaveLength(1);
    expect(o.releasePort(ANT)).toBeNull(); // only the hand's grasper is there
    expect(o.releasePort(UTIL)?.target).toBe('lung_lower_lobe_right');
    expect(o.hasRoom(UTIL)).toBe(true);
    o.releaseAll();
    expect(o.holds).toHaveLength(0);
    expect(o.inUse('grasper')).toBe(1); // the one in the hand
  });

  test('approach angles: bronchus and fissure ports, live point, unknowns', () => {
    const o = new PortOccupancy(PORTS);
    expect(o.canFire('stapler', 'middle_lobe_bronchus', ANT, 'bronchial')).toBe('ok'); // v8: posterior port
    expect(o.canFire('stapler', 'middle_lobe_bronchus', UTIL, 'bronchial')).toBe('poor-angle');
    expect(o.canFire('stapler', 'lung_middle_lobe_right', ANT, 'parenchyma')).toBe('ok');
    // Live point straight along the fissure normal from the access incision → poor angle.
    const u = PORTS[2]?.pleura ?? { x: 0, y: 0, z: 0 };
    const along = { x: u.x + 0.091, y: u.y - 0.025, z: u.z - 0.032 };
    expect(o.canFire('stapler', 'lung_middle_lobe_right', UTIL, 'parenchyma', along)).toBe('poor-angle');
    expect(o.approachDeg('middle_lobe_artery', CAM)).toBeLessThan(PORT_CONFIG.maxApproachDeg);
    expect(o.approachDeg('LN_11R', CAM)).toBe(0); // no axis
    // Live point straight along the axis from the camera fulcrum → 90°.
    const p = PORTS[0]?.pleura ?? { x: 0, y: 0, z: 0 };
    const pt = { x: p.x - 0.44, y: p.y + 0.89, z: p.z + 0.1 }; // targets.ts vein axis (v8)
    expect(o.approachDeg('middle_lobe_vein', CAM, pt)).toBeCloseTo(90, 3);
    expect(o.canFire('stapler', 'nope', CAM)).toBe('no-target');
    expect(o.canFire('stapler', 'middle_lobe_vein', 'nope')).toBe('no-port');
    expect(o.canFire('cautery', 'middle_lobe_vein', CAM)).toBe('wrong-tool');
    expect(o.moveScope('nope')).toBe(false);
  });

  test('every target axis/danger entry is well-formed', () => {
    for (const t of TARGETS) {
      if (t.axis) expect(Math.hypot(...t.axis)).toBeCloseTo(1, 1);
      if (t.maxApproachDeg !== undefined) expect(t.maxApproachDeg).toBeLessThanOrEqual(90);
    }
  });
});
