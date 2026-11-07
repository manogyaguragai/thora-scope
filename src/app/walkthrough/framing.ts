// T860 framing contract (FEEDBACK_GUIDED_v1 §2.1-6 / R3): a beat's subject is centred in the 5:4 scope aperture.
// Metric: projected bounding box of the subject's sample points (vertex indices cached per subject) → centre offset
// (fraction of the aperture half-size) + clipped area / aperture area; fraction of sample points unoccluded by
// anatomy (BVH rays via the picker: instruments are not in it); the active tip inside the aperture. The pose search
// tries rig poses from the scope's port (lens depth × digital zoom, re-aimed at the bbox centre), keeping the rig
// rules (no lens in tissue: the rig's collision limit; no lens leaving the chest: the pivot cone). Event time only;
// measure() and the search reuse preallocated temps.
import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Mesh } from 'three';
import { config } from '../../core/config';
import type { Pose } from '../../scene/cameras';
import type { Picker, PickHit } from '../../scene/picking';
import { aimPose } from '../../sim/scopeRig';
import { apertureRect } from '../../ui/labels3d';
import type { ScopeRig } from '../../sim/scopeRig';
import type { Framing, Subject } from './types';
import { walkthroughConfig as W } from './walkthrough.config';

const F = W.framing;
const RIG = config.scopeRig;

export interface MutableFraming {
  offset: [number, number];
  coverage: number;
  unoccluded: number;
  tipInside: boolean | null;
  pass: boolean;
  /** T870: fraction of the subject's unclipped bbox outside the aperture (+ points behind the lens). */
  spill: number;
  /** T870: lens to the nearest subject sample / the first surface straight ahead, m. */
  nearM: number;
  /** T871: no surface within framing.lensClearM of the lens (the rig collision's clearance test, wider): false =
   *  the lens sits in / against the chest wall (dark facets). */
  clear: boolean;
  /** T883 E1: the holding grasper's jaws inside framing.heldInner of the aperture (null = no hold / not asked). */
  heldInside: boolean | null;
  /** T888: some point of the holding jaws / distal shaft inside the aperture AND unoccluded by anatomy (ray from the
   *  lens; null = no hold asked). False with a pass = no pose showed it with the subject (the subject was kept). */
  heldVisible: boolean | null;
  /** T883 E5: coverage is of subject + the big instrument's jaws (judged on framing.big). */
  big: boolean;
  /** T891 G9: the big instrument's shaft diameter at its nearest point to the lens, share of the aperture height
   *  (0 = none in hand / behind the lens); judged against framing.big.widthMax. */
  width: number;
}
export const newFraming = (): MutableFraming => ({
  offset: [0, 0],
  coverage: 0,
  unoccluded: 0,
  tipInside: null,
  pass: false,
  spill: 0,
  nearM: Infinity,
  clear: true,
  heldInside: null,
  heldVisible: null,
  big: false,
  width: 0,
});
export const copyFraming = (f: Framing, out: MutableFraming): MutableFraming => {
  out.offset[0] = f.offset[0];
  out.offset[1] = f.offset[1];
  out.coverage = f.coverage;
  out.unoccluded = f.unoccluded;
  out.tipInside = f.tipInside;
  out.pass = f.pass;
  const m = f as Partial<MutableFraming>;
  out.spill = m.spill ?? 0;
  out.nearM = m.nearM ?? Infinity;
  out.clear = m.clear ?? true;
  out.heldInside = m.heldInside ?? null;
  out.heldVisible = m.heldVisible ?? null;
  out.big = m.big ?? false;
  out.width = m.width ?? 0;
  return out;
};

/** Stable key of a subject (sample cache, coverage overrides). */
export function subjectKey(s: Subject): string {
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return (s as readonly string[]).join('+');
  const o = s as Exclude<Subject, string | readonly string[]>;
  return 'fissure' in o ? `fissure:${o.fissure}` : 'bed' in o ? 'bed' : 'segment';
}

/** Contract limits: coverage band, unoccluded minimum (default framing.unoccludedMin) and, from a beat override,
 *  the coverage band used while a big instrument is in hand (default framing.big.coverage). */
export interface Limits {
  min: number;
  max: number;
  un?: number;
  big?: { min: number; max: number };
  /** T891: offset limit of a beat override (framing.beatOverrides offsetMax), else framing.offsetMax. */
  off?: number;
}

