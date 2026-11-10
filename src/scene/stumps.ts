// T834 division stumps. v7+ segments overlap into their parent with no stump cap, so hiding a divided segment
// would leave the parent looking as if the branch never existed. At load, per manifest segment (divideStep), fit
// the junction against the parent surface (BVH), build a short pinched tube + domed cap + two staple rows, copy
// the parent's morph deltas into it and hang it under the parent mesh (same transform, same morph influences
// array, same material object → no new tissue program). Runtime: sync() = visibility + material ref (§6.10).
// T841 two stumps: each segment is also split at load at its cut (geodesic distance from the junction) into a
// proximal + a distal piece (morph deltas copied by index, same material). The logical segment mesh keeps picking,
// visibility and its material but draws on a layer no camera renders. Division hides the proximal piece and shows
// the T834 stump + a distal cap; the distal piece stays with the lobe. Staples / clips on stumps and caps carry the
// tissue normal (`carrier`) so they ride the heartbeat pulse (one titanium program, uniforms only).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Ray,
  Triangle,
  Vector3,
} from 'three';
import type {
  InterleavedBufferAttribute,
  Material,
  Object3D,
  WebGLProgramParametersWithUniforms,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { HitPointInfo } from 'three-mesh-bvh';
import anatomyJson from '../content/anatomy.json' with { type: 'json' };
const { structures } = anatomyJson;
import { TARGET_BY_ID } from '../content/targets';
import { instrumentGeom } from './instruments.config';
import { PULSE, look } from './materials.config';
import { STAPLES_CONFIG, lineMatrices, localAxis } from './staples';
import type { V3 } from './staples';
import { STUMPS } from './stumps.config';
import { specimenCarrier } from './retrievalBag';
import { getInstrumentEnv } from './lights';
import { setPulseOn } from './materials';

interface Structure {
  group: string;
  lobe?: string;
  divideStep?: number;
}
type Manifest = Readonly<Record<string, Structure>>;
type MorphList = (BufferAttribute | InterleavedBufferAttribute)[];

/** Manifest pairs [segment, parent]: a `_X4`-style sub-branch hangs on its common segment, a common segment on the
 *  undivided, lobe-less tree of its group. Same names in v8 → no code change. */
export function stumpPairs(st: Manifest = structures as Manifest): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, s] of Object.entries(st)) {
    if (s.divideStep === undefined) continue;
    const common = name.replace(STUMPS.subBranch, '');
    const parent =
      common !== name && st[common]
        ? common
        : Object.keys(st).find(
            (n) => st[n]?.group === s.group && st[n]?.divideStep === undefined && !st[n]?.lobe,
          );
    if (parent) out.push([name, parent]);
  }
  return out;
}

export interface Junction {
  base: Vector3; // where the branch axis leaves the parent surface (world)
  axis: Vector3; // unit, outward along the branch
  radius: number;
}

const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _tri = new Triangle();

/** Unit normal of BVH face f (outward for CCW glTF winding). */
function faceNormal(bvh: MeshBVH, f: number, out: Vector3): Vector3 {
  const g = bvh.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const i = (k: number): number => (idx ? idx.getX(3 * f + k) : 3 * f + k);
  _tri.set(
    _a.fromBufferAttribute(pos, i(0)),
    _b.fromBufferAttribute(pos, i(1)),
    _c.fromBufferAttribute(pos, i(2)),
  );
  return _tri.getNormal(out);
}

/** Fit the cross-section where segment `seg` (world positions) leaves the parent surface `bvh` (world). */
export function fitJunction(seg: BufferAttribute, bvh: MeshBVH, C = STUMPS): Junction | null {
  const hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const n = seg.count;
  const sd = new Float32Array(n).fill(Infinity); // signed distance to the parent surface (+ outside)
  const ring = new Vector3();
  let nr = 0;
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(seg, i);
    if (!bvh.closestPointToPoint(_v, hit, 0, C.band2M[1])) continue;
    const out = _w.subVectors(_v, hit.point).dot(faceNormal(bvh, hit.faceIndex, _c)) >= 0;
    sd[i] = out ? hit.distance : -hit.distance;
    if (hit.distance < C.ringTolM) {
      ring.add(_v);
      nr++;
    }
  }
  if (!nr) return null;
  ring.divideScalar(nr);
  const c = [new Vector3(), new Vector3()];
  const cnt = [0, 0];
  const band = new Uint8Array(n); // 0 = none, 1 / 2 = band index
  let d1 = 0;
  const inBand = (d: number, [lo, hi]: readonly [number, number]): boolean => d > lo && d <= hi;
  for (let i = 0; i < n; i++) {
    const d = sd[i] ?? Infinity;
    if (d === Infinity || _v.fromBufferAttribute(seg, i).distanceTo(ring) > C.reachM) continue;
    const b = inBand(d, C.band1M) ? 1 : inBand(d, C.band2M) ? 2 : 0;
    if (!b) continue;
    band[i] = b;
    c[b - 1]?.add(_v);
    cnt[b - 1] = (cnt[b - 1] ?? 0) + 1;
    if (b === 1) d1 += d;
  }
  const [n1 = 0, n2 = 0] = cnt;
  const [c1, c2] = c as [Vector3, Vector3];
  if (!n1 || !n2) return null;
  c1.divideScalar(n1);
  c2.divideScalar(n2);
  const axis = new Vector3().subVectors(c2, c1).normalize();
  let r = 0;
  for (let i = 0; i < n; i++) {
    if (!band[i]) continue;
    _w.fromBufferAttribute(seg, i).sub(c1);
    r += _w.addScaledVector(axis, -_w.dot(axis)).length();
  }
  r /= n1 + n2;
  // Base: back along the axis from the band-1 centroid to the parent surface (fallback: mean band-1 distance).
  const back = bvh.raycastFirst(new Ray(c1, axis.clone().negate()), DoubleSide);
  const base = back ? back.point.clone() : c1.clone().addScaledVector(axis, -d1 / n1);
  return { base, axis, radius: r };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Stump in world space: group 0 = tissue (tube + pinched end + dome; open base buried in the parent), group 1 =
 *  staples (two staggered rows on both flat faces), group 2 = one clip across the pinched end (clip division).
 *  Position + normal like the glb meshes, + `carrier` (tissue face normal on the metal, 0 on tissue) for the pulse. */
