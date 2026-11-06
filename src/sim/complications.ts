// Complications (CONTEXT §6.4 "Complications"). Pure controller: fed action events + per-frame input, it
// classifies injurious hits, runs bleeding episodes (pooled blood, view reddening, vitals warning) and keeps a
// timed log for the debrief. No scene access: effect requests are returned for the wiring (T505).
// Clinical thresholds/rates are placeholders, pending clinician review.
import { config } from '../core/config';
import { ANATOMY } from '../content/anatomy';
import { TARGET_BY_ID, dangerLevel } from '../content/targets';
import { cauteryConfig } from '../scene/cautery.config';
import type { PointLike } from './portOccupancy';
import type { ActionKind, PracticeTool } from './practiceActions';

export const COMPLICATIONS_CONFIG = config.complications; // values in src/core/config.ts

export type Severity = 'major' | 'minor';

/** Same shape as PracticeAttempt minus port. */
export interface ComplicationAction {
  readonly tool: PracticeTool;
  readonly subOption: string | null;
  readonly target: string | null;
  readonly kind: ActionKind;
  /** Hit point on the structure (glTF coords); falls back to the target centroid, else null. */
  readonly point?: PointLike;
}

/** Per-frame input; the caller reuses one object. Proximity to the bleed is the caller's call. */
export interface ComplicationInput {
  /** Sucker (suction sub-option) active. */
  suction: boolean;
  /** Sponge-stick held pressing on the bleed. */
  pressure: boolean;
  /** Current max of the retract_* keys. */
  retract: number;
  /** T822: energised cautery touching tissue here (null = not); seals a minor bleed within coag.radiusM. */
  coagAt?: PointLike | null;
}

/** `t` = injected clock (seconds). */
export type ComplicationEvent =
  /** Stapler/cautery on a CONTEXT §6.4 danger structure (manifest `danger` severity). */
  | {
      readonly type: 'danger-hit';
      readonly t: number;
      readonly target: string;
      readonly tool: PracticeTool;
      readonly severity: Severity;
    }
  | {
      readonly type: 'bleed';
      readonly t: number;
      readonly target: string;
      readonly severity: Severity;
      readonly cause: BleedCause;
    }
  | { readonly type: 'bleed-controlled'; t: number; target: string; severity: Severity }
  /** Injurious hit on a non-vascular structure. */
  | { readonly type: 'injury'; readonly t: number; readonly target: string; readonly tool: PracticeTool };

export type ComplicationRequest =
  /** Spawn a blood decal; pass the BloodPool slot back via bindSlot(bleed, slot). */
  | {
      readonly type: 'blood';
      readonly bleed: number;
      readonly point: PointLike | null;
      readonly severity: Severity;
    }
  /** Toast text key (src/content). */
  | { readonly type: 'toast'; readonly key: ToastKey };

export type ToastKey =
  | 'complication.danger'
  | 'complication.dangerMinor'
  | 'complication.bleed'
  | 'complication.tear'
  | 'complication.injury'
  | 'complication.coagulated'
  | 'complication.coagMajor';
export type VitalsKey = 'vitals.bleed.major' | 'vitals.bleed.minor';

interface Bleed {
  active: boolean;
  severity: Severity;
  held: number;
  /** T822: seconds of cautery contact (minor only). */
  coag: number;
  /** Bleed point (glTF coords); has = false when the episode had none. */
  at: { x: number; y: number; z: number; has: boolean };
  slot: number;
  /** Pre-built so control logs without allocating in update(). */
  done: { type: 'bleed-controlled'; t: number; target: string; severity: Severity };
}

/** T844 'node-bed': the expected ooze after lymph node removal (step 4), sealed with the cautery; not scored. */
export type BleedCause = 'injury' | 'over-traction' | 'node-bed';

/** Manifest blood-carrying tissue classes; scene vessels outside the manifest by name (aorta, cavae, brachiocephalic). */
const VASCULAR_TISSUE = new Set(['artery', 'vein', 'svc']);
const VASCULAR = /artery|vein|vena|aorta|brachio/;