/** Coverage band for a subject key (a multi-name subject: the widest of its names' overrides). */
export function coverageLimits(key: string): { min: number; max: number } {
  let min: number = F.coverage.min;
  let max: number = F.coverage.max;
  for (const k of key.split('+')) {
    const o = F.overrides[k];
    if (o?.min !== undefined) min = Math.min(min, o.min);
    if (o?.max !== undefined) max = Math.max(max, o.max);
  }
  return { min, max };
}

/** T888: unoccluded minimum for a subject key (the lowest of its names' overrides, else framing.unoccludedMin). */
export function unoccludedLimit(key: string): number {
  let un: number = F.unoccludedMin;
  for (const k of key.split('+')) un = Math.min(un, F.overrides[k]?.unoccludedMin ?? un);
  return un;
}

/** Aperture half-extents in NDC for a w × h viewport (the post pass's letterboxed 5:4 rect, labels3d.apertureRect). */
export function apertureHalf(
  w: number,
  h: number,
  out: { ax: number; ay: number },
): { ax: number; ay: number } {
  apertureRect(w, h, rect);
  out.ax = rect.hw / Math.max(1, rect.cx);
  out.ay = rect.hh / Math.max(1, rect.cy);
  return out;
}
const rect = { cx: 0, cy: 0, hw: 0, hh: 0 };

/** Bbox of the `n` NDC points with front[i] = 1 against the aperture (±ax, ±ay): offset + clipped coverage. Returns
 *  the number of points in front of the camera (0 → offset 9, coverage 0). */
export function bboxFraming(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  front: ArrayLike<number>,
  n: number,
  ax: number,
  ay: number,
  out: MutableFraming,
): number {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!front[i]) continue;
    const x = xs[i] as number;
    const y = ys[i] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    k++;
  }
  if (k === 0) {
    out.offset[0] = out.offset[1] = 9;
    out.coverage = 0;
    out.spill = 1;
    return 0;
  }
  out.offset[0] = (x0 + x1) / 2 / ax;
  out.offset[1] = (y0 + y1) / 2 / ay;
  const w = Math.max(0, Math.min(x1, ax) - Math.max(x0, -ax));
  const h = Math.max(0, Math.min(y1, ay) - Math.max(y0, -ay));
  out.coverage = (w * h) / (4 * ax * ay);
  // T870: a subject that fills the view because the lens is in it spills far past the aperture (or behind the lens).
  const full = (x1 - x0) * (y1 - y0);
  out.spill = Math.max(full > 0 ? 1 - (w * h) / full : 0, (n - k) / n);
  return k;
}

/** T883 E1 / T888: a frame that also shows the holding instrument (heldVisible) may sit the subject off centre up to
 *  framing.heldOffsetMax. */
const offMax = (f: MutableFraming, lim: Limits): number =>
  Math.max(f.heldVisible === true ? F.heldOffsetMax : 0, lim.off ?? F.offsetMax);

/** Contract check (sets and returns out.pass). T888: the holding instrument is not part of it: the search prefers
 *  poses that show it (searchPose), and heldVisible = false records that none did (the subject is kept). */
export function judge(out: MutableFraming, lim0: Limits): boolean {
  const lim = out.big ? (lim0.big ?? F.big.coverage) : lim0;
  const om = offMax(out, lim0);
  out.pass =
    Math.abs(out.offset[0]) <= om &&
    Math.abs(out.offset[1]) <= om &&
    out.coverage >= lim.min &&
    out.coverage <= lim.max &&
    out.unoccluded >= (lim0.un ?? F.unoccludedMin) &&
    out.tipInside !== false &&
    out.spill <= F.spillMax &&
    out.nearM >= F.minDistM &&
    out.width <= F.big.widthMax &&
    out.clear;
  return out.pass;
}

/** How far a framing misses the contract (0 = passes); the search minimises it. */
export function miss(f: MutableFraming, lim0: Limits): number {
  const lim = f.big ? (lim0.big ?? F.big.coverage) : lim0;
  const om = offMax(f, lim0);
  const o = Math.max(0, Math.abs(f.offset[0]) - om) + Math.max(0, Math.abs(f.offset[1]) - om);
  const c = Math.max(0, lim.min - f.coverage) / lim.min + Math.max(0, f.coverage - lim.max);
  const u = Math.max(0, (lim0.un ?? F.unoccludedMin) - f.unoccluded) + (f.tipInside === false ? 0.5 : 0);
  const close = Math.max(0, f.spill - F.spillMax) + Math.max(0, F.minDistM - f.nearM) / F.minDistM;
  return o + c + u + close + Math.max(0, f.width - F.big.widthMax) + (f.clear ? 0 : 1);
}

