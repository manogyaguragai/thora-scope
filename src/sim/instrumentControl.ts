// Instrument control (CONTEXT §6.4 "Control — snap on click + manual"). One active instrument at a time.
// The shaft always passes through its port's pleura point (remote centre of motion); the tip sits `depth` metres
// along the unit shaft direction from that fulcrum. Snap = eased fulcrum-constrained tween (shaft direction slerps,
// depth lerps); manual = mirrored pivot about the fulcrum + depth on the wheel. Tool frame: tip at the origin,
// +Z along the shaft toward the tip. Pure state + math; update / writeTransform / steer / insert allocate nothing.
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Port } from './ports';
import { ease } from './state';
import { config } from '../core/config';

export const INSTRUMENT_CONTROL_CONFIG = config.instrumentControl; // values in src/core/config.ts

export type InstrumentControlConfig = typeof INSTRUMENT_CONTROL_CONFIG;
export type InstrumentPhase = 'parked' | 'inserting' | 'placed' | 'manual' | 'withdrawing';
export type SnapResult = { ok: true; point: Vector3 } | { ok: false; reason: string };

export const SNAP_REASONS = {
  noPoint: 'no valid action point here',
  reach: 'out of reach from this port',
  angle: 'too steep an angle from this port',
} as const;

const Z = new Vector3(0, 0, 1);
// Module-level temps (no per-call allocation).
const tD = new Vector3();
const tA = new Vector3();
const tQ = new Quaternion();
const tQ2 = new Quaternion();

export class InstrumentController {
  port: Port | null = null;
  phase: InstrumentPhase = 'parked';
  readonly tipPos = new Vector3();
  /** Unit, fulcrum → tip. */
  readonly shaftDir = new Vector3(0, 0, 1);
  /** Tip distance past the pleura point along the shaft, metres. */
  depth = 0;
  /** Left button held (close jaws / fire / activate). */
  active = false;
  /** 0 open … 1 closed, eased toward `active`. */
  jaw = 0;
  /** View basis for mirrored steering (image right / up in world); set from the scope camera. */
  readonly viewRight = new Vector3(1, 0, 0);
  readonly viewUp = new Vector3(0, 1, 0);

  // Tween state (preallocated).
  private readonly fromDir = new Vector3();
  private readonly toDir = new Vector3();
  private readonly turn = new Quaternion();
  private readonly target = new Vector3();
  private fromDepth = 0;
  private toDepth = 0;
  private t = 0;
  private durMs = 1;

  constructor(private readonly cfg: InstrumentControlConfig = INSTRUMENT_CONTROL_CONFIG) {}

  /** Put the tool at a port instantly: shaft on the port axis, tip just inside the pleura. */
  park(port: Port): void {
    this.port = port;
    this.phase = 'parked';
    this.shaftDir.copy(port.axis);
    this.depth = this.cfg.depthM.min;
    this.syncTip();
  }

  /**
   * Snap toward a clicked point: pick the nearest valid point within snapRadius (`validPoints` null = the click
   * itself is valid), check reach + cone, then animate in through `port`. Click-time only (result object allocates).
   */
  snapTo(port: Port, targetPoint: Vector3, validPoints?: readonly Vector3[] | null): SnapResult {
    let point: Vector3 | null = validPoints ? null : targetPoint;
    if (validPoints) {
      let best = this.cfg.snapRadiusM * this.cfg.snapRadiusM;
      for (const p of validPoints) {
        const d = p.distanceToSquared(targetPoint);
        if (d <= best) {
          best = d;
          point = p;
        }
      }
    }
    if (!point) return { ok: false, reason: SNAP_REASONS.noPoint };
    tD.subVectors(point, port.pleura);
    const len = tD.length();
    if (len > this.cfg.depthM.max || len < this.cfg.depthM.min)
      return { ok: false, reason: SNAP_REASONS.reach };
    tD.divideScalar(len);
    if (tD.dot(port.axis) < Math.cos(MathUtils.degToRad(this.cfg.coneDeg)))
      return { ok: false, reason: SNAP_REASONS.angle };

    if (this.port !== port) this.park(port);
    this.target.copy(point);
    this.startTween(tD, len, this.cfg.snapDurationMs, 'inserting');
    return { ok: true, point };
  }

