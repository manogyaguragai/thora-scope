// T851 step-7 fissure guide: built ONCE at load from geometry (§6.10). The middle lobe's contact band with each
// neighbour lobe (collapsed pose) is traced in the step-7 pose as the edge the step-7 scope sees, split into
// stapler-sized segments and drawn as dots (one InstancedMesh, depth-scaled in its vertex shader). Each powered-stapler
// fire on the lobe (finish.ts fissureFires; wireM4 seats the jaws on nextSegment()) turns the next segment, in order,
// into a staple line (own Staples pool, same program as the M4 staples) and hides its dots; when all are fired the free lobe drifts with the grasper. Runtime = matrix writes
// at fire time + a few compares per frame; nothing is created after load.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Ray,
  SphereGeometry,
  Triangle,
  Vector3,
} from 'three';
import type { Mesh, Object3D } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { HitPointInfo } from 'three-mesh-bvh';
import { readPorts } from '../sim/ports';
import { fissureGuideConfig as C } from './fissureGuide.config';
import { COLLAPSE_GAIN } from './morphs';
import { specimenCarrier } from './retrievalBag';
import { Staples } from './staples';
import { getStep } from '../sim/steps';
import { tweenTo } from '../sim/state';
import type { AppState } from '../sim/state';

/** Pure (unit-tested): indices of `pts` (xyz triplets) within `band` of any point of `other` (hash grid). */
export function bandIndices(pts: ArrayLike<number>, other: ArrayLike<number>, band: number): number[] {
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < other.length; i += 3) {
    const k = key(
      Math.floor((other[i] as number) / band),
      Math.floor((other[i + 1] as number) / band),
      Math.floor((other[i + 2] as number) / band),
    );
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  }
  const out: number[] = [];
  const b2 = band * band;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] as number;
    const y = pts[i + 1] as number;
    const z = pts[i + 2] as number;
    const cx = Math.floor(x / band);
    const cy = Math.floor(y / band);
    const cz = Math.floor(z / band);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++)
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dz = -1; dz <= 1 && !hit; dz++)
          for (const j of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            const ex = (other[j] as number) - x;
            const ey = (other[j + 1] as number) - y;
            const ez = (other[j + 2] as number) - z;
            if (ex * ex + ey * ey + ez * ez <= b2) {
              hit = true;
              break;
            }
          }
    if (hit) out.push(i / 3);
  }
  return out;
}

/** Pure: the band's visible edge from `eye` — band points projected on the plane ⟂ the view, binned along their
 *  principal axis there; per bin the point nearest the eye. Ordered along the axis; [] for an empty band. */
export function tracePath(pts: readonly Vector3[], eye: Vector3, bins: number): Vector3[] {
  if (pts.length === 0) return [];
  const c = new Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  const v = c.clone().sub(eye).normalize();
  const flat = pts.map((p) => {
    const d = p.clone().sub(c);
    return d.addScaledVector(v, -d.dot(v));
  });
  // Principal axis of the projected points (power iteration on the 3×3 covariance).
  const m = new Float64Array(9);
  for (const d of flat) {
    const a = [d.x, d.y, d.z];
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 3; k++) m[r * 3 + k] = (m[r * 3 + k] ?? 0) + (a[r] as number) * (a[k] as number);
  }
  const axis = new Vector3(1, 1, 1);
  for (let it = 0; it < 32; it++) {
    const { x, y, z } = axis;
    axis.set(
      (m[0] as number) * x + (m[1] as number) * y + (m[2] as number) * z,
      (m[3] as number) * x + (m[4] as number) * y + (m[5] as number) * z,
      (m[6] as number) * x + (m[7] as number) * y + (m[8] as number) * z,
    );
    if (axis.lengthSq() === 0) axis.set(1, 0, 0);
    axis.normalize();
  }
  const t = flat.map((d) => d.dot(axis));
  const lo = Math.min(...t);
  const span = Math.max(...t) - lo || 1;
  const best: (Vector3 | null)[] = new Array<Vector3 | null>(bins).fill(null);
  const dist = new Array<number>(bins).fill(Infinity);
  pts.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor((((t[i] as number) - lo) / span) * bins));
    const d = p.distanceToSquared(eye);
    if (d < (dist[b] as number)) {
      dist[b] = d;
      best[b] = p;
    }
  });
  return best.filter((p): p is Vector3 => p !== null).map((p) => p.clone());
}