// ── Runtime ──
export interface SampleSet {
  readonly key: string;
  /** Hits on these nodes count as the subject itself (unoccluded). */
  readonly names: ReadonlySet<string>;
  readonly lim: Limits & { un: number };
  /** Per sample: its mesh + vertex (null mesh = fixed world point in pts). */
  readonly mesh: (Mesh | null)[];
  readonly vi: Int32Array;
  readonly pts: Vector3[];
}

export interface FramerDeps {
  picker: Picker;
  /** Meshes of node `name` (cached by the caller). */
  meshesOf: (name: string) => readonly Mesh[];
  /** Fixed world points of a dynamic subject (fissure band, next segment, node bed), or null. */
  points: (s: Exclude<Subject, string | readonly string[]>) => readonly Vector3[] | null;
  /** Node names standing for a special subject (unoccluded hits), e.g. the lobes along a fissure. */
  names: (s: Exclude<Subject, string | readonly string[]>) => readonly string[];
  /** T883 E1: tip of the grasper holding the lobe + the port fulcrum its shaft runs to, or false. */
  held: (tip: Vector3, port: Vector3) => boolean;
  /** T883 E5: jaw length of the instrument in hand if it is a big one (framing.big.jawsM), else 0; `heel` = the
   *  point that far back from `tip` along the shaft. */
  jaws: (tip: Vector3, heel: Vector3) => number;
  /** T891 G9: shaft radius of the big instrument in hand (framing.big.radiusM), 0 = none; and its tip, or null. */
  bigRadius: () => number;
  tip: () => Vector3 | null;
  /** T891 G5: world Y of the saline surface (-Infinity when dry): the lens stays framing.waterClearM above it. */
  waterY: () => number;
}

const N = F.samples;
// +2: the big instrument's tip and jaw heel (T883 E5 union bbox).
const xs = new Float32Array(N + 2);
const ys = new Float32Array(N + 2);
const front = new Uint8Array(N + 2);
const tH = new Vector3();
const tQh = new Vector3();
const tV = new Vector3();
const tF = new Vector3();
const tP = new Vector3();
const tQ = new Quaternion();
const fovRef = { fov: 0 };
const hit: PickHit = { nodeName: '', point: new Vector3(), normal: new Vector3(), distance: 0 };
const ap = { ax: 1, ay: 1 };
/** T888 Framer.limits(): the set's limits with the running beat's override applied (one shared object). */
const lims: Limits & { un: number; big: { min: number; max: number } } = {
  min: 0,
  max: 0,
  un: 0,
  big: { min: 0, max: 0 },
  off: undefined,
};
const tW = new Vector3();
const tW2 = new Vector3();
type BeatOverride = (typeof F.beatOverrides)[string];

export class Framer {
  /** Probe camera (aspect = the rendered camera's) for candidate poses. */
  readonly cam = new PerspectiveCamera();
  /** T874: mesh names of ghosted structures (Beat.ghost): occlusion rays look through them. */
  readonly ghost = new Set<string>();
  /** T883 E1: the holding grasper's jaws must stay in the aperture (the engine sets it per beat). */
  wantHeld = false;
  /** T888: the running beat's framing.beatOverrides entry (the engine sets it per beat), or undefined. */
  beat: BeatOverride | undefined = undefined;
  /** T891 G8: centre of the running beat's glow subject (framing.hints `toward`), or null. The engine sets it. */
  glowAt: Vector3 | null = null;
  private readonly cache = new Map<string, SampleSet>();

  constructor(
    private readonly deps: FramerDeps,
    private readonly viewCam: PerspectiveCamera,
  ) {}

