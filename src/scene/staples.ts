// Staple-line caps + titanium clips (CONTEXT §6.4) and the division-plane write. Built ONCE at load (§6.10):
// two InstancedMeshes with fixed capacity sharing one material; placement = setMatrixAt only (ring buffer, the
// oldest line/clip is reused when full). Division mutates the mesh's preallocated planes (materials.ts
// getDivisionPlanes) — the plane count never changes, so no shader recompiles at fire time.
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import type { Plane } from 'three';
import { config } from '../core/config';
import { instrumentGeom } from './instruments.config';

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

export class Staples {
  /** scene.add(group) + registerWarmupObject(group) once at load. */
  readonly group = new Group();
  readonly staples: InstancedMesh;
  readonly clips: InstancedMesh;
  readonly perLine = STAPLES_CONFIG.rows * STAPLES_CONFIG.perRow;
  private lines = 0;
  private clipCount = 0;

  constructor() {
    const C = STAPLES_CONFIG;
    const G = instrumentGeom.clip;
    const mat = new MeshStandardMaterial({ ...C.look, name: 'staples:titanium' });
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
  }

  get lineCount(): number {
    return Math.min(this.lines, STAPLES_CONFIG.maxLines);
  }
  get clipsPlaced(): number {
    return Math.min(this.clipCount, STAPLES_CONFIG.maxClips);
  }

  /** Staple-line cap at a cut: rows on the kept side of `normal` (StapleResult.normal), staggered, spanning
   *  `width` along `across` (stapler jaw width direction). */
  addLine(point: V3, normal: V3, across: V3, width: number = STAPLES_CONFIG.lineWidth): void {
    const C = STAPLES_CONFIG;
    basis(normal, across);
    const base = (this.lines % C.maxLines) * this.perLine;
    const pitch = width / C.perRow;
    let i = base;
    for (let r = 0; r < C.rows; r++) {
      const along = C.cutGap / 2 + C.rowGap * (r + 0.5);
      const stagger = (r % 2) * 0.5;
      for (let s = 0; s < C.perRow; s++) {
        const off = (s + 0.5 + stagger - C.perRow / 2) * pitch;
        _p.set(point.x, point.y, point.z).addScaledVector(_n, along).addScaledVector(_a, off);
        this.staples.setMatrixAt(i++, _m.makeBasis(_a, _l, _n).setPosition(_p));
      }
    }
    this.lines++;
    this.commit(this.staples, this.lineCount * this.perLine);
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

  /** New practice run: hide everything (instances stay allocated). */
  reset(): void {
    this.lines = 0;
    this.clipCount = 0;
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
