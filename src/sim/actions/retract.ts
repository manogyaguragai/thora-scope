// Grasp & retract (CONTEXT §6.4, §7.3): drag maps to retract_posterior / retract_fissure (clamped 0..1, optional
// spring-back) + a local grasp-and-pull vertex offset written into the shared material uniforms (capped, relaxes
// on release). No physics; allocation-free after construction.
import { Vector3 } from 'three';
import type { GraspUniforms } from '../../scene/materials';
import { TARGET_BY_ID } from '../../content/targets';
import { tweenTo, type AppState } from '../state';
import { config } from '../../core/config';

export type RetractKey = 'retract_posterior' | 'retract_fissure';
export type RetractCheck = 'ok' | 'no-target' | 'not-collapsed';

export const RETRACT_CONFIG = config.retract; // values in src/core/config.ts

const LOBES = ['deflate_RUL', 'deflate_RML', 'deflate_RLL'] as const;
const tmp = new Vector3();

export class Retract {
  /** Morph being driven, null when nothing is grasped. */
  key: RetractKey | null = null;
  /** Set from the scope camera each frame (world axes of screen right / up) so pulls follow the view. */
  readonly viewRight = new Vector3(1, 0, 0);
  readonly viewUp = new Vector3(0, 1, 0);
  private springKey: RetractKey | null = null;
  private rest = 0;

  constructor(
    private readonly state: AppState,
    private readonly uniforms: GraspUniforms,
    private readonly springBack = RETRACT_CONFIG.springBack,
  ) {
    uniforms.uGraspRadius.value = RETRACT_CONFIG.pull.radius;
  }

  /** Grasp a lobe at `point` (world). Starts a fresh pull there. */
  grasp(targetId: string, point: Vector3): RetractCheck {
    const t = TARGET_BY_ID.get(targetId);
    if (!t || (t.tools.grasper === undefined && t.tools.sponge === undefined)) return 'no-target';
    for (const k of LOBES) if (this.state[k] < RETRACT_CONFIG.minDeflate) return 'not-collapsed';
    this.key = RETRACT_CONFIG.morphFor[targetId] ?? 'retract_posterior';
    this.springKey = null;
    this.rest = this.state[this.key];
    this.uniforms.uGraspPoint.value.copy(point);
    this.uniforms.uGraspOffset.value.set(0, 0, 0);
    return 'ok';
  }

  /** Pointer drag (px) while grasped: morph along its axis + capped pull offset in view space. */
  drag(dx: number, dy: number): void {
    const key = this.key;
    if (key === null) return;
    const [ax, ay] = RETRACT_CONFIG.dragAxis[key];
    const v = Math.min(1, Math.max(0, this.state[key] + (dx * ax + dy * ay) * RETRACT_CONFIG.dragPerPx));
    if (v !== this.state[key]) tweenTo(this.state, key, v, 0);
    const P = RETRACT_CONFIG.pull;
    const off = this.uniforms.uGraspOffset.value;
    off.add(tmp.copy(this.viewRight).multiplyScalar(dx * P.perPx));
    off.add(tmp.copy(this.viewUp).multiplyScalar(-dy * P.perPx));
    off.clampLength(0, P.max);
  }

  /** Let go. `hold` (G: retraction held via its port) keeps the morph even with spring-back on. */
  release(hold = false): void {
    if (this.key !== null && this.springBack && !hold) this.springKey = this.key;
    this.key = null;
  }

  update(dtMs: number): void {
    if (this.key !== null) return;
    const dt = dtMs / 1000;
    const P = RETRACT_CONFIG.pull;
    const off = this.uniforms.uGraspOffset.value;
    if (off.x !== 0 || off.y !== 0 || off.z !== 0) {
      off.multiplyScalar(Math.exp(-P.relaxPerSec * dt));
      if (off.lengthSq() < P.epsilon * P.epsilon) off.set(0, 0, 0);
    }
    const k = this.springKey;
    if (k === null) return;
    const cur = this.state[k];
    const step = RETRACT_CONFIG.springPerSec * dt;
    const v = cur > this.rest ? Math.max(this.rest, cur - step) : Math.min(this.rest, cur + step);
    if (v !== cur) tweenTo(this.state, k, v, 0);
    if (v === this.rest) this.springKey = null;
  }
}