export const isVascular = (id: string): boolean => {
  const e = ANATOMY.structures[id];
  return e ? VASCULAR_TISSUE.has(e.tissue) : VASCULAR.test(id);
};
/** Divided arteries (manifest artery with a divideStep): pulling while one is encircled tears it. */
const isDividedArtery = (id: string): boolean =>
  ANATOMY.structures[id]?.tissue === 'artery' && ANATOMY.structures[id]?.divideStep !== undefined;

/** Stapler fire or cautery on a structure that doesn't list that tool (TARGETS). */
function injurious(a: ComplicationAction): boolean {
  if (a.target === null) return false;
  if (a.tool !== 'cautery' && !(a.tool === 'stapler' && a.kind === 'fire')) return false;
  return TARGET_BY_ID.get(a.target)?.tools[a.tool] === undefined;
}

export class ComplicationController {
  /** Pooled blood 0..1. */
  pool = 0;
  /** Post-FX view-reddening uniform 0..1. */
  redden = 0;
  /** Summed pool growth per second of active bleeds. */
  oozeRate = 0;
  vitalsKey: VitalsKey | null = null;
  /** T822: episodes sealed by the cautery so far (the wiring toasts on change). */
  coagulated = 0;
  /** T822: this update the energised cautery touched a major bleed (it can't seal it). */
  coagRefused = false;
  readonly log: ComplicationEvent[] = [];
  private readonly bleeds: Bleed[] = [];
  private head = 0;
  /** Encircled artery target (over-traction watch), torn = already bled this passage. */
  private passage: { target: string; point: PointLike | null } | null = null;
  private torn = false;

  constructor(
    private readonly clock: () => number,
    /** Called once when an episode is controlled, with the slot from bindSlot (-1 if never bound). */
    private readonly onStop: (slot: number) => void = () => {},
  ) {
    for (let i = 0; i < COMPLICATIONS_CONFIG.maxBleeds; i++) {
      this.bleeds.push({
        active: false,
        severity: 'minor',
        held: 0,
        coag: 0,
        at: { x: 0, y: 0, z: 0, has: false },
        slot: -1,
        done: { type: 'bleed-controlled', t: 0, target: '', severity: 'minor' },
      });
    }
  }

  get activeBleeds(): number {
    let n = 0;
    for (const b of this.bleeds) if (b.active) n++;
    return n;
  }

  /** T822: an active bleed lies within coag.radiusM of `p` (cautery placement there is coagulation, not a strike). */
  bleedNear(p: PointLike): boolean {
    for (const b of this.bleeds) if (b.active && near(b, p)) return true;
    return false;
  }

  bindSlot(bleed: number, slot: number): void {
    const b = this.bleeds[bleed];
    if (b) b.slot = slot;
  }

  /** Feed every trainee action (accepted or not). Returns effect requests for the wiring. */
  onAction(a: ComplicationAction): ComplicationRequest[] {
    const out: ComplicationRequest[] = [];
    const point = a.point ?? (a.target ? pointOf(a.target) : null);
    if (a.kind === 'encircle' && a.target && isDividedArtery(a.target)) {
      if (this.passage?.target !== a.target) this.torn = false;
      this.passage = { target: a.target, point };
    } else {
      this.passage = null;
    }
    if (!injurious(a) || a.target === null) return out;
    const t = this.clock();
    const target = a.target;
    const danger = dangerLevel(target);
    if (danger) {
      this.push({ type: 'danger-hit', t, target, tool: a.tool, severity: danger });
      out.push({
        type: 'toast',
        key: danger === 'major' ? 'complication.danger' : 'complication.dangerMinor',
      });
    }
    if (isVascular(target)) {
      out.push(this.startBleed(target, point, 'major', 'injury', t));
      if (!danger) out.push({ type: 'toast', key: 'complication.bleed' });
    } else if (!danger) {
      this.push({ type: 'injury', t, target, tool: a.tool });
      out.push({ type: 'toast', key: 'complication.injury' });
    }
    return out;
  }