export interface Segment {
  /** Polyline from start to end (the end points interpolated on the path). */
  readonly points: readonly Vector3[];
  readonly mid: Vector3;
  /** Unit, start → end (the chord). */
  readonly dir: Vector3;
  readonly length: number;
}

/** Pure: split a polyline into `n` segments of equal arc length. */
export function splitPath(path: readonly Vector3[], n: number): Segment[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push((cum[i - 1] as number) + (path[i] as Vector3).distanceTo(path[i - 1] as Vector3));
  const total = cum[cum.length - 1] as number;
  const at = (s: number): Vector3 => {
    let i = 1;
    while (i < path.length - 1 && (cum[i] as number) < s) i++;
    const a = path[i - 1] as Vector3;
    const b = path[i] ?? a;
    const len = (cum[i] as number) - (cum[i - 1] as number);
    return a.clone().lerp(b, len > 0 ? (s - (cum[i - 1] as number)) / len : 0);
  };
  const out: Segment[] = [];
  if (path.length < 2 || total === 0 || n < 1) return out;
  for (let k = 0; k < n; k++) {
    const s0 = (total * k) / n;
    const s1 = (total * (k + 1)) / n;
    const points = [at(s0)];
    for (let i = 0; i < path.length; i++)
      if ((cum[i] as number) > s0 && (cum[i] as number) < s1) points.push((path[i] as Vector3).clone());
    points.push(at(s1));
    const a = points[0] as Vector3;
    const b = points[points.length - 1] as Vector3;
    out.push({ points, mid: at((s0 + s1) / 2), dir: b.clone().sub(a).normalize(), length: a.distanceTo(b) });
  }
  return out;
}

/** Pure: dot centres along a segment, `spacing` apart, `gap` left free at both ends. */
export function dotPoints(seg: Segment, spacing: number, gap: number): Vector3[] {
  const out: Vector3[] = [];
  let carry = gap;
  for (let i = 1; i < seg.points.length; i++) {
    const a = seg.points[i - 1] as Vector3;
    const b = seg.points[i] as Vector3;
    const len = a.distanceTo(b);
    let s = carry;
    for (; s <= len; s += spacing) out.push(a.clone().lerp(b, s / len));
    carry = s - len;
  }
  const end = seg.points[seg.points.length - 1] as Vector3;
  while (out.length > 1 && (out[out.length - 1] as Vector3).distanceTo(end) < gap) out.pop();
  return out;
}

export interface FissureGuide {
  readonly group: Group;
  readonly segments: readonly Segment[];
  /** Segments fired so far (e2e). */
  readonly fired: number;
  /** Segment i stapled? */
  isFired(i: number): boolean;
  /** Midpoint of the next unfired segment (demo / stapler snap); false when all are fired. */
  next(out: Vector3): boolean;
  /** The next unfired segment (the user's stapler seats on it); null when all are fired. */
  nextSegment(): Segment | null;
  /** Dots shown: the guide's step, segments left (the stapler snaps to them). */
  readonly active: boolean;
  /** Per frame (after M4): mirror finish.fissureFires onto the segments, step visibility. Allocation-free. */
  update(state: AppState, f: GuideFinish): void;
  /** T860 instant case reset (walkthrough seek): every segment unfired, dots back, no staple rows. */
  reset(): void;
}

/** The finish.ts fields the guide reads. */
export interface GuideFinish {
  readonly fissureFires: number;
  readonly lobeFree: boolean;
  readonly lobeRemoved: boolean;
}

const COLLAPSE = 'collapse_';
/** World vertex positions of every mesh under `node`, morphed to state `s` (influences restored after). */
export function posedPositions(node: Object3D, s: Readonly<Record<string, number | undefined>>): Vector3[] {
  const out: Vector3[] = [];
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const inf = mesh.morphTargetInfluences;
    const saved = inf ? [...inf] : [];
    for (const [name, i] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      if (!inf) break;
      const key = name.startsWith(COLLAPSE) ? `deflate_${name.slice(COLLAPSE.length)}` : name;
      inf[i] = (s[key] ?? 0) * (name.startsWith(COLLAPSE) ? COLLAPSE_GAIN : 1);
    }
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++)
      out.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    if (inf) saved.forEach((v, i) => (inf[i] = v));
  });
  return out;
}

const flatten = (v: readonly Vector3[]): Float32Array => {
  const a = new Float32Array(v.length * 3);
  v.forEach((p, i) => p.toArray(a, i * 3));
  return a;
};

