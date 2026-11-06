import { describe, expect, test } from 'vitest';
import { config } from '../../src/core/config';
import { ANATOMY } from '../../src/content/anatomy';
import { buildMorphBindings, CHANNELS, COLLAPSE_GAIN, updateMorphs } from '../../src/scene/morphs';
import type { MorphMesh } from '../../src/scene/morphs';
import { tickSim } from '../../src/sim/physiology';
import { clampRMLReinflate, createState, releaseClamp, setLobe, startOLV } from '../../src/sim/state';
import type { AppState } from '../../src/sim/state';

const P = config.physiology;

/** Plain object shaped like a three Mesh; morph order deliberately differs per mesh. */
function fakeMesh(names: string[], parent: MorphMesh | null = null): MorphMesh {
  const dict: Record<string, number> = {};
  names.forEach((n, i) => (dict[n] = i));
  return { visible: true, parent, morphTargetDictionary: dict, morphTargetInfluences: names.map(() => 0) };
}
const inf = (m: MorphMesh, name: string): number =>
  m.morphTargetInfluences?.[m.morphTargetDictionary?.[name] ?? -1] ?? NaN;

/** Still state: no physiology motion, so channel values depend only on deflate/retract. */
function still(): AppState {
  const s = createState();
  s.heartbeatOn = false;
  s.breathingOn = false;
  return s;
}

describe('morph bindings', () => {
  const lobe = fakeMesh([
    'retract_fissure',
    'collapse_RML',
    'retract_hilum',
    'retract_RML_lateral',
    'old_key',
  ]);
  const heart = fakeMesh(['heartbeat']);
  const bare: MorphMesh = { visible: true, parent: null };
  const b = buildMorphBindings([lobe, heart, bare]);

  test('channels = manifest morphs + heartbeat + breath_left; bound by name', () => {
    expect(CHANNELS).toEqual([...ANATOMY.morphs, 'heartbeat', 'breath_left']);
    expect(b.meshes).toBe(2);
    expect(b.list.length).toBe(5); // old_key has no channel
  });

  test('collapse follows its lobe; retract keys are ungated, additive', () => {
    const s = still();
    s.deflate_RML = 0.7;
    s.retract_hilum = 0.4;
    s.retract_RML_lateral = 0.6;
    s.retract_fissure = 1;
    updateMorphs(b, s);
    expect(inf(lobe, 'collapse_RML')).toBeCloseTo(0.7 * COLLAPSE_GAIN); // T843 manifest gain
    expect(inf(lobe, 'retract_hilum')).toBeCloseTo(0.4);
    expect(inf(lobe, 'retract_RML_lateral')).toBeCloseTo(0.6);
    expect(inf(lobe, 'retract_fissure')).toBe(1);
    expect(inf(lobe, 'old_key')).toBe(0);
  });

  test('legacy grasper key drives retract_hilum (max)', () => {
    const s = still();
    s.retract_hilum = 0.2;
    s.retract_posterior = 0.9;
    updateMorphs(b, s);
    expect(inf(lobe, 'retract_hilum')).toBeCloseTo(0.9);
  });

  test('dirty flags: identical second frame writes 0', () => {
    const s = still();
    s.deflate_RML = 0.33;
    updateMorphs(b, s);
    expect(b.writes).toBeGreaterThan(0);
    expect(updateMorphs(b, s)).toBe(0);
  });

  test('hidden mesh (self or ancestor) skipped, catches up when shown', () => {
    const group: MorphMesh = { visible: true, parent: null };
    const child = fakeMesh(['collapse_RUL'], group);
    const b2 = buildMorphBindings([child]);
    const s = still();
    group.visible = false;
    s.deflate_RUL = 0.9;
    expect(updateMorphs(b2, s)).toBe(0);
    expect(b2.skipped).toBe(1);
    expect(inf(child, 'collapse_RUL')).toBe(0);
    group.visible = true;
    expect(updateMorphs(b2, s)).toBe(1);
    expect(inf(child, 'collapse_RUL')).toBeCloseTo(0.9 * COLLAPSE_GAIN);
  });

  test('ventilated right lobe breathes subtly; collapsed lobe does not', () => {
    const m = fakeMesh(['collapse_RUL', 'collapse_RLL']);
    const b3 = buildMorphBindings([m]);
    const s = createState();
    s.deflate_RLL = 1;
    let maxU = 0;
    let maxL = 0;
    for (let t = 1; t <= 4000; t += 10) {
      tickSim(s, t);
      updateMorphs(b3, s);
      maxU = Math.max(maxU, inf(m, 'collapse_RUL'));
      maxL = Math.max(maxL, inf(m, 'collapse_RLL'));
    }
    expect(maxU).toBeGreaterThan(P.rightLobeBreathAmp * 0.9);
    expect(maxU).toBeLessThanOrEqual(P.rightLobeBreathAmp + 1e-9);
    expect(maxL).toBeCloseTo(COLLAPSE_GAIN, 9);
  });
});

