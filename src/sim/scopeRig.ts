// Fulcrum thoracoscope rig (CONTEXT §6.2). The shaft pivots about its port's pleura point (remote centre of motion);
// the lens sits `depth` metres inside along the shaft. An oblique optic tilts the view `opticAngleDeg` off the shaft,
// toward the light-post direction (`lightPostDeg` around the shaft). Image up comes from the camera-head roll, or
// from world up (+Y, ceiling — §7.1) when the horizon lock is on. Pure state + math; writePose is allocation-free.
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { Pose } from '../scene/cameras';
import type { Port } from './ports';

/** Tunables: config.scopeRig. */
export const SCOPE_RIG_CONFIG = config.scopeRig;

export type RigConfig = typeof SCOPE_RIG_CONFIG;

const Y_UP = new Vector3(0, 1, 0);
const X_HEAD = new Vector3(1, 0, 0);
// Module-level temps (no per-call allocation).
const tS = new Vector3();
const tV = new Vector3();
const tUp = new Vector3();
const tRight = new Vector3();
const tP0 = new Vector3();
const tP1 = new Vector3();
const tU = new Vector3();
const tR = new Vector3();
const tA = new Vector3();
const tB = new Vector3();
const tQ = new Quaternion();
const tM = new Matrix4();

const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Port reference frame: u ⟂ axis (head-ward, else ceiling-ward), r = axis × u. */
function portFrame(port: Port, outU: Vector3, outR: Vector3): void {
  const a = port.axis;
  const ref = Math.abs(a.dot(X_HEAD)) < SCOPE_RIG_CONFIG.degenerateDot ? X_HEAD : Y_UP;
  outU.copy(ref).addScaledVector(a, -ref.dot(a)).normalize();
  outR.crossVectors(a, outU);
}

export class ScopeRig {
  readonly ports: readonly Port[];
  port!: Port;
  /** Lens distance past the pleura point along the shaft, metres. */
  depth = 0;
  /** Shaft azimuth / elevation about the fulcrum in the port frame, radians. */
  yaw = 0;
  pitch = 0;
  opticAngleDeg = 0;
  lightPostDeg = 0;
  headRollDeg = 0;
  horizonLock = true;
  zoom = 1;
  /** Unzoomed vertical fov, degrees. */
  fovDeg = 0;
  private readonly aimPose: Pose = { position: new Vector3(), quaternion: new Quaternion(), fov: 0 };

  constructor(
    ports: readonly Port[],
    private readonly cfg: RigConfig = SCOPE_RIG_CONFIG,
  ) {
    if (ports.length === 0) throw new Error('ScopeRig needs at least one port');
    this.ports = ports;
    this.reset();
  }

  reset(): void {
    this.port = this.ports.find((p) => p.id === this.cfg.defaultPort) ?? (this.ports[0] as Port);
    this.depth = this.cfg.depthM.default;
    this.yaw = this.pitch = 0;
    this.opticAngleDeg = this.cfg.opticDefaultDeg;
    this.lightPostDeg = this.headRollDeg = 0;
    this.horizonLock = true;
    this.zoom = 1;
    this.fovDeg = this.cfg.fovDeg;
  }

  /** Pointer drag in px (screen: +x right, +y down). Fulcrum: the tip (and view) moves opposite to the hand. */
  drag(dxPx: number, dyPx: number): void {
    const k = this.cfg.dragRadPerPx;
    this.pivot(-dxPx * k, dyPx * k);
  }

  /** Swing the shaft tip (≈ the view) toward image right / up by these angles, radians (arrow keys, drag). */
  pivot(rightRad: number, upRad: number): void {
    this.frame();
    tS.addScaledVector(tRight, rightRad).addScaledVector(tUp, upRad).normalize();
    this.setShaft(tS);
  }

  insert(deltaM: number): void {
    this.depth = MathUtils.clamp(this.depth + deltaM, this.cfg.depthM.min, this.cfg.depthM.max);
  }

  /** Light-post rotation: swings the oblique view around the shaft; lens and shaft stay put. */
  rotateOptic(deltaDeg: number): void {
    this.lightPostDeg = wrapDeg(this.lightPostDeg + deltaDeg);
  }

