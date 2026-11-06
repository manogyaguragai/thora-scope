import { CylinderGeometry, Mesh, Plane, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { instrumentGeom } from '../../src/scene/instruments.config';
import {
  STAPLES_CONFIG,
  Staples,
  localAxis,
  parkDivisionPlanes,
  setDivisionPlane,
} from '../../src/scene/staples';
import {
  ClipFire,
  Encircle,
  STAPLE_CONFIG,
  StapleFire,
  closedJawFor,
  cutPlane,
  jawPose,
  staplerDepth,
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
    expect(targetTissue('middle_lobe_bronchus')).toBe('airway');
    expect(targetTissue('middle_lobe_vein')).toBe('vessel');
    expect(targetTissue('LN_7')).toBeNull();
    expect(validateStaple('nope', 'bronchial', e)).toBe('no-target');
    expect(validateStaple('LN_7', 'bronchial', e)).toBe('not-stapleable');
    expect(validateStaple('middle_lobe_bronchus', 'vascular-curved', e)).toBe('wrong-cartridge');
    expect(validateStaple('middle_lobe_bronchus', null, e)).toBe('wrong-cartridge');
    expect(validateStaple('middle_lobe_bronchus', 'bronchial', e)).toBe('not-encircled');
    expect(e.pass('middle_lobe_bronchus', 'cautery')).toBe(false);
    expect(e.pass('middle_lobe_bronchus', 'clamp')).toBe(true);
    expect(e.pass('middle_lobe_vein', 'peanut')).toBe(true); // T844: the peanut makes the passage
    expect(validateStaple('middle_lobe_bronchus', 'bronchial', e)).toBe('ok');
    // Fissure: no clamp tunnel needed; the leader encircles vessels only.
    expect(validateStaple('lung_middle_lobe_right', 'parenchyma', e)).toBe('ok');
    expect(e.pass('middle_lobe_artery', 'stapler', 'vascular-leader')).toBe(true);
    expect(e.pass('middle_lobe_bronchus', 'stapler', 'vascular-leader')).toBe(false);
    e.reset();
    expect(e.has('middle_lobe_artery')).toBe(false);
  });

  it('cut normal is the unit target axis pointing toward the carina (stump side)', () => {
    const r = new StapleFire().result;
    expect(cutPlane('middle_lobe_vein', r)).toBe(true);
    const t = TARGET_BY_ID.get('middle_lobe_vein');
    if (!t?.axis) throw new Error('middle_lobe_vein needs an axis');
    const n = new Vector3(r.normal.x, r.normal.y, r.normal.z);
    expect(n.length()).toBeCloseTo(1, 6);
    const toRef = new Vector3(...STAPLE_CONFIG.proximalRef).sub(new Vector3(...t.point));
    expect(n.dot(toRef)).toBeGreaterThan(0);
    expect(Math.abs(n.dot(new Vector3(...t.axis).normalize()))).toBeCloseTo(1, 6);
    expect(r.hide).toBe(STAPLE_CONFIG.mode === 'hide');
    cutPlane('middle_lobe_vein', r, { x: 1, y: 2, z: 3 });
    expect([r.point.x, r.point.y, r.point.z]).toEqual([1, 2, 3]);
  });
});

