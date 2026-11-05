// Encircle + staple-divide logic (CONTEXT §6.4). Pure: no scene objects; all state preallocated at construction.
// The scene side (division planes, staple-line caps, clips) lives in src/scene/staples.ts.
import { TARGET_BY_ID, type ToolId } from '../../content/targets';
import type { PointLike } from '../portOccupancy';
import { config } from '../../core/config';

export const STAPLE_CONFIG = config.staple; // values in src/core/config.ts

export type StapleCheck =
  'ok' | 'no-target' | 'not-stapleable' | 'wrong-cartridge' | 'not-encircled' | 'busy';
export type FirePhase = 'idle' | 'closing' | 'closed' | 'firing' | 'opening';

/** Tissue the target needs (first allowed cartridge), null if it can't be stapled. For the "wrong cartridge" toast. */
export function targetTissue(targetId: string): string | null {
  const c = TARGET_BY_ID.get(targetId)?.tools.stapler?.[0];
  return c === undefined ? null : (STAPLE_CONFIG.cartridgeTissue[c] ?? null);
}

/** Targets that must be encircled first: everything the blunt clamp can pass behind (vessels, bronchus). */
export function needsEncircle(targetId: string): boolean {
  return TARGET_BY_ID.get(targetId)?.tools.clamp !== undefined;
}

/** Which targets have a clamp tunnel / silicone leader passed behind them. */
export class Encircle {
  private readonly passed = new Set<string>();

  /** Clamp (or the stapler's silicone leader) passed behind the target. False if that tool can't encircle it. */
  pass(targetId: string, tool: ToolId, sub: string | null = null): boolean {
    const t = TARGET_BY_ID.get(targetId);
    if (!t) return false;
    const ok =
      (tool === 'clamp' && t.tools.clamp !== undefined) ||
      (tool === 'stapler' && sub === 'vascular-leader' && t.tools.stapler?.includes(sub) === true);
    if (ok) this.passed.add(targetId);
    return ok;
  }
  has(targetId: string): boolean {
    return this.passed.has(targetId);
  }
  reset(): void {
    this.passed.clear();
  }
}

/** Cartridge vs target tissue + encircle prerequisite. */
export function validateStaple(targetId: string, cartridge: string | null, encircle: Encircle): StapleCheck {
  const t = TARGET_BY_ID.get(targetId);
  if (!t) return 'no-target';
  const allowed = t.tools.stapler;
  if (!allowed) return 'not-stapleable';
  if (cartridge === null || !allowed.includes(cartridge)) return 'wrong-cartridge';
  if (needsEncircle(targetId) && !encircle.has(targetId)) return 'not-encircled';
  return 'ok';
}

export interface StapleResult {
  target: string;
  cartridge: string;
  /** Cut point (world, glTF coords). */
  readonly point: { x: number; y: number; z: number };
  /** Unit cut-plane normal pointing to the kept (proximal stump) side. */
  readonly normal: { x: number; y: number; z: number };
  /** Fallback: hide the divided meshes instead of clipping them (cap still placed). */
  hide: boolean;
}

/** Write the cut plane for `targetId` at `point` (default: the target's rest centroid). False if unknown target. */
export function cutPlane(targetId: string, out: StapleResult, point?: PointLike): boolean {
  const t = TARGET_BY_ID.get(targetId);
  if (!t) return false;
  const p = out.point;
  p.x = point ? point.x : t.point[0];
  p.y = point ? point.y : t.point[1];
  p.z = point ? point.z : t.point[2];
  const [rx, ry, rz] = STAPLE_CONFIG.proximalRef;
  const tx = rx - p.x;
  const ty = ry - p.y;
  const tz = rz - p.z;
  let [nx, ny, nz] = t.axis ?? [tx, ty, tz];
  if (nx * tx + ny * ty + nz * tz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  out.normal.x = nx / len;
  out.normal.y = ny / len;
  out.normal.z = nz / len;
  out.target = targetId;
  out.hide = STAPLE_CONFIG.mode === 'hide' || STAPLE_CONFIG.hideAndCap.includes(targetId);
  return true;
}

/** Stapler fire sequence. Drive with update(dtMs); `jaw` is the instrument opening (InstrumentSet.setJaw). */
export class StapleFire {
  phase: FirePhase = 'idle';
  /** 1 = open, 0 = closed. */
  jaw = 1;
  /** Valid after update() returned true (the division frame); reused, never reallocated. */
  readonly result: StapleResult = {
    target: '',
    cartridge: '',
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    hide: false,
  };
  private t = 0;
  private armed = false;

  /** Close the jaws across the target (no fire yet — e.g. bronchus test). */
  close(targetId: string, cartridge: string | null, encircle: Encircle, point?: PointLike): StapleCheck {
    if (this.phase !== 'idle') return 'busy';
    const check = validateStaple(targetId, cartridge, encircle);
    if (check !== 'ok') return check;
    cutPlane(targetId, this.result, point);
    this.result.cartridge = cartridge as string;
    this.phase = 'closing';
    this.t = 0;
    this.armed = false;
    return 'ok';
  }

  /** Fire: immediately when closed, or as soon as closing finishes. False if the jaws aren't on a target. */
  fire(): boolean {
    if (this.phase === 'closing') this.armed = true;
    else if (this.phase === 'closed') this.enter('firing');
    else return false;
    return true;
  }

  /** Open without firing (abort / reposition). */
  release(): void {
    if (this.phase === 'closing' || this.phase === 'closed') this.enter('opening');
  }

  /** Advance; returns true exactly once per fire, on the frame the target is divided. */
  update(dtMs: number): boolean {
    const C = STAPLE_CONFIG;
    this.t += dtMs;
    let divided = false;
    switch (this.phase) {
      case 'closing':
        this.jaw = Math.max(0, 1 - this.t / C.closeMs);
        if (this.t >= C.closeMs) this.enter(this.armed ? 'firing' : 'closed');
        break;
      case 'firing':
        if (this.t >= C.fireMs) {
          this.enter('opening');
          divided = true;
        }
        break;
      case 'opening':
        this.jaw = Math.min(1, this.t / C.openMs);
        if (this.t >= C.openMs) this.enter('idle');
        break;
      default:
        break;
    }
    return divided;
  }

  private enter(p: FirePhase): void {
    this.phase = p;
    this.t = 0;
    this.armed = false;
    // Release mid-close opens from closed (ponytail: tiny jaw snap, fine at 400 ms).
    this.jaw = p === 'idle' ? 1 : 0;
  }
}
