import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { interactionConfig as I } from '../../src/sim/interaction.config';
import { contactOf, TipCollision } from '../../src/sim/tipCollision';
import type { RayHit } from '../../src/sim/tipCollision';
import { createHotbar } from '../../src/sim/hotbar';
import { setMode } from '../../src/sim/modes';
import { InstrumentController } from '../../src/sim/instrumentControl';
import { PortOccupancy } from '../../src/sim/portOccupancy';
import type { Port } from '../../src/sim/ports';

// T850: tissue-aware tip (constraint math + lung press), "Insert via" refusals, park / re-select, controller limit.
const C = I.collide;
const O = new Vector3();
const X = new Vector3(1, 0, 0);

/** Fake BVH ray: surfaces at fixed distances along +X, nearest one in [near, far]. */
const rayOver =
  (surfaces: [string, number][]) =>
  (_o: Vector3, _d: Vector3, near: number, far: number): RayHit | null => {
    let best: RayHit | null = null;
    for (const [nodeName, distance] of surfaces)
      if (distance >= near && distance <= far && (!best || distance < best.distance))
        best = { nodeName, distance, point: new Vector3(distance, 0, 0) };
    return best;
  };

describe('T850 tip collision', () => {
  test('tissue classes are manifest-driven', () => {
    expect(contactOf('lung_middle_lobe_right')).toBe('lung');
    expect(contactOf('mediastinal_pleura_hilum')).toBe('pass');
    expect(contactOf('hilar_connective_tissue')).toBe('pass');
    expect(contactOf('pulmonary_vein_tree')).toBe('hard');
    expect(contactOf('parietal_pleura_wall')).toBe('hard'); // chest wall (dissectable in the shader, not here)
    expect(contactOf('pericardium')).toBe('hard');
  });

  test('hard surface: the tip stops margin short; nothing ahead: free', () => {
    const c = new TipCollision(rayOver([['parietal_pleura_wall', 0.1]]));
    c.check(O, X, 0.2);
    expect(c.limit).toBeCloseTo(0.1 - C.marginM, 9);
    expect(c.press(0.2)).toBe(0);
    c.check(O, X, 0.05); // out of the ray's reach (depth + margin + cap)
    expect(c.limit).toBe(Infinity);
  });

  test('an aimed point just inside a hard surface (overlapping layers) is reachable, not one well behind it', () => {
    const c = new TipCollision(rayOver([['middle_lobe_vein', 0.111]]));
    c.check(O, X, 0.1116, 0.1116);
    expect(c.limit).toBeCloseTo(0.1116, 9);
    c.check(O, X, 0.13, 0.13);
    expect(c.limit).toBeCloseTo(0.111 - C.marginM, 9);
  });

  test('T853: a lobe in the shaft path yields to a dissector aimed at a layer behind it; hard tissue still stops it', () => {
    const lobe: [string, number] = ['lung_middle_lobe_right', 0.04];
    const layer: [string, number] = ['hilar_connective_tissue', 0.08];
    const c = new TipCollision(rayOver([lobe, layer]));
    c.check(O, X, 0.08, 0.08);
    expect(c.limit).toBeCloseTo(0.04 + C.push.capM, 9); // not reaching: the lobe blocks after its press
    c.check(O, X, 0.08, 0.08, false, true);
    expect(c.limit).toBeCloseTo(0.08, 9);
    expect(c.press(0.08)).toBeCloseTo(C.push.capM, 9); // the lobe is pushed aside (indent capped)
    const h = new TipCollision(rayOver([lobe, ['pericardium', 0.06], layer]));
    h.check(O, X, 0.08, 0.08, false, true);
    expect(h.limit).toBeCloseTo(0.06 - C.marginM, 9);
  });

  test('a click-snap placed on a structure reaches it through tissue in the way (force)', () => {
    const c = new TipCollision(rayOver([['pericardium', 0.05]]));
    c.check(O, X, 0.09, 0.09);
    expect(c.limit).toBeCloseTo(0.05 - C.marginM, 9);
    c.check(O, X, 0.09, 0.09, true);
    expect(c.limit).toBeCloseTo(0.09, 9);
  });

  test('dissectable layers are passed: the vessel beneath stops the tip', () => {
    const c = new TipCollision(
      rayOver([
        ['mediastinal_pleura_hilum', 0.06],
        ['pulmonary_vein_tree', 0.07],
      ]),
    );
    c.check(O, X, 0.1);
    expect(c.limit).toBeCloseTo(0.07 - C.marginM, 9);
  });

  test('lung: the tip presses up to the cap; the indent rises at once and springs back eased', () => {
    const c = new TipCollision(rayOver([['lung_lower_lobe_right', 0.08]]));
    c.check(O, X, 0.2);
    expect(c.limit).toBeCloseTo(0.08 + C.push.capM, 9);
    expect(c.point.x).toBeCloseTo(0.08, 9);
    const tip = Math.min(0.2, c.limit);
    expect(c.press(tip)).toBeCloseTo(C.push.capM, 9);
    expect(c.ease(16, tip)).toBe(true);
    expect(c.push).toBeCloseTo(C.push.capM, 9); // no lag pressing in: never visibly inside the lung
    expect(c.ease(16, tip)).toBe(false); // unchanged → no uniform write
    c.clear();
    c.ease(100, tip);
    expect(c.push).toBeGreaterThan(0);
    expect(c.push).toBeLessThan(C.push.capM);
    for (let i = 0; i < 200; i++) c.ease(16, tip);
    expect(c.push).toBe(0);
  });

  test('the controller shows the tip at min(depth, limit); wheel insert stops at the limit', () => {
    const port: Port = {
      id: 'p',
      label: 'P',
      skin: new Vector3(0.02, 0, 0),
      pleura: new Vector3(),
      axis: X.clone(),
    };
    const k = new InstrumentController();
    k.park(port);
    k.insert(0.1);
    const free = k.tipPos.x;
    k.setLimit(free - 0.01);
    expect(k.tipPos.x).toBeCloseTo(free - 0.01, 9);
    k.insert(0.05);
    expect(k.depth).toBeCloseTo(free - 0.01, 9); // the wheel does not bank depth behind a surface
    k.setLimit(Infinity);
    expect(k.tipPos.x).toBeCloseTo(free - 0.01, 9);
    k.park(port);
    expect(k.limit).toBe(Infinity); // a new direction drops the stale limit
  });
});

