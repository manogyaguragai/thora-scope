// T850 tissue-aware instrument tip (docs/FEEDBACK_v8_LIVE.md 3): one ray along the shaft from the port fulcrum,
// by tissue type (manifest-driven): hard structures stop the tip short of their surface, a lung lobe yields (the
// tip presses it, an indent eased back on release), manifest-dissectable layers are passed. Pure logic; the ray is
// injected (wireM4: picker.ray, BVH). check() runs at ≤ follow.hz, ease() per frame; neither allocates.
import { MathUtils, Vector3 } from 'three';
import { ANATOMY } from '../content/anatomy';
import { interactionConfig } from './interaction.config';

export type Contact = 'hard' | 'lung' | 'pass';

/** What the tip may do at a surface of node `name`. */
export const contactOf = (name: string): Contact => {
  const s = ANATOMY.structures[name];
  return s?.group === 'lungs' ? 'lung' : s?.dissectable ? 'pass' : 'hard';
};

export interface RayHit {
  readonly nodeName: string;
  readonly distance: number;
  readonly point: Vector3;
}
/** First surface along unit `dir` from `origin` in [near, far] m (picker.ray). */
export type RayFn = (origin: Vector3, dir: Vector3, near: number, far: number) => RayHit | null;

export class TipCollision {
  /** Max tip depth along the shaft (Infinity = free). */
  limit = Infinity;
  /** Lung surface distance along the shaft (Infinity = no lung ahead). */
  surface = Infinity;
  /** Shown indent depth (m): rises with the press at once, eases back. */
  push = 0;
  /** Lung surface point the indent centres on (kept while it springs back). */
  readonly point = new Vector3();
  /** Unit shaft direction it is pressed along. */
  readonly dir = new Vector3(0, 0, 1);

  constructor(
    private readonly ray: RayFn,
    private readonly cfg = interactionConfig.collide,
  ) {}

  /** Shaft from `origin` (pleura point) along unit `dir`, the tip wanting to be `depth` m along it. */
  check(origin: Vector3, dir: Vector3, depth: number): void {
    const c = this.cfg;
    const far = depth + c.marginM + c.push.capM;
    let near = c.skipM;
    this.clear();
    for (let i = 0; i <= c.passMax && near < far; i++) {
      const h = this.ray(origin, dir, near, far);
      if (!h) return;
      const k = contactOf(h.nodeName);
      if (k === 'pass') {
        near = h.distance + c.passStepM;
        continue;
      }
      if (k === 'lung') {
        this.surface = h.distance;
        this.limit = h.distance + c.push.capM;
        if (depth > h.distance) {
          this.point.copy(h.point);
          this.dir.copy(dir);
        }
      } else this.limit = Math.max(c.skipM, h.distance - c.marginM);
      return;
    }
  }

  /** No surface ahead (tool out / gripping / jaws engaged): the indent springs back. */
  clear(): void {
    this.limit = Infinity;
    this.surface = Infinity;
  }

  /** How far a tip at `depth` presses past the lung surface (0 … capM). */
  press(depth: number): number {
    return this.surface === Infinity ? 0 : MathUtils.clamp(depth - this.surface, 0, this.cfg.push.capM);
  }

  /** Per frame: the indent follows a deeper press at once and eases back otherwise. True if `push` changed. */
  ease(dtMs: number, depth: number): boolean {
    const p = this.cfg.push;
    const to = this.press(depth);
    const next = to >= this.push ? to : to + (this.push - to) * Math.exp((-p.perS * dtMs) / 1000);
    const v = next < p.epsM ? 0 : next;
    if (v === this.push) return false;
    this.push = v;
    return true;
  }
}