test('T843 collapse gain comes from the manifest, within the tear-checked range', () => {
  expect(COLLAPSE_GAIN).toBe((ANATOMY as { collapseGain?: number }).collapseGain ?? 1);
  expect(COLLAPSE_GAIN).toBeGreaterThanOrEqual(1);
  expect(COLLAPSE_GAIN).toBeLessThanOrEqual(1.6);
});

describe('physiology clock', () => {
  /** Ticks 1 ms steps over one cycle; returns time spent with value > 0 and time of peak. */
  function cycle(s: AppState, ms: number, read: (s: AppState) => number): { above: number; peakAt: number } {
    let above = 0;
    let peak = -1;
    let peakAt = 0;
    tickSim(s, 1);
    for (let t = 1; t < ms; t++) {
      tickSim(s, t + 1);
      const v = read(s);
      if (v > 1e-9) above++;
      if (v > peak) [peak, peakAt] = [v, t];
    }
    return { above, peakAt };
  }

  test('systole ≈ 0.3 s at 75 bpm and scales with HR', () => {
    const s = createState();
    s.hrBpm = 75;
    expect(cycle(s, 800, (x) => x.heartbeat).above).toBeGreaterThanOrEqual(298);
    expect(cycle(createState(), 800, (x) => x.heartbeat).above).toBeLessThanOrEqual(301);
    const fast = createState();
    fast.hrBpm = 150;
    expect(cycle(fast, 400, (x) => x.heartbeat).above).toBeCloseTo(150, -1);
  });

  test('breath: inspiration is 40 % of the cycle', () => {
    const s = createState();
    s.rrPerMin = 15; // 4 s cycle
    expect(cycle(s, 4000, (x) => x.breath).peakAt).toBeCloseTo(4000 * P.inspFraction, -1);
  });

  test('toggles off hold heartbeat and breath at 0', () => {
    const s = createState();
    s.heartbeatOn = false;
    s.breathingOn = false;
    expect(cycle(s, 4000, (x) => x.heartbeat + x.breath).above).toBe(0);
  });
});

describe('commands + tweens', () => {
  function run(s: AppState, from: number, ms: number): void {
    for (let t = from; t <= from + ms; t += 16) tickSim(s, t);
    tickSim(s, from + ms);
  }

  test('startOLV: all lobes → 1 over olvMs, eased', () => {
    const s = createState();
    tickSim(s, 1000);
    startOLV(s);
    tickSim(s, 1000 + P.olvMs / 4);
    expect(s.deflate_RML).toBeGreaterThan(0);
    expect(s.deflate_RML).toBeLessThan(0.25); // ease-in: slower than linear early
    tickSim(s, 1000 + P.olvMs / 2);
    expect(s.deflate_RML).toBeCloseTo(0.5);
    tickSim(s, 1000 + P.olvMs - 1);
    expect(s.deflate_RUL).toBeLessThan(1);
    run(s, 1000 + P.olvMs, 0);
    expect([s.deflate_RUL, s.deflate_RML, s.deflate_RLL]).toEqual([1, 1, 1]);
  });

  test('clamp re-inflates RUL/RLL, RML stays; release re-inflates RML unless divided', () => {
    const s = createState();
    tickSim(s, 1);
    startOLV(s);
    run(s, 1, P.olvMs);
    clampRMLReinflate(s);
    run(s, s.t, P.clampMs);
    expect([s.deflate_RUL, s.deflate_RML, s.deflate_RLL]).toEqual([0, 1, 0]);
    s.rmlDivided = true;
    releaseClamp(s);
    run(s, s.t, P.releaseMs);
    expect(s.deflate_RML).toBe(1);
    s.rmlDivided = false;
    releaseClamp(s);
    run(s, s.t, P.releaseMs);
    expect(s.deflate_RML).toBe(0);
  });

  test('setLobe sets immediately, clamps and cancels the tween', () => {
    const s = createState();
    tickSim(s, 1);
    startOLV(s);
    setLobe(s, 'RML', 2);
    expect(s.deflate_RML).toBe(1);
    setLobe(s, 'RML', 0.3);
    run(s, 1, P.olvMs);
    expect(s.deflate_RML).toBe(0.3);
  });
});
