// T860 walkthrough shots (FEEDBACK_GUIDED_v1 §2.1-5, R1): camera moves inside the fulcrum rig (eased rig-parameter
// interpolation between two valid rig states, so the shaft always passes through the port) and the acts, driven
// through the REAL m4 paths (hotbar select, insertVia, snapTo / press / hold / withdraw, stapler fire, ring-clamp node
// removal, fissure segments) inside asEngine() — the walkthrough input lock blocks only the user. Event-time code:
// one engine-clock motion per move (engine.ts ticks it from the frame loop); per-frame callbacks reuse module temps.
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { config } from '../../core/config';
import { ANATOMY } from '../../content/anatomy';
import { SUB_IDS, TARGET_BY_ID } from '../../content/targets';
import type { ToolId } from '../../scene/instruments';
import { instrumentGeom } from '../../scene/instruments.config';
import { retrievalBag as BAG } from '../../scene/instruments.config';
import { DISSECTABLE } from '../../scene/materials.config';
import type { RetrievalBag } from '../../scene/retrievalBag';
import { SLOTS } from '../../sim/hotbar';
import { interactionConfig } from '../../sim/interaction.config';
import type { Port } from '../../sim/ports';
import type { ScopeRig } from '../../sim/scopeRig';
import { startOLV, tweenTo } from '../../sim/state';
import { asEngine } from '../../sim/walkLock';
import {
  aimRig,
  centreOn,
  clampToTissue,
  lensInside,
  levelRig,
  loadRig,
  newSnap,
  saveRig,
  searchPose,
} from './framing';
import type { Framer, MutableFraming, RigSnap } from './framing';
import type { Act, BedFxApi, Cam, PortId, Subject } from './types';
import { walkthroughConfig as W } from './walkthrough.config';

type Sim = Window['__sim'];
type M4 = NonNullable<Sim['m4']>;

/** Engine clock services (engine.ts). Every await returns false once the run was cancelled (seek / mode change). */
export interface Clock {
  /** Wait `ms` engine ms. */
  wait(ms: number): Promise<boolean>;
  /** Eased motion over `ms` engine ms: fn(e ∈ 0..1) every frame (allocation-free callbacks). */
  move(ms: number, fn: (e: number) => void): Promise<boolean>;
  /** Until `ok()` (checked per frame), at most `realMs` real ms (m4's own animations run in real time). */
  until(ok: () => boolean, realMs?: number): Promise<boolean>;
  /** Engine ms → move / state-tween duration (reduced motion: short). T871: state tweens run on the engine clock
   *  (the engine shifts them with timeScale and pause), so they take engine ms too. */
  dur(ms: number): number;
  alive(): boolean;
  /** prefers-reduced-motion: camera moves become dip-to-black cuts (same beat order). */
  reduced(): boolean;
  /** Reduced-motion dip: scene brightness × f (1 = normal), uniform only. */
  dip(f: number): void;
}

export interface ShotCtx {
  readonly k: Clock;
  readonly sim: () => Sim;
  readonly framer: Framer;
  /** Last removed node's bed point + name (m4.onNodeRemoved). */
  readonly bed: Vector3;
  bedNode: string | null;
  /** Framing measured at the end of the last camera move / act. */
  readonly framing: MutableFraming;
  /** Subject of the last framing (null: none). */
  framed: Subject | null;
  /** 'sNN:beatId' of the beat running (framing hints, walkthrough.config.ts framing.hints). */
  beatKey: string;
  /** T887: the running beat's camera subject (a sweep covers its layer round it), null = none. */
  area: Subject | null;
}

const I = W.insert;
const RIG = config.scopeRig;
const IC = config.instrumentControl;
const BRONCHUS = config.finish.bronchus[0] as string;
const STOPPED = 'stopped';

// ── Rig interpolation (allocation-free per frame) ──
const A = newSnap(); // camera move: from
const B = newSnap(); // camera move: to
const P = newSnap(); // insertion: pulled back on the entry
const Fo = newSnap(); // insertion: looking at the target from the pulled-back depth
const pullFrom = newSnap(); // pullOnEntry: the pose it started from
const pullAlt = newSnap(); // pullOnEntry: deepest in-cone candidate
const pullEntry = newSnap(); // pullOnEntry: the entry in view, the goal not
const pullShaft = newSnap(); // pullOnEntry: entry hidden, the tip's end point + shaft in view (T883 E4)
const pullGoal = newSnap(); // pullOnEntry: the entry and the goal in the aperture, the goal hidden (T891 G7)
const V1 = newSnap(); // easeTo detour: lens drawn back at the start pose (T883 E7)
const V2 = newSnap(); // easeTo detour: lens drawn back at the end pose
const Ret = newSnap(); // release: the working pose to come back to
const FOLLOW = Array.from({ length: W.insert.followKeys + 1 }, newSnap); // T888 release: follow-cam keys
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
function lerpRig(s: ScopeRig, a: RigSnap, b: RigSnap, e: number): void {
  s.depth = MathUtils.lerp(a.depth, b.depth, e);
  s.yaw = MathUtils.lerp(a.yaw, b.yaw, e);
  s.pitch = MathUtils.lerp(a.pitch, b.pitch, e);
  s.opticAngleDeg = MathUtils.lerp(a.optic, b.optic, e);
  s.lightPostDeg = a.post + wrap(b.post - a.post) * e;
  s.headRollDeg = a.roll + wrap(b.roll - a.roll) * e;
  s.horizonLock = a.lock && b.lock;
  s.zoom = MathUtils.lerp(a.zoom, b.zoom, e);
  s.fovDeg = MathUtils.lerp(a.fov, b.fov, e);
  if (!s.horizonLock) levelRig(s, false); // T891 G1: every in-between frame on the step horizon too
}

/** A camera move frame: eased, or under reduced motion a cut at the midpoint inside a dip to black. */
function camAt(c: ShotCtx, s: ScopeRig, a: RigSnap, b: RigSnap, e: number): void {
  if (!c.k.reduced()) return lerpRig(s, a, b, e);
  lerpRig(s, a, b, e < 0.5 ? 0 : 1);
  c.k.dip(Math.abs(1 - 2 * e));
}

const tA = new Vector3();
const tB = new Vector3();
const tDir = new Vector3();
const tQ = new Quaternion();
const qTurn = new Quaternion();
const dir0 = new Vector3();
const from = new Vector3();
const to = new Vector3();
const tS = new Vector3();
const tH = new Vector3();