export function buildStumpGeometry(
  j: Junction,
  acrossRef: V3 = vec(STUMPS.acrossRef),
  C = STUMPS,
): BufferGeometry {
  const S = STAPLES_CONFIG;
  const r = j.radius;
  const Z = j.axis;
  const X = new Vector3(acrossRef.x, acrossRef.y, acrossRef.z).addScaledVector(Z, -Z.dot(acrossRef));
  if (X.lengthSq() < 1e-12) X.set(Z.y, -Z.x, 0); // ref ∥ axis: any perpendicular
  if (X.lengthSq() < 1e-12) X.set(0, Z.z, -Z.y);
  X.normalize();
  const Y = new Vector3().crossVectors(Z, X);
  const flat = S.cutGap / 2 + S.rowGap * C.rows + C.flatMarginM;
  const ramp = r * C.rampR;
  const L = Math.max(r * C.lengthR, flat + ramp);
  const z0 = -r * C.embedR;
  const dome = r * C.pinch;
  const rings: [number, number, number, number][] = []; // z, half-width (X), half-thickness (Y), superellipse exp
  for (let k = 0; k <= C.tubeRings; k++) {
    const z = z0 + ((L - z0) * k) / C.tubeRings;
    const p = smooth(L - flat - ramp, L - flat, z);
    rings.push([z, r * (1 + (C.widen - 1) * p), r * (1 + (C.pinch - 1) * p), 2 + (C.flatExp - 2) * p]);
  }
  for (let k = 1; k < C.domeRings; k++) {
    const phi = ((k / C.domeRings) * Math.PI) / 2;
    rings.push([
      L + dome * Math.sin(phi),
      r * C.widen * Math.cos(phi),
      r * C.pinch * Math.cos(phi),
      C.flatExp,
    ]);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const car: number[] = [];
  const idx: number[] = [];
  const R = C.radial;
  const se = (c: number, e: number): number => Math.sign(c) * Math.abs(c) ** (2 / e); // flat faces when e > 2
  for (const [z, w, t, e] of rings)
    for (let u = 0; u < R; u++) {
      const th = (u / R) * 2 * Math.PI;
      _v.copy(j.base)
        .addScaledVector(Z, z)
        .addScaledVector(X, se(Math.cos(th), e) * w)
        .addScaledVector(Y, se(Math.sin(th), e) * t);
      pos.push(_v.x, _v.y, _v.z);
    }
  _v.copy(j.base).addScaledVector(Z, L + dome);
  pos.push(_v.x, _v.y, _v.z);
  const pole = rings.length * R;
  for (let k = 0; k + 1 < rings.length; k++)
    for (let u = 0; u < R; u++) {
      const a = k * R + u;
      const a1 = k * R + ((u + 1) % R);
      idx.push(a, a1, a1 + R, a, a1 + R, a + R);
    }
  const last = (rings.length - 1) * R;
  for (let u = 0; u < R; u++) idx.push(last + u, last + ((u + 1) % R), pole);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  for (const v of g.getAttribute('normal').array) nrm.push(v);
  for (let i = 0; i < pos.length; i++) car.push(0);
  const tissueIdx = idx.length;
  // Staples: same box as the action's staple lines, baked so they ride the morphs with the tissue.
  const box = new BoxGeometry(S.crown, S.wire, S.wire);
  const nm = new Matrix3();
  const span = 2 * r * C.widen * C.lineSpan;
  const perRow = Math.max(1, Math.floor(span / (S.crown * C.pitchK)));
  const pitch = span / (perRow + 0.5); // the odd rows' half-pitch stagger stays inside `span`
  const width = pitch * perRow;
  const cv = new Vector3(); // carrier of the part being added
  const add = (_i: number, m: Matrix4, b: BufferGeometry = box): void => {
    const o = pos.length / 3;
    const [p, n, bx] = [b.getAttribute('position'), b.getAttribute('normal'), b.index as BufferAttribute];
    nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _w.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(_w.x, _w.y, _w.z);
      _w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      nrm.push(_w.x, _w.y, _w.z);
      car.push(cv.x, cv.y, cv.z);
    }
    for (let i = 0; i < bx.count; i++) idx.push(o + bx.getX(i));
  };
  const end = new Vector3().copy(j.base).addScaledVector(Z, L);
  const back = Z.clone().negate();
  for (const side of [1, -1]) {
    cv.copy(Y).multiplyScalar(side);
    const face = end
      .clone()
      .addScaledVector(Y, side * (r * C.pinch + S.wire / 2 + C.liftM))
      .addScaledVector(X, -pitch / 4);
    lineMatrices(face, back, X, width, C.rows, perRow, add);
  }
  box.dispose();
  const staplesIdx = idx.length;
  // Clip: two flat legs over both faces (+ heel), across the flat stapled zone.
  const K = instrumentGeom.clip;
  const clipSpan = 2 * r * C.widen * STUMPS.clip.spanK;
  const leg = new BoxGeometry(clipSpan, K.clipThick, K.clipWidth);
  const at = (x: number, y: number): Matrix4 =>
    new Matrix4().makeBasis(X, Y, Z).setPosition(
      _v
        .copy(end)
        .addScaledVector(Z, -flat / 2)
        .addScaledVector(X, x)
        .addScaledVector(Y, y),
    );
  for (const side of [1, -1]) {
    cv.copy(Y).multiplyScalar(side);
    add(0, at(0, side * (r * C.pinch + K.clipThick / 2 + C.liftM)), leg);
  }
  if (STUMPS.clip.heel) {
    const heel = new BoxGeometry(K.clipThick, 2 * (r * C.pinch + K.clipThick), K.clipWidth);
    cv.copy(X);
    add(0, at(clipSpan / 2, 0), heel);
    heel.dispose();
  }
  leg.dispose();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('carrier', new BufferAttribute(new Float32Array(car), 3));
  g.setIndex(idx);
  g.addGroup(0, tissueIdx, 0);
  g.addGroup(tissueIdx, staplesIdx - tissueIdx, 1);
  g.addGroup(staplesIdx, idx.length - staplesIdx, 2);
  return g;
}