  /** Camera-head roll (image rotates about the view axis); releases the horizon lock, which would override it. */
  rollHead(deltaDeg: number): void {
    this.horizonLock = false;
    this.headRollDeg = wrapDeg(this.headRollDeg + deltaDeg);
  }

  setHorizonLock(on: boolean): void {
    this.horizonLock = on;
  }

  zoomBy(factor: number): void {
    this.zoom = MathUtils.clamp(this.zoom * factor, this.cfg.zoom.min, this.cfg.zoom.max);
  }

  /** Move the scope to another port: shaft back on the port axis, depth kept within limits. */
  switchPort(id: string): void {
    this.port = this.findPort(id);
    this.yaw = this.pitch = 0;
    this.insert(0);
  }

  /**
   * Port-switch default view: move to port `id` and look at `target` through the default oblique optic, level.
   * The shaft is tilted off the fulcrum→target line by the optic angle (away from the light post), then snapTo
   * solves the exact optic / light post. Allocation-free.
   */
  aimFrom(id: string, target: Vector3): void {
    const port = this.findPort(id);
    const d = tA.subVectors(target, port.pleura);
    const dist = d.length();
    if (dist < 1e-6) return this.switchPort(id);
    d.divideScalar(dist);
    portFrame(port, tU, tR);
    tB.copy(tU).addScaledVector(d, -tU.dot(d));
    if (tB.lengthSq() < 1e-12) tB.copy(tR);
    const al = MathUtils.degToRad(this.cfg.opticDefaultDeg);
    tS.copy(d).multiplyScalar(Math.cos(al)).addScaledVector(tB.normalize(), -Math.sin(al));
    const p = this.aimPose;
    p.position
      .copy(port.pleura)
      .addScaledVector(tS, Math.min(this.cfg.depthM.default, dist * this.cfg.aimDepthFrac));
    p.quaternion.setFromRotationMatrix(tM.lookAt(p.position, target, Y_UP));
    p.fov = this.cfg.fovDeg;
    this.snapTo(p, id);
    this.horizonLock = true;
  }

  /**
   * Best rig state reproducing a camera pose (e.g. a glTF step camera). Port: given, else the port whose
   * fulcrum→lens line sits closest to `opticAngleDeg` off the camera forward (distance to the port axis picks
   * the wrong port for cam_1/2/6 on this asset). Turns the horizon lock off: authored views are rolled.
   */
  snapTo(pose: Readonly<Pose>, portId?: string): void {
    const pos = pose.position;
    const fwd = tB.set(0, 0, -1).applyQuaternion(pose.quaternion);
    if (portId) this.port = this.findPort(portId);
    else {
      const want = Math.cos(MathUtils.degToRad(this.opticAngleDeg));
      let best = Infinity;
      for (const p of this.ports) {
        const err = Math.abs(tA.subVectors(pos, p.pleura).normalize().dot(fwd) - want);
        if (err < best) {
          best = err;
          this.port = p;
        }
      }
    }
    this.horizonLock = false;
    tS.subVectors(pos, this.port.pleura);
    const len = tS.length();
    if (len > 1e-6) tS.divideScalar(len);
    else tS.copy(fwd);
    this.setShaft(tS);
    this.depth = MathUtils.clamp(len, this.cfg.depthM.min, this.cfg.depthM.max);
    this.zoom = 1;
    this.fovDeg = pose.fov;

    // Optic angle + light post from the camera forward, in the (transported) shaft frame.
    this.shaftFrame();
    const cosA = MathUtils.clamp(fwd.dot(tS), -1, 1);
    this.opticAngleDeg = Math.min(MathUtils.radToDeg(Math.acos(cosA)), this.cfg.opticMaxDeg);
    if (cosA < this.cfg.degenerateDot)
      this.lightPostDeg = MathUtils.radToDeg(Math.atan2(fwd.dot(tP1), fwd.dot(tP0)));

    // Head roll so the unlocked image up matches the camera up: solve v·((cosR p0 + sinR p1) × up) = 0.
    this.viewDir();
    const camUp = tB.set(0, 1, 0).applyQuaternion(pose.quaternion);
    const c0 = tA.crossVectors(tP0, camUp).dot(tV);
    const c1 = tA.crossVectors(tP1, camUp).dot(tV);
    let r = Math.atan2(c0, -c1);
    if (Math.cos(r) * tP0.dot(camUp) + Math.sin(r) * tP1.dot(camUp) < 0) r += Math.PI;
    this.headRollDeg = wrapDeg(MathUtils.radToDeg(r));
  }