const portOf = (sim: Sim, id: string): Port | undefined => sim.m3?.scope.ports.find((p) => p.id === id);
const nameOf = (s: Subject): string | null =>
  typeof s === 'string' ? s : Array.isArray(s) ? ((s as readonly string[])[0] ?? null) : null;

/** T883 E7: the eased rig path a → b keeps the lens usable (Framer.lensOk) at framing.pathChecks points (rig left
 *  anywhere: the caller restores it). The end points are the caller's to choose. */
function pathOk(c: ShotCtx, s: ScopeRig, a: RigSnap, b: RigSnap): boolean {
  const n = W.framing.pathChecks;
  for (let i = 1; i < n; i++) {
    lerpRig(s, a, b, i / n);
    if (!c.framer.lensOk(c.framer.place(s))) return false;
  }
  return true;
}

/** T883 E7: a blocked path a → b detours through a shallower lens depth (draw back, turn, push in): v1 / v2 = a / b at
 *  that depth. False when no depth clears it (the caller moves straight). */
function detour(c: ShotCtx, s: ScopeRig, a: RigSnap, b: RigSnap): boolean {
  if (pathOk(c, s, a, b)) return false;
  for (const d of W.framing.depthsM) {
    if (d >= Math.min(a.depth, b.depth)) continue;
    Object.assign(V1, a, { depth: d });
    Object.assign(V2, b, { depth: d });
    if (pathOk(c, s, a, V1) && pathOk(c, s, V1, V2) && pathOk(c, s, V2, b)) return true;
  }
  return false;
}

/** Ease the rig from its current state to `b` (same port), writing the live pose each frame. */
async function easeTo(c: ShotCtx, b: RigSnap, ms: number): Promise<boolean> {
  const sim = c.sim();
  const m3 = sim.m3;
  if (!m3) return false;
  const s = m3.scope;
  saveRig(s, A);
  const via = s.port.id === b.port && detour(c, s, A, b);
  loadRig(s, A);
  // Detour: three legs on one eased clock (draw back, turn, push in), each a third of the move.
  const ok = await c.k.move(c.k.dur(ms), (e) => {
    if (!via) camAt(c, s, A, b, e);
    else if (e < 1 / 3) camAt(c, s, A, V1, 3 * e);
    else if (e < 2 / 3) camAt(c, s, V1, V2, 3 * e - 1);
    else camAt(c, s, V2, b, 3 * e - 2);
    m3.writeScope();
  });
  c.k.dip(1);
  if (ok) {
    loadRig(s, b);
    m3.syncScope();
  }
  return ok;
}

/** Measure `subject`'s framing from the rig as it is now (tip = the hand's instrument). */
export function measureNow(c: ShotCtx, subject: Subject | null): void {
  c.framed = subject;
  const sim = c.sim();
  if (!subject || !sim.m3 || !sim.m4) return;
  const set = c.framer.set(asOf(c, subject));
  c.framer.refresh(set);
  c.framer.measure(set, c.framer.place(sim.m3.scope), sim.m4.tool ? sim.m4.control.tipPos : null, c.framing);
}

/** T891 G7: framing hint `as` (another subject's pose, e.g. the s02 hilum view) for the running beat. */
const asOf = (c: ShotCtx, s: Subject): Subject => W.framing.hints[c.beatKey]?.as ?? s;

// ── Camera beats ──
export async function cam(c: ShotCtx, k: Cam, ms?: number): Promise<string> {
  const sim = c.sim();
  const m3 = sim.m3;
  const rig = sim.rig;
  if (!m3 || !rig || !sim.m4) return 'not wired';
  const s = m3.scope;
  const tip = sim.m4.tool ? sim.m4.control.tipPos : null;
  if (k.k === 'frame' || k.k === 'wide') {
    saveRig(s, A);
    searchPose(c.framer, s, s.port.id, c.framer.set(asOf(c, k.subject)), tip, c.framing, c.beatKey);
    saveRig(s, B);
    // T871 'wide': back out by `back` and unzoom, re-aimed so the subject stays on the view axis (centred).
    // T883 E6: out from the wider of the current pose and the framing pose (never in), the shallowest lens depth
    // from there that is still clear of the wall (no dark facets).
    if (k.k === 'wide') {
      const d0 = Math.max(RIG.depthM.min, Math.min(A.depth, B.depth) - k.back);
      const set = c.framer.set(k.subject);
      let ok = false;
      for (const d of [d0, ...W.framing.depthsM.filter((x) => x > d0).reverse()]) {
        ok = centreOn(c.framer, s, s.port.id, set, d, RIG.zoom.min) && c.framer.lensOk(c.framer.place(s));
        if (ok) break;
      }
      if (ok) saveRig(s, B);
      else {
        B.depth = d0;
        B.zoom = RIG.zoom.min;
      }
      // T888: never narrower than the view it leaves; no room to back off by `back` → the optic widens instead.
      B.fov = Math.max(B.fov, A.fov);
      if (A.depth - B.depth < k.back - 1e-4) B.fov = Math.max(B.fov, W.wideFovDeg);
    }
    loadRig(s, A);
    if (!(await easeTo(c, B, k.ms ?? ms ?? W.camMs))) return STOPPED;
    measureNow(c, k.subject);
    return 'ok';
  }
  if (k.k === 'step') {
    saveRig(s, A);
    const pose = rig.scopePoseOf(sim.state.camera);
    s.snapTo(pose, s.port.id);
    levelRig(s); // T891 G1: the step horizon (else world-up lock)
    clampToTissue(s);
    if (!lensInside(s)) {
      // The authored view lies outside the pivot cone from this port (cam_6): look at its point of view instead.
      tA.set(0, 0, -1).applyQuaternion(pose.quaternion).multiplyScalar(W.stepLookM).add(pose.position);
      if (!aimRig(s, s.port.id, tA, RIG.depthM.default) || !lensInside(s)) loadRig(s, A);
    }
    saveRig(s, B);
    loadRig(s, A);
    return (await easeTo(c, B, ms ?? W.camMs)) ? 'ok' : STOPPED;
  }
  return scopePort(c, k.port, k.subject);
}

/** T891 G8: the shallowest lens depth (≤ `b`'s) along `b`'s view with the lens usable (Framer.lensOk), else b's. */
function shallowClear(c: ShotCtx, s: ScopeRig, b: RigSnap): number {
  let out = b.depth;
  for (const d of [RIG.depthM.min, ...[...W.framing.depthsM].reverse()]) {
    if (d >= b.depth) break;
    Object.assign(V1, b, { depth: d });
    loadRig(s, V1);
    if (c.framer.lensOk(c.framer.place(s))) {
      out = d;
      break;
    }
  }
  loadRig(s, b);
  return out;
}