  /** Sample set of a subject: node names cached (call at load for the step data), special subjects rebuilt. */
  set(s: Subject): SampleSet {
    const key = subjectKey(s);
    const hit0 = this.cache.get(key);
    if (hit0) return hit0;
    const mesh: (Mesh | null)[] = [];
    const vi: number[] = [];
    const pts: Vector3[] = [];
    let names: readonly string[];
    if (typeof s === 'string' || Array.isArray(s)) {
      names = typeof s === 'string' ? [s] : (s as readonly string[]);
      const ms = names.flatMap((n) => this.deps.meshesOf(n));
      let total = 0;
      for (const m of ms) total += m.geometry.getAttribute('position').count;
      const stride = Math.max(1, Math.floor(total / N));
      let i = 0;
      for (const m of ms) {
        const c = m.geometry.getAttribute('position').count;
        for (let v = 0; v < c && mesh.length < N; v++, i++)
          if (i % stride === 0) {
            mesh.push(m);
            vi.push(v);
            pts.push(new Vector3());
          }
      }
    } else {
      const o = s as Exclude<Subject, string | readonly string[]>;
      names = this.deps.names(o);
      const p = this.deps.points(o) ?? [];
      const stride = Math.max(1, Math.ceil(p.length / N));
      for (let i = 0; i < p.length && mesh.length < N; i += stride) {
        mesh.push(null);
        vi.push(-1);
        pts.push((p[i] as Vector3).clone());
      }
    }
    const set: SampleSet = {
      key,
      names: new Set(names),
      lim: { ...coverageLimits(key), un: unoccludedLimit(key) },
      mesh,
      vi: Int32Array.from(vi),
      pts,
    };
    if (typeof s === 'string' || Array.isArray(s) || 'fissure' in s) this.cache.set(key, set);
    return set;
  }

  /** T888: contract limits of `set` for the running beat (framing.beatOverrides replace the subject's / the big band). */
  limits(set: SampleSet): typeof lims {
    const o = this.beat;
    lims.min = o?.min ?? set.lim.min;
    lims.max = o?.max ?? set.lim.max;
    lims.un = o?.unoccludedMin ?? set.lim.un;
    lims.big.min = o?.min ?? F.big.coverage.min;
    lims.big.max = o?.max ?? F.big.coverage.max;
    lims.off = o?.offsetMax;
    return lims;
  }

  /** Current world sample points (morph-aware vertex reads). */
  refresh(set: SampleSet): void {
    for (let i = 0; i < set.pts.length; i++) {
      const m = set.mesh[i];
      if (m) m.getVertexPosition(set.vi[i] as number, set.pts[i] as Vector3).applyMatrix4(m.matrixWorld);
    }
  }

  centre(set: SampleSet, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    for (const p of set.pts) out.add(p);
    return out.divideScalar(Math.max(1, set.pts.length));
  }

  /** Probe camera ← scope rig pose. */
  place(scope: ScopeRig): PerspectiveCamera {
    const c = this.cam;
    scope.writePose(c.position, c.quaternion, fovRef);
    c.fov = fovRef.fov;
    c.aspect = this.viewCam.aspect;
    c.near = this.viewCam.near;
    c.far = this.viewCam.far;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    return c;
  }

  /** Framing of `set` (points refreshed by the caller) from camera `c`; `tip` = active instrument tip or null. */
  measure(
    set: SampleSet,
    c: PerspectiveCamera,
    tip: Vector3 | null,
    out: MutableFraming,
    occlusion = true,
  ): MutableFraming {
    apertureHalf(window.innerWidth, window.innerHeight, ap);
    tF.set(0, 0, -1).applyQuaternion(c.quaternion);
    const n = Math.min(N, set.pts.length);
    // T870: lens-to-subject distance (nearest sample) and to whatever is straight ahead (centre ray).
    out.nearM = this.deps.picker.ray(c.position, tF, 0, F.minDistM, hit)?.distance ?? Infinity;
    for (let i = 0; i < n; i++) {
      const p = set.pts[i] as Vector3;
      out.nearM = Math.min(out.nearM, p.distanceTo(c.position));
      front[i] = tV.subVectors(p, c.position).dot(tF) > 0 ? 1 : 0;
      tV.copy(p).project(c);
      xs[i] = tV.x;
      ys[i] = tV.y;
    }
    bboxFraming(xs, ys, front, n, ap.ax, ap.ay, out);
    // T883 E5: a big instrument in hand: coverage of subject + its jaws (offset / spill stay the subject's).
    out.big = tip !== null && this.deps.jaws(tH.copy(tip), tP) > 0;
    if (out.big) {
      const off0 = out.offset[0];
      const off1 = out.offset[1];
      const spill = out.spill;
      for (let j = 0; j < 2; j++) {
        const p = j === 0 ? tH : tP;
        front[n + j] = tV.subVectors(p, c.position).dot(tF) > 0 ? 1 : 0;
        tV.copy(p).project(c);
        xs[n + j] = tV.x;
        ys[n + j] = tV.y;
      }
      bboxFraming(xs, ys, front, n + 2, ap.ax, ap.ay, out);
      out.offset[0] = off0;
      out.offset[1] = off1;
      out.spill = spill;
    }
    out.width = tip ? this.width(c, tip) : 0;
    out.heldInside = this.wantHeld && this.deps.held(tH, tP) ? this.jawsIn(c) : null;
    // T888: projection alone passed jaws hidden behind the lobe they hold: rays decide (bbox pass: optimistic).
    out.heldVisible = out.heldInside === null ? null : occlusion ? this.heldSeen(c) : out.heldInside;
    out.clear = this.clear(c.position);
    out.unoccluded = occlusion ? this.unoccluded(set, c) : 1;
    if (!tip) out.tipInside = null;
    else {
      const ahead = tV.subVectors(tip, c.position).dot(tF) > 0;
      tV.copy(tip).project(c);
      out.tipInside = ahead && Math.abs(tV.x) <= ap.ax && Math.abs(tV.y) <= ap.ay;
    }
    judge(out, this.limits(set));
    return out;
  }