  /** Lens position, orientation and (zoomed) vertical fov. Allocation-free. */
  writePose(outPosition: Vector3, outQuaternion: Quaternion, outFovRef: { fov: number }): void {
    this.frame();
    outPosition.copy(this.port.pleura).addScaledVector(tS, this.depth);
    tB.copy(tV).negate(); // camera +Z (looks down −Z)
    tRight.crossVectors(tUp, tB);
    outQuaternion.setFromRotationMatrix(tM.makeBasis(tRight, tUp, tB));
    outFovRef.fov = this.fovDeg / this.zoom;
  }

  private findPort(id: string): Port {
    const p = this.ports.find((q) => q.id === id);
    if (!p) throw new Error(`Unknown port "${id}"`);
    return p;
  }

  /** yaw/pitch ← unit shaft direction s (clamped to the cone around the port axis; s is modified). */
  private setShaft(s: Vector3): void {
    const a = this.port.axis;
    const maxRad = MathUtils.degToRad(this.cfg.coneDeg);
    if (Math.acos(MathUtils.clamp(s.dot(a), -1, 1)) > maxRad) {
      portFrame(this.port, tU, tR);
      tA.copy(s).addScaledVector(a, -s.dot(a));
      if (tA.lengthSq() < 1e-12) tA.copy(tR);
      s.copy(a).multiplyScalar(Math.cos(maxRad)).addScaledVector(tA.normalize(), Math.sin(maxRad));
    }
    portFrame(this.port, tU, tR);
    this.pitch = Math.asin(MathUtils.clamp(s.dot(tU), -1, 1));
    this.yaw = Math.atan2(s.dot(tR), s.dot(a));
  }

  /** tS ← shaft dir; tP0/tP1 ← port frame (u, r) parallel-transported onto the shaft (smooth within the cone). */
  private shaftFrame(): void {
    const a = this.port.axis;
    portFrame(this.port, tU, tR);
    const cp = Math.cos(this.pitch);
    tS.copy(a)
      .multiplyScalar(cp * Math.cos(this.yaw))
      .addScaledVector(tR, cp * Math.sin(this.yaw))
      .addScaledVector(tU, Math.sin(this.pitch))
      .normalize();
    tQ.setFromUnitVectors(a, tS);
    tP0.copy(tU).applyQuaternion(tQ);
    tP1.crossVectors(tS, tP0);
  }

  /** tV ← view dir (needs shaftFrame). */
  private viewDir(): void {
    const al = MathUtils.degToRad(this.opticAngleDeg);
    const lp = MathUtils.degToRad(this.lightPostDeg);
    tV.copy(tS)
      .multiplyScalar(Math.cos(al))
      .addScaledVector(tP0, Math.sin(al) * Math.cos(lp))
      .addScaledVector(tP1, Math.sin(al) * Math.sin(lp));
  }

  /** tS, tP0, tP1, tV, tUp (image up), tRight (image right). */
  private frame(): void {
    this.shaftFrame();
    this.viewDir();
    const lock = this.horizonLock && Math.abs(tV.dot(Y_UP)) < this.cfg.degenerateDot;
    if (lock) tUp.copy(Y_UP);
    else {
      const r = MathUtils.degToRad(this.headRollDeg);
      tUp.copy(tP0).multiplyScalar(Math.cos(r)).addScaledVector(tP1, Math.sin(r));
    }
    tUp.addScaledVector(tV, -tUp.dot(tV)).normalize();
    tRight.crossVectors(tV, tUp);
  }
}