/** R1 scope port change: lens out to the pleura of its port, re-enter through `port`, frame `subject`. */
async function scopePort(c: ShotCtx, port: PortId, subject: Subject): Promise<string> {
  const sim = c.sim();
  const m3 = sim.m3 as NonNullable<Sim['m3']>;
  const m4 = sim.m4 as M4;
  const s = m3.scope;
  if (s.port.id === port) return cam(c, { k: 'frame', subject });
  if (!m4.occupancy.hasRoom(port)) return `No room for the scope in ${port}`;
  // T891 G8: out to the shallowest depth whose lens is still clear (not the chest wall), in at the same.
  saveRig(s, B);
  B.depth = shallowClear(c, s, B);
  if (!(await easeTo(c, B, W.scopePort.outMs))) return STOPPED;
  // Re-enter: lens just inside the new port, looking at the subject; then ease in to the framing pose.
  const set = c.framer.set(subject);
  c.framer.refresh(set);
  aimRig(s, port, c.framer.centre(set, tA), RIG.depthM.min);
  m4.occupancy.scopePort = port;
  searchPose(c.framer, s, port, set, null, c.framing, c.beatKey);
  saveRig(s, B);
  // T891 G8: in along the framing pose's own shaft, from its shallowest clear depth (no wall-grazing turn).
  Object.assign(A, B);
  A.depth = shallowClear(c, s, B);
  loadRig(s, A);
  m3.syncScope();
  if (!(await easeTo(c, B, W.scopePort.inMs))) return STOPPED;
  measureNow(c, subject);
  return 'ok';
}

// ── Reach (as the T851 demo): a point on the target the straight shaft from the port meets first ──
function vertices(sim: Sim, name: string, near: Vector3, r: number): Vector3[] {
  const out: Vector3[] = [];
  for (const m of sim.m3?.picker.meshes ?? []) {
    let o: Object3D | null = m;
    while (o && o.name !== name) o = o.parent;
    if (!o) continue;
    const n = m.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      const v = m.getVertexPosition(i, new Vector3()).applyMatrix4(m.matrixWorld);
      if (v.distanceTo(near) <= r) out.push(v);
    }
  }
  return out;
}

function seen(sim: Sim, name: string, pleura: Vector3, v: Vector3): Vector3 | null {
  const C = interactionConfig.collide;
  const d = v.clone().sub(pleura);
  const far = d.length() + W.reach.beyondM;
  d.normalize();
  let near = C.skipM;
  for (let i = 0; i <= C.passMax && near < far; i++) {
    const hit = sim.m3?.picker.ray(pleura, d, near, far);
    if (!hit) return null;
    if (hit.nodeName === name) return hit.point.clone();
    if (ANATOMY.structures[hit.nodeName]?.dissectable !== true) return null;
    near = hit.distance + C.passStepM;
  }
  return null;
}

export function reach(sim: Sim, name: string, port: Port): Vector3 | null {
  const cone = Math.cos(MathUtils.degToRad(IC.coneDeg));
  const pleura = port.pleura;
  const c = new Vector3().fromArray(TARGET_BY_ID.get(name)?.point ?? [0, 0, 0]);
  const dir = c.clone().sub(pleura).normalize();
  const vs = vertices(sim, name, c, Infinity)
    .filter((v) => {
      const d = v.distanceTo(pleura);
      return d >= IC.depthM.min && d <= IC.depthM.max && v.clone().sub(pleura).dot(port.axis) >= d * cone;
    })
    .map((v) => ({ v, cos: v.clone().sub(pleura).normalize().dot(dir) }))
    .sort((x, y) => y.cos - x.cos);
  const stride = Math.max(1, Math.floor((vs.length * W.reach.topFrac) / W.reach.tries));
  for (let i = 0; i < vs.length && i < stride * W.reach.tries; i += stride) {
    const hit = seen(sim, name, pleura, (vs[i] as { v: Vector3 }).v);
    if (hit) return hit;
  }
  return vs[0]?.v ?? null;
}

/** Points of layer `name` the instrument reaches from `pleura` within sweep.radiusM of `centre` (≤ sweep.tries rays). */
function reachable(sim: Sim, name: string, centre: Vector3, pleura: Vector3): Vector3[] {
  const all = vertices(sim, name, centre, W.sweep.radiusM);
  const stride = Math.max(1, Math.ceil(all.length / W.sweep.tries));
  const pts: Vector3[] = [];
  for (let i = 0; i < all.length; i += stride) {
    const v = all[i] as Vector3;
    const hit = seen(sim, name, pleura, v) ?? (nearlySeen(sim, pleura, v) ? v.clone() : null);
    if (hit) pts.push(hit);
  }
  return pts;
}

/** T887: the straight shaft from `pleura` reaches `v` past dissectable layers, blocked only within sweep.reachTolM
 *  of it (a strand at a vessel's edge: the hook slips in beside the vessel). */
function nearlySeen(sim: Sim, pleura: Vector3, v: Vector3): boolean {
  const C = interactionConfig.collide;
  const d = tDir.subVectors(v, pleura);
  const far = d.length() - W.sweep.reachTolM;
  d.normalize();
  let near = C.skipM;
  for (let i = 0; i <= C.passMax && near < far; i++) {
    const hit = sim.m3?.picker.ray(pleura, d, near, far);
    if (!hit) return true;
    if (ANATOMY.structures[hit.nodeName]?.dissectable !== true) return false;
    near = hit.distance + C.passStepM;
  }
  return true;
}

/** T887 (event time): a zig-zag over the part of layer `name` the instrument reaches from `pleura` round the beat's
 *  subject, the placed tip or halfway (whichever reaches most of it): rows across its long axis, each point snapped
 *  to the reachable surface (`raw`), smoothed (`path`, same length: the stroke the tip draws). */
