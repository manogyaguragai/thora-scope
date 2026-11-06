import { BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { cauteryConfig as CAUTERY } from '../../src/scene/cautery.config';
import {
  addOpenedAttribute,
  createEffects,
  BLUNT_ATTR,
  CutPool,
  EFFECTS_CONFIG,
  LensFog,
  OPEN_THRESHOLD,
  OPENED_ATTR,
  poolCapacity,
} from '../../src/scene/effects';

const presets = config.quality.presets;

describe('effect pools (§6.10 fixed capacity)', () => {
  it('scales capacity by preset', () => {
    const low = createEffects(presets.low);
    const high = createEffects(presets.high);
    expect(low.smoke.capacity).toBe(presets.low.particleCap);
    expect(high.smoke.capacity).toBe(presets.high.particleCap);
    expect(low.blood.capacity).toBe(poolCapacity(EFFECTS_CONFIG.decal.capScale, presets.low));
    expect(high.blood.capacity).toBeGreaterThan(low.blood.capacity);
    expect(poolCapacity(0.0001, presets.low)).toBe(1);
  });

  it('reuses slots: no growth after more spawns than capacity', () => {
    const fx = createEffects(presets.low);
    const attr = fx.smoke.points.geometry.getAttribute('position');
    const arr = attr.array;
    const at = new Vector3(0, 0, 0);
    fx.cautery(at);
    for (let k = 0; k < fx.smoke.capacity; k++) {
      fx.contact(at, new Vector3(0, 1, 0)); // each touch-down bursts
      fx.contact(null);
    }
    fx.update(1 / 60);
    expect(fx.smoke.aliveCount).toBe(fx.smoke.capacity);
    expect(fx.smoke.points.geometry.getAttribute('position')).toBe(attr);
    expect(attr.array).toBe(arr);
    expect(attr.count).toBe(fx.smoke.capacity);

    for (let k = 0; k < fx.blood.capacity * 3; k++) fx.blood.spawn(at, new Vector3(0, 1, 0));
    expect(fx.blood.mesh.count).toBe(fx.blood.capacity);
    expect(fx.blood.activeBleeds).toBe(fx.blood.capacity);
  });

  it('particles expire after their life and suction clears smoke/ooze', () => {
    const fx = createEffects(presets.low);
    fx.blood.spawn(new Vector3(), new Vector3(0, 1, 0));
    fx.update(1);
    expect(fx.ooze.aliveCount).toBeGreaterThan(0);
    fx.blood.stop(0);
    fx.update(EFFECTS_CONFIG.ooze.lifeSec + 0.01);
    expect(fx.ooze.aliveCount).toBe(0);
    fx.cautery(new Vector3());
    fx.contact(new Vector3(), new Vector3(0, 1, 0));
    fx.suction();
    expect(fx.smoke.aliveCount).toBe(0);
    fx.bubbleBurst(new Vector3());
    fx.update(EFFECTS_CONFIG.bubbles.lifeSec + 0.01);
    expect(fx.bubbles.aliveCount).toBe(0);
  });
});

describe('cautery (T817)', () => {
  it('energised in free space: nothing on tissue (no smoke, char or haze)', () => {
    const fx = createEffects(presets.medium);
    fx.cautery(new Vector3());
    for (let i = 0; i < 30; i++) fx.update(1 / 30);
    expect(fx.energised).toBe(true);
    expect(fx.touching).toBe(false);
    expect(fx.smoke.aliveCount).toBe(0);
    expect(fx.char.count).toBe(0);
    expect(fx.fog.value).toBe(0);
    fx.cautery(null);
    fx.contact(new Vector3(), new Vector3(0, 1, 0), true); // contact without energy does nothing
    expect(fx.touching).toBe(false);
    expect(fx.char.count).toBe(0);
  });

  it('sear line: a mark every char.spacingM along the path, none on dissectable (mark = false) contact', () => {
    const fx = createEffects(presets.medium);
    const n = new Vector3(0, 1, 0);
    fx.cautery(new Vector3());
    for (let k = 0; k < 4; k++) fx.contact(new Vector3(k * CAUTERY.char.spacingM * 1.01, 0, 0), n, true);
    expect(fx.char.count).toBe(4);
    fx.contact(new Vector3(0.0001 + 3 * CAUTERY.char.spacingM, 0, 0), n, true); // dwell: same mark grows
    expect(fx.char.count).toBe(4);
    fx.contact(new Vector3(1, 0, 0), n, false);
    expect(fx.char.count).toBe(4);
    fx.char.clear();
    expect(fx.char.count).toBe(0);
  });

  it('energised: smoke plume keeps emitting, char mark grows while held; off: plume stops, mark stays', () => {
    const fx = createEffects(presets.medium);
    const tip = new Vector3(0, 0, 0);
    const scale = (): number => {
      const m = new Matrix4();
      fx.char.mesh.getMatrixAt(0, m);
      return new Vector3().setFromMatrixScale(m).x;
    };
    fx.cautery(tip);
    fx.contact(new Vector3(0, 0, 0), new Vector3(0, 1, 0), true);
    expect(fx.energised).toBe(true);
    expect(fx.char.count).toBe(1);
    expect(scale()).toBeCloseTo(CAUTERY.char.startRadiusM);
    for (let i = 0; i < 60; i++) fx.update(1 / 30); // 2 s > smoke life: still alive = still emitting
    expect(fx.smoke.aliveCount).toBeGreaterThan(0);
    expect(scale()).toBeGreaterThan(CAUTERY.char.startRadiusM);
    expect(fx.fog.value).toBeGreaterThan(0);
    fx.cautery(null);
    expect(fx.energised).toBe(false);
    const grown = scale();
    fx.update(EFFECTS_CONFIG.smoke.lifeSec + 0.01);
    expect(fx.smoke.aliveCount).toBe(0);
    expect(scale()).toBeCloseTo(grown);
    fx.cautery(tip);
    fx.contact(tip, new Vector3(0, 1, 0), true); // a new press = a new mark (ring-buffer slot)
    expect(fx.char.count).toBe(2);
  });
});

describe('smoke density (T842)', () => {
  it('accumulates with energy time to haze.max, stays (slow passive clearing), the sucker clears it', () => {
    const H = CAUTERY.haze;
    const fog = new LensFog();
    fog.on = true;
    fog.update(1);
    expect(fog.value).toBeCloseTo(H.riseRate);
    for (let i = 0; i < 29; i++) fog.update(1); // 30 s of cautery → murky
    expect(fog.value).toBeGreaterThan(0.5);
    for (let i = 0; i < 100; i++) fog.update(1);
    expect(fog.value).toBe(H.max);
    fog.on = false;
    for (let i = 0; i < 10; i++) fog.update(1);
    expect(fog.value).toBeCloseTo(H.max - 10 * H.decayRate); // persists
    fog.suction = true;
    fog.update(1);
    expect(fog.value).toBeCloseTo(H.max - 11 * H.decayRate - CAUTERY.suction.hazeClearPerSec);
    for (let i = 0; i < 10; i++) fog.update(1);
    expect(fog.value).toBe(0);
  });

  it('cavity smoke drifts in with density; the held sucker pulls particles to the tip and aspirates them', () => {
    const fx = createEffects(presets.high);
    const at = new Vector3(0, 0, 0);
    fx.cautery(at);
    fx.contact(at, new Vector3(0, 1, 0));
    for (let i = 0; i < 300; i++) fx.update(1 / 10); // 30 s
    fx.cautery(null);
    expect(fx.fog.value).toBeGreaterThan(0.5);
    expect(fx.haze.aliveCount).toBeGreaterThan(0);
    const fog = fx.fog.value;
    fx.suck(at);
    expect(fx.sucking).toBe(true);
    for (let i = 0; i < 30; i++) fx.update(1 / 10);
    expect(fx.fog.value).toBeLessThan(fog);
    expect(fx.smoke.aliveCount).toBe(0); // all within reach of the tip: aspirated
    fx.suck(null);
    expect(fx.sucking).toBe(false);
  });

  it('suction shrinks pooled blood near the tip; a still-bleeding decal keeps a floor', () => {
    const fx = createEffects(presets.medium);
    const n = new Vector3(0, 1, 0);
    const size = (i: number): number => {
      const m = new Matrix4();
      fx.blood.mesh.getMatrixAt(i, m);
      return new Vector3().setFromMatrixScale(m).x;
    };
    fx.blood.spawn(new Vector3(), n, 0.01);
    fx.blood.spawn(new Vector3(0.001, 0, 0), n, 0.01);
    fx.blood.stop(1);
    fx.update(EFFECTS_CONFIG.decal.growSec);
    fx.suck(new Vector3());
    for (let i = 0; i < 60; i++) fx.update(1 / 10);
    expect(size(0)).toBeGreaterThan(0); // bleeding: floor
    expect(size(1)).toBe(0); // controlled: aspirated
  });
});

describe('node-bed ooze (T842)', () => {
  it('drips until energised contact holds coag.sec on it', () => {
    const fx = createEffects(presets.medium);
    const bed = new Vector3(0.01, 0, 0);
    fx.startOoze(bed, new Vector3(0, 1, 0));
    expect(fx.oozing).toBe(1);
    expect(fx.oozeNear(bed)).toBe(true);
    expect(fx.oozeNear(new Vector3(1, 0, 0))).toBe(false);
    fx.update(1);
    expect(fx.ooze.aliveCount).toBeGreaterThan(0);
    fx.cautery(bed);
    fx.contact(new Vector3(1, 0, 0), new Vector3(0, 1, 0)); // elsewhere: no seal
    fx.update(CAUTERY.coag.sec + 0.1);
    expect(fx.oozing).toBe(1);
    fx.contact(bed, new Vector3(0, 1, 0));
    for (let t = 0; t <= CAUTERY.coag.sec + 0.1; t += 0.1) fx.update(0.1);
    expect(fx.oozing).toBe(0);
    expect(fx.oozeNear(bed)).toBe(false);
  });
});

describe('persistent dissection (T842 per-vertex opened field)', () => {
  const D = CAUTERY.dissect;
  /** 4 cm sheet, 0.5 mm grid, BVH as the picker builds it. */
  const layer = () => {
    const g = new PlaneGeometry(0.04, 0.04, 80, 80);
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.name = 'mediastinal_pleura_hilum';
    mesh.updateMatrixWorld();
    g.boundsTree = new MeshBVH(g);
    addOpenedAttribute(mesh);
    const opened = g.getAttribute(OPENED_ATTR) as BufferAttribute;
    return { mesh, opened, cuts: new CutPool([mesh]) };
  };

  it('opens along the stroke, widens on dwell; picking sees the same field', () => {
    const { mesh, opened, cuts } = layer();
    const p = new Vector3();
    cuts.touch(mesh.name, p, 0.03);
    const first = cuts.count;
    expect(first).toBeGreaterThan(0);
    expect(cuts.inside(mesh, p)).toBe(true);
    expect(cuts.inside(mesh, new Vector3(D.maxRadiusM * 2, 0, 0))).toBe(false);
    for (let i = 0; i < 200; i++) cuts.touch(mesh.name, p, 0.03); // dwell → maxRadiusM
    expect(cuts.count).toBeGreaterThan(first);
    expect(cuts.inside(mesh, new Vector3(D.maxRadiusM * 0.9, 0, 0))).toBe(true);
    cuts.touch(mesh.name, p.set(0.01, 0, 0), 0.03); // fast jump: the capsule opens the whole path
    expect(cuts.inside(mesh, new Vector3(0.006, 0, 0))).toBe(true);
    expect(opened.updateRanges).toHaveLength(1); // one reused range, widened while the upload is pending
    expect(cuts.stroking).toBe(true);
    cuts.touch('lung_upper_lobe_right', p, 0.03); // not a layer: lifts
    expect(cuts.stroking).toBe(false);
  });

  it('T852 blunt (peanut) touch: a wider opening flagged blunt; a later cautery touch flags its own vertices', () => {
    const cautery = layer();
    const blunt = layer();
    const p = new Vector3();
    cautery.cuts.touch(cautery.mesh.name, p, 0.03);
    blunt.cuts.touch(blunt.mesh.name, p, 0.03, true);
    expect(blunt.cuts.count).toBeGreaterThan(cautery.cuts.count); // radiusScale wider
    const b = blunt.mesh.geometry.getAttribute(BLUNT_ATTR) as BufferAttribute;
    const flags = b.array as Float32Array;
    expect(flags.some((v) => v === 1)).toBe(true);
    expect(b.updateRanges).toHaveLength(1);
    blunt.cuts.lift();
    blunt.cuts.touch(blunt.mesh.name, p.set(0.012, 0, 0), 0.03); // cautery elsewhere: its rim is coagulated
    const pos = blunt.mesh.geometry.getAttribute('position');
    const at = (x: number): number => {
      for (let k = 0; k < pos.count; k++) if (Math.hypot(pos.getX(k) - x, pos.getY(k)) < 1e-4) return k;
      return -1;
    };
    expect(flags[at(0)]).toBe(1);
    expect(flags[at(0.012)]).toBe(0);
    expect(blunt.cuts.inside(blunt.mesh, p)).toBe(true);
    expect((cautery.mesh.geometry.getAttribute(BLUNT_ATTR).array as Float32Array).every((v) => v === 0)).toBe(true);
  });

  it('never closes: 10 sweeps back and forth only add; reset clears everything', () => {
    const { mesh, opened, cuts } = layer();
    const p = new Vector3();
    let prev = 0;
    for (let sweep = 0; sweep < 10; sweep++) {
      for (let k = 0; k <= 20; k++) {
        const t = sweep % 2 ? 1 - k / 20 : k / 20;
        cuts.touch(mesh.name, p.set(-0.012 + 0.024 * t, 0.002 * Math.sin(sweep), 0), 0.03);
        expect(cuts.count).toBeGreaterThanOrEqual(prev);
        prev = cuts.count;
      }
      cuts.lift();
      expect(cuts.inside(mesh, new Vector3(-0.012, 0, 0))).toBe(true); // the first opening is still open
    }
    const o = opened.array as Float32Array;
    expect(o.filter((v) => v > OPEN_THRESHOLD).length).toBe(cuts.count);
    cuts.reset();
    expect(cuts.count).toBe(0);
    expect(o.every((v) => v === 0)).toBe(true);
    expect(cuts.inside(mesh, new Vector3(-0.012, 0, 0))).toBe(false);
  });
});
