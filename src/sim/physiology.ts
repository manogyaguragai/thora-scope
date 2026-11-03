// Heartbeat + breathing clock (CONTEXT §7.3). Phases advance by dt so rate changes never jump.
import { config } from '../core/config';
import { ease, updateTweens } from './state';
import type { AppState } from './state';

const P = config.physiology;
const SYSTOLE_FRACTION = P.systoleMsAtRef / (60000 / P.refHrBpm);

/** 0 in diastole; half-sine 0→1→0 over systole (fixed share of the cycle, so duration scales with HR). */
export function heartbeatWave(phase: number): number {
  return phase < SYSTOLE_FRACTION ? Math.sin((Math.PI * phase) / SYSTOLE_FRACTION) : 0;
}

/** 0→1 eased over inspiration (inspFraction of the cycle), 1→0 over expiration. */
export function breathWave(phase: number): number {
  const f = P.inspFraction;
  return phase < f ? ease(phase / f) : 1 - ease((phase - f) / (1 - f));
}

/**
 * Ventilated right lobe "breathes" via its collapse morph: +amp at end-expiration, 0 at end-inspiration.
 * Fades linearly to 0 as deflate → rightLobeBreathMaxDeflate; collapsed lobes don't breathe.
 */
export function breathOffset(s: AppState, deflate: number): number {
  if (!s.breathingOn) return 0;
  const w = 1 - deflate / P.rightLobeBreathMaxDeflate;
  return w > 0 ? P.rightLobeBreathAmp * w * (1 - s.breath) : 0;
}

/** Per frame: tweens, then heartbeat/breath. Allocation-free. */
export function tickSim(s: AppState, now: number): void {
  const dt = s.t > 0 ? now - s.t : 0;
  updateTweens(s, now);
  s.heartPhase = (s.heartPhase + (dt * s.hrBpm) / 60000) % 1;
  s.breathPhase = (s.breathPhase + (dt * s.rrPerMin) / 60000) % 1;
  s.heartbeat = s.heartbeatOn ? heartbeatWave(s.heartPhase) : 0;
  s.breath = s.breathingOn ? breathWave(s.breathPhase) : 0;
}