function sweepPath(
  sim: Sim,
  name: string,
  subject: Vector3,
  tip: Vector3,
  pleura: Vector3,
): { path: Vector3[]; raw: Vector3[] } {
  const S = W.sweep;
  let pts: Vector3[] = [];
  for (const centre of [subject, tip, subject.clone().lerp(tip, 0.5)]) {
    const p = reachable(sim, name, centre, pleura);
    if (p.length > pts.length) pts = p;
  }
  if (pts.length < 3) return { path: [tip.clone()], raw: [tip.clone()] };
  const c = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(pts.length);
  // Long axis u (farthest point), across v ⟂ u and the line from the port: the area as seen by the instrument.
  let u = new Vector3(1, 0, 0);
  let spread = -1;
  for (const p of pts) {
    const d = p.distanceTo(c);
    if (d > spread) {
      spread = d;
      u = p.clone().sub(c).normalize();
    }
  }
  const v = new Vector3().crossVectors(u, c.clone().sub(pleura).normalize()).normalize();
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of pts) {
    const d = p.clone().sub(c);
    u0 = Math.min(u0, d.dot(u));
    u1 = Math.max(u1, d.dot(u));
    v0 = Math.min(v0, d.dot(v));
    v1 = Math.max(v1, d.dot(v));
  }
  const rows = Math.max(1, Math.min(S.maxRows, Math.ceil((v1 - v0) / S.rowM)));
  const cols = Math.max(2, Math.ceil((u1 - u0) / S.stepM));
  const raw: Vector3[] = [];
  for (let r = 0; r < rows; r++) {
    const vr = rows === 1 ? (v0 + v1) / 2 : v0 + ((v1 - v0) * r) / (rows - 1);
    for (let k = 0; k <= cols; k++) {
      const t = r % 2 === 0 ? k / cols : 1 - k / cols; // zig-zag: no jump between rows
      const q = c
        .clone()
        .addScaledVector(u, u0 + (u1 - u0) * t)
        .addScaledVector(v, vr);
      let best = pts[0] as Vector3;
      for (const p of pts) if (p.distanceToSquared(q) < best.distanceToSquared(q)) best = p;
      if (!raw.length || !(raw[raw.length - 1] as Vector3).equals(best)) raw.push(best);
    }
  }
  // Snapping jumps between neighbouring vertices: a few 3-point averaging passes keep the stroke smooth.
  let path = raw.map((p) => p.clone());
  for (let s = 0; s < S.smooth; s++)
    path = path.map((p, i) =>
      i === 0 || i === path.length - 1
        ? p
        : p
            .clone()
            .add(path[i - 1] as Vector3)
            .add(path[i + 1] as Vector3)
            .divideScalar(3),
    );
  return path.length > 1 ? { path, raw } : { path: [tip.clone()], raw: [tip.clone()] };
}

// ── Instrument shots ──
/** Hotbar select tool + sub-option, then into `port` (insertVia). 'ok' or the refusal. */
function bring(sim: Sim, tool: string, sub: string | undefined, port: string): string {
  const hb = sim.m3?.hotbar;
  const m4 = sim.m4 as M4;
  if (!hb) return 'not wired';
  const slot = SLOTS.findIndex((s) => s.id === tool);
  if (slot < 0) return `Unknown instrument ${tool}`;
  asEngine(() => {
    if (hb.slot !== slot) hb.select(slot);
    const k = sub ? Math.max(0, SUB_IDS[tool as keyof typeof SUB_IDS]?.indexOf(sub) ?? 0) : 0;
    for (let n = 0; n < (SLOTS[slot]?.subOptions.length ?? 0) && hb.subOption() !== k; n++) hb.select(slot);
  });
  if (m4.occupancy.activePort !== port) asEngine(() => m4.insertVia(port));
  return m4.occupancy.activePort === port ? 'ok' : `No room for the ${tool} in ${port}`;
}

/** Hands: the hand's instrument is gone (hotbar slot 0). */
const hands = (sim: Sim): void => asEngine(() => sim.m3?.hotbar.select(0));

/** Rig on the port's pleural entry from the scope's port (T871: aimed part-way toward `goal`, the tip's end point, so
 *  the entry and the goal are both in the aperture and the tip is seen all the way in): deepest pull that shows the
 *  entry unoccluded (and the goal), the lens clear of the wall. True when the goal is in view too. */
function pullOnEntry(c: ShotCtx, port: Port, goal: Vector3 | null): boolean {
  const s = (c.sim().m3 as NonNullable<Sim['m3']>).scope;
  saveRig(s, pullFrom);
  let inCone = false;
  let entryOnly = false;
  let goalSeen = false;
  let shaft = false;
  tA.copy(port.pleura).addScaledVector(port.axis, I.entryM);
  // T883 E4: the shaft point behind the tip's end point (toward the port), for the entry-hidden fallback.
  if (goal) tS.subVectors(port.pleura, goal).normalize().multiplyScalar(I.shaftM).add(goal);
  for (const d of I.pullDepthsM)
    for (const f of goal ? I.pullAims : [0]) {
      tB.lerpVectors(tA, goal ?? tA, f);
      if (!aimRig(s, s.port.id, tB, Math.min(d, pullFrom.depth)) || !lensInside(s)) continue;
      const cam = c.framer.place(s);
      if (!c.framer.clear(cam.position)) continue; // T871: never a lens against the chest wall
      if (!inCone) saveRig(s, pullAlt); // the deepest in-cone pull (fallback when the entry stays hidden)
      inCone = true;
      if (!c.framer.sees(cam, tA, true)) continue;
      // T891 G7: the goal unoccluded too (the reflected lobe not over the hilum); else the goal at least projected.
      if (!goal || c.framer.sees(cam, goal, true)) return goal !== null;
      if (!goalSeen && c.framer.sees(cam, goal, false)) {
        saveRig(s, pullGoal);
        goalSeen = true;
      }
      if (!entryOnly) saveRig(s, pullEntry); // the entry alone: kept unless an aim shows the goal too
      entryOnly = true;
    }
  if (goalSeen) {
    loadRig(s, pullGoal);
    return true;
  }
  // T883 E4: the entry hidden from every pull: keep the tip's end point and its shaft in view (and lens usable).
  if (goal && !entryOnly)
    for (const d of I.pullDepthsM) {
      for (const f of I.shaftAims) {
        tB.lerpVectors(goal, tS, f);
        if (!aimRig(s, s.port.id, tB, Math.min(d, pullFrom.depth)) || !lensInside(s)) continue;
        const cam = c.framer.place(s);
        if (!c.framer.lensOk(cam) || !c.framer.sees(cam, goal, false) || !c.framer.sees(cam, tS, false))
          continue;
        saveRig(s, pullShaft);
        shaft = true;
        break;
      }
      if (shaft) break;
    }
  // T870: never leave the lens out of the pivot cone (rig rules, §2.1-5): deepest in-cone pull, else stay put.
  loadRig(s, entryOnly ? pullEntry : shaft ? pullShaft : inCone ? pullAlt : pullFrom);
  return shaft;
}