  /** Right-mouse drag in px (screen: +x right, +y down). Fulcrum: tip moves opposite to the hand. */
  steer(dxPx: number, dyPx: number): void {
    if (!this.port || !this.isIdle()) return;
    const k = this.cfg.steerRadPerPx;
    tD.copy(this.shaftDir)
      .addScaledVector(this.viewRight, -dxPx * k)
      .addScaledVector(this.viewUp, dyPx * k)
      .normalize();
    this.clampCone(tD);
    this.shaftDir.copy(tD);
    this.phase = 'manual';
    this.syncTip();
  }

  /** Wheel: insert (+) / withdraw (−) along the shaft, clamped. */
  insert(deltaM: number): void {
    if (!this.port || !this.isIdle()) return;
    this.depth = MathUtils.clamp(this.depth + deltaM, this.cfg.depthM.min, this.cfg.depthM.max);
    this.phase = 'manual';
    this.syncTip();
  }

  activate(down: boolean): void {
    this.active = down;
  }

  /** Esc: animate back to parked at the current port. */
  withdraw(): void {
    if (!this.port || this.phase === 'parked') return;
    this.active = false;
    this.startTween(this.port.axis, this.cfg.depthM.min, this.cfg.withdrawDurationMs, 'withdrawing');
  }

  update(dtMs: number): void {
    const j = this.cfg.jawPerS * dtMs * 0.001;
    this.jaw = MathUtils.clamp(this.jaw + (this.active ? j : -j), 0, 1);
    if (this.phase !== 'inserting' && this.phase !== 'withdrawing') return;
    this.t = Math.min(1, this.t + dtMs / this.durMs);
    if (this.t >= 1) {
      this.shaftDir.copy(this.toDir);
      this.depth = this.toDepth;
      if (this.phase === 'inserting') {
        this.tipPos.copy(this.target); // exact landing on the chosen point
        this.phase = 'placed';
      } else {
        this.phase = 'parked';
        this.syncTip();
      }
      return;
    }
    const e = ease(this.t);
    tQ.identity().slerp(this.turn, e);
    this.shaftDir.copy(this.fromDir).applyQuaternion(tQ).normalize();
    this.depth = MathUtils.lerp(this.fromDepth, this.toDepth, e);
    this.syncTip();
  }

  /** Instrument root: position = tip, +Z = shaftDir; roll carried from the port frame (smooth within the cone). */
  writeTransform(outPos: Vector3, outQuat: Quaternion): void {
    outPos.copy(this.tipPos);
    if (!this.port) {
      outQuat.setFromUnitVectors(Z, this.shaftDir);
      return;
    }
    tQ.setFromUnitVectors(Z, this.port.axis);
    tQ2.setFromUnitVectors(this.port.axis, this.shaftDir);
    outQuat.multiplyQuaternions(tQ2, tQ);
  }

  private isIdle(): boolean {
    return this.phase === 'parked' || this.phase === 'placed' || this.phase === 'manual';
  }

  private startTween(dir: Vector3, depth: number, durMs: number, phase: InstrumentPhase): void {
    this.fromDir.copy(this.shaftDir);
    this.toDir.copy(dir);
    this.turn.setFromUnitVectors(this.fromDir, this.toDir);
    this.fromDepth = this.depth;
    this.toDepth = depth;
    this.t = 0;
    this.durMs = Math.max(1, durMs);
    this.phase = phase;
  }

  /** Clamp a unit direction to the cone around the port axis (modified in place). */
  private clampCone(s: Vector3): void {
    const a = (this.port as Port).axis;
    const maxRad = MathUtils.degToRad(this.cfg.coneDeg);
    if (s.dot(a) >= Math.cos(maxRad)) return;
    tA.copy(s).addScaledVector(a, -s.dot(a));
    if (tA.lengthSq() < 1e-12) tA.copy(this.viewRight).addScaledVector(a, -this.viewRight.dot(a));
    s.copy(a).multiplyScalar(Math.cos(maxRad)).addScaledVector(tA.normalize(), Math.sin(maxRad));
  }

  private syncTip(): void {
    this.tipPos.copy((this.port as Port).pleura).addScaledVector(this.shaftDir, this.depth);
  }
}