/** Skin `g` (world positions) to the parent: per vertex, the parent's morph deltas (position/normal, parent-local
 *  units) barycentrically interpolated at the nearest parent surface point (`bvh`: parent in world, same index). */
export function copyMorphDeltas(g: BufferGeometry, parent: BufferGeometry, bvh: MeshBVH): void {
  const hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const pos = g.getAttribute('position');
  const wpos = bvh.geometry.getAttribute('position');
  const idx = bvh.geometry.index;
  const bary = new Vector3();
  const src = parent.morphAttributes as Record<string, MorphList>;
  const dst = g.morphAttributes as Record<string, MorphList>;
  const keys = Object.keys(src);
  const out = keys.map((k) => (src[k] ?? []).map(() => new Float32Array(pos.count * 3)));
  for (let i = 0; i < pos.count; i++) {
    bvh.closestPointToPoint(_v.fromBufferAttribute(pos, i), hit);
    const f = hit.faceIndex;
    const t0 = idx ? idx.getX(3 * f) : 3 * f;
    const t1 = idx ? idx.getX(3 * f + 1) : 3 * f + 1;
    const t2 = idx ? idx.getX(3 * f + 2) : 3 * f + 2;
    _tri.set(
      _a.fromBufferAttribute(wpos, t0),
      _b.fromBufferAttribute(wpos, t1),
      _c.fromBufferAttribute(wpos, t2),
    );
    _tri.getBarycoord(hit.point, bary);
    keys.forEach((k, ki) =>
      (src[k] ?? []).forEach((attr, ti) => {
        const o = out[ki]?.[ti] as Float32Array;
        for (let c = 0; c < 3; c++)
          o[3 * i + c] =
            bary.x * attr.getComponent(t0, c) +
            bary.y * attr.getComponent(t1, c) +
            bary.z * attr.getComponent(t2, c);
      }),
    );
  }
  keys.forEach((k, ki) => (dst[k] = (out[ki] ?? []).map((a) => new BufferAttribute(a, 3))));
  g.morphTargetsRelative = parent.morphTargetsRelative;
}