/** Target point on `t` reached from `port` (node bed → the bed point). */
function pointOn(c: ShotCtx, t: Subject, port: Port, out: Vector3): string | null {
  if (typeof t === 'object' && !Array.isArray(t) && 'bed' in t) {
    out.copy(c.bed);
    return c.bedNode ?? BRONCHUS;
  }
  const name = nameOf(t);
  const p = name ? reach(c.sim(), name, port) : null;
  if (!name || !p) return null;
  out.copy(p);
  return name;
}

/** Insertion shot: pull back to the port's entry, tip in along the port axis (camera turning with it), push in to
 *  the working pose on the target. */
async function insert(c: ShotCtx, tool: string, sub: string | undefined, portId: PortId, t: Subject) {
  const sim = c.sim();
  const m3 = sim.m3 as NonNullable<Sim['m3']>;
  const m4 = sim.m4 as M4;
  const o = m4.occupancy;
  const port = portOf(sim, portId);
  if (!port) return `Unknown port ${portId}`;
  if (tool === 'bag') return bagIn(c, port);
  if (!SLOTS.some((s) => s.id === tool)) return 'ok'; // chest tube: no instrument model (context action)
  if (o.activePort !== portId && !o.hasRoom(portId)) return `Port occupied: ${portId}`;
  const s = m3.scope;
  const at = new Vector3();
  let name = pointOn(c, t, port, at);
  const ringNode =
    tool === 'grasper' && sub === 'ring' && ANATOMY.structures[name ?? '']?.tissue === 'lymphNode';
  if (name && ringNode) {
    // T871: the rings close AROUND the node: their centre sits ringRadius behind the tip, so the tip goes that far
    // past the node's centre along the line from the port.
    const set = c.framer.set(name);
    c.framer.refresh(set);
    c.framer.centre(set, at);
    at.addScaledVector(tB.subVectors(at, port.pleura).normalize(), instrumentGeom.ringClamp.ringRadius);
  }
  // T891 G5: the sucker's tip goes to the saline pool's surface over its target.
  const w = m4.water;
  if (tool === 'sucker' && w.level > 0) at.y = Math.max(at.y, w.surfaceY);
  saveRig(s, A);
  const both = pullOnEntry(c, port, name ? at : null);
  saveRig(s, P);
  loadRig(s, A);
  if (!(await easeTo(c, P, I.pullMs))) return STOPPED;
  const r0 = bring(sim, tool, sub, portId);
  if (r0 !== 'ok') return r0;
  let r = name ? asEngine(() => m4.snapTo(name as string, at)) : 'No reachable target';
  if (r !== 'ok' && typeof t === 'object' && !Array.isArray(t) && 'bed' in t) {
    name = BRONCHUS; // the bed seal: the node is gone, the hook lands beside it
    r = asEngine(() => m4.snapTo(name as string, at));
  }
  if (r !== 'ok') return r;
  const ctl = m4.control;
  ctl.park(port);
  // Tip: shaft direction slerps from the port axis to the target line while the depth goes in.
  dir0.copy(port.axis);
  from.copy(at).sub(port.pleura);
  const len = from.length();
  qTurn.setFromUnitVectors(dir0, from.divideScalar(len));
  // The camera turns with the tip (T870: stay in the cone); T871: a pull that shows the entry and the goal holds.
  const turn =
    !both &&
    aimRig(s, s.port.id, at, P.depth) &&
    lensInside(s) &&
    c.framer.lensOk(c.framer.place(s)) && // T883 E7: no lens in / against tissue while following the tip
    pathOk(c, s, P, saveRig(s, Fo));
  if (!turn) Object.assign(Fo, P);
  loadRig(s, P);
  const ok = await c.k.move(c.k.dur(I.tipMs), (e) => {
    tQ.identity().slerp(qTurn, e);
    tDir.copy(dir0).applyQuaternion(tQ);
    to.copy(port.pleura).addScaledVector(tDir, MathUtils.lerp(IC.depthM.min, len, e));
    ctl.aimAt(to);
    camAt(c, s, P, Fo, e);
    m3.writeScope();
  });
  if (!ok) return STOPPED;
  loadRig(s, Fo);
  const set = c.framer.set(t);
  searchPose(c.framer, s, s.port.id, set, ctl.tipPos, c.framing, c.beatKey);
  saveRig(s, B);
  loadRig(s, Fo);
  if (!(await easeTo(c, B, I.pushMs))) return STOPPED;
  measureNow(c, t);
  // T876: the ring jaws close round the node as soon as they are on it (the node act then pulls it free).
  if (!ringNode) return 'ok';
  asEngine(() => (m4.press(true), m4.press(false)));
  return (await c.k.until(() => m4.control.jaw >= 1)) ? 'ok' : STOPPED; // the beat ends on closed rings
}

/** Withdrawal shot (shorter mirror): tip back out to its port with the camera following it, then back. */
async function withdraw(c: ShotCtx): Promise<string> {
  const sim = c.sim();
  const m3 = sim.m3 as NonNullable<Sim['m3']>;
  const m4 = sim.m4 as M4;
  const ctl = m4.control;
  const port = ctl.port;
  if (!m4.tool || !port) return 'ok';
  const s = m3.scope;
  // T891 G2: the camera follows the tip out (as the held grasper's release), then comes back to this pose.
  saveRig(s, Ret);
  followOut(c, s, port, ctl.tipPos);
  asEngine(() => m4.press(false));
  from.copy(ctl.tipPos);
  to.copy(port.pleura).addScaledVector(port.axis, IC.depthM.min);
  const ok = await c.k.move(c.k.dur(I.tipMs * I.withdrawFrac), (e) => {
    tA.lerpVectors(from, to, e);
    ctl.aimAt(tA);
    followCam(c, s, e);
    m3.writeScope();
  });
  if (!ok) return STOPPED;
  asEngine(() => m4.withdraw());
  hands(sim);
  loadRig(s, FOLLOW[I.followKeys] as RigSnap);
  return (await easeTo(c, Ret, I.pushMs * I.withdrawFrac)) ? 'ok' : STOPPED;
}

interface Opening {
  p: Vector3;
  /** Index of the nearest stroke point: painted once the stroke gets there. */
  i: number;
}
/** T891 G6 (event time): layer `name`'s vertices within sweep.openRadiusM of `centre`, thinned to sweep.openStepM
 *  apart, each tagged with its nearest stroke point and sorted by it (the opening follows the stroke). */