  /** T883 E1: the holding grasper's jaws into `out` (false: no hold drawn). */
  heldPoint(out: Vector3): boolean {
    return this.deps.held(out, tP);
  }

  /** T883 E1: some point of the holding jaws (tH = tip, tP = its port; framing.heldJawsM back along the shaft, in
   *  framing.heldSteps) inside framing.heldInner of the aperture. */
  private jawsIn(c: PerspectiveCamera): boolean {
    tP.sub(tH).normalize();
    for (let i = 0; i <= F.heldSteps; i++)
      if (this.inside(c, tQh.copy(tH).addScaledVector(tP, (F.heldJawsM * i) / F.heldSteps), F.heldInner))
        return true;
    return false;
  }

  /** T888: some point from the holding tip back along its shaft (framing.heldSeenM, heldSeenSteps + 1 points; tH = tip,
   *  tP = unit shaft direction after jawsIn) inside framing.heldInner of the aperture with a clear ray from the lens.
   *  Instruments are not in the picker (none occludes); ghosted structures are seen through, as for the subject. */
  private heldSeen(c: PerspectiveCamera): boolean {
    for (let i = 0; i <= F.heldSeenSteps; i++) {
      const p = tQh.copy(tH).addScaledVector(tP, (F.heldSeenM * i) / F.heldSeenSteps);
      if (!this.inside(c, p, F.heldInner)) continue;
      tV.subVectors(p, c.position);
      const d = tV.length();
      if (d < 1e-6) continue;
      tV.divideScalar(d);
      const far = Math.max(0, d - F.heldTolM);
      let h = this.deps.picker.ray(c.position, tV, 0, far, hit);
      for (let k = 0; h && this.ghost.has(h.nodeName) && k < F.ghostPassMax; k++)
        h = this.deps.picker.ray(c.position, tV, h.distance + F.occlusionTolM, far, hit);
      if (!h || this.ghost.has(h.nodeName)) return true;
    }
    return false;
  }

  /** T883: world point `p` ahead of camera `c` and inside `frac` of its aperture (no ray). */
  inside(c: PerspectiveCamera, p: Vector3, frac: number): boolean {
    apertureHalf(window.innerWidth, window.innerHeight, ap);
    tF.set(0, 0, -1).applyQuaternion(c.quaternion);
    if (tV.subVectors(p, c.position).dot(tF) <= 0) return false;
    tV.copy(p).project(c);
    return Math.abs(tV.x) <= ap.ax * frac && Math.abs(tV.y) <= ap.ay * frac;
  }

  /** T891 G9: diameter of the big instrument's shaft (tip back toward its port) at its nearest point to the lens, as a
   *  share of the aperture height (0: no big instrument, or that point behind the lens). */
  width(c: PerspectiveCamera, tip: Vector3): number {
    const r = this.deps.bigRadius();
    if (r <= 0 || this.deps.jaws(tW.copy(tip), tW2) <= 0) return 0;
    tW2.sub(tW).normalize(); // shaft direction, tip → port
    tV.subVectors(c.position, tW);
    tW.addScaledVector(tW2, Math.max(0, tV.dot(tW2))); // nearest shaft point
    tF.set(0, 0, -1).applyQuaternion(c.quaternion);
    tV.subVectors(tW, c.position);
    const d = tV.length();
    if (tV.dot(tF) <= 0 || d < 1e-6) return 0;
    apertureHalf(window.innerWidth, window.innerHeight, ap);
    return r / (d * ap.ay * Math.tan(MathUtils.degToRad(c.fov / 2)));
  }

