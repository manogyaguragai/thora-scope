import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { createEffects } from '../../src/scene/effects';
import { Water, waterUniforms } from '../../src/scene/water';
import { waterConfig as C } from '../../src/scene/water.config';
import { createFinishState } from '../../src/sim/actions/finish';
import { irrigateField } from '../../src/sim/actions/irrigation';

// Below the maxTopY cap (lens stays above the water); a separate case checks the cap.
const points = [new Vector3(0, 0.02, 0), new Vector3(0.01, 0.05, 0.01)];

describe('irrigation water (T842)', () => {
  it('caps the full level below the scope ports (maxTopY)', () => {
    const w = new Water([new Vector3(0, 0.02, 0), new Vector3(0, 0.2, 0)]);
    expect(w.topY).toBe(C.maxTopY);
  });

  it('fills until every listed point is under, drives uniforms only, suction drains it', () => {
    const w = new Water(points);
    const mat = w.mesh.material;
    expect(w.mesh.visible).toBe(false);
    expect(waterUniforms.uWaterLevel.value).toBe(C.dryY);
    w.fill();
    for (let i = 0; i < 100; i++) w.update(0.1, null, null);
    expect(w.level).toBe(1);
    expect(w.mesh.visible).toBe(true);
    for (const p of points) expect(w.surfaceY).toBeGreaterThan(p.y); // submerged
    expect(waterUniforms.uWaterLevel.value).toBeCloseTo(w.surfaceY);
    const tip = new Vector3(0, w.bottomY, 0);
    w.update(1, null, new Vector3(0, w.surfaceY + 2 * C.suctionReachM, 0)); // out of reach: no drain
    w.update(1, null, new Vector3(1, w.bottomY, 0)); // outside the pool
    expect(w.level).toBe(1);
    const t = waterUniforms.uWaterTime.value;
    w.update(0.1, null, null);
    expect(waterUniforms.uWaterTime.value).toBeGreaterThan(t); // ripples / caustics move
    w.update(1, null, tip); // sucker held at the bottom of the pool
    expect(w.level).toBeCloseTo(1 - C.drainPerSec);
    w.update(1, null, null); // released: stays down
    expect(w.level).toBeCloseTo(1 - C.drainPerSec);
    for (let i = 0; i < 20; i++) w.update(1, null, tip);
    expect(w.level).toBe(0);
    expect(w.mesh.visible).toBe(false);
    expect(waterUniforms.uWaterLevel.value).toBe(C.dryY);
    expect(w.mesh.material).toBe(mat);
    expect(mat.transparent).toBe(true);
  });

  it('bubbles only from a leak under water (setLeak); reset dries at once', () => {
    const fx = createEffects(config.quality.presets.medium);
    const w = new Water(points);
    w.fill();
    for (let i = 0; i < 100; i++) w.update(0.1, fx.bubbles, null);
    expect(fx.bubbles.aliveCount).toBe(0); // intact staple lines: no bubbles
    w.setLeak(points[0] ?? null);
    w.update(1, fx.bubbles, null);
    expect(fx.bubbles.aliveCount).toBeGreaterThan(0);
    w.reset();
    expect(w.level).toBe(0);
    expect(w.mesh.visible).toBe(false);
  });

  it('irrigateField: final step of guided / explore fills; practice needs the lobe out', () => {
    const s = createFinishState();
    expect(irrigateField(s, false).ok).toBe(false);
    const r = irrigateField(s, true);
    expect(r.ok && r.requests[0]?.kind).toBe('fluid');
    expect(s.fluidFilled).toBe(true);
  });
});
