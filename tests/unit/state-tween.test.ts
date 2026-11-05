import { describe, expect, test } from 'vitest';
import { config } from '../../src/core/config';
import { tickSim } from '../../src/sim/physiology';
import { createState, startOLV } from '../../src/sim/state';

const P = config.physiology;

describe('tween started before the first tick', () => {
  test('runs its full duration from the first tick, not from t=0', () => {
    const s = createState();
    startOLV(s); // sim clock not started yet (s.t = 0)
    const t0 = 50_000; // a typical performance.now() on the first frame
    tickSim(s, t0);
    expect(s.deflate_RML).toBe(0);
    expect(s.tweens.deflate_RML.active).toBe(true);
    tickSim(s, t0 + P.olvMs / 2);
    expect(s.deflate_RML).toBeCloseTo(0.5);
    tickSim(s, t0 + P.olvMs);
    expect([s.deflate_RUL, s.deflate_RML, s.deflate_RLL]).toEqual([1, 1, 1]);
    expect(s.tweens.deflate_RML.active).toBe(false);
  });
});