  /** T883 E7: a follow-cam lens pose is usable: clear of every surface (lensClearM) and nothing straight ahead
   *  closer than framing.minDistM (no lens-in-tissue / wall-of-tissue frames). T891 G9: nor a big instrument's shaft
   *  filling more than framing.big.widthMax of the view. */
  lensOk(c: PerspectiveCamera): boolean {
    if (!this.clear(c.position)) return false;
    const tip = this.deps.tip();
    if (tip && this.width(c, tip) > F.big.widthMax) return false;
    tF.set(0, 0, -1).applyQuaternion(c.quaternion);
    return !this.deps.picker.ray(c.position, tF, 0, F.minDistM, hit);
  }

  /** T871: lens clear of every surface by framing.lensClearM (the rig collision's nearest-surface test). T891 G5: and
   *  framing.waterClearM above the saline. */
  clear(lens: Vector3): boolean {
    return this.dry(lens) && !this.deps.picker.nearest(lens, F.lensClearM, false, hit);
  }

  /** T891 G5: lens framing.waterClearM or more above the saline (always, when dry). */
  dry(lens: Vector3): boolean {
    return lens.y >= this.deps.waterY() + F.waterClearM;
  }

  /** T871: world point `p` inside the aperture of camera `c` (and, with `ray`, unoccluded by anatomy). */
  sees(c: PerspectiveCamera, p: Vector3, ray: boolean): boolean {
    apertureHalf(window.innerWidth, window.innerHeight, ap);
    tF.set(0, 0, -1).applyQuaternion(c.quaternion);
    if (tV.subVectors(p, c.position).dot(tF) <= 0) return false;
    tV.copy(p).project(c);
    if (Math.abs(tV.x) > ap.ax || Math.abs(tV.y) > ap.ay) return false;
    if (!ray) return true;
    tV.subVectors(p, c.position);
    const d = tV.length();
    return !this.deps.picker.ray(c.position, tV.divideScalar(d), 0, Math.max(0, d - F.occlusionTolM), hit);
  }

  private unoccluded(set: SampleSet, c: PerspectiveCamera): number {
    let ok = 0;
    const n = Math.min(N, set.pts.length);
    for (let i = 0; i < n; i++) {
      tV.subVectors(set.pts[i] as Vector3, c.position);
      const d = tV.length();
      if (d < 1e-6) continue;
      tV.divideScalar(d);
      const far = Math.max(0, d - F.occlusionTolM);
      let h = this.deps.picker.ray(c.position, tV, 0, far, hit);
      // T874: a ghosted structure is seen through (as instruments are not in the picker at all).
      for (let k = 0; h && this.ghost.has(h.nodeName) && k < F.ghostPassMax; k++)
        h = this.deps.picker.ray(c.position, tV, h.distance + F.occlusionTolM, far, hit);
      if (!h || set.names.has(h.nodeName) || this.ghost.has(h.nodeName)) ok++;
    }
    return n ? ok / n : 0;
  }
}

// ── Pose search (event time) ──
export interface RigSnap {
  port: string;
  depth: number;
  yaw: number;
  pitch: number;
  optic: number;
  post: number;
  roll: number;
  lock: boolean;
  zoom: number;
  fov: number;
}
export const newSnap = (): RigSnap => ({
  port: '',
  depth: 0,
  yaw: 0,
  pitch: 0,
  optic: 0,
  post: 0,
  roll: 0,
  lock: true,
  zoom: 1,
  fov: 0,
});
export function saveRig(s: ScopeRig, o: RigSnap = newSnap()): RigSnap {
  o.port = s.port.id;
  o.depth = s.depth;
  o.yaw = s.yaw;
  o.pitch = s.pitch;
  o.optic = s.opticAngleDeg;
  o.post = s.lightPostDeg;
  o.roll = s.headRollDeg;
  o.lock = s.horizonLock;
  o.zoom = s.zoom;
  o.fov = s.fovDeg;
  return o;
}
export function loadRig(s: ScopeRig, o: RigSnap): void {
  s.port = s.ports.find((p) => p.id === o.port) ?? s.port;
  s.depth = o.depth;
  s.yaw = o.yaw;
  s.pitch = o.pitch;
  s.opticAngleDeg = o.optic;
  s.lightPostDeg = o.post;
  s.headRollDeg = o.roll;
  s.horizonLock = o.lock;
  s.zoom = o.zoom;
  s.fovDeg = o.fov;
}

/** The rig's shaft stays within the pivot cone (an aim never swings the lens out of the chest). */
export function lensInside(scope: ScopeRig): boolean {
  scope.writePose(tP, tQ, fovRef);
  const cos = Math.cos(MathUtils.degToRad(RIG.pivotConeDeg));
  return tP.sub(scope.port.pleura).dot(scope.port.axis) >= scope.depth * cos;
}