function openingPoints(sim: Sim, name: string, centre: Vector3, raw: readonly Vector3[]): Opening[] {
  const out: Opening[] = [];
  const step2 = W.sweep.openStepM ** 2;
  for (const v of vertices(sim, name, centre, W.sweep.openRadiusM)) {
    if (out.some((o) => o.p.distanceToSquared(v) < step2)) continue;
    let i = 0;
    for (let k = 1; k < raw.length; k++)
      if ((raw[k] as Vector3).distanceToSquared(v) < (raw[i] as Vector3).distanceToSquared(v)) i = k;
    out.push({ p: v, i });
  }
  return out.sort((a, b) => a.i - b.i);
}

/** Back and forth along the placed target's surface, energy / blunt pressure on. */
async function sweep(c: ShotCtx, ms: number, strokes: number): Promise<string> {
  const sim = c.sim();
  const m4 = sim.m4 as M4;
  const ctl = m4.control;
  if (m4.tool === 'clamp') {
    // Blunt clamp passage (R4): close around the structure, hold, open again.
    asEngine(() => {
      m4.press(true);
      m4.press(false);
    });
    if (!(await c.k.wait(ms))) return STOPPED;
    if (m4.clamped !== null) asEngine(() => (m4.press(true), m4.press(false)));
    return 'ok';
  }
  const pleura = ctl.port?.pleura;
  // T887: centred on the beat's subject (e.g. the vein the strands cover), else where the tip was placed.
  const centre = ctl.tipPos.clone();
  if (c.area) {
    const set = c.framer.set(c.area);
    c.framer.refresh(set);
    c.framer.centre(set, centre);
  }
  const name = m4.target ?? '';
  const { path, raw } = pleura
    ? sweepPath(sim, name, centre, ctl.tipPos, pleura)
    : { path: [ctl.tipPos.clone()], raw: [ctl.tipPos.clone()] };
  asEngine(() => m4.press(true)); // the peanut answers with its passage toast: the sweep goes on either way
  const n = path.length - 1;
  // T891 G6: the stroke opens the layer it passes over (frame-rate independent: the contact sampling alone misses most
  // of a fast-forwarded stroke): every opening point is painted once the stroke reaches its nearest path point; the
  // peanut on a vessel tears the fascia round it.
  const layer = DISSECTABLE.test(name);
  const blunt = m4.tool === 'peanut';
  const area = layer ? openingPoints(sim, name, centre, raw) : raw.map((p, i) => ({ p, i }));
  let painted = 0;
  const ok = await c.k.move(c.k.dur(ms), (e) => {
    const u = (e * strokes) % 2;
    const f = (u > 1 ? 2 - u : u) * n;
    const i = Math.min(n - 1, Math.floor(f));
    if (n > 0) ctl.aimAt(tA.lerpVectors(path[i] as Vector3, path[i + 1] as Vector3, f - i));
    for (const end = Math.round(f); painted < area.length && (area[painted] as Opening).i <= end; painted++) {
      const p = (area[painted] as Opening).p;
      m4.cuts.lift(); // one disc per point (no stroke bridging)
      if (layer) m4.cuts.touch(name, p, 0, blunt);
      else if (blunt) m4.cuts.touchNear(p);
    }
  });
  m4.cuts.lift();
  asEngine(() => m4.press(false));
  return ok ? 'ok' : STOPPED;
}

async function fire(c: ShotCtx, target: string): Promise<string> {
  const m4 = c.sim().m4 as M4;
  const r = asEngine(() => {
    const x = m4.press(true);
    m4.press(false);
    return x;
  });
  if (r !== 'ok') return r;
  if (!(await c.k.until(() => m4.flags.has(`divided:${target}`), W.waitMs)))
    return c.k.alive() ? `${target} was not divided` : STOPPED;
  return (await c.k.until(() => !m4.walk.busy())) && (await c.k.wait(W.beatMs / 2)) ? 'ok' : STOPPED;
}

/** Ring clamp on the placed node: grasp, tug, carry it out to the port (it leaves the frame), recorded. */
async function node(c: ShotCtx): Promise<string> {
  const sim = c.sim();
  const m4 = sim.m4 as M4;
  const ctl = m4.control;
  const port = ctl.port;
  const r = asEngine(() => {
    const x = m4.press(true);
    m4.press(false);
    return x;
  });
  if (r !== 'ok' || !port) return r === 'ok' ? 'No port' : r;
  const N = W.node;
  from.copy(ctl.tipPos);
  to.copy(from).lerp(port.pleura, N.tugM / Math.max(N.tugM, from.distanceTo(port.pleura)));
  if (!(await c.k.move(c.k.dur(N.tugMs), (e) => ctl.aimAt(tA.lerpVectors(from, to, e))))) return STOPPED;
  from.copy(to);
  to.copy(port.pleura).addScaledVector(port.axis, IC.depthM.min);
  if (!(await c.k.move(c.k.dur(N.carryMs), (e) => ctl.aimAt(tA.lerpVectors(from, to, e))))) return STOPPED;
  const n = m4.samples.length;
  asEngine(() => m4.withdraw());
  hands(sim);
  return m4.samples.length > n ? 'ok' : m4.lastToast;
}

/** Step 7: stapler (inserted through `port` on the first) to the next guide segment, fire, wait. */
async function segment(c: ShotCtx, port: PortId): Promise<string> {
  const sim = c.sim();
  const m4 = sim.m4 as M4;
  const fg = sim.fissure;
  const at = new Vector3();
  const before = fg?.fired ?? 0;
  if (!fg?.next(at)) return 'No fissure segment left';
  const lobe = config.finish.lobe;
  if (m4.tool !== 'stapler') {
    const r = await insert(c, 'stapler', 'parenchyma', port, lobe);
    if (r !== 'ok') return r;
  }
  const r = asEngine(() => m4.snapTo(lobe, at));
  if (r !== 'ok') return r;
  if (!(await c.k.until(() => m4.control.phase === 'placed', W.waitMs))) return STOPPED;
  const f = asEngine(() => {
    const x = m4.press(true);
    m4.press(false);
    return x;
  });
  if (f !== 'ok') return f;
  if (!(await c.k.until(() => (fg.fired ?? 0) > before, W.waitMs)))
    return c.k.alive() ? 'The segment did not fire' : STOPPED;
  // The jaws open (real time) before the next segment.
  if (!(await c.k.until(() => !m4.walk.busy()))) return STOPPED;
  // T874: the open stapler backs off along its shaft so the new staple row shows in the beat's end frame.
  const ctl = m4.control;
  const pleura = ctl.port?.pleura;
  if (pleura) {
    from.copy(ctl.tipPos);
    to.subVectors(from, pleura).normalize().multiplyScalar(-W.segmentBackoffM).add(from);
    if (!(await c.k.move(c.k.dur(W.segmentBackoffMs), (e) => ctl.aimAt(tA.lerpVectors(from, to, e)))))
      return STOPPED;
  }
  return (await c.k.wait(W.beatMs / 2)) ? 'ok' : STOPPED;
}

