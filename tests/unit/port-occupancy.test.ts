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
  test('capacities follow ADR-004 (access incision 3, others 1)', () => {
    const o = new PortOccupancy(PORTS);
    expect(o.capacity(UTIL)).toBe(3);
    expect(o.capacity(CAM)).toBe(1);
    expect(o.moveScope(UTIL)).toBe(true);
    expect(o.insert('grasper', UTIL)).toBe(true);
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.insert('peanut', UTIL)).toBe(true);
    expect(o.used(UTIL)).toBe(3);
    expect(o.hasRoom(UTIL)).toBe(false);
    expect(o.moveScope(CAM)).toBe(true);
    expect(o.insert('grasper', CAM)).toBe(false); // scope is there
  });

  test('video vein-stapler swap (PA02, PA03, PA08–PA10)', () => {
    const o = new PortOccupancy(PORTS);
    o.moveScope(CAM);
    expect(o.moveScope(ANT)).toBe(true); // PA02: scope → anterior working port
    expect(o.insert('grasper', CAM)).toBe(true); // PA03: retractor via former camera port, held
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.hasRoom(CAM)).toBe(false);
    expect(o.insert('clamp', UTIL)).toBe(true); // PA08: encircle the vein via the access incision
    expect(o.canFire('clamp', 'V_RML_common', UTIL)).toBe('ok');

    // Stapler: the access incision is free but at a poor angle, the camera port is blocked by the held retractor.
    expect(o.canFire('stapler', 'V_RML_common', UTIL, 'vascular-curved')).toBe('poor-angle');
    expect(o.canFire('stapler', 'V_RML_common', CAM, 'vascular-curved')).toBe('retraction-in-port');
    expect(o.canFire('stapler', 'V_RML_common', ANT, 'vascular-curved')).toBe('port-full'); // scope there
    expect(o.swaps).toBe(0);

    // PA09: transfer the retraction to a grasper via the access incision.
    expect(o.insert('grasper', UTIL)).toBe(true);
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.swaps).toBe(1);
    expect([o.lastSwapFrom, o.lastSwapTo]).toEqual([CAM, UTIL]);
    expect(o.heldPort).toBe(UTIL);
    expect(o.hasRoom(CAM)).toBe(true);

    // PA10: curved-tip stapler through the now-free camera port.
    expect(o.canFire('stapler', 'V_RML_common', CAM, 'vascular-curved')).toBe('ok');
    expect(o.insert('stapler', CAM)).toBe(true);
    expect(o.canFire('stapler', 'V_RML_common', CAM, 'vascular-curved')).toBe('ok');
    expect(o.canFire('stapler', 'V_RML_common', CAM, 'bronchial')).toBe('wrong-tool');

    // PA11: retraction back to the camera port = second swap.
    o.withdraw();
    o.insert('grasper', CAM);
    o.hold('lung_upper_lobe_right');
    expect(o.swaps).toBe(2);
    expect(o.heldPort).toBe(CAM);
    expect(o.used(UTIL)).toBe(0);
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

  test('T820: two held instruments + the active tool; a third hold and full ports are refused', () => {
    const o = new PortOccupancy(PORTS);
    expect(o.maxHeld).toBe(2);
    o.moveScope(CAM);
    expect(o.insert('grasper', ANT)).toBe(true); // lung grasper on the upper lobe via the anterior port
    expect(o.hold('lung_upper_lobe_right')).toBe(true);
    expect(o.insert('sponge', UTIL)).toBe(true); // sponge-stick on the middle lobe via the access incision
    expect(o.hold('lung_middle_lobe_right')).toBe(true);
    expect(o.insert('cautery', UTIL)).toBe(true); // the working tool
    expect([o.used(CAM), o.used(ANT), o.used(UTIL)]).toEqual([1, 1, 2]);
    expect(o.holds.map((h) => h.tool)).toEqual(['grasper', 'sponge']);
    expect(o.insert('peanut', ANT)).toBe(false); // the held grasper fills the anterior port
    expect(o.canFire('stapler', 'lung_middle_lobe_right', ANT, 'parenchyma')).toBe('retraction-in-port');
    expect(o.holdFull('LN_11R')).toBe(true);
    expect(o.hold('LN_11R')).toBe(false); // no third hold slot; the active tool stays in
    expect(o.activeTool).toBe('cautery');
    expect(o.holdFull('lung_upper_lobe_right')).toBe(false); // re-holding a held target is a transfer
    o.release('lung_upper_lobe_right');
    expect(o.hasRoom(ANT)).toBe(true);
    o.releaseAll();
    expect(o.holds).toHaveLength(0);
    expect(o.used(UTIL)).toBe(1);
  });

  test('approach angles: bronchus waiver, fissure via anterior working port, live point, unknowns', () => {
    const o = new PortOccupancy(PORTS);
    expect(o.canFire('stapler', 'B_RML_common', UTIL, 'bronchial')).toBe('ok');
    expect(o.canFire('stapler', 'lung_middle_lobe_right', ANT, 'parenchyma')).toBe('ok');
    expect(o.canFire('stapler', 'lung_middle_lobe_right', UTIL, 'parenchyma')).toBe('poor-angle');
    expect(o.approachDeg('A_RML_common', CAM)).toBeLessThan(PORT_CONFIG.maxApproachDeg);
    expect(o.approachDeg('LN_11R', CAM)).toBe(0); // no axis
    // Live point straight along the axis from the camera fulcrum → 90°.
    const p = PORTS[0]?.pleura ?? { x: 0, y: 0, z: 0 };
    const pt = { x: p.x + 0.5, y: p.y - 0.56, z: p.z - 0.66 };
    expect(o.approachDeg('V_RML_common', CAM, pt)).toBeCloseTo(90, 3);
    expect(o.canFire('stapler', 'nope', CAM)).toBe('no-target');
    expect(o.canFire('stapler', 'V_RML_common', 'nope')).toBe('no-port');
    expect(o.canFire('cautery', 'V_RML_common', CAM)).toBe('wrong-tool');
    expect(o.moveScope('nope')).toBe(false);
  });

  test('every target axis/danger entry is well-formed', () => {
    for (const t of TARGETS) {
      if (t.axis) expect(Math.hypot(...t.axis)).toBeCloseTo(1, 1);
      if (t.maxApproachDeg !== undefined) expect(t.maxApproachDeg).toBeLessThanOrEqual(90);
    }
  });
});
