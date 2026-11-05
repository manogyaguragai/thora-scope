import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { createEffects, EFFECTS_CONFIG, LensFog, poolCapacity } from '../../src/scene/effects';

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
    for (let k = 0; k < fx.smoke.capacity; k++) fx.cautery(at);
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
    fx.suction();
    expect(fx.smoke.aliveCount).toBe(0);
    fx.bubbleBurst(new Vector3());
    fx.update(EFFECTS_CONFIG.bubbles.lifeSec + 0.01);
    expect(fx.bubbles.aliveCount).toBe(0);
  });
});

describe('lens fog driver', () => {
  it('rises to the pulse then decays to 0', () => {
    const fog = new LensFog();
    fog.pulse(0.6);
    fog.update(0.05);
    expect(fog.value).toBeCloseTo(Math.min(0.6, EFFECTS_CONFIG.fog.riseRate * 0.05));
    fog.update(0.05);
    fog.update(0.05); // 0.15 s × riseRate 4 ≥ 0.6: at the target
    const peak = fog.value;
    expect(peak).toBeCloseTo(0.6);
    fog.update(0.5);
    expect(fog.value).toBeLessThan(peak);
    for (let i = 0; i < 100; i++) fog.update(0.1);
    expect(fog.value).toBe(0);
    fog.pulse(5);
    for (let i = 0; i < 10; i++) fog.update(0.1);
    expect(fog.value).toBeLessThanOrEqual(1);
  });
});