/** An instrument left in `port` on `target` slides out along its shaft and is gone (§2.1-3: shown, never hidden).
 *  T883 E4: the camera turns to keep its jaws + shaft (or the port entry) in view while it leaves, then comes back. */
async function heldOut(c: ShotCtx, port: string, target: string): Promise<boolean> {
  const sim = c.sim();
  const m4 = sim.m4 as M4;
  const m3 = sim.m3 as NonNullable<Sim['m3']>;
  const set = m4.walk.heldOut(port, target);
  if (!set) return true;
  const s = m3.scope;
  const p = portOf(sim, port);
  saveRig(s, Ret);
  const n = I.followKeys;
  if (p && m4.walk.heldTip(port, tH)) followOut(c, s, p, tH);
  else for (const f of FOLLOW) Object.assign(f, Ret);
  loadRig(s, Ret);
  const ok = await c.k.move(c.k.dur(I.tipMs * I.withdrawFrac), (e) => {
    set(e);
    followCam(c, s, e);
    m3.writeScope();
  });
  if (!ok) return false;
  set(1);
  loadRig(s, FOLLOW[n] as RigSnap);
  return easeTo(c, Ret, I.pushMs * I.withdrawFrac);
}

/** Follow-cam frame `e` (0..1) along the FOLLOW keys (reduced motion: one cut). */
function followCam(c: ShotCtx, s: ScopeRig, e: number): void {
  const n = I.followKeys;
  const x = c.k.reduced() ? 0 : Math.min(n - 1, Math.floor(e * n));
  if (c.k.reduced()) camAt(c, s, FOLLOW[0] as RigSnap, FOLLOW[n] as RigSnap, e);
  else camAt(c, s, FOLLOW[x] as RigSnap, FOLLOW[x + 1] as RigSnap, e * n - x);
}

/** T888 (E4 release): FOLLOW[0] = the working pose (Ret, rig there now), FOLLOW[i] = aimed at the leaving tip's point
 *  i / n of its way from `tip` out to the port, at the deepest lens depth (≤ Ret's) that is clear, sees that point and
 *  reaches it from the previous key along a clear path; else the previous key (the camera holds). */
function followOut(c: ShotCtx, s: ScopeRig, port: Port, tip: Vector3): void {
  const n = I.followKeys;
  Object.assign(FOLLOW[0] as RigSnap, Ret);
  to.copy(port.pleura).addScaledVector(port.axis, IC.depthM.min);
  for (let i = 1; i <= n; i++) {
    const key = FOLLOW[i] as RigSnap;
    const prev = FOLLOW[i - 1] as RigSnap;
    Object.assign(key, prev);
    tB.lerpVectors(tip, to, i / n);
    for (const d of [Ret.depth, ...I.pullDepthsM]) {
      if (d > Ret.depth || !aimRig(s, s.port.id, tB, d) || !lensInside(s)) continue;
      const cam = c.framer.place(s);
      if (!c.framer.lensOk(cam) || !c.framer.sees(cam, tB, false)) continue;
      saveRig(s, V1);
      if (!pathOk(c, s, prev, V1)) continue;
      Object.assign(key, V1);
      break;
    }
  }
  loadRig(s, Ret);
}

const tP = new Vector3();
const bagFxOf = (m4: M4): RetrievalBag | null | undefined => (m4.fx as { bag?: RetrievalBag | null }).bag;
/** T891 G4: retrieval-bag run progress reached by the bag-in beat (0 = not in yet). */
let bagT = 0;

/** T891 G4 bag-in beat: the camera on the access incision (and the lobe), the bag comes in and its hoop opens. */
async function bagIn(c: ShotCtx, port: Port): Promise<string> {
  const sim = c.sim();
  const m3 = sim.m3 as NonNullable<Sim['m3']>;
  const fx = bagFxOf(sim.m4 as M4);
  bagT = 0;
  if (!fx) return 'ok';
  const s = m3.scope;
  const lobe = config.finish.lobe;
  const set = c.framer.set(lobe);
  c.framer.refresh(set);
  const goal = c.framer.centre(set, new Vector3());
  saveRig(s, A);
  pullOnEntry(c, port, goal);
  saveRig(s, P);
  loadRig(s, A);
  // The bag is on its way in while the camera turns to the incision (the beat's middle shows it entering).
  const open = BAG.phase.open;
  const [cam, bag] = await Promise.all([
    easeTo(c, P, I.pullMs),
    c.k.move(c.k.dur(I.pullMs + I.tipMs), (e) => void fx.play(lobe, port.id, e * open)),
  ]);
  if (!cam || !bag) return STOPPED;
  bagT = open;
  return 'ok';
}

/** Bag the free lobe (as practice's B): it shrinks into the bag and goes out through the access incision, then
 *  the bag action records it. No bag model exists: the lobe itself carries the motion. */