describe('fire sequence timing', () => {
  it('close → fire → open, divides exactly once', () => {
    const e = new Encircle();
    e.pass('middle_lobe_vein', 'clamp');
    const f = new StapleFire();
    expect(f.fire()).toBe(false);
    expect(f.close('middle_lobe_vein', 'vascular-curved', e)).toBe('ok');
    expect(f.close('middle_lobe_vein', 'vascular-curved', e)).toBe('busy');
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
    expect(f.result.target).toBe('middle_lobe_vein');
    expect(f.result.cartridge).toBe('vascular-curved');
    run(f, STAPLE_CONFIG.openMs + 32);
    expect(f.phase).toBe('idle');
    expect(f.jaw).toBe(1);
  });

  it('close holds until fire (bronchus test); release opens without dividing', () => {
    const e = new Encircle();
    e.pass('middle_lobe_bronchus', 'clamp');
    const f = new StapleFire();
    expect(f.close('middle_lobe_bronchus', 'vascular-curved', e)).toBe('wrong-cartridge');
    expect(f.phase).toBe('idle');
    f.close('middle_lobe_bronchus', 'bronchial', e);
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
    const arr = s.staples.instanceMatrix.array;
    for (let i = 0; i < s.perLine; i++) {
      m.fromArray(arr, i * 16 + 12);
      if (i >= s.perSide) {
        expect(arr[i * 16]).toBe(0); // one-sided: the second half of the slot stays unformed
        continue;
      }
      expect(m.z).toBeGreaterThan(0);
      expect(Math.abs(m.x)).toBeLessThanOrEqual(STAPLES_CONFIG.lineWidth / 2 + 1e-6);
    }
  });

  it('T841: two-sided line forms progressively heel → tip, then clears for the stumps', () => {
    const s = new Staples();
    s.beginLine({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, 0.01, 2);
    expect(s.revealed).toBe(0);
    const arr = s.staples.instanceMatrix.array;
    s.reveal(0.5);
    const half = s.revealed;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(s.perLine);
    const m = new Vector3();
    for (let i = 0; i < s.perLine; i++) {
      if (arr[i * 16] === 0) continue;
      m.fromArray(arr, i * 16 + 12);
      expect(m.x).toBeLessThan(0.0001); // heel half (−across) first
    }
    s.reveal(1);
    expect(s.revealed).toBe(s.perLine);
    let neg = 0;
    for (let i = 0; i < s.perLine; i++) if ((arr[i * 16 + 14] as number) < 0) neg++;
    expect(neg).toBe(s.perSide); // mirrored rows on the far side of the knife line
    s.clearLine();
    expect(s.revealed).toBe(0);
    for (let i = 0; i < s.perLine; i++) expect(arr[i * 16]).toBe(0);
    expect(s.lineCount).toBe(1);
  });

  it('T841: localAxis = principal axis + centroid of the nearby vertices', () => {
    const g = new CylinderGeometry(0.002, 0.002, 0.04, 16, 40).rotateZ(Math.PI / 4);
    const mesh = new Mesh(g);
    mesh.updateMatrixWorld();
    const c = new Vector3();
    const a = new Vector3();
    expect(localAxis(mesh, { x: 0.001, y: 0.001, z: 0 }, 0.006, c, a)).toBe(true);
    expect(Math.abs(a.dot(new Vector3(-1, 1, 0).normalize()))).toBeGreaterThan(0.99);
    expect(c.length()).toBeLessThan(0.001);
    expect(localAxis(mesh, { x: 1, y: 1, z: 1 }, 0.006, c, a)).toBe(false);
  });
});

describe('T841 fire sub-phases, compressed jaws, clip applier, jaw pose', () => {
  it('closes onto closedJaw, pauses, forms staples, then the knife runs; opens from closedJaw', () => {
    const e = new Encircle();
    e.pass('middle_lobe_vein', 'clamp');
    const f = new StapleFire();
    f.closedJaw = 0.3;
    f.close('middle_lobe_vein', 'vascular-curved', e);
    f.fire();
    run(f, STAPLE_CONFIG.closeMs + 16);
    expect(f.phase).toBe('firing');
    expect(f.jaw).toBeCloseTo(0.3, 6);
    const seen: number[][] = [];
    for (let t = 0; t < STAPLE_CONFIG.fireMs; t += 16) {
      if (f.update(16)) break;
      seen.push([f.compress, f.form, f.knife]);
    }
    const formAt = seen.findIndex(([, fm]) => (fm as number) > 0);
    const knifeAt = seen.findIndex(([, , k]) => (k as number) > 0);
    expect(formAt).toBeGreaterThan(0); // compression pause first
    expect(seen[formAt - 1]?.[0]).toBeGreaterThan(0.9);
    expect(knifeAt).toBeGreaterThan(formAt);
    expect(seen[knifeAt - 1]?.[1]).toBeGreaterThan(0.9);
    expect(f.phase).toBe('opening');
    f.update(16);
    expect(f.jaw).toBeGreaterThan(0.3);
  });

  it('closed jaw squeezes but never cuts through: larger structures stop wider', () => {
    for (const tool of ['stapler', 'clamp', 'clip'] as const) {
      const small = closedJawFor(tool, 0.0015);
      const big = closedJawFor(tool, 0.004);
      expect(small).toBeGreaterThanOrEqual(0);
      expect(big).toBeGreaterThan(small);
      expect(big).toBeLessThanOrEqual(1);
    }
    expect(staplerDepth(0.004)).toBeGreaterThan(staplerDepth(0.0015));
  });

  it('clip applier crimps once per application', () => {
    const c = new ClipFire();
    expect(c.start()).toBe(true);
    expect(c.start()).toBe(false);
    let crimps = 0;
    for (let t = 0; t < STAPLE_CONFIG.closeMs + STAPLE_CONFIG.openMs + 64; t += 16)
      if (c.update(16)) crimps++;
    expect(crimps).toBe(1);
    expect(c.phase).toBe('idle');
    expect(c.jaw).toBe(1);
  });

  it('jawPose crosses the structure at 90°, centre between the jaws, shaft through the port', () => {
    const pivot = new Vector3(0.1, 0.05, 0.12);
    const centre = new Vector3(0, 0, 0);
    for (const axis of [
      new Vector3(0, 1, 0),
      new Vector3(0.3, 0.2, -0.9).normalize(),
      new Vector3(1, 0.2, 0.1),
    ]) {
      for (const tool of ['stapler', 'clamp', 'clip'] as const) {
        const pos = new Vector3();
        const q = new Quaternion();
        const jaw = new Vector3();
        const art = jawPose(tool, pivot, centre, axis, 0.003, pos, q, jaw);
        const shaft = new Vector3(0, 0, 1).applyQuaternion(q);
        const toTip = pos.clone().sub(pivot).normalize();
        expect(shaft.dot(toTip)).toBeGreaterThan(0.999); // the shaft passes through the port fulcrum
        const cosJaw = Math.abs(jaw.dot(axis));
        if (tool === 'stapler' && Math.abs(art) < instrumentGeom.stapler.maxArticulation - 1e-6)
          expect(cosJaw).toBeLessThan(Math.sin((2 * Math.PI) / 180)); // articulated exactly ⟂
        if (tool !== 'stapler') expect(new Vector3(1, 0, 0).applyQuaternion(q).dot(shaft)).toBeCloseTo(0, 6);
        // The structure's centre sits at the tool's hold point between the jaws (tool-local).
        const local = centre.clone().sub(pos).applyQuaternion(q.clone().invert());
        if (tool === 'clip')
          expect(local.distanceTo(new Vector3(0, 0, -instrumentGeom.clip.clipLength / 2))).toBeLessThan(1e-6);
        if (tool === 'stapler')
          expect(local.y).toBeCloseTo(instrumentGeom.stapler.insertInset / 2 + 0.003, 6);
      }
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
