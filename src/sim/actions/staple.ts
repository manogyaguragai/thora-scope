// Encircle + staple-divide logic (CONTEXT §6.4). Pure: no scene objects; all state preallocated at construction.
// The scene side (division planes, staple-line caps, clips) lives in src/scene/staples.ts.
// T841: the fire runs close → compression pause → staples form heel → tip → knife; jaws stop on the compressed
// structure (closedJaw); jawPose() orients stapler / clamp / clip jaws across a structure's local axis.
import { Matrix4, Vector3 } from 'three';
import type { Quaternion } from 'three';
import { TARGET_BY_ID, type ToolId } from '../../content/targets';
import type { PointLike } from '../portOccupancy';
import { config } from '../../core/config';
import { instrumentAnim, instrumentGeom } from '../../scene/instruments.config';

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
      ((tool === 'clamp' || tool === 'peanut') && t.tools.clamp !== undefined) || // T844: peanut passage
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
  /** T841: jaw value the closing stops at (the compressed structure between the jaws); set before close(). */
  closedJaw = 0;
  private t = 0;
  private armed = false;

  /** T841: firing sub-progress, 0 … 1 each: compression pause, staples formed (heel → tip), knife travel. */
  get compress(): number {
    return this.sub(0, FIRE.compress);
  }
  get form(): number {
    return this.sub(FIRE.compress, FIRE.compress + FIRE.form);
  }
  get knife(): number {
    return this.sub(FIRE.compress + FIRE.form, 1);
  }
  private sub(a: number, b: number): number {
    if (this.phase === 'opening' || this.phase === 'idle') return this.phase === 'opening' ? 1 : 0;
    if (this.phase !== 'firing') return 0;
    return Math.min(1, Math.max(0, (this.t / STAPLE_CONFIG.fireMs - a) / (b - a)));
  }

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
        this.jaw = Math.max(this.closedJaw, 1 - ((1 - this.closedJaw) * this.t) / C.closeMs);
        if (this.t >= C.closeMs) this.enter(this.armed ? 'firing' : 'closed');
        break;
      case 'firing':
        if (this.t >= C.fireMs) {
          this.enter('opening');
          divided = true;
        }
        break;
      case 'opening':
        this.jaw = Math.min(1, this.closedJaw + ((1 - this.closedJaw) * this.t) / C.openMs);
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
    this.jaw = p === 'idle' ? 1 : this.closedJaw;
  }
}

const FIRE = instrumentAnim.staplerFire;
const ENG = instrumentAnim.engage;

/** T841 clip applier: close on the structure (the clip is crimped and left there), then open. */
export class ClipFire {
  phase: 'idle' | 'closing' | 'opening' = 'idle';
  jaw = 1;
  closedJaw = 0;
  private t = 0;
  start(): boolean {
    if (this.phase !== 'idle') return false;
    this.phase = 'closing';
    this.t = 0;
    return true;
  }
  /** Advance; true exactly once, on the frame the clip is crimped (jaws closed). */
  update(dtMs: number): boolean {
    const C = STAPLE_CONFIG;
    if (this.phase === 'idle') return false;
    this.t += dtMs;
    const k = this.phase === 'closing' ? 1 - this.t / C.closeMs : this.t / C.openMs;
    this.jaw = Math.min(1, Math.max(this.closedJaw, this.closedJaw + (1 - this.closedJaw) * k));
    if (this.phase === 'closing' && this.t >= C.closeMs) {
      this.phase = 'opening';
      this.t = 0;
      return true;
    }
    if (this.phase === 'opening' && this.t >= C.openMs) {
      this.phase = 'idle';
      this.jaw = 1;
    }
    return false;
  }
}

export type JawTool = 'stapler' | 'clamp' | 'clip';
const SG = instrumentGeom.stapler;
const insertTop = SG.insertInset / 2;
/** Stapler: depth along the jaws (from the head hinge) where a structure of `radius` sits with `clearance` × its
 *  diameter of anvil gap at full opening, within the jaw's usable span. */