/** A mesh's rest-pose (un-morphed) world positions, sharing its index. Load time. */
function worldGeometry(mesh: Mesh): BufferGeometry {
  const src = mesh.geometry.getAttribute('position');
  const a = new BufferAttribute(new Float32Array(src.count * 3), 3);
  for (let i = 0; i < src.count; i++) {
    _v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
    a.setXYZ(i, _v.x, _v.y, _v.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', a);
  if (mesh.geometry.index) g.setIndex(mesh.geometry.index);
  return g;
}

const vec = (v: readonly number[]): V3 => ({ x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 });

type Shape = typeof STUMPS;
/** Stump / cap reach beyond its base: tube length L + dome (same formula as buildStumpGeometry). */
export function stumpReach(r: number, C: Shape = STUMPS): number {
  const S = STAPLES_CONFIG;
  const flat = S.cutGap / 2 + S.rowGap * C.rows + C.flatMarginM;
  return Math.max(r * C.lengthR, flat + r * C.rampR) + r * C.pinch;
}
const CAP: Shape = { ...STUMPS, ...STUMPS.cap };
/** T875: a trunk too short for the full pair (e.g. the middle-lobe artery, 9 mm for 7 mm) gets a compact pair. */
const SHORT: Shape = { ...STUMPS, ...STUMPS.short };
const SHORT_CAP: Shape = { ...CAP, ...STUMPS.short, lengthR: STUMPS.short.capLengthR };

// ── T841 split (load time) ──
/** Edge-length (geodesic) distance of every vertex from `seeds`, over the position-welded mesh (glTF seams split
 *  vertices); unreachable = Infinity. */
export function geodesic(
  pos: BufferAttribute,
  index: ArrayLike<number> | null,
  seeds: readonly number[],
  weldM: number = STUMPS.split.weldM,
): Float64Array {
  const n = pos.count;
  const id = new Int32Array(n);
  const keyOf = new Map<string, number>();
  const rep: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) / weldM)},${Math.round(pos.getY(i) / weldM)},${Math.round(pos.getZ(i) / weldM)}`;
    let c = keyOf.get(k);
    if (c === undefined) {
      keyOf.set(k, (c = rep.length));
      rep.push(i);
    }
    id[i] = c;
  }
  const nbr: number[][] = rep.map(() => []);
  const vi = (t: number): number => id[index ? (index[t] as number) : t] as number;
  const tris = index ? index.length : n;
  for (let t = 0; t + 2 < tris; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = vi(t + e);
      const b = vi(t + ((e + 1) % 3));
      nbr[a]?.push(b);
      nbr[b]?.push(a);
    }
  // Dijkstra, binary heap with lazy deletion.
  const d = new Float64Array(rep.length).fill(Infinity);
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (k: number, v: number): void => {
    let i = hk.length;
    hk.push(k);
    hv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((hk[p] as number) <= k) break;
      hk[i] = hk[p] as number;
      hv[i] = hv[p] as number;
      i = p;
    }
    hk[i] = k;
    hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0] as number;
    const k = hk.pop() as number;
    const v = hv.pop() as number;
    if (hk.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hk.length) break;
        if (c + 1 < hk.length && (hk[c + 1] as number) < (hk[c] as number)) c++;
        if ((hk[c] as number) >= k) break;
        hk[i] = hk[c] as number;
        hv[i] = hv[c] as number;
        i = c;
      }
      hk[i] = k;
      hv[i] = v;
    }
    return top;
  };
  for (const sd of seeds) {
    const c = id[sd] as number;
    if (d[c] !== 0) push((d[c] = 0), c);
  }
  while (hk.length) {
    const k = hk[0] as number;
    const u = pop();
    if (k > (d[u] as number)) continue;
    _a.fromBufferAttribute(pos, rep[u] as number);
    for (const v of nbr[u] ?? []) {
      const w = k + _a.distanceTo(_b.fromBufferAttribute(pos, rep[v] as number));
      if (w < (d[v] as number)) push((d[v] = w), v);
    }
  }
  return Float64Array.from(id, (c) => d[c] as number);
}

export interface CutPlan {
  dist: Float64Array;
  dCut: number;
  dSplit: number;
  /** Rest-pose ring at the split (distal open end) → the cap junction (axis toward the proximal side). */
  cap: Junction;
  /** Vertices on the cut ring and ± one band either side (live cut point / axis at the current pose). */
  ring: number[];
  ringP: number[];
  ringD: number[];
}

/** Where to cut a segment (world rest positions): at the vertex nearest `at` (in `posed` positions) or half way,
 *  ≥ `minCut` from the junction, leaving the distal piece ≥ minDistalM; the split sits one cap reach beyond the cut
 *  so the cap's dome ends at the cut. `r0` = radius guess (the junction fit). */
export function planCut(
  pos: BufferAttribute,
  index: ArrayLike<number> | null,
  seeds: readonly number[],
  minCut: number,
  r0: number,
  at: Vector3 | null = null,
  posed: BufferAttribute | null = null,
  capShape: Shape = CAP,
  quiet = false,
): CutPlan | null {
  const P = STUMPS.split;
  const fail = (why: string): null => {
    if (!quiet) console.warn(`[stumps] no cut plan: ${why}`);
    return null;
  };
  const dist = geodesic(pos, index, seeds);
  let maxD = 0;
  for (const d of dist) if (d !== Infinity && d > maxD) maxD = d;
  let dCut = maxD / 2;
  if (at && posed) {
    let best = Infinity;
    for (let i = 0; i < posed.count; i++) {
      const e = _v.fromBufferAttribute(posed, i).distanceToSquared(at);
      if (e < best && (dist[i] as number) < Infinity) [best, dCut] = [e, dist[i] as number];
    }
  }
  const band = (d0: number, hw: number, c: Vector3, list?: number[]): boolean => {
    c.set(0, 0, 0);
    let k = 0;
    for (let i = 0; i < pos.count; i++)
      if (Math.abs((dist[i] as number) - d0) < hw) {
        c.add(_w.fromBufferAttribute(pos, i));
        list?.push(i);
        k++;
      }
    if (k) c.divideScalar(k);
    return k > 0;
  };
  const ringAt = (d0: number, r: number): Junction | null => {
    const hw = r * P.bandR;
    const list: number[] = [];
    const base = new Vector3();
    const axis = new Vector3();
    if (!band(d0, hw, base, list) || !band(d0 - r * P.axisR, hw, axis) || !band(d0 + r * P.axisR, hw, _c))
      return null;
    _w.subVectors(axis, _c); // toward the proximal side (smaller distance)
    // Axis = principal direction of the tube around the ring (iso-distance rings can lean on a curved segment).
    if (!localAxis(pos, base, Math.max(STUMPS.pcaRadiusM, STUMPS.pcaRadiusR * r), _v, axis)) axis.copy(_w);
    if (axis.dot(_w) < 0) axis.negate();
    axis.normalize();
    let radius = 0;
    for (const i of list) {
      _w.fromBufferAttribute(pos, i).sub(base);
      radius += _w.addScaledVector(axis, -_w.dot(axis)).length();
    }
    return { base, axis, radius: radius / list.length };
  };
  // Cut range for a structure of radius r: the stump + margin before it, the cap + minDistal after it; a short
  // segment gives up the margin and the spare distal length first.
  const range = (r: number): [number, number, number] | null => {
    const reach = stumpReach(r * STUMPS.cap.radiusK, capShape);
    const hi = maxD - P.minDistalM - reach;
    if (hi >= minCut) return [minCut, hi, reach];
    const [lo2, hi2] = [minCut - P.marginM, maxD - reach];
    return hi2 >= lo2 ? [lo2, hi2, reach] : null;
  };
  const r0Range = range(r0);
  if (!r0Range)
    return fail(`too short: ${(maxD * 1000).toFixed(1)} mm for a ${(r0 * 2000).toFixed(1)} mm structure`);
  dCut = Math.min(r0Range[1], Math.max(r0Range[0], dCut));
  const cut = ringAt(dCut, r0);
  const r = (cut && ringAt(dCut, cut.radius)?.radius) ?? cut?.radius ?? 0;
  if (!r) return fail(`no ring at ${(dCut * 1000).toFixed(1)} of ${(maxD * 1000).toFixed(1)} mm`);
  const rr = range(r);
  if (!rr)
    return fail(`too short: ${(maxD * 1000).toFixed(1)} mm for a ${(r * 2000).toFixed(1)} mm structure`);
  const [lo, hi, reach] = rr;
  dCut = Math.min(hi, Math.max(lo, dCut));
  const dSplit = dCut + reach;
  // T875: near the end of a short trunk the distal axis band runs off the segment: the cut ring's axis then serves.
  let cap = ringAt(dSplit, r);
  if (!cap && cut) {
    const base = new Vector3();
    if (band(dSplit, r * P.bandR, base)) cap = { base, axis: cut.axis.clone(), radius: r };
  }
  if (!cap) return fail('no ring at the split');
  cap.radius = r * STUMPS.cap.radiusK;
  const ring: number[] = [];
  const ringP: number[] = [];
  const ringD: number[] = [];
  band(dCut, r * P.bandR, _c, ring);
  band(dCut - r * P.axisR, r * P.bandR, _c, ringP);
  band(dCut + r * P.axisR, r * P.bandR, _c, ringD);
  return { dist, dCut, dSplit, cap, ring, ringP, ringD };
}

/** Copy of `g` with only the triangles `keep` accepts: every attribute + morph attribute, re-indexed. Load time. */
export function subsetGeometry(
  g: BufferGeometry,
  keep: (a: number, b: number, c: number) => boolean,
): BufferGeometry {
  const n = g.getAttribute('position').count;
  const idx = g.index;
  const vi = (t: number): number => (idx ? idx.getX(t) : t);
  const map = new Int32Array(n).fill(-1);
  const order: number[] = [];
  const out: number[] = [];
  for (let t = 0; t + 2 < (idx ? idx.count : n); t += 3) {
    const [a, b, c] = [vi(t), vi(t + 1), vi(t + 2)];
    if (!keep(a, b, c)) continue;
    for (const v of [a, b, c]) {
      if ((map[v] as number) < 0) {
        map[v] = order.length;
        order.push(v);
      }
      out.push(map[v] as number);
    }
  }
  const copy = (attr: BufferAttribute | InterleavedBufferAttribute): BufferAttribute => {
    const k = attr.itemSize;
    const arr = new Float32Array(order.length * k);
    order.forEach((v, i) => {
      for (let c = 0; c < k; c++) arr[i * k + c] = attr.getComponent(v, c);
    });
    return new BufferAttribute(arr, k);
  };
  const o = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) o.setAttribute(name, copy(attr));
  for (const [name, list] of Object.entries(g.morphAttributes as Record<string, MorphList>))
    (o.morphAttributes as Record<string, MorphList>)[name] = list.map(copy);
  o.morphTargetsRelative = g.morphTargetsRelative;
  o.setIndex(out);
  return o;
}

// ── Titanium that rides the heartbeat pulse: staples / clips carry their tissue face normal (`carrier`) ──
const beat = { value: 0 };
/** Per frame (uniform write only): state.heartbeat, as the tissue programs get it (materials.ts setHeartbeat). */
export function setStumpHeartbeat(v: number): void {
  beat.value = v;
}
const PULSE_VERTEX = `attribute vec3 carrier;
uniform float uMetalPulse;
uniform float uMetalBeat;
void main() {`;
function pulsingMetal(pulseM: number, name: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ ...STAPLES_CONFIG.look, envMap: getInstrumentEnv(), name }); // T884 neutral env
  const amp = { value: pulseM };
  m.onBeforeCompile = (p: WebGLProgramParametersWithUniforms): void => {
    p.uniforms.uMetalPulse = amp;
    p.uniforms.uMetalBeat = beat;
    p.vertexShader = p.vertexShader
      .replace('void main() {', PULSE_VERTEX)
      .replace(
        '#include <project_vertex>',
        'transformed += carrier * ( uMetalPulse * uMetalBeat );\n#include <project_vertex>',
      );
  };
  m.customProgramCacheKey = () => 'stumps:titanium-pulse';
  return m;
}
/** Group material that draws nothing (three skips invisible group materials; never compiled). */
const NONE = new MeshBasicMaterial({ visible: false, name: 'stumps:none' });

export type DivideMode = 'staple' | 'clip';
export interface Stump {
  segment: Mesh;
  parent: Mesh;
  mesh: Mesh;
  mats: Material[]; // [parent's current material, staples, clip]
  metal: Material;
}
export interface Split {
  /** Logical mesh: picking, visibility, material variants; drawn on STUMPS.split.layer (no camera renders it). */
  segment: Mesh;
  proximal: Mesh;
  distal: Mesh;
  /** Distal stump cap (child of `distal`): pinched end + staples / clip, shown once divided. */
  cap: Mesh;
  capMats: Material[];
  metal: Material;
  stump: Stump | null;
  parent: Split | null;
  top: Object3D;
  lobe: Object3D | null;
  /** T872b specimen carrier (retrievalBag): the distal piece lives in it; a carried branch's proximal one joins it. */
  carrier: Object3D | null;
  ring: readonly number[];
  ringP: readonly number[];
  ringD: readonly number[];
  /** Vertices within patchR of the rest cut centre: the live cut axis = their principal direction. */
  patch: readonly number[];
  patchR: number;
  radius: number;
  cut: DivideMode | null;
  divided: boolean;
  carried: boolean;
  /** Its pieces ride the heartbeat: false once divided / carried (the specimen side is off the circulation). */
  pulsing: boolean;
  /** T886 short-trunk pair: once divided, its specimen side (distal piece + cap + the branches it carries) shifts
   *  this far (parent-local) away from the stump, so the cut reads as two stapled ends; null = no shift. */
  retract: Vector3 | null;
  /** Shift applied to this split's pieces now (its own retract when divided, else its carrying ancestor's). */
  shift: Vector3 | null;
  /** Shared by proximal / distal / cap; copied per frame from `src[k]` influence `srcI[k]` into slot `dstI[k]`. */
  inf: number[];
  src: Mesh[];
  srcI: number[];
  dstI: number[];
}
export interface Stumps {
  readonly list: readonly Stump[];
  readonly splits: readonly Split[];
  split(name: string): Split | undefined;
  /** `name` hangs (directly or further down) on segment `ancestor`; undefined if `name` has no split. */
  isBranchOf(name: string, ancestor: string): boolean | undefined;
  /** Live cut point + unit axis (toward the proximal side) at the current morph pose; the radius, 0 = no split. */
  cutAt(name: string, outPoint: Vector3, outAxis: Vector3): number;
  /** Explicit division (stapler fire / second clip): stumps + cap show the staples or the clip. */
  divide(name: string, mode: DivideMode): boolean;
  /** New run: no explicit cuts (guided steps still divide what their visibility hides). */
  reset(): void;
  /** Per frame: piece / stump / cap visibility, material refs, piece morph influences (dirty writes only). */
  sync(): void;
}

let current: Stumps | null = null;
/** The stumps built at load (null before). */
export const getStumps = (): Stumps | null => current;

const shownChain = (o: Object3D | null): boolean => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};
const _fm = new Matrix4();
/** `src`'s matrix, translated by `shift` (parent-local; null = none); written only when it changed. */
const followMatrix = (m: Object3D, src: Object3D, shift: Vector3 | null = null): void => {
  _fm.copy(src.matrix);
  if (shift) {
    const e = _fm.elements;
    e[12] = (e[12] as number) + shift.x;
    e[13] = (e[13] as number) + shift.y;
    e[14] = (e[14] as number) + shift.z;
  }
  if (m.matrix.equals(_fm)) return;
  m.matrix.copy(_fm);
  m.matrixWorldNeedsUpdate = true;
};
const setMode = (mats: Material[], metal: Material, mode: DivideMode): void => {
  mats[1] = mode === 'staple' ? metal : NONE;
  mats[2] = mode === 'clip' ? metal : NONE;
};
/** Rest-pose positions + Σ pose influence × morph delta (world). Load time. */
function posedWorld(mesh: Mesh, pose: Readonly<Record<string, number>>): BufferAttribute {
  const g = mesh.geometry;
  const src = g.getAttribute('position');
  const out = new BufferAttribute(new Float32Array(src.count * 3), 3);
  const morphs = (g.morphAttributes.position ?? []) as MorphList;
  const dict = mesh.morphTargetDictionary ?? {};
  for (let i = 0; i < src.count; i++) {
    _v.fromBufferAttribute(src, i);
    for (const [k, w] of Object.entries(pose)) {
      const m = dict[k] === undefined ? undefined : morphs[dict[k]];
      if (m && g.morphTargetsRelative) _v.addScaledVector(_w.fromBufferAttribute(m, i), w);
    }
    _v.applyMatrix4(mesh.matrixWorld);
    out.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return out;
}

/** Load time, after applyMaterials and picking, before the compile stage (titanium + morph programs compile there). */
export function buildStumps(
  root: Object3D,
  isDivided: (segment: Mesh) => boolean = (s) => !s.visible,
): Stumps {
  root.updateMatrixWorld(true);
  const st = structures as Manifest;
  const bvhs = new Map<Mesh, MeshBVH>();
  const inv = new Matrix4();
  const list: Stump[] = [];
  const splits: Split[] = [];
  const byName = new Map<string, Split>();
  const hit: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const pairs = stumpPairs();
  const parentOf = new Map(pairs);
  // T890 (critic r2 C3): each staple line runs ⟂ the view from STUMPS.faceEye (X = view × axis), so the stapled faces
  // and their rows face the lens instead of showing their edge; no eye node: the fixed acrossRef.
  const eye = root.getObjectByName(STUMPS.faceEye)?.getWorldPosition(new Vector3()) ?? null;
  const across = (j: Junction): V3 =>
    eye ? new Vector3().subVectors(eye, j.base).cross(j.axis) : vec(STUMPS.acrossRef);
  for (const [segName, parentName] of pairs) {
    const segment = root.getObjectByName(segName) as Mesh | undefined;
    const parent = root.getObjectByName(parentName) as Mesh | undefined;
    if (!segment?.isMesh || !parent?.isMesh || Array.isArray(parent.material)) continue;
    let bvh = bvhs.get(parent);
    if (!bvh) bvhs.set(parent, (bvh = new MeshBVH(worldGeometry(parent))));
    const wg = worldGeometry(segment);
    const seg = wg.getAttribute('position') as BufferAttribute;
    const j = fitJunction(seg, bvh);
    if (!j) {
      console.warn(`[stumps] no junction found: ${segName} → ${parentName}`);
      continue;
    }
    // T841: where the segment splits into proximal + distal pieces (planned first: a short trunk gets the compact
    // stump shapes, the T834 stump included).
    const seeds: number[] = [];
    // Seeds: the junction cross-section (on / inside the parent, not past the junction base along the branch), so
    // distances grow along the branch even where it runs against the parent for a while.
    for (let i = 0; i < seg.count; i++) {
      _v.fromBufferAttribute(seg, i);
      const behind = _w.subVectors(_v, j.base).dot(j.axis) <= 0 && _w.length() < STUMPS.reachM;
      if (behind || (bvh.closestPointToPoint(_v, hit, 0, STUMPS.ringTolM) && _w.dot(j.axis) <= j.radius))
        seeds.push(i);
    }
    const t = TARGET_BY_ID.get(segName)?.point;
    const idx = wg.index ? (wg.index.array as ArrayLike<number>) : null;
    const splittable = !Array.isArray(segment.material) && segment.parent !== null;
    const plan1 = (shape: Shape, cap: Shape, quiet: boolean): CutPlan | null =>
      planCut(
        seg,
        idx,
        seeds,
        stumpReach(j.radius, shape) + STUMPS.split.marginM,
        j.radius,
        t ? new Vector3(...t) : null,
        t ? posedWorld(segment, STUMPS.split.pose) : null,
        cap,
        quiet,
      );
    let shape = STUMPS;
    let capShape = CAP;
    let plan = splittable ? plan1(STUMPS, CAP, true) : null;
    if (splittable && !plan) {
      [shape, capShape] = [SHORT, SHORT_CAP];
      plan = plan1(SHORT, SHORT_CAP, false);
    }
    const g = buildStumpGeometry(j, across(j), shape);
    copyMorphDeltas(g, parent.geometry, bvh);
    g.applyMatrix4(inv.copy(parent.matrixWorld).invert());
    const metal = pulsingMetal(
      ((PULSE[parentName] ?? 0) * look.pulse.amplitudeM) / parent.matrixWorld.getMaxScaleOnAxis(),
      'stumps:titanium',
    );
    const mats: Material[] = [parent.material, metal, NONE];
    const mesh = new Mesh(g, mats);
    mesh.name = `stump_${segName}`;
    // Same morph names/order as the parent → share its influences: the morph controller drives both.
    mesh.morphTargetDictionary = parent.morphTargetDictionary;
    mesh.morphTargetInfluences = parent.morphTargetInfluences;
    mesh.visible = false;
    parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    const stump: Stump = { segment, parent, mesh, mats, metal };
    list.push(stump);

    if (!splittable || Array.isArray(segment.material)) continue;
    if (!plan) {
      console.warn(`[stumps] ${segName} stays whole (no split)`);
      continue;
    }
    const D = plan.dist;
    const meanD = (a: number, b: number, c: number): number =>
      ((D[a] as number) + (D[b] as number) + (D[c] as number)) / 3;
    const pieces = [
      subsetGeometry(segment.geometry, (a, b, c) => meanD(a, b, c) < plan.dSplit),
      subsetGeometry(segment.geometry, (a, b, c) => !(meanD(a, b, c) < plan.dSplit)),
    ];
    const inf = [...(segment.morphTargetInfluences ?? [])];
    const [proximal, distal] = pieces.map((pg, k) => {
      const m = new Mesh(pg, segment.material);
      m.name = `${segName}_${k ? 'distal' : 'proximal'}`;
      m.morphTargetDictionary = segment.morphTargetDictionary;
      m.morphTargetInfluences = inf;
      m.matrix.copy(segment.matrix);
      m.matrixAutoUpdate = false;
      m.renderOrder = segment.renderOrder;
      segment.parent?.add(m);
      return m;
    }) as [Mesh, Mesh];
    const segBvh = new MeshBVH(wg);
    const cg = buildStumpGeometry(plan.cap, across(plan.cap), capShape);
    copyMorphDeltas(cg, segment.geometry, segBvh);
    cg.applyMatrix4(inv.copy(segment.matrixWorld).invert());
    const capMetal = pulsingMetal(0, 'stumps:titanium'); // shown once divided = off the body: no pulse
    const capMats: Material[] = [segment.material, capMetal, NONE];
    const cap = new Mesh(cg, capMats);
    cap.name = `stump_cap_${segName}`;
    cap.morphTargetDictionary = segment.morphTargetDictionary;
    cap.morphTargetInfluences = inf;
    cap.visible = false;
    distal.add(cap);
    cap.matrixAutoUpdate = false;
    segment.layers.set(STUMPS.split.layer); // the pieces draw it from now on
    // Piece influences follow the undivided tree's (always shown with its group), else the segment's own.
    let topName = parentName;
    while (parentOf.has(topName)) topName = parentOf.get(topName) as string;
    const top = (root.getObjectByName(topName) as Mesh | undefined) ?? parent;
    const src: Mesh[] = [];
    const srcI: number[] = [];
    const dstI: number[] = [];
    for (const [k, di] of Object.entries(segment.morphTargetDictionary ?? {})) {
      const ti = top.morphTargetDictionary?.[k];
      src.push(ti === undefined ? segment : top);
      srcI.push(ti ?? di);
      dstI.push(di);
    }
    const lobeKey = st[segName]?.lobe;
    const lobeName = Object.keys(st).find((n) => st[n]?.lobe === lobeKey && st[n]?.divideStep === undefined);
    const patchR = Math.max(STUMPS.pcaRadiusM, (STUMPS.pcaRadiusR * plan.cap.radius) / STUMPS.cap.radiusK);
    const ringC = plan.ring.reduce((c, i) => c.add(_w.fromBufferAttribute(seg, i)), new Vector3());
    ringC.divideScalar(Math.max(1, plan.ring.length));
    const patch: number[] = [];
    for (let i = 0; i < seg.count; i++)
      if (_w.fromBufferAttribute(seg, i).distanceTo(ringC) < patchR * STUMPS.split.patchSlack) patch.push(i);
    const sp: Split = {
      segment,
      proximal,
      distal,
      cap,
      capMats,
      metal: capMetal,
      stump,
      parent: byName.get(parentName) ?? null,
      top,
      lobe: lobeName ? (root.getObjectByName(lobeName) ?? null) : null,
      carrier: null,
      ring: plan.ring,
      ringP: plan.ringP,
      ringD: plan.ringD,
      patch,
      patchR,
      radius: plan.cap.radius / STUMPS.cap.radiusK,
      cut: null,
      divided: false,
      carried: false,
      pulsing: true,
      retract: null,
      shift: null,
      inf,
      src,
      srcI,
      dstI,
    };
    // T886: a short trunk's cut ends sit ≈ 1 mm apart; its specimen side shifts back along the cut axis once divided.
    if (shape === SHORT && segment.parent) {
      inv.copy(segment.parent.matrixWorld).invert();
      const p0 = plan.cap.base.clone().applyMatrix4(inv);
      sp.retract = plan.cap.base
        .clone()
        .addScaledVector(plan.cap.axis, -STUMPS.short.retractM) // the axis points to the proximal side
        .applyMatrix4(inv)
        .sub(p0);
    }
    splits.push(sp);
    byName.set(segName, sp);
    // T872b: the distal piece (+ its staple cap) stays on the specimen: it leaves with the lobe in the bag.
    if (sp.lobe && distal.parent) (sp.carrier = specimenCarrier(distal.parent, sp.lobe.name)).add(distal);
  }
  const centroid = (s: Split, ids: readonly number[], out: Vector3): Vector3 => {
    out.set(0, 0, 0);
    for (const i of ids) out.add(s.segment.getVertexPosition(i, _w).applyMatrix4(s.segment.matrixWorld));
    return out.divideScalar(Math.max(1, ids.length));
  };
  const stumps: Stumps = {
    list,
    splits,
    split: (name) => byName.get(name),
    isBranchOf(name, ancestor) {
      let s = byName.get(name);
      if (!s) return undefined;
      for (s = s.parent ?? undefined; s; s = s.parent ?? undefined)
        if (s.segment.name === ancestor) return true;
      return false;
    },
    cutAt(name, outPoint, outAxis) {
      const s = byName.get(name);
      if (!s) return 0;
      centroid(s, s.ring, outPoint);
      centroid(s, s.ringP, _b).sub(centroid(s, s.ringD, _a)); // proximal sense
      if (!localAxis(s.segment, outPoint, s.patchR, _c, outAxis, s.patch)) outAxis.copy(_b);
      if (outAxis.dot(_b) < 0) outAxis.negate();
      outAxis.normalize();
      return s.radius;
    },
    divide(name, mode) {
      const s = byName.get(name);
      if (!s) return false;
      s.cut = mode;
      setMode(s.capMats, s.metal, mode);
      if (s.stump) setMode(s.stump.mats, s.stump.metal, mode);
      return true;
    },
    reset() {
      for (const s of splits) {
        s.cut = null;
        setMode(s.capMats, s.metal, 'staple');
        if (s.stump) setMode(s.stump.mats, s.stump.metal, 'staple');
      }
    },
    sync() {
      for (let k = 0; k < list.length; k++) {
        const s = list[k] as Stump;
        const sp = byName.get(s.segment.name);
        s.mesh.visible = sp ? sp.divided : isDivided(s.segment);
        if (s.mesh.visible) s.mats[0] = s.parent.material as Material; // follows X-ray / opacity variant swaps
      }
    },
  };
  // Splits run parents first (manifest order: a common segment before its branches) → `carried` is ready.
  const syncSplits = (): void => {
    for (let k = 0; k < splits.length; k++) {
      const s = splits[k] as Split;
      const segV = s.segment.visible;
      const topV = shownChain(s.top);
      const anc = s.parent;
      s.carried = anc !== null && (anc.divided || anc.carried);
      s.divided = !s.carried && (s.cut !== null || (!segV && topV));
      s.shift = s.divided ? s.retract : s.carried ? (anc?.shift ?? null) : null;
      // After the cut the segment's material only draws specimen-side pieces (the stump uses the parent's).
      if (s.pulsing === (s.divided || s.carried)) setPulseOn(s.segment, (s.pulsing = !s.pulsing));
      const specimen = topV && (s.lobe ? s.lobe.visible : true);
      s.proximal.visible = s.carried ? specimen : segV && !s.divided;
      const home = s.carried && s.carrier ? s.carrier : s.segment.parent; // a carried branch leaves with the lobe
      if (home && s.proximal.parent !== home) home.add(s.proximal);
      s.distal.visible = s.carried || s.divided ? specimen : segV;
      s.cap.visible = s.divided;
      if (!s.proximal.visible && !s.distal.visible) continue;
      // The logical node's matrix can change (T840 clamp squeeze): the pieces follow (rare write).
      followMatrix(s.proximal, s.segment, s.carried ? s.shift : null);
      followMatrix(s.distal, s.segment, s.shift);
      const mat = s.segment.material as Material;
      s.proximal.material = mat;
      s.distal.material = mat;
      s.capMats[0] = mat;
      const inf = s.inf;
      for (let i = 0; i < s.dstI.length; i++) {
        const v = (s.src[i] as Mesh).morphTargetInfluences?.[s.srcI[i] as number] ?? 0;
        const d = s.dstI[i] as number;
        if (inf[d] !== v) inf[d] = v;
      }
    }
  };
  const syncStumps = stumps.sync;
  stumps.sync = () => {
    syncSplits();
    syncStumps();
  };
  current = stumps;
  return stumps;
}
