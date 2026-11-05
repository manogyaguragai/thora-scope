import { Plane, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { STAPLES_CONFIG, Staples, parkDivisionPlanes, setDivisionPlane } from '../../src/scene/staples';
import {
  Encircle,
  STAPLE_CONFIG,
  StapleFire,
  cutPlane,
  targetTissue,
  validateStaple,
} from '../../src/sim/actions/staple';
import { TARGET_BY_ID } from '../../src/content/targets';

const run = (f: StapleFire, ms: number, step = 16): number => {
  let fired = 0;
  for (let t = 0; t < ms; t += step) if (f.update(step)) fired++;
  return fired;
};

describe('staple validation (§6.4)', () => {
  it('checks cartridge vs target tissue and the encircle prerequisite', () => {
    const e = new Encircle();
    expect(targetTissue('B_RML_common')).toBe('airway');
    expect(targetTissue('V_RML_common')).toBe('vessel');
    expect(targetTissue('LN_7')).toBeNull();
    expect(validateStaple('nope', 'bronchial', e)).toBe('no-target');
    expect(validateStaple('LN_7', 'bronchial', e)).toBe('not-stapleable');
    expect(validateStaple('B_RML_common', 'vascular-curved', e)).toBe('wrong-cartridge');
    expect(validateStaple('B_RML_common', null, e)).toBe('wrong-cartridge');
    expect(validateStaple('B_RML_common', 'bronchial', e)).toBe('not-encircled');
    expect(e.pass('B_RML_common', 'peanut')).toBe(false);
    expect(e.pass('B_RML_common', 'clamp')).toBe(true);
    expect(validateStaple('B_RML_common', 'bronchial', e)).toBe('ok');
    // Fissure: no clamp tunnel needed; the leader encircles vessels only.
    expect(validateStaple('lung_middle_lobe_right', 'parenchyma', e)).toBe('ok');
    expect(e.pass('A_RML_common', 'stapler', 'vascular-leader')).toBe(true);
    expect(e.pass('B_RML_common', 'stapler', 'vascular-leader')).toBe(false);
    e.reset();
    expect(e.has('A_RML_common')).toBe(false);
  });

  it('cut normal is the unit target axis pointing toward the carina (stump side)', () => {
    const r = new StapleFire().result;
    expect(cutPlane('V_RML_common', r)).toBe(true);
    const t = TARGET_BY_ID.get('V_RML_common');
    if (!t?.axis) throw new Error('V_RML_common needs an axis');
    const n = new Vector3(r.normal.x, r.normal.y, r.normal.z);
    expect(n.length()).toBeCloseTo(1, 6);
    const toRef = new Vector3(...STAPLE_CONFIG.proximalRef).sub(new Vector3(...t.point));
    expect(n.dot(toRef)).toBeGreaterThan(0);
    expect(Math.abs(n.dot(new Vector3(...t.axis).normalize()))).toBeCloseTo(1, 6);
    expect(r.hide).toBe(STAPLE_CONFIG.mode === 'hide');
    cutPlane('V_RML_common', r, { x: 1, y: 2, z: 3 });
    expect([r.point.x, r.point.y, r.point.z]).toEqual([1, 2, 3]);
  });
});

describe('fire sequence timing', () => {
  it('close → fire → open, divides exactly once', () => {
    const e = new Encircle();
    e.pass('V_RML_common', 'clamp');
    const f = new StapleFire();
    expect(f.fire()).toBe(false);
    expect(f.close('V_RML_common', 'vascular-curved', e)).toBe('ok');
    expect(f.close('V_RML_common', 'vascular-curved', e)).toBe('busy');
    expect(f.fire()).toBe(true); // armed during closing
    expect(run(f, STAPLE_CONFIG.closeMs / 2)).toBe(0);
    expect(f.phase).toBe('closing');
    expect(f.jaw).toBeGreaterThan(0);
    expect(f.jaw).toBeLessThan(1);
    expect(run(f, STAPLE_CONFIG.closeMs)).toBe(0);
    expect(f.phase).toBe('firing');
    expect(f.jaw).toBe(0);
    expect(run(f, STAPLE_CONFIG.fireMs)).toBe(1);
    expect(f.phase).toBe('opening');
    expect(f.result.target).toBe('V_RML_common');
    expect(f.result.cartridge).toBe('vascular-curved');
    run(f, STAPLE_CONFIG.openMs + 32);
    expect(f.phase).toBe('idle');
    expect(f.jaw).toBe(1);
  });

  it('close holds until fire (bronchus test); release opens without dividing', () => {
    const e = new Encircle();
    e.pass('B_RML_common', 'clamp');
    const f = new StapleFire();
    expect(f.close('B_RML_common', 'vascular-curved', e)).toBe('wrong-cartridge');
    expect(f.phase).toBe('idle');
    f.close('B_RML_common', 'bronchial', e);
    run(f, STAPLE_CONFIG.closeMs * 3);
    expect(f.phase).toBe('closed');
    f.release();
    expect(run(f, STAPLE_CONFIG.openMs + 32)).toBe(0);
    expect(f.phase).toBe('idle');
  });
});

describe('staples scene pools (§6.10)', () => {
  it('fixed capacity, no growth past it', () => {
    const s = new Staples();
    const cap = s.staples.instanceMatrix.count;
    const arr = s.staples.instanceMatrix.array;
    expect(cap).toBe(STAPLES_CONFIG.maxLines * s.perLine);
    expect(s.staples.visible).toBe(false);
    const p = { x: 0, y: 0, z: 0 };
    const n = { x: 1, y: 0, z: 0 };
    const a = { x: 0, y: 1, z: 0 };
    for (let k = 0; k < STAPLES_CONFIG.maxLines + 3; k++) s.addLine(p, n, a);
    for (let k = 0; k < STAPLES_CONFIG.maxClips + 3; k++) s.addClip(p, n, n); // across ∥ axis → fallback basis
    expect(s.staples.instanceMatrix.count).toBe(cap);
    expect(s.staples.instanceMatrix.array).toBe(arr);
    expect(s.staples.count).toBe(cap);
    expect(s.clips.count).toBe(STAPLES_CONFIG.maxClips);
    expect(s.staples.visible && s.clips.visible).toBe(true);
    expect(s.staples.material).toBe(s.clips.material);
    expect(Array.from(s.clips.instanceMatrix.array).every(Number.isFinite)).toBe(true);
    s.reset();
    expect(s.staples.count + s.clips.count).toBe(0);
    expect(s.staples.visible).toBe(false);
  });

  it('cap rows sit on the kept side of the cut', () => {
    const s = new Staples();
    s.addLine({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 0 });
    const m = new Vector3();
    for (let i = 0; i < s.perLine; i++) {
      m.fromArray(s.staples.instanceMatrix.array, i * 16 + 12);
      expect(m.z).toBeGreaterThan(0);
      expect(Math.abs(m.x)).toBeLessThanOrEqual(STAPLES_CONFIG.lineWidth / 2 + 1e-6);
    }
  });
});

describe('division planes', () => {
  it('sets values of preallocated planes without changing count or identity', () => {
    const planes = Array.from(
      { length: config.clipping.divisionPlanes },
      () => new Plane(new Vector3(0, 0, 1), config.clipping.parkConstant),
    );
    const before = [...planes];
    const p0 = planes[0] as Plane;
    expect(setDivisionPlane(planes, { x: 0, y: 0, z: 0.05 }, { x: 0, y: 0, z: -3 })).toBe(true);
    expect(setDivisionPlane(planes, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, planes.length)).toBe(false);
    expect(planes.length).toBe(config.clipping.divisionPlanes);
    planes.forEach((p, i) => expect(p).toBe(before[i]));
    const kept = p0.distanceToPoint(new Vector3(0, 0, 0)); // proximal side (−z)
    const cut = p0.distanceToPoint(new Vector3(0, 0, 0.06));
    expect(kept).toBeGreaterThan(0);
    expect(cut).toBeLessThan(0);
    expect(p0.distanceToPoint(new Vector3(0, 0, 0.05))).toBeCloseTo(-STAPLES_CONFIG.cutGap / 2, 9);
    parkDivisionPlanes(planes);
    expect(p0.constant).toBe(config.clipping.parkConstant);
    expect(p0.normal.z).toBe(1);
  });
});