/** Load time: world-space BVHs of every mesh under the named nodes, morphed to state `s` (occlusion tests). */
function posedBvhs(
  model: Object3D,
  names: readonly string[],
  s: Readonly<Record<string, number | undefined>>,
): MeshBVH[] {
  const out: MeshBVH[] = [];
  for (const name of names)
    model.getObjectByName(name)?.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.children.length > 0) return;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(flatten(posedPositions(mesh, s)), 3));
      if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
      out.push(new MeshBVH(g));
    });
  return out;
}

/** Load time: the points of `pts` no occluder hides from `eye` (`slack` m short of each point). */
function visibleFrom(
  pts: readonly Vector3[],
  eye: Vector3,
  bvhs: readonly MeshBVH[],
  slack: number,
): Vector3[] {
  const ray = new Ray();
  return pts.filter((p) => {
    const far = p.distanceTo(eye) - slack;
    ray.origin.copy(eye);
    ray.direction.subVectors(p, eye).normalize();
    return far <= 0 || bvhs.every((b) => !b.raycastFirst(ray, DoubleSide, 0, far));
  });
}

const ZERO = new Matrix4().makeScale(0, 0, 0);
const _m = new Matrix4();
const _hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
const _best = new Vector3();
const _sp = new Vector3();
const _bn = new Vector3();
const _tri = new Triangle();

/** T884: staple-matrix fix that moves the staple onto the nearest surface of `bvhs` (world, step-7 pose), lifted along
 *  that face's normal. T890 (critic r2 C3): out of reach = dropped (zero matrix): a staple left on the straight chord
 *  floated past the lobe's outline. Fire time only; allocation-free. */
function surfaceSnap(bvhs: readonly MeshBVH[]): (m: Matrix4) => void {
  const S = C.staples;
  return (m) => {
    _sp.setFromMatrixPosition(m);
    let d = Infinity;
    for (const b of bvhs) {
      if (!b.closestPointToPoint(_sp, _hit, 0, S.snapM) || _hit.distance >= d) continue;
      d = _hit.distance;
      _best.copy(_hit.point);
      const g = b.geometry;
      const k = _hit.faceIndex * 3;
      const idx = g.index;
      _tri
        .setFromAttributeAndIndices(
          g.getAttribute('position'),
          idx ? idx.getX(k) : k,
          idx ? idx.getX(k + 1) : k + 1,
          idx ? idx.getX(k + 2) : k + 2,
        )
        .getNormal(_bn);
    }
    if (d < Infinity) m.setPosition(_best.addScaledVector(_bn, S.liftM));
    else m.copy(ZERO);
  };
}
const _n = new Vector3();
const _a = new Vector3();
const _off = new Vector3();
const REST = {}; // un-morphed: the lobes' fissure surfaces sit a fraction of a millimetre apart

