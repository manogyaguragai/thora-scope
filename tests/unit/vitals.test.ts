import { describe, expect, it } from 'vitest';
import { tickSim } from '../../src/sim/physiology';
import { createState } from '../../src/sim/state';
import { vitalsConfig as V } from '../../src/ui/vitals.config';
import {
  beepHz,
  detectBeat,
  diathermyNoise,
  ecgTrace,
  ecgWave,
  plethWave,
  spo2For,
} from '../../src/ui/vitalsMonitor';

/** Run tickSim at 60 fps for `ms`, counting beats; `onFrame` may change the state mid-run. */
function countBeats(ms: number, onFrame?: (s: ReturnType<typeof createState>, t: number) => void): number {
  const s = createState();
  const det = { last: s.heartPhase };
  let beats = 0;
  for (let t = 1; t <= ms; t += 1000 / 60) {
    onFrame?.(s, t);
    tickSim(s, t);
    if (detectBeat(det, s)) beats++;
  }
  return beats;
}

describe('vitals mapping', () => {
  it('SpO2: base on two-lung ventilation, OLV value at full right-lobe collapse, lerped by the max lobe', () => {
    const s = createState();
    expect(spo2For(s)).toBe(V.spo2.basePct);
    s.deflate_RML = 1;
    expect(spo2For(s)).toBe(V.spo2.olvPct);
    s.deflate_RML = 0.5;
    s.deflate_RUL = 0.1;
    expect(spo2For(s)).toBe(Math.round((V.spo2.basePct + V.spo2.olvPct) / 2));
  });

  it('beep pitch rises with SpO2, ~hzPerPct per %', () => {
    expect(beepHz(100)).toBe(V.beep.hzAt100);
    expect(beepHz(99) - beepHz(98)).toBe(V.beep.hzPerPct);
    expect(beepHz(V.spo2.basePct)).toBeGreaterThan(beepHz(V.spo2.olvPct));
    expect(beepHz(0)).toBe(V.beep.minHz);
  });

  it('waveforms: R peak at phase 0, flat-ish diastole, pleth starts at 0', () => {
    expect(ecgWave(0)).toBeCloseTo(1, 1);
    expect(Math.abs(ecgWave(0.6))).toBeLessThan(0.05);
    expect(plethWave(V.wave.plethDelay)).toBeCloseTo(0, 5);
    expect(plethWave(V.wave.plethDelay + V.wave.plethRise)).toBeCloseTo(1, 5);
  });
});

describe('beat detection (heartPhase wrap)', () => {
  it('one beat per cycle at the state HR', () => {
    const s = createState();
    expect(countBeats(60_000)).toBeCloseTo(s.hrBpm, -1); // ±5
  });

  it('follows an HR change mid-run', () => {
    const before = countBeats(30_000);
    const beats = countBeats(60_000, (s, t) => {
      if (t > 30_000) s.hrBpm = 120;
    });
    expect(beats - before).toBeGreaterThanOrEqual(58);
    expect(beats - before).toBeLessThanOrEqual(61);
  });

  it('no beats while the heartbeat is off', () => {
    expect(countBeats(10_000, (s) => (s.heartbeatOn = false))).toBe(0);
  });
});

describe('diathermy interference (T817)', () => {
  it('cautery flag adds bounded high-frequency noise to the ECG trace; off = clean PQRST', () => {
    const I = V.interference;
    let dev = 0;
    for (let k = 0; k < 200; k++) {
      const ph = k / 200;
      expect(ecgTrace(ph, true, false, k)).toBe(ecgWave(ph));
      const d = ecgTrace(ph, true, true, k) - ecgWave(ph);
      expect(Math.abs(d)).toBeLessThanOrEqual(I.amp + I.ripple);
      dev += d * d;
    }
    expect(Math.sqrt(dev / 200)).toBeGreaterThan(0.1); // visibly noisy
    expect(ecgTrace(0.6, false, false, 3)).toBe(0); // no beat, no cautery: flat
    expect(ecgTrace(0.6, false, true, 3)).toBe(diathermyNoise(3));
  });
});
