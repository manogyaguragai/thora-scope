// Single app state (CONTEXT §7.3) + fixed-capacity tweens (one slot per tweenable key, reused forever).
import procedure from '../content/procedure_steps.json';
import { config } from '../core/config';

export const TWEEN_KEYS = [
  'deflate_RUL',
  'deflate_RML',
  'deflate_RLL',
  'retract_posterior',
  'retract_fissure',
] as const;
export type TweenKey = (typeof TWEEN_KEYS)[number];
export type Lobe = 'RUL' | 'RML' | 'RLL';

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
  active: boolean;
}

export interface AppState extends Record<TweenKey, number> {
  heartbeat: number; // 0 diastole → 1 systole
  breath: number; // 0 expiration → 1 inspiration
  heartbeatOn: boolean;
  breathingOn: boolean;
  hrBpm: number;
  rrPerMin: number;
  /** Active procedure step (1–7, 0 = none applied), its glTF camera and the scope's port (UI, M2/M3). */
  step: number;
  camera: string;
  port: string;
  /** Once divided, the RML stays collapsed: releaseClamp does not re-inflate it. */
  rmlDivided: boolean;
  /** Sim clock (ms) of the last tick; commands start tweens here. 0 = not started. */
  t: number;
  heartPhase: number; // 0..1
  breathPhase: number; // 0..1
  tweens: Record<TweenKey, Tween>;
}

const slot = (): Tween => ({ from: 0, to: 0, start: 0, dur: 0, active: false });

export function createState(): AppState {
  return {
    deflate_RUL: 0,
    deflate_RML: 0,
    deflate_RLL: 0,
    retract_posterior: 0,
    retract_fissure: 0,
    heartbeat: 0,
    breath: 0,
    heartbeatOn: true,
    breathingOn: true,
    hrBpm: procedure.heart_rate_bpm,
    rrPerMin: procedure.resp_rate_per_min,
    step: 0,
    camera: '',
    port: '',
    rmlDivided: false,
    t: 0,
    heartPhase: 0,
    breathPhase: 0,
    tweens: {
      deflate_RUL: slot(),
      deflate_RML: slot(),
      deflate_RLL: slot(),
      retract_posterior: slot(),
      retract_fissure: slot(),
    },
  };
}

/** Smoothstep ease-in-out on [0,1]. */
export const ease = (x: number): number => x * x * (3 - 2 * x);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Start (or retarget) the tween for `key`; ms ≤ 0 sets immediately. */
export function tweenTo(s: AppState, key: TweenKey, to: number, ms: number): void {
  const tw = s.tweens[key];
  if (ms <= 0) {
    tw.active = false;
    s[key] = to;
    return;
  }
  tw.from = s[key];
  tw.to = to;
  tw.start = s.t;
  tw.dur = ms;
  tw.active = true;
}

/** Per frame: advance the clock and active tweens. Allocation-free. */
export function updateTweens(s: AppState, now: number): void {
  s.t = now;
  for (let i = 0; i < TWEEN_KEYS.length; i++) {
    const key = TWEEN_KEYS[i] ?? 'deflate_RUL';
    const tw = s.tweens[key];
    if (!tw.active) continue;
    const p = (now - tw.start) / tw.dur;
    if (p >= 1) {
      s[key] = tw.to;
      tw.active = false;
    } else {
      s[key] = tw.from + (tw.to - tw.from) * ease(clamp01(p));
    }
  }
}

const P = config.physiology;

/** Physiology lab: one-lung ventilation, all right lobes collapse. */
export function startOLV(s: AppState): void {
  tweenTo(s, 'deflate_RUL', 1, P.olvMs);
  tweenTo(s, 'deflate_RML', 1, P.olvMs);
  tweenTo(s, 'deflate_RLL', 1, P.olvMs);
}

/** Clamp the RML bronchus and ventilate: RUL + RLL re-inflate, RML stays collapsed. */
export function clampRMLReinflate(s: AppState): void {
  tweenTo(s, 'deflate_RUL', 0, P.clampMs);
  tweenTo(s, 'deflate_RLL', 0, P.clampMs);
  tweenTo(s, 'deflate_RML', 1, P.clampMs);
}

/** Release the clamp: RML re-inflates unless its bronchus has been divided. */
export function releaseClamp(s: AppState): void {
  if (!s.rmlDivided) tweenTo(s, 'deflate_RML', 0, P.releaseMs);
}

/** Slider: set one lobe immediately (cancels its tween). */
export function setLobe(s: AppState, lobe: Lobe, v: number): void {
  tweenTo(s, `deflate_${lobe}`, clamp01(v), 0);
}
