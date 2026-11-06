// Grasp & retract (CONTEXT §6.4, §7.3; T840 any direction). Each grasp owns a slot: its drag (screen px) is projected
// on the screen image of every manifest retract key's world direction for the grasped lobe, so any drag direction
// blends retract_hilum / retract_RML_lateral / retract_fissure. Slots add up (two graspers combine, e.g. RUL up + RLL
// down) on top of the key values when the first grasp engaged, clamped 0..1. A held slot keeps its pose; a let-go
// slot eases back over retractionConfig.releaseMs. A local grasp-and-pull vertex offset (shared material uniforms,
// capped) follows the dragged grasp. No physics; allocation-free after construction.
import { Vector3 } from 'three';
import type { GraspUniforms } from '../../scene/materials';
import { ANATOMY } from '../../content/anatomy';
import { TARGET_BY_ID, lobeOf } from '../../content/targets';
import { tweenTo, type AppState } from '../state';
import { config } from '../../core/config';
import { retractionConfig, type RetractKey } from '../retraction.config';

export type { RetractKey };
export type RetractCheck = 'ok' | 'no-target' | 'not-collapsed';

export const RETRACT_CONFIG = config.retract; // values in src/core/config.ts
const G = retractionConfig.grasp;
/** The blend's channels: the manifest's retract_* morph keys. */
export const RETRACT_KEYS = ANATOMY.morphs.filter((m) => m.startsWith('retract_')) as readonly RetractKey[];
const NK = RETRACT_KEYS.length;

const LOBES = ['deflate_RUL', 'deflate_RML', 'deflate_RLL'] as const;
const tmp = new Vector3();

interface Slot {
  used: boolean;
  letGo: boolean;
  lobe: string;
  /** Contribution per key (RETRACT_KEYS order), −1..1. */
  readonly c: Float64Array;
}

export class Retract {
  /** Strongest key of the grasp being dragged, null when nothing is dragged. */
  key: RetractKey | null = null;
  /** Slot of the grasp being dragged (−1 = none). */
  active = -1;
  /** Set from the scope camera each frame (world axes of screen right / up) so pulls follow the view. */
  readonly viewRight = new Vector3(1, 0, 0);
  readonly viewUp = new Vector3(0, 1, 0);
  private readonly slots: Slot[];
  /** Key values when the first slot engaged; the blend adds onto them. */
  private readonly base = new Float64Array(NK);
  private readonly out = new Float64Array(NK);
  private engaged = false;
  /** Per lobe: world direction per key, scaled so the lobe's strongest key has length 1. */
  private readonly dirs = new Map<string, Vector3[]>();

  constructor(
    private readonly state: AppState,
    private readonly uniforms: GraspUniforms,
    private readonly springBack = RETRACT_CONFIG.springBack,
    capacity = retractionConfig.slots,
  ) {
    uniforms.uGraspRadius.value = RETRACT_CONFIG.pull.radius;
    this.slots = Array.from({ length: capacity }, () => ({
      used: false,
      letGo: false,
      lobe: '',
      c: new Float64Array(NK),
    }));
    for (const [lobe, d] of Object.entries(G.fallbackDirs))
      this.setDirs(
        lobe,
        RETRACT_KEYS.map((k) => tmp.fromArray(d[k] ?? [0, 0, 0]).clone()),
      );
  }

  /** Load time: world direction each key moves `lobe` (RETRACT_KEYS order, e.g. mean morph deltas). */
  setDirs(lobe: string, dirs: readonly Vector3[]): void {
    let max = 0;
    for (const d of dirs) max = Math.max(max, d.length());
    if (max === 0) return;
    this.dirs.set(
      lobe,
      RETRACT_KEYS.map((_, i) => (dirs[i] ?? tmp.set(0, 0, 0)).clone().divideScalar(max)),
    );
  }

  /** Grasp a lobe at `point` (world): a fresh slot (being dragged) and a fresh pull there. */
  grasp(targetId: string, point: Vector3): RetractCheck {
    const t = TARGET_BY_ID.get(targetId);
    if (!t || (t.tools.grasper === undefined && t.tools.sponge === undefined)) return 'no-target';
    for (const k of LOBES) if (this.state[k] < RETRACT_CONFIG.minDeflate) return 'not-collapsed';
    const i = this.free();
    if (i < 0) return 'no-target';
    const s = this.slots[i] as Slot;
    if (!this.engaged) {
      for (let k = 0; k < NK; k++) this.base[k] = this.out[k] = this.state[RETRACT_KEYS[k] as RetractKey];
      this.engaged = true;
    }
    s.used = true;
    s.letGo = false;
    s.lobe = lobeOf(targetId) ?? '';
    s.c.fill(0);
    this.active = i;
    const d = this.dirs.get(s.lobe);
    let best = -1;
    this.key = null;
    for (let k = 0; k < NK; k++) {
      const len = d?.[k]?.lengthSq() ?? 0;
      if (len > best) {
        best = len;
        this.key = RETRACT_KEYS[k] ?? null;
      }
    }
    this.uniforms.uGraspPoint.value.copy(point);
    this.uniforms.uGraspOffset.value.set(0, 0, 0);
    return 'ok';
  }

