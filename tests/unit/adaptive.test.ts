import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AdaptiveResolution,
  applyPixelRatio,
  loadQualityChoice,
  nextLowerPreset,
  saveQualityChoice,
} from '../../src/core/adaptiveResolution';
import { config } from '../../src/core/config';

const C = config.perf.adaptive;

/** Feed frames for `totalMs` of frame time; frameMs may depend on the current ratio. */
function run(a: AdaptiveResolution, totalMs: number, frameMs: (ratio: number) => number): number {
  let changes = 0;
  for (let t = 0; t < totalMs;) {
    const ms = frameMs(a.ratio);
    const before = a.ratio;
    a.update(ms);
    if (a.ratio !== before) changes++;
    t += ms;
  }
  return changes;
}

/** Deterministic noise in [lo, hi). */
function noise(lo: number, hi: number): () => number {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return lo + (hi - lo) * (s / 2 ** 31);
  };
}

describe('AdaptiveResolution', () => {
  test('starts at the clamped ceiling: min(input, 1.5), floor 0.6 unless the ceiling is lower', () => {
    expect(new AdaptiveResolution(2).ratio).toBe(C.maxRatio);
    expect(new AdaptiveResolution(1.25).ratio).toBe(1.25);
    const tiny = new AdaptiveResolution(0.5);
    expect(tiny.ratio).toBe(0.5);
    run(tiny, 10_000, () => 30);
    expect(tiny.ratio).toBe(0.5);
  });

  test('steps down after downHoldMs of slow windows, never below minRatio', () => {
    const a = new AdaptiveResolution(1.5);
    run(a, C.downHoldMs * 0.9, () => 30);
    expect(a.ratio).toBe(1.5);
    run(a, C.downHoldMs * 0.2, () => 30);
    expect(a.ratio).toBe(1.4);
    run(a, 60_000, () => 30);
    expect(a.ratio).toBe(C.minRatio);
  });

  test('steps up only after cooldown + upHoldMs of headroom, never above the ceiling', () => {
    const a = new AdaptiveResolution(1.5);
    run(a, C.downHoldMs * 1.1, () => 30);
    expect(a.ratio).toBe(1.4);
    run(a, C.upHoldMs * 0.975, () => 10);
    expect(a.ratio).toBe(1.4);
    run(a, C.cooldownMs + C.upHoldMs * 0.5, () => 10);
    expect(a.ratio).toBe(1.5);
    run(a, 60_000, () => 10);
    expect(a.ratio).toBe(1.5);
  });

  test('hysteresis: noisy frame times inside / straddling the band never change the ratio', () => {
    const a = new AdaptiveResolution(1.2);
    expect(run(a, 60_000, noise(1000 / C.upAboveFps + 0.1, 1000 / C.downBelowFps - 0.1))).toBe(0);
    expect(run(a, 60_000, noise(12, 21))).toBe(0); // p90 above the up threshold, mostly below
    expect(a.ratio).toBe(1.2);
  });

  test('failed up-probes back off: a borderline GPU does not flicker every few seconds', () => {
    const a = new AdaptiveResolution(1.5);
    const changes = run(a, 120_000, (r) => (r > 1 ? 30 : 15)); // fine at 1.0, too slow at 1.1
    expect(a.ratio).toBeGreaterThanOrEqual(1);
    expect(a.ratio).toBeLessThanOrEqual(1.1);
    expect(changes).toBeLessThan(5 + 2 * 6); // 5 initial steps + ≤ 6 probes, not ~20
  });

  test('requests a downgrade after downgradeHoldMs < downgradeFps at minRatio only', () => {
    const atMin = new AdaptiveResolution(C.minRatio);
    run(atMin, C.downgradeHoldMs * 0.9, () => 30);
    expect(atMin.downgradeRequested).toBe(false);
    run(atMin, C.downgradeHoldMs * 0.2, () => 30);
    expect(atMin.downgradeRequested).toBe(true);
    atMin.setMaxRatio(1);
    expect(atMin.downgradeRequested).toBe(false);

    const ok = new AdaptiveResolution(C.minRatio);
    run(ok, 30_000, () => 1000 / (C.downgradeFps + 2));
    expect(ok.downgradeRequested).toBe(false);

    const high = new AdaptiveResolution(1.5);
    run(high, C.downgradeHoldMs * 1.5, () => 30);
    expect(high.downgradeRequested).toBe(false);
  });

  test('lock holds the ceiling and never downgrades; unlock resumes', () => {
    const a = new AdaptiveResolution(1.5);
    run(a, 3_000, () => 30);
    a.setLocked(true);
    expect(a.ratio).toBe(1.5);
    expect(run(a, 30_000, () => 60)).toBe(0);
    expect(a.downgradeRequested).toBe(false);
    a.setLocked(false);
    run(a, 3_000, () => 30);
    expect(a.ratio).toBeLessThan(1.5);
  });

  test('ignores gaps (tab switch) and junk frame times', () => {
    const a = new AdaptiveResolution(1.5);
    for (const ms of [C.gapMs + 1, 0, -5, NaN, Infinity]) a.update(ms);
    run(a, C.downHoldMs * 0.9, () => 30);
    a.update(5_000);
    expect(a.ratio).toBe(1.5);
  });
});

test('applyPixelRatio only touches the renderer when the ratio changes', () => {
  let ratio = 1;
  const r = { getPixelRatio: () => ratio, setPixelRatio: vi.fn((v: number) => void (ratio = v)) };
  expect(applyPixelRatio(r, 1)).toBe(false);
  expect(applyPixelRatio(r, 0.9)).toBe(true);
  expect(applyPixelRatio(r, 0.9)).toBe(false);
  expect(r.setPixelRatio).toHaveBeenCalledTimes(1);
});

test('nextLowerPreset walks high → medium → low → null', () => {
  expect(nextLowerPreset('high')).toBe('medium');
  expect(nextLowerPreset('medium')).toBe('low');
  expect(nextLowerPreset('low')).toBeNull();
});

describe('quality choice persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('round-trips and validates the stored preset', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(loadQualityChoice()).toEqual({ preset: null, locked: false });
    saveQualityChoice({ preset: 'low', locked: true });
    expect(loadQualityChoice()).toEqual({ preset: 'low', locked: true });
    store.set(config.quality.storageKey, '{"preset":"ultra","locked":"yes"}');
    expect(loadQualityChoice()).toEqual({ preset: null, locked: false });
  });

  test('blocked storage falls back to automatic and save does not throw', () => {
    const boom = (): never => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(loadQualityChoice()).toEqual({ preset: null, locked: false });
    expect(() => saveQualityChoice({ preset: 'high', locked: true })).not.toThrow();
  });
});
