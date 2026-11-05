import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { cauteryConfig as CAUTERY } from '../../src/scene/cautery.config';
import { createEffects, CutPool, EFFECTS_CONFIG, LensFog, poolCapacity } from '../../src/scene/effects';

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

describe('smoke haze driver', () => {
  it('builds slowly to haze.max while on, clears after', () => {
    const fog = new LensFog();
    fog.on = true;
    fog.update(1);
    expect(fog.value).toBeCloseTo(CAUTERY.haze.riseRate);
    for (let i = 0; i < 100; i++) fog.update(1);
    expect(fog.value).toBe(CAUTERY.haze.max);
    fog.on = false;
    fog.update(1);
    expect(fog.value).toBeCloseTo(CAUTERY.haze.max - CAUTERY.haze.decayRate);
    for (let i = 0; i < 100; i++) fog.update(1);
    expect(fog.value).toBe(0);
  });
});

describe('cautery openings (T822 CutPool ring buffer)', () => {
  const D = CAUTERY.dissect;
  const pool = () => {
    const u = { uCuts: { value: new Float32Array(D.maxPoints * 4) }, uCutCount: { value: 0 } };
    return { u, cuts: new CutPool(u) };
  };

  it('adds openings at spacing along the path, interpolates fast sweeps, grows on dwell up to the cap', () => {
    const { u, cuts } = pool();
    const p = new Vector3();
    cuts.touch(p, 0.03);
    expect(cuts.count).toBe(1);
    expect(u.uCuts.value[3]).toBeCloseTo(D.startRadiusM);
    for (let i = 0; i < 200; i++) cuts.touch(p, 0.03); // dwell
    expect(cuts.count).toBe(1);
    expect(u.uCuts.value[3]).toBeCloseTo(D.maxRadiusM);
    cuts.touch(p.set(D.spacingM * 3.5, 0, 0), 0.03); // jump of 3.5 spacings → 3 openings
    expect(cuts.count).toBe(4);
    expect(cuts.inside(new Vector3(D.spacingM, 0, 0))).toBe(true);
    expect(cuts.inside(new Vector3(0, 1, 0))).toBe(false);
    expect(cuts.stroking).toBe(true);
    cuts.lift();
    expect(cuts.stroking).toBe(false);
    cuts.touch(p.set(1, 0, 0), 0.03); // new stroke: no interpolation across the lift
    expect(cuts.count).toBe(5);
  });

  it('recycles the oldest slot at capacity; reset clears', () => {
    const { u, cuts } = pool();
    for (let i = 0; i < D.maxPoints + 5; i++) {
      cuts.lift();
      cuts.touch(new Vector3(i, 0, 0), 0.03);
    }
    expect(cuts.count).toBe(D.maxPoints);
    expect(u.uCuts.value.length).toBe(D.maxPoints * 4);
    expect(u.uCuts.value[0]).toBe(D.maxPoints); // slot 0 overwritten by stroke #maxPoints
    cuts.reset();
    expect(cuts.count).toBe(0);
    expect(cuts.inside(new Vector3(D.maxPoints, 0, 0))).toBe(false);
  });
});