async function bag(c: ShotCtx): Promise<string> {
  const sim = c.sim();
  const m4 = sim.m4 as M4;
  const fx = bagFxOf(m4);
  if (fx) {
    // T872 retrieval bag: in through the access incision, the lobe into the pouch, out (engine clock, pausable).
    // T891 G4: on from where bag-in left it; once the mouth closes the camera follows the bag out.
    const lobe = config.finish.lobe;
    const port = config.finish.accessPort;
    const m3 = sim.m3 as NonNullable<Sim['m3']>;
    const s = m3.scope;
    const p = portOf(sim, port);
    const t0 = bagT;
    bagT = 0;
    saveRig(s, Ret);
    c.framer.refresh(c.framer.set(lobe));
    c.framer.centre(c.framer.set(lobe), tH);
    if (p) followOut(c, s, p, tH);
    else for (const f of FOLLOW) Object.assign(f, Ret);
    const close = BAG.phase.close;
    const ok = await c.k.move(c.k.dur(W.bag.playMs * (1 - t0)), (e) => {
      const t = t0 + (1 - t0) * e;
      fx.play(lobe, port, t);
      followCam(c, s, t <= close ? 0 : (t - close) / (1 - close));
      m3.writeScope();
    });
    const r = ok ? m4.walk.bag() : STOPPED;
    fx.stop(); // the bag action hid the lobe; stop() puts its transform back for a later seek
    if (!ok) return r;
    loadRig(s, FOLLOW[I.followKeys] as RigSnap);
    return (await easeTo(c, Ret, I.pushMs * I.withdrawFrac)) ? r : STOPPED;
  }
  const lobe = sim.m3?.picker.meshes.find((m) => m.name === config.finish.lobe);
  const port = portOf(sim, config.finish.accessPort);
  if (!lobe || !port) return m4.walk.bag();
  const p0 = lobe.position.clone();
  const s0 = lobe.scale.clone();
  // Local position whose world origin moves by (port exit − lobe centre).
  lobe.updateWorldMatrix(true, false);
  c.framer.refresh(c.framer.set(config.finish.lobe));
  c.framer.centre(c.framer.set(config.finish.lobe), tA);
  lobe.getWorldPosition(tB).add(tP.copy(port.pleura).addScaledVector(port.axis, -W.bag.outM).sub(tA));
  lobe.parent?.worldToLocal(tB);
  tP.copy(tB);
  const restore = (): void => {
    lobe.position.copy(p0);
    lobe.scale.copy(s0);
    lobe.updateMatrix();
    lobe.matrixWorldNeedsUpdate = true;
  };
  const ok = await c.k.move(c.k.dur(W.bag.ms), (e) => {
    lobe.position.lerpVectors(p0, tP, e);
    lobe.scale.copy(tS.copy(s0).multiplyScalar(MathUtils.lerp(1, W.bag.scale, e)));
    lobe.updateMatrix();
    lobe.matrixWorldNeedsUpdate = true;
  });
  const r = ok ? m4.walk.bag() : STOPPED;
  restore(); // hidden by the bag action; a later seek shows it in place
  return r;
}

const bedFx = (m4: M4): BedFxApi | undefined => (m4.fx as { bed?: BedFxApi }).bed;

/** Run one act; 'ok' or the refusal / 'stopped'. `ms` = the beat's minimum length (engine ms). */
export async function act(c: ShotCtx, a: Act, ms: number): Promise<string> {
  const sim = c.sim();
  const m4 = sim.m4;
  if (!m4 || !sim.m3) return 'not wired';
  switch (a.k) {
    case 'insert':
      return insert(c, a.tool, a.sub, a.port, a.target);
    case 'withdraw':
      return withdraw(c);
    case 'handoff': {
      // R1: the new grasper takes the lung BEFORE the old one visibly withdraws; the keys never relax (no tween).
      const old = m4.occupancy.holds.find((x) => x.target === nameOf(a.target) && x.port !== a.port);
      const r = await insert(c, 'grasper', 'retractor', a.port, a.target);
      if (r !== 'ok') return r;
      if (asEngine(() => m4.press(true)) !== 'ok') return m4.lastToast;
      if (!(await c.k.wait(W.beatMs / 2))) return STOPPED;
      if (old && !(await heldOut(c, old.port, old.target))) return STOPPED;
      asEngine(() => m4.hold());
      return 'ok';
    }
    case 'grasp': {
      if (asEngine(() => m4.press(true)) !== 'ok') return m4.lastToast;
      const t = ms || W.graspMs;
      if (a.key) tweenTo(sim.state, a.key, a.to ?? 1, c.k.dur(t));
      if (!(await c.k.wait(t))) return STOPPED;
      if (a.hold) asEngine(() => m4.hold());
      return 'ok';
    }
    case 'release': {
      // The grasper lets go (the lung eases back) and visibly withdraws out through its port.
      for (const k of ['retract_hilum', 'retract_RML_lateral', 'retract_fissure'] as const)
        tweenTo(sim.state, k, 0, c.k.dur(W.releaseMs));
      // T888: the lung settles first, then the camera follows the grasper out (the beat's middle shows it leaving).
      if (!(await c.k.wait(W.releaseMs))) return STOPPED;
      const h = m4.occupancy.holds.find((x) => x.tool === 'grasper');
      return !h || (await heldOut(c, h.port, h.target)) ? 'ok' : STOPPED;
    }
    case 'sweep':
      return sweep(c, ms || W.sweep.ms, a.strokes ?? W.sweep.strokes);
    case 'close':
      asEngine(() => (m4.press(true), m4.press(false)));
      return (await c.k.wait(ms || W.beatMs / 2)) ? 'ok' : STOPPED;
    case 'fire':
      return fire(c, a.target);
    case 'node':
      return node(c);
    case 'ooze':
      bedFx(m4)?.ooze(c.bed); // else the node removal already started the ooze (m4.onNodeRemoved)
      return 'ok';
    case 'coagulate': {
      asEngine(() => m4.press(true));
      const ok = await c.k.wait(ms || W.beatMs / 2);
      asEngine(() => m4.press(false));
      bedFx(m4)?.coagulate();
      return ok ? 'ok' : STOPPED;
    }
    case 'ventilate':
      if (a.mode === 'two') return m4.walk.ventilate();
      if (sim.state.deflate_RUL < 1 || sim.state.deflate_RLL < 1) startOLV(sim.state);
      return 'ok';
    case 'segment':
      return segment(c, a.port);
    case 'irrigate':
      return m4.irrigate() === 'gated' ? 'gated' : 'ok'; // answers with its "saline in" toast
    case 'suction': {
      asEngine(() => m4.press(true));
      const ok = await c.k.wait(ms || W.beatMs);
      asEngine(() => m4.press(false));
      return ok ? 'ok' : STOPPED;
    }
    case 'bag':
      return bag(c);
    case 'pose':
      tweenTo(sim.state, a.key, a.to, c.k.dur(Math.min(ms || config.steps.stateMs, config.steps.stateMs)));
      return 'ok';
    case 'set':
      Object.assign(m4.finish, a.finish);
      return 'ok';
  }
}

/** Seek: a holding grasper placed instantly in its port on `target` (retract keys are set by the engine). */
export function placeHold(sim: Sim, port: PortId, target: string): boolean {
  const p = portOf(sim, port);
  const m4 = sim.m4;
  if (!p || !m4) return false;
  const at = reach(sim, target, p) ?? new Vector3().fromArray(TARGET_BY_ID.get(target)?.point ?? [0, 0, 0]);
  return m4.walk.hold('grasper' as ToolId, 'retractor', port, target, at);
}