describe('T850 insert via / park', () => {
  const PORTS = [
    { id: 'port_camera_8ICS', pleura: { x: 0, y: 0, z: 0 } },
    { id: 'port_retraction_8ICS', pleura: { x: 0, y: 0, z: 0 } },
    { id: 'port_utility_5ICS', pleura: { x: 0, y: 0, z: 0 } },
  ];
  test('refusal: own port ok, full, practice not-allowed, unknown', () => {
    const o = new PortOccupancy(PORTS);
    o.moveScope('port_camera_8ICS');
    o.insert('grasper', 'port_utility_5ICS');
    expect(o.insertRefusal('port_utility_5ICS')).toBe('');
    expect(o.insertRefusal('port_camera_8ICS')).toBe('full');
    expect(o.insertRefusal('port_retraction_8ICS')).toBe('');
    expect(o.insertRefusal('port_retraction_8ICS', ['port_utility_5ICS'])).toBe('not-allowed');
    expect(o.insertRefusal('nope')).toBe('unknown');
    expect(I.insertOrder).toEqual(PORTS.map((p) => p.id));
  });

  test('re-selecting the active slot asks reselect first (resume, no sub-option cycle)', () => {
    setMode('explore'); // T860: guided = the walkthrough (user hotbar input locked)
    const hb = createHotbar();
    hb.select(1);
    const sub = hb.subOption();
    let changes = 0;
    hb.on('change', () => changes++);
    hb.reselect = () => true;
    hb.select(1);
    expect([hb.subOption(), changes]).toEqual([sub, 0]);
    hb.reselect = () => false;
    hb.select(1);
    expect(changes).toBe(1); // grasper has sub-options: cycles as before
  });
});