/** Lens no deeper than the rig's collision limit along its shaft (no lens in tissue). */
export function clampToTissue(scope: ScopeRig): void {
  if (!scope.limit) return;
  scope.writePose(tP, tQ, fovRef);
  tV.subVectors(tP, scope.port.pleura).normalize();
  const lim = scope.limit(scope.port.pleura, tV);
  if (scope.depth > lim) scope.depth = Math.max(RIG.depthM.min, lim);
}

/** WalkState.scopeInside: lens inside the chest (pivot cone) and not past the first surface along its shaft. */
export function scopeInside(scope: ScopeRig): boolean {
  if (!lensInside(scope)) return false;
  if (!scope.limit) return true;
  scope.writePose(tP, tQ, fovRef);
  tV.subVectors(tP, scope.port.pleura).normalize();
  return scope.depth <= scope.limit(scope.port.pleura, tV) + RIG.collision.marginM;
}

const aimCfg = {
  opticDefaultDeg: RIG.opticDefaultDeg,
  fovDeg: RIG.fovDeg,
  aimDepthFrac: 1,
  depthM: { default: RIG.depthM.default as number },
};
const pose: Pose = { position: new Vector3(), quaternion: new Quaternion(), fov: 0 };
// T891 G1: the step horizon. aimRig / levelRig keep the image up on it (horizon lock off, head roll solved by snapTo)
// instead of the rig's world-up lock, which spins the image when the view looks near straight down. The horizon is
// the image up `horizon` of the step's reference view `horizonFwd`; any other view takes it carried along by the
// shortest rotation between the two views (a tilt / pan without roll: continuous, never degenerate).
const horizon = new Vector3();
const horizonFwd = new Vector3();
let horizonOn = false;
const tLook = new Matrix4();
const tTurn = new Quaternion();
const tUp = new Vector3();
/** Event time: the image up `up` of the reference view `fwd` every walkthrough aim keeps (null = world-up lock). */
export function setHorizon(up: Vector3 | null, fwd: Vector3 | null = null): void {
  horizonOn = up !== null && fwd !== null && up.lengthSq() > 1e-12 && fwd.lengthSq() > 1e-12;
  if (!horizonOn || !up || !fwd) return;
  horizon.copy(up).normalize();
  horizonFwd.copy(fwd).normalize();
}
/** Pose quaternion ← a camera at `pose.position` looking at `target`, image up on the step horizon. */
function levelLook(target: Vector3): void {
  tF.subVectors(target, pose.position).normalize();
  tUp.copy(horizon).applyQuaternion(tTurn.setFromUnitVectors(horizonFwd, tF));
  pose.quaternion.setFromRotationMatrix(tLook.lookAt(pose.position, target, tUp));
}
/** T891 G1: the rig as it looks now, its image up re-solved onto the step horizon (zoom kept); no horizon: the
 *  world-up lock (`lock`). Allocation-free (also per frame: camera moves interpolate rig parameters, which alone can
 *  roll the image between two level poses). */
export function levelRig(scope: ScopeRig, lock = true): void {
  if (!horizonOn) {
    if (lock) scope.horizonLock = true;
    return;
  }
  const zoom = scope.zoom;
  const fov = scope.fovDeg;
  scope.writePose(pose.position, pose.quaternion, fovRef);
  levelLook(tV.set(0, 0, -1).applyQuaternion(pose.quaternion).add(pose.position));
  pose.fov = fov;
  scope.snapTo(pose, scope.port.id);
  scope.zoom = zoom;
  scope.fovDeg = fov;
}
const orig = newSnap();
const best = newSnap();
const aim = new Vector3();
const tgt = new Vector3();
const cand = newFraming();
const held = new Vector3();
const NO_BIAS: readonly number[] = [0];

/** Aim the rig in port `portId` at `target` with the lens `depthM` in (view level), clamped out of tissue. */
export function aimRig(scope: ScopeRig, portId: string, target: Vector3, depthM: number, zoom = 1): boolean {
  const port = scope.ports.find((p) => p.id === portId);
  aimCfg.depthM.default = depthM;
  if (!port || !aimPose(port, target, pose, aimCfg)) return false;
  if (horizonOn) levelLook(target);
  scope.snapTo(pose, portId);
  scope.horizonLock = !horizonOn; // T891 G1: the head roll snapTo solved keeps the horizon
  scope.zoom = MathUtils.clamp(zoom, RIG.zoom.min, RIG.zoom.max);
  clampToTissue(scope);
  return true;
}