export function staplerDepth(radius: number): number {
  const need = (ENG.clearance * 2 * radius - SG.jawGap) / Math.tan(SG.open);
  return Math.min(ENG.staplerSpan[1], Math.max(ENG.staplerSpan[0], need / SG.headLength)) * SG.headLength;
}
/** Jaw value (0 closed … 1 open) whose gap at the structure is `compress` × its diameter (it is squeezed, not cut). */
export function closedJawFor(tool: JawTool, radius: number): number {
  const gap = ENG.compress * 2 * radius;
  if (tool === 'stapler') {
    const s = Math.min(1, Math.max(0, (gap - SG.jawGap) / staplerDepth(radius)));
    return Math.asin(s) / SG.open;
  }
  const [reach, open] =
    tool === 'clip'
      ? [instrumentGeom.clip.jawLength, instrumentGeom.clip.open]
      : [instrumentGeom.rightAngle.bendLength, instrumentGeom.rightAngle.open];
  return Math.min(1, Math.asin(Math.min(1, gap / (2 * reach))) / (open / 2));
}

const _d = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _h = new Vector3();
const _ax = new Vector3();
const _m4 = new Matrix4();
/**
 * T841 alignment: tool root pose (`pos` = tip, `quat` +Z = shaft) that puts a structure of `radius` centred at
 * `centre`, running along `axis`, between the jaws and PERPENDICULAR to them, the shaft still through the port
 * fulcrum `pivot`. Roll: tool +X ∥ the axis component ⟂ the shaft (`quat` in = current pose, for the axis sign).
 * Stapler: the head articulates (≤ maxArticulation) so its jaws are ⟂ the axis too. Writes `outJaw` (world jaw
 * direction, heel → tip) and returns the articulation (rad). Allocation-free.
 */
export function jawPose(
  tool: JawTool,
  pivot: PointLike,
  centre: Vector3,
  axis: Vector3,
  radius: number,
  pos: Vector3,
  quat: Quaternion,
  outJaw: Vector3,
): number {
  _x.set(1, 0, 0).applyQuaternion(quat);
  _ax.copy(axis).normalize();
  if (_ax.dot(_x) < 0) _ax.negate(); // least roll from the current pose
  pos.copy(centre);
  let art = 0;
  for (let k = 0; k < ENG.iterations; k++) {
    _d.set(pos.x - pivot.x, pos.y - pivot.y, pos.z - pivot.z).normalize();
    const beta = _ax.dot(_d);
    _x.copy(_ax).addScaledVector(_d, -beta);
    const alpha = _x.length();
    if (alpha < 1e-6) _x.set(1, 0, 0).applyQuaternion(quat).addScaledVector(_d, -_x.dot(_d));
    _x.normalize();
    _y.crossVectors(_d, _x);
    quat.setFromRotationMatrix(_m4.makeBasis(_x, _y, _d));
    art =
      tool === 'stapler'
        ? Math.max(-SG.maxArticulation, Math.min(SG.maxArticulation, Math.atan2(-beta, alpha)))
        : 0;
    if (tool === 'stapler') {
      const zc = staplerDepth(radius);
      _h.set(zc * Math.sin(art), insertTop + radius, -SG.headLength + zc * Math.cos(art));
    } else if (tool === 'clamp')
      _h.set(0, -Math.max(radius * ENG.clampHoldR, instrumentGeom.rightAngle.bendLength * ENG.clampHold), 0);
    else _h.set(0, 0, -instrumentGeom.clip.clipLength * ENG.clipHold);
    pos.copy(centre).sub(_h.applyQuaternion(quat));
  }
  if (tool === 'stapler') outJaw.set(Math.sin(art), 0, Math.cos(art)).applyQuaternion(quat);
  else if (tool === 'clamp') outJaw.set(0, 1, 0).applyQuaternion(quat);
  else outJaw.set(0, 0, 1).applyQuaternion(quat);
  return art;
}
