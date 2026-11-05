// BVH picking (CONTEXT §6.4, §6.10): trees built once at load (loading stage 2/3), hover throttled to ≤ 30 Hz,
// full pick on click only. Visibility-aware; one Raycaster + one result object reused forever.
import { BufferAttribute, BufferGeometry, Matrix3, Mesh, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, Intersection, Object3D } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { config } from '../core/config';

/** Tunables: config.pick (cameras/helpers are skipped by the isMesh test). */
const PICKING_CONFIG = config.pick;

export interface PickHit {
  nodeName: string;
  point: Vector3; // world
  normal: Vector3; // world, unit
  distance: number;
}

export interface Picker {
  /** Node name under the cursor; recomputed at most hoverHz times a second, cached in between. */
  hover(ndcX: number, ndcY: number, camera: Camera, now?: number): string | null;
  /** Full pick (click). Returns the shared result object — copy what you keep. */
  pick(ndcX: number, ndcY: number, camera: Camera): PickHit | null;
  /** Re-bake current morph poses into the pick BVHs. Call after a state transition ends, never per frame. */
  refreshMorphs(meshes: readonly Object3D[]): void;
  readonly meshes: readonly Mesh[];
}

interface Entry {
  mesh: Mesh;
  bvh: MeshBVH;
  baked: BufferAttribute | null; // pick-only morphed positions (morph meshes)
}

let patched = false;
const _v = new Vector3();
const _ndc = new Vector2();
const _nm = new Matrix3();

/** Write mesh's current (morphed) local positions into attr. */
function bake(mesh: Mesh, attr: BufferAttribute): void {
  for (let i = 0; i < attr.count; i++) {
    mesh.getVertexPosition(i, _v);
    attr.setXYZ(i, _v.x, _v.y, _v.z);
  }
}

function visibleChain(o: Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function buildPickBVH(root: Object3D, onProgress?: (f: number) => void): Picker {
  if (!patched) {
    Mesh.prototype.raycast = acceleratedRaycast;
    patched = true;
  }
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && !PICKING_CONFIG.excludePrefixes.some((p) => m.name.startsWith(p))) meshes.push(m);
  });

  const entries: Entry[] = [];
  const byMesh = new Map<Object3D, Entry>();
  const byGeom = new Map<BufferGeometry, Entry>();
  meshes.forEach((mesh, i) => {
    const g = mesh.geometry;
    // ponytail: a geometry shared by several morphed meshes bakes from whichever mesh refreshed last.
    let e = byGeom.get(g);
    if (e) e = { mesh, bvh: e.bvh, baked: e.baked };
    else if (g.morphAttributes.position?.length) {
      // Collapsed lungs differ a lot from rest pose: the BVH lives on a pick-only geometry (own positions, shared
      // index) so it can be re-baked + refit without touching the render geometry.
      const baked = new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3);
      const pg = new BufferGeometry();
      pg.setAttribute('position', baked);
      if (g.index) pg.setIndex(g.index);
      pg.groups = g.groups;
      bake(mesh, baked);
      e = { mesh, bvh: new MeshBVH(pg), baked };
    } else e = { mesh, bvh: new MeshBVH(g), baked: null };
    // raycastObject3D reads triangles from the BVH's own geometry, so hanging it on the render geometry is safe.
    g.boundsTree = e.bvh;
    byGeom.set(g, e);
    byMesh.set(mesh, e);
    entries.push(e);
    onProgress?.((i + 1) / meshes.length);
  });

  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const hits: Intersection[] = [];
  const result: PickHit = { nodeName: '', point: new Vector3(), normal: new Vector3(), distance: 0 };
  const hoverMs = 1000 / PICKING_CONFIG.hoverHz;
  let lastHover = -Infinity;
  let hoverName: string | null = null;

  function cast(x: number, y: number, camera: Camera): Intersection | null {
    raycaster.setFromCamera(_ndc.set(x, y), camera);
    for (const e of entries) if (visibleChain(e.mesh)) e.mesh.raycast(raycaster, hits);
    let best: Intersection | null = null;
    for (const h of hits) if (!best || h.distance < best.distance) best = h;
    hits.length = 0;
    return best;
  }

  return {
    meshes,
    hover(x, y, camera, now = performance.now()) {
      if (now - lastHover < hoverMs) return hoverName;
      lastHover = now;
      hoverName = cast(x, y, camera)?.object.name ?? null;
      return hoverName;
    },
    pick(x, y, camera) {
      const h = cast(x, y, camera);
      if (!h) return null;
      result.nodeName = h.object.name;
      result.point.copy(h.point);
      result.distance = h.distance;
      if (h.face)
        result.normal.copy(h.face.normal).applyMatrix3(_nm.getNormalMatrix(h.object.matrixWorld)).normalize();
      else result.normal.set(0, 0, 0);
      return result;
    },
    refreshMorphs(list) {
      for (const m of list) {
        const e = byMesh.get(m);
        if (!e?.baked) continue;
        bake(e.mesh, e.baked);
        e.bvh.refit();
      }
    },
  };
}
