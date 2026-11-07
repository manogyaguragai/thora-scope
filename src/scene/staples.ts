// Staple-line caps + titanium clips (CONTEXT §6.4) and the division-plane write. Built ONCE at load (§6.10):
// two InstancedMeshes with fixed capacity sharing one material; placement = setMatrixAt only (ring buffer, the
// oldest line/clip is reused when full). Division mutates the mesh's preallocated planes (materials.ts
// getDivisionPlanes) — the plane count never changes, so no shader recompiles at fire time.
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import type { BufferAttribute, Mesh, Plane } from 'three';
import { config } from '../core/config';
import { instrumentGeom } from './instruments.config';
import { getInstrumentEnv } from './lights';
import { STUMPS } from './stumps.config';

export const STAPLES_CONFIG = config.staples; // values in src/core/config.ts

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const _n = new Vector3();
const _a = new Vector3();
const _l = new Vector3();
const _p = new Vector3();
const _m = new Matrix4();
const PARK_NORMAL = new Vector3(0, 0, 1); // same parked state as materials.ts

/** Set division plane `slot` of a mesh (from getDivisionPlanes) so only the side `normal` points to is kept,
 *  `cutGap/2` beyond `point`. Mutates values only. False if the slot doesn't exist. */
export function setDivisionPlane(planes: readonly Plane[], point: V3, normal: V3, slot = 0): boolean {
  const plane = planes[slot];
  if (!plane) return false;
  _n.set(normal.x, normal.y, normal.z).normalize();
  plane.setFromNormalAndCoplanarPoint(_n, _p.set(point.x, point.y, point.z));
  plane.constant -= STAPLES_CONFIG.cutGap / 2;
  return true;
}

/** Park every division plane of a mesh (clips nothing) — new practice run. */
export function parkDivisionPlanes(planes: readonly Plane[]): void {
  for (const p of planes) p.set(PARK_NORMAL, config.clipping.parkConstant);
}

/** Orthonormal basis: `across` made ⟂ `axis` (fallback: any ⟂). Writes _n (axis), _a (across), _l (axis × across). */
function basis(axis: V3, across: V3): void {
  _n.set(axis.x, axis.y, axis.z).normalize();
  _a.set(across.x, across.y, across.z);
  _a.addScaledVector(_n, -_a.dot(_n));
  if (_a.lengthSq() < 1e-12) _a.set(1, 0, 0).addScaledVector(_n, -_n.x);
  if (_a.lengthSq() < 1e-12) _a.set(0, 1, 0).addScaledVector(_n, -_n.y);
  _a.normalize();
  _l.crossVectors(_n, _a);
}

/** Staggered staple line: `rows` × `perRow` staple matrices (box x = along the line, z = `normal`), rows on the
 *  `normal` side of `point` starting cutGap/2 beyond it, spanning `width` along `across`. set(i, m) reuses `m`. */
export function lineMatrices(
  point: V3,
  normal: V3,
  across: V3,
  width: number,
  rows: number,
  perRow: number,
  set: (i: number, m: Matrix4) => void,
): void {
  const C = STAPLES_CONFIG;
  basis(normal, across);
  const pitch = width / perRow;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const along = C.cutGap / 2 + C.rowGap * (r + 0.5);
    const stagger = (r % 2) * 0.5;
    for (let s = 0; s < perRow; s++) {
      const off = (s + 0.5 + stagger - perRow / 2) * pitch;
      _p.set(point.x, point.y, point.z).addScaledVector(_n, along).addScaledVector(_a, off);
      set(i++, _m.makeBasis(_a, _l, _n).setPosition(_p));
    }
  }
}

const ZERO = new Matrix4().makeScale(0, 0, 0); // an unformed staple: no area, nothing drawn
const _neg = { x: 0, y: 0, z: 0 };

/** T841: centroid + principal axis (unit) of the vertices within `radius` of world `at`: a mesh at its current morph
 *  pose (getVertexPosition), or world positions. `ids` limits the scan to those vertices (per-frame safe: no
 *  allocation). False if fewer than 3 vertices are that close. */