/** T871: aim the rig in `portId` so `set`'s bbox centre lies on the view axis, lens `depthM` in (a 'wide' ease back
 *  keeps the subject centred). False (rig unchanged meaning undefined) when an aim leaves the pivot cone. */
export function centreOn(
  fr: Framer,
  scope: ScopeRig,
  portId: string,
  set: SampleSet,
  depthM: number,
  zoom: number,
): boolean {
  fr.refresh(set);
  fr.centre(set, tgt);
  for (let r = 0; r <= F.refine; r++) {
    if (!aimRig(scope, portId, tgt, depthM, zoom) || !lensInside(scope)) return false;
    const c = fr.place(scope);
    fr.measure(set, c, null, cand, false);
    if (r === F.refine || cand.coverage <= 0) return true;
    tV.copy(tgt).project(c);
    tgt.set(cand.offset[0] * ap.ax, cand.offset[1] * ap.ay, tV.z).unproject(c);
  }
  return true;
}

/**
 * Best framing pose for `set` from port `portId`: leaves the RIG in the chosen pose (the caller reads it with
 * writePose and restores/eases as it likes) and `out` = its framing. True when it passes the contract.
 */
export function searchPose(
  fr: Framer,
  scope: ScopeRig,
  portId: string,
  set: SampleSet,
  tip: Vector3 | null,
  out: MutableFraming,
  beatKey = '',
): boolean {
  saveRig(scope, orig);
  fr.refresh(set);
  fr.centre(set, aim);
  // Author hints (walkthrough.config.ts framing.hints): per 'sNN:beatId', else per subject key.
  const hint = F.hints[beatKey] ?? F.hints[set.key];
  if (hint?.aim) aim.fromArray(hint.aim);
  // T891 G8: part-way toward the beat's glow subject, kept there (no re-aim on the subject's bbox).
  const toward = hint?.toward !== undefined && fr.glowAt !== null;
  if (toward) aim.lerp(fr.glowAt as Vector3, hint?.toward ?? 0);
  let bestMiss = Infinity;
  let bestScore = -Infinity;
  let found = false;
  const lim = fr.limits(set);
  const goal0 = lim.min + (lim.max - lim.min) * F.aimFrac;
  let bestVis = -1;
  // T883 E1: with a hold to show, also aim part-way from the subject toward the holding jaws (no re-aim).
  const biases = fr.wantHeld && fr.heldPoint(held) ? F.heldAims : NO_BIAS;
  for (const f of biases)
    for (const zoom of hint?.zooms ?? F.zooms)
      for (const d of hint?.depthsM ?? F.depthsM) {
        tgt.lerpVectors(aim, held, f);
        for (let r = f > 0 || toward ? F.refine : 0; r <= F.refine; r++) {
          if (!aimRig(scope, portId, tgt, d, zoom) || !lensInside(scope)) break;
          const c = fr.place(scope);
          if (!fr.dry(c.position)) break; // T891 G5: never a framing pose under the saline
          fr.measure(set, c, tip, cand, false);
          if (r < F.refine && cand.coverage > 0) {
            // Re-aim at the bbox centre (NDC → world at the subject centre's depth).
            tV.copy(tgt).project(c);
            tgt.set(cand.offset[0] * ap.ax, cand.offset[1] * ap.ay, tV.z).unproject(c);
            continue;
          }
          if (found && miss(cand, lim) > bestMiss + 1e-9) break; // bbox alone already worse: skip the rays
          fr.measure(set, c, tip, cand, true);
          const m = miss(cand, lim);
          const score = -Math.abs(cand.coverage - (cand.big ? F.big.aim : goal0));
          // T888: among passing poses, one showing the holding instrument (heldVisible; else its jaws at least
          // projected into the aperture) wins over a better coverage.
          const vis = cand.heldVisible !== false ? 2 : cand.heldInside !== false ? 1 : 0;
          if (
            m < bestMiss - 1e-9 ||
            (m <= 1e-9 && (vis > bestVis || (vis === bestVis && score > bestScore)))
          ) {
            bestMiss = m;
            bestScore = score;
            bestVis = vis;
            saveRig(scope, best);
            copyFraming(cand, out);
            found = true;
          }
          break;
        }
      }
  if (!found) {
    loadRig(scope, orig);
    fr.measure(set, fr.place(scope), tip, out, true);
    return out.pass;
  }
  loadRig(scope, best);
  return out.pass;
}