/** Load time, before the compile stage (the caller adds `group` to the scene + registerWarmupObject). */
export function buildFissureGuide(model: Object3D, eye: Vector3): FissureGuide {
  model.updateMatrixWorld();
  const lobe = model.getObjectByName(C.lobe);
  const restLobe = lobe ? posedPositions(lobe, REST) : [];
  const stepState = getStep(C.step).state;
  const poseLobe = lobe ? posedPositions(lobe, stepState) : [];
  const restFlat = flatten(restLobe);
  const lobeCentre = new Vector3();
  for (const p of poseLobe) lobeCentre.add(p);
  lobeCentre.divideScalar(Math.max(1, poseLobe.length));

  const segments: Segment[] = [];
  const normals: Vector3[] = []; // per segment: middle lobe → neighbour, ⟂ the segment (staple rows either side)
  const eyes: Vector3[] = []; // per segment: the eye its dots lift toward
  const ports = C.fissures.some((f) => f.visibleFrom) ? readPorts(model) : [];
  const bvhsOf = new Map<string, MeshBVH[]>(); // step-7 pose, per lobe name (occlusion + staple snap)
  const posed = (name: string): MeshBVH[] => {
    let b = bvhsOf.get(name);
    if (!b) bvhsOf.set(name, (b = posedBvhs(model, [name], stepState)));
    return b;
  };
  let occluders: MeshBVH[] | null = null;
  const snapNb: ((m: Matrix4) => void)[] = []; // per segment: onto its neighbour lobe
  for (const f of C.fissures) {
    const nb = model.getObjectByName(f.neighbour);
    if (!nb) continue;
    const nbRest = flatten(posedPositions(nb, REST));
    let pts = bandIndices(restFlat, nbRest, C.bandM).map((i) => poseLobe[i] as Vector3);
    let fEye = eye;
    const port = ports.find((p) => p.id === f.visibleFrom);
    if (port) {
      // R8: the middle-lobe points nearest the fissure that the camera port sees (lobes posed as at step 7): the
      // band widens until enough of it is in view (the contact face itself faces away from that port).
      occluders ??= C.occluders.flatMap(posed);
      // The eye: in from the port toward the middle lobe (where the step-7 lens frames it), short of any lobe.
      const ray = new Ray(port.pleura, lobeCentre.clone().sub(port.pleura).normalize());
      let depth: number = C.eyeDepthM;
      for (const b of occluders) {
        const h = b.raycastFirst(ray, DoubleSide, 0, depth);
        if (h) depth = Math.min(depth, h.distance - C.eyeClearM);
      }
      fEye = ray.at(Math.max(0, depth), new Vector3());
      for (const r of C.visibleBandsM) {
        const band = bandIndices(restFlat, nbRest, r).map((i) => poseLobe[i] as Vector3);
        const seen = visibleFrom(band, fEye, occluders, C.occlusionSlackM);
        if (seen.length < C.minVisible) continue;
        pts = seen;
        break;
      }
    }
    const path = tracePath(pts, fEye, C.bins);
    const nbCentre = new Vector3();
    const nbPose = posedPositions(nb, stepState);
    for (const p of nbPose) nbCentre.add(p);
    nbCentre.divideScalar(Math.max(1, nbPose.length));
    const toNb = surfaceSnap(posed(f.neighbour));
    for (const seg of splitPath(path, f.segments)) {
      segments.push(seg);
      snapNb.push(toNb);
      eyes.push(fEye);
      const n = nbCentre.clone().sub(lobeCentre);
      normals.push(n.addScaledVector(seg.dir, -n.dot(seg.dir)).normalize());
    }
  }

  // Dots: one InstancedMesh, contiguous range per segment.
  const D = C.dot;
  const ranges: [number, number][] = [];
  const centres: Vector3[] = [];
  segments.forEach((seg, k) => {
    const dots = dotPoints(seg, D.spacingM, D.segmentGapM / 2);
    ranges.push([centres.length, centres.length + dots.length]);
    const e = eyes[k] ?? eye;
    for (const p of dots) centres.push(p.addScaledVector(_n.subVectors(e, p).normalize(), D.liftM));
  });
  const dotMat = new MeshBasicMaterial({ color: new Color(D.color), name: 'fissureGuide:dots' });
  // Nearer than refDepthM a dot keeps its screen size (shrinks in the world): no big blobs by the lens. Load-time
  // program (compiled at warm-up), no runtime uniform.
  dotMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 dotC = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec4 mvPosition = dotC + modelViewMatrix * instanceMatrix * vec4(transformed, 0.0) *
        min(1.0, -dotC.z / ${D.refDepthM.toFixed(4)});
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  dotMat.customProgramCacheKey = () => 'fissureGuide:dots';
  const dots = new InstancedMesh(new SphereGeometry(D.radiusM, 8, 6), dotMat, Math.max(1, centres.length));
  dots.name = 'fissure_guide_dots';
  dots.count = centres.length;
  centres.forEach((p, i) => dots.setMatrixAt(i, _m.makeTranslation(p.x, p.y, p.z)));
  dots.computeBoundingSphere();
  dots.matrixAutoUpdate = false;
  dots.frustumCulled = false;
  // Fired segments: real staple rows either side of the cut. T872b: the middle-lobe side sits on the specimen carrier
  // (retrievalBag) so it leaves with the lobe; the neighbour side stays with the remaining lobe.
  const staples = new Staples();
  const lobeStaples = new Staples();
  lobeStaples.snap = surfaceSnap(posed(C.lobe));
  const group = new Group();
  group.name = 'fissure_guide';
  group.add(dots, staples.group);
  group.matrixAutoUpdate = false;
  group.visible = lobeStaples.group.visible = false;
  const carrierParent = lobe?.parent ?? null;
  if (lobe && carrierParent) {
    lobeStaples.group.matrix.copy(carrierParent.matrixWorld).invert(); // the rows are written in world space
    specimenCarrier(carrierParent, lobe.name).add(lobeStaples.group);
  } else group.add(lobeStaples.group);
  // T872b: the lobe-side rows follow the middle lobe's morph pose (the drift, the release letting it drop): one
  // anchor vertex per segment (nearest to its midpoint, step-7 pose); the rows translate by the anchors' mean
  // displacement from that pose, recomputed only when the lobe's influences change.
  const lobeMesh = lobe as Mesh | undefined;
  const morphed =
    lobeMesh?.isMesh &&
    lobeMesh.morphTargetInfluences &&
    lobeMesh.geometry.getAttribute('position').count === poseLobe.length // poseLobe indexes this mesh
      ? lobeMesh
      : null;
  const anchors = segments.map((seg) => {
    let best = 0;
    let d = Infinity;
    poseLobe.forEach((p, i) => {
      const e = p.distanceToSquared(seg.mid);
      if (e < d) [d, best] = [e, i];
    });
    return best;
  });
  const lobeWorld0 = (morphed?.matrixWorld ?? new Matrix4()).clone();
  const rowsBase = lobeStaples.group.matrix.clone();
  const lastInf = new Float32Array(morphed?.morphTargetInfluences?.length ?? 0).fill(NaN);
  const followLobe = (): void => {
    const inf = morphed?.morphTargetInfluences;
    if (!morphed || !inf || anchors.length === 0) return;
    let dirty = false;
    for (let k = 0; k < inf.length; k++)
      if (lastInf[k] !== inf[k]) {
        lastInf[k] = inf[k] as number;
        dirty = true;
      }
    if (!dirty) return;
    _off.set(0, 0, 0);
    for (const i of anchors)
      _off.add(
        morphed
          .getVertexPosition(i, _a)
          .applyMatrix4(lobeWorld0)
          .sub(poseLobe[i] as Vector3),
      );
    _off.divideScalar(anchors.length);
    lobeStaples.group.matrix.copy(rowsBase).multiply(_m.makeTranslation(_off.x, _off.y, _off.z));
    lobeStaples.group.matrixWorldNeedsUpdate = true;
  };

  const fired = new Uint8Array(segments.length);
  let nFired = 0;
  let seen = 0;
  let drifted = false;
  const fire = (i: number): void => {
    const seg = segments[i];
    const r = ranges[i];
    if (!seg || !r || fired[i]) return;
    fired[i] = 1;
    nFired++;
    for (let k = r[0]; k < r[1]; k++) dots.setMatrixAt(k, ZERO);
    dots.instanceMatrix.needsUpdate = true;
    const n = normals[i] as Vector3;
    staples.snap = snapNb[i] ?? null;
    staples.addLine(seg.mid, n, seg.dir, seg.length, 1);
    lobeStaples.addLine(seg.mid, _n.copy(n).negate(), seg.dir, seg.length, 1);
  };
  const nextSegment = (): Segment | null => segments[fired.indexOf(0)] ?? null;

  return {
    group,
    segments,
    get fired() {
      return nFired;
    },
    isFired: (i) => fired[i] === 1,
    next(out) {
      const seg = nextSegment();
      if (seg) out.copy(seg.mid);
      return seg !== null;
    },
    nextSegment,
    get active() {
      return group.visible && dots.visible;
    },
    reset() {
      fired.fill(0);
      nFired = seen = 0;
      drifted = false;
      centres.forEach((p, i) => dots.setMatrixAt(i, _m.makeTranslation(p.x, p.y, p.z)));
      dots.instanceMatrix.needsUpdate = true;
      staples.reset();
      lobeStaples.reset();
    },
    update(state, f) {
      if (f.fissureFires < seen) seen = f.fissureFires; // a fresh case
      for (; seen < f.fissureFires && nFired < segments.length; seen++) fire(fired.indexOf(0));
      if (f.lobeFree && nFired < segments.length) {
        for (let i = 0; i < segments.length; i++) fire(i); // freed elsewhere (a reload into a later step)
        drifted = true;
      }
      if (!drifted && nFired > 0 && nFired === segments.length && state.step === C.step) {
        drifted = true;
        tweenTo(state, C.drift.key, C.drift.to, C.drift.ms);
      }
      const show = (state.step === C.step || state.step === C.step + 1) && !f.lobeRemoved;
      if (group.visible !== show) group.visible = lobeStaples.group.visible = show;
      // The neighbour side rides the remaining lobes' step-7 pose: off once step 8 lets them ease back.
      const showRows = state.step === C.step;
      if (staples.group.visible !== showRows) staples.group.visible = showRows;
      const showDots = state.step === C.step && nFired < segments.length;
      if (dots.visible !== showDots) dots.visible = showDots;
      if (lobeStaples.group.visible && nFired > 0) followLobe();
    },
  };
}