  /** T844: small expected ooze from a node bed at `point` (the wiring calls it once the node is out). */
  startOoze(target: string, point: PointLike | null): ComplicationRequest {
    return this.startBleed(target, point, 'minor', 'node-bed', this.clock());
  }

  /**
   * Per frame. Allocation-free except the rare over-traction tear (an event, once per passage).
   * Returns requests only on that tear, else null.
   */
  update(dt: number, input: ComplicationInput): ComplicationRequest[] | null {
    const C = COMPLICATIONS_CONFIG;
    let torn: ComplicationRequest[] | null = null;
    if (this.passage && !this.torn && input.retract > C.overTractionRetract) {
      this.torn = true;
      const req = this.startBleed(
        this.passage.target,
        this.passage.point,
        'minor',
        'over-traction',
        this.clock(),
      );
      torn = [req, { type: 'toast', key: 'complication.tear' }];
    }
    let rate = 0;
    let major = false;
    let minor = false;
    const press = input.pressure && this.pool <= C.pressureMaxPool;
    const coagAt = input.coagAt ?? null;
    const K = cauteryConfig.coag;
    this.coagRefused = false;
    for (const b of this.bleeds) {
      if (!b.active) continue;
      b.held = press ? b.held + dt : 0;
      const touched = coagAt !== null && near(b, coagAt);
      if (touched && b.severity === 'major') this.coagRefused = true;
      b.coag = touched && b.severity === 'minor' ? b.coag + dt : 0;
      const sealed = b.coag >= K.sec;
      if (sealed) this.coagulated++;
      if (sealed || b.held >= C.pressureSec[b.severity]) {
        b.active = false;
        b.done.t = this.clock();
        this.push(b.done);
        this.onStop(b.slot);
        continue;
      }
      rate += C.oozeRate[b.severity] * (1 - b.coag / K.sec); // cautery contact slows a minor ooze
      if (b.severity === 'major') major = true;
      else minor = true;
    }
    this.oozeRate = rate;
    this.pool += rate * dt - (input.suction ? C.suctionRate * dt : 0);
    this.pool = Math.min(1, Math.max(0, this.pool));
    this.redden = Math.min(1, this.pool * C.reddenGain);
    this.vitalsKey = major ? 'vitals.bleed.major' : minor ? 'vitals.bleed.minor' : null;
    return torn;
  }

  private startBleed(
    target: string,
    point: PointLike | null,
    severity: Severity,
    cause: BleedCause,
    t: number,
  ): ComplicationRequest {
    const i = this.head;
    this.head = (i + 1) % this.bleeds.length;
    const b = this.bleeds[i] as Bleed;
    if (b.active) this.onStop(b.slot); // pool full: oldest episode's decal stops oozing
    b.active = true;
    b.severity = severity;
    b.held = 0;
    b.coag = 0;
    b.at.has = point !== null;
    if (point) Object.assign(b.at, { x: point.x, y: point.y, z: point.z });
    b.slot = -1;
    b.done = { type: 'bleed-controlled', t: 0, target, severity };
    this.push({ type: 'bleed', t, target, severity, cause });
    return { type: 'blood', bleed: i, point, severity };
  }

  private push(e: ComplicationEvent): void {
    this.log.push(e);
    if (this.log.length > COMPLICATIONS_CONFIG.maxLogEvents) this.log.shift();
  }
}

function near(b: Bleed, p: PointLike): boolean {
  const r = cauteryConfig.coag.radiusM;
  return b.at.has && (b.at.x - p.x) ** 2 + (b.at.y - p.y) ** 2 + (b.at.z - p.z) ** 2 <= r * r;
}

function pointOf(id: string): PointLike | null {
  const p = TARGET_BY_ID.get(id)?.point;
  return p ? { x: p[0], y: p[1], z: p[2] } : null;
}