export function localAxis(
  src: Mesh | BufferAttribute,
  at: V3,
  radius: number,
  outCentre: Vector3,
  outAxis: Vector3,
  ids?: readonly number[],
): boolean {
  const mesh = (src as Mesh).isMesh ? (src as Mesh) : null;
  const pos = mesh ? mesh.geometry.getAttribute('position') : (src as BufferAttribute);
  const r2 = radius * radius;
  let n = 0;
  outCentre.set(0, 0, 0);
  let xx = 0; // raw second moments
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  _a.set(at.x, at.y, at.z);
  const count = ids ? ids.length : pos.count;
  for (let k = 0; k < count; k++) {
    const i = ids ? (ids[k] as number) : k;
    if (mesh) mesh.getVertexPosition(i, _p).applyMatrix4(mesh.matrixWorld);
    else _p.fromBufferAttribute(pos, i);
    if (_p.distanceToSquared(_a) > r2) continue;
    n++;
    outCentre.add(_p);
    xx += _p.x * _p.x;
    xy += _p.x * _p.y;
    xz += _p.x * _p.z;
    yy += _p.y * _p.y;
    yz += _p.y * _p.z;
    zz += _p.z * _p.z;
  }
  if (n < 3) return false;
  const m = outCentre.divideScalar(n);
  const a = xx / n - m.x * m.x;
  const b = xy / n - m.x * m.y;
  const d = xz / n - m.x * m.z;
  const e = yy / n - m.y * m.y;
  const f = yz / n - m.y * m.z;
  const g = zz / n - m.z * m.z;
  // Power iteration on the covariance, from its largest column (never ⟂ the principal axis).
  if (a >= e && a >= g) outAxis.set(a, b, d);
  else if (e >= g) outAxis.set(b, e, f);
  else outAxis.set(d, f, g);
  if (outAxis.lengthSq() < 1e-30) return false;
  outAxis.normalize();
  for (let k = 0; k < STUMPS.pcaIterations; k++) {
    const { x, y, z } = outAxis;
    outAxis.set(a * x + b * y + d * z, b * x + e * y + f * z, d * x + f * y + g * z);
    if (outAxis.lengthSq() < 1e-30) return false;
    outAxis.normalize();
  }
  return true;
}

export class Staples {
  /** scene.add(group) + registerWarmupObject(group) once at load. */
  readonly group = new Group();
  readonly staples: InstancedMesh;
  readonly clips: InstancedMesh;
  /** Staples per side of the knife line; a line slot holds both sides (one-sided lines leave the second empty). */
  readonly perSide = STAPLES_CONFIG.rows * STAPLES_CONFIG.perRow;
  readonly perLine = 2 * this.perSide;
  /** T841: staples of the current line formed so far (progressive firing). */
  revealed = 0;
  private lines = 0;
  private clipCount = 0;
  private base = 0;
  private sides = 1;
  private readonly stash = new Float32Array(this.perLine * 16);
  private readonly shown = new Uint8Array(this.perLine);
  private readonly order = new Float32Array(this.perLine); // heel → tip position of each staple, 0 … 1
  /** T884: optional per-staple placement fix applied as a line is laid out (fissure rows snap onto the lobe
   *  surface); null = the straight line. Called at fire time only. */
  snap: ((m: Matrix4) => void) | null = null;
  private readonly stashAt =
    (k: number) =>
    (i: number, m: Matrix4): void => {
      this.snap?.(m);
      m.toArray(this.stash, (k + i) * 16);
    };
  private readonly side0 = this.stashAt(0);
  private readonly side1 = this.stashAt(this.perSide);