  /** Pointer drag (px, +y down) while grasped: blended keys + capped pull offset in view space. */
  drag(dx: number, dy: number): void {
    const s = this.slots[this.active];
    if (!s) return;
    const P = RETRACT_CONFIG.pull;
    const off = this.uniforms.uGraspOffset.value;
    off.add(tmp.copy(this.viewRight).multiplyScalar(dx * P.perPx));
    off.add(tmp.copy(this.viewUp).multiplyScalar(-dy * P.perPx));
    off.clampLength(0, P.max);
    const d = this.dirs.get(s.lobe);
    if (!d) return;
    for (let k = 0; k < NK; k++) {
      const w = d[k] as Vector3;
      const sx = w.dot(this.viewRight);
      const sy = -w.dot(this.viewUp);
      const sl = Math.hypot(sx, sy);
      if (sl < G.minScreen * w.length() || sl === 0) continue;
      // Full rate along the key's screen image, scaled by how much the key moves this lobe.
      const v = (s.c[k] as number) + ((dx * sx + dy * sy) / sl) * w.length() * RETRACT_CONFIG.dragPerPx;
      s.c[k] = Math.min(1, Math.max(-1, v));
    }
    this.apply();
  }

  /** Stop dragging. Returns the slot that stays engaged (the grip is kept), −1 if it was let go (spring-back on and
   *  not `hold`) or nothing was dragged. */
  release(hold = false): number {
    const i = this.active;
    this.active = -1;
    this.key = null;
    if (i < 0) return -1;
    if (this.springBack && !hold) {
      this.letGo(i);
      return -1;
    }
    return i;
  }

  /** The grasp in slot `i` lets go: its contribution eases back. */
  letGo(i: number): void {
    const s = this.slots[i];
    if (s?.used) s.letGo = true;
    if (i === this.active) {
      this.active = -1;
      this.key = null;
    }
  }

  letGoAll(): void {
    for (let i = 0; i < this.slots.length; i++) this.letGo(i);
  }

  /** Drop every grasp at once without writing the keys (a mode / step that sets its own pose). */
  reset(): void {
    for (const s of this.slots) s.used = s.letGo = false;
    this.engaged = false;
    this.active = -1;
    this.key = null;
  }

  /** Slot `i` is engaged (held or easing back). */
  engagedSlot(i: number): boolean {
    return this.slots[i]?.used === true;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    const P = RETRACT_CONFIG.pull;
    const off = this.uniforms.uGraspOffset.value;
    if (this.active < 0 && (off.x !== 0 || off.y !== 0 || off.z !== 0)) {
      off.multiplyScalar(Math.exp(-P.relaxPerSec * dt));
      if (off.lengthSq() < P.epsilon * P.epsilon) off.set(0, 0, 0);
    }
    if (!this.engaged) return;
    const step = dtMs / retractionConfig.releaseMs;
    let changed = false;
    let any = false;
    for (const s of this.slots) {
      if (!s.used) continue;
      if (s.letGo) {
        let left = false;
        for (let k = 0; k < NK; k++) {
          const c = s.c[k] as number;
          if (c === 0) continue;
          s.c[k] = c > 0 ? Math.max(0, c - step) : Math.min(0, c + step);
          changed = true;
          if (s.c[k] !== 0) left = true;
        }
        if (!left) s.used = s.letGo = false;
      }
      if (s.used) any = true;
    }
    if (changed) this.apply();
    if (!any) this.engaged = false;
  }

  /** Blend → state, written only for keys whose value changed. */
  private apply(): void {
    for (let k = 0; k < NK; k++) {
      let v = this.base[k] as number;
      for (const s of this.slots) if (s.used) v += s.c[k] as number;
      v = Math.min(1, Math.max(0, v));
      if (v === this.out[k]) continue;
      this.out[k] = v;
      tweenTo(this.state, RETRACT_KEYS[k] as RetractKey, v, 0);
    }
  }

  private free(): number {
    let lru = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      if (!s.used) return i;
      if (s.letGo && lru < 0) lru = i;
    }
    return lru; // all taken: recycle one that is easing back
  }
}