  constructor() {
    const C = STAPLES_CONFIG;
    const G = instrumentGeom.clip;
    // T884: the instruments' neutral env (the cavity env made the titanium read maroon); set at load, never toggled.
    const mat = new MeshStandardMaterial({ ...C.look, envMap: getInstrumentEnv(), name: 'staples:titanium' });
    // Local frame for both: x = along the line / across the vessel, y = legs, z = stump axis.
    this.staples = new InstancedMesh(
      new BoxGeometry(C.crown, C.wire, C.wire),
      mat,
      C.maxLines * this.perLine,
    );
    this.clips = new InstancedMesh(new BoxGeometry(G.clipLength, G.clipThick, G.clipWidth), mat, C.maxClips);
    for (const m of [this.staples, this.clips]) {
      m.name = m === this.staples ? 'staple_lines' : 'clips';
      m.count = 0;
      m.visible = false; // warm-up forces it visible for compilation
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    this.group.matrixAutoUpdate = false;
    for (let i = 0; i < this.perLine; i++) {
      const r = Math.floor((i % this.perSide) / C.perRow);
      this.order[i] = ((i % C.perRow) + 0.5 + (r % 2) * 0.5) / (C.perRow + 0.5);
    }
  }

  get lineCount(): number {
    return Math.min(this.lines, STAPLES_CONFIG.maxLines);
  }
  get clipsPlaced(): number {
    return Math.min(this.clipCount, STAPLES_CONFIG.maxClips);
  }

  /** T841: start a staple line at a cut, nothing formed yet (reveal() forms it). Rows on the `normal` side of
   *  `point` (StapleResult.normal, the kept side) and, with `sides` 2, mirrored on the other side of the knife line;
   *  staggered, spanning `width` along `across` (the jaw direction, heel → tip). */
  beginLine(
    point: V3,
    normal: V3,
    across: V3,
    width: number = STAPLES_CONFIG.lineWidth,
    sides: 1 | 2 = 1,
  ): void {
    const C = STAPLES_CONFIG;
    this.base = (this.lines % C.maxLines) * this.perLine;
    this.sides = sides;
    lineMatrices(point, normal, across, width, C.rows, C.perRow, this.side0);
    _neg.x = -normal.x;
    _neg.y = -normal.y;
    _neg.z = -normal.z;
    if (sides === 2) lineMatrices(point, _neg, across, width, C.rows, C.perRow, this.side1);
    this.clearLine();
    this.lines++;
    this.commit(this.staples, this.lineCount * this.perLine);
  }

  /** T841: staples formed from the heel up to `f` (0 … 1) of the line; writes only the newly formed ones. */
  reveal(f: number): void {
    const n = this.sides * this.perSide;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (this.shown[i] || (this.order[i] as number) > f) continue;
      this.shown[i] = 1;
      this.revealed++;
      _m.fromArray(this.stash, i * 16);
      this.staples.setMatrixAt(this.base + i, _m);
      changed = true;
    }
    if (changed) this.commit(this.staples, this.lineCount * this.perLine);
  }

  /** Unform the current line (its stumps carry the staples from now on); the slot stays allocated. */
  clearLine(): void {
    for (let i = 0; i < this.perLine; i++) this.staples.setMatrixAt(this.base + i, ZERO);
    this.shown.fill(0);
    this.revealed = 0;
    this.staples.instanceMatrix.needsUpdate = true;
  }

  /** Staple-line cap at a cut, fully formed at once: rows on the kept side of `normal` (StapleResult.normal),
   *  staggered, spanning `width` along `across` (stapler jaw width direction); `sides` 2 = both sides of the cut. */
  addLine(
    point: V3,
    normal: V3,
    across: V3,
    width: number = STAPLES_CONFIG.lineWidth,
    sides: 1 | 2 = 1,
  ): void {
    this.beginLine(point, normal, across, width, sides);
    this.reveal(1);
  }

  /** Titanium clip across a small vessel at `point`, ⟂ to the vessel `axis`, jaw plane along `across`. */
  addClip(point: V3, axis: V3, across: V3): void {
    basis(axis, across);
    _p.set(point.x, point.y, point.z);
    this.clips.setMatrixAt(
      this.clipCount % STAPLES_CONFIG.maxClips,
      _m.makeBasis(_a, _l, _n).setPosition(_p),
    );
    this.clipCount++;
    this.commit(this.clips, this.clipsPlaced);
  }

  /** T841: hide the last `n` clips placed (their stumps carry the clips from now on). */
  removeClips(n: number): void {
    for (let k = 1; k <= Math.min(n, this.clipsPlaced); k++)
      this.clips.setMatrixAt((this.clipCount - k) % STAPLES_CONFIG.maxClips, ZERO);
    this.clips.instanceMatrix.needsUpdate = true;
  }

  /** New practice run: hide everything (instances stay allocated). */
  reset(): void {
    this.lines = 0;
    this.clipCount = 0;
    this.revealed = 0;
    this.commit(this.staples, 0);
    this.commit(this.clips, 0);
  }

  private commit(m: InstancedMesh, count: number): void {
    m.count = count;
    m.visible = count > 0;
    m.instanceMatrix.needsUpdate = true;
    if (count > 0) m.computeBoundingSphere(); // per action, not per frame; reuses the mesh's Sphere
  }
}
