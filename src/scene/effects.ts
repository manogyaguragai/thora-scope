// Pooled effects (§6.4 cautery/bleeding/water test, §8 effects, §6.10 build-once pools). Everything is allocated at
// load for the chosen preset's capacity; spawns reuse slots ring-buffer style (oldest overwritten), never grow.
// Wiring: scene.add(fx.group) before the compile stage; per frame fx.update(dt) then uFog.value = fx.fog.value.
// T817/T822: cautery acts only at contact: smoke plume + haze at the touched point, a subtle char / sear line along
// the path (CharPool). T842: dissection openings are a per-vertex attribute on each soft layer (CutPool, persistent
// until reset); smoke density accumulates with energy time and the held sucker aspirates smoke / blood.
// T861 node-bed ooze (BedFx): drop + gravity rivulet + pool (instanced blobs placed once, uniform-driven growth),
// darkened to a coagulum by an energised touch; no decal circle, no particles.
import {
  BufferAttribute,
  Triangle,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import type { HitPointInfo, MeshBVH } from 'three-mesh-bvh';
import type { QualityPreset } from '../core/quality';
import type { BedFxApi } from '../app/walkthrough/types';
import { config } from '../core/config';
import { cauteryConfig as CAUTERY } from './cautery.config';
import type { RetrievalBag } from './retrievalBag';

export const EFFECTS_CONFIG = config.effects; // values in src/core/config.ts

export function poolCapacity(capScale: number, preset: Pick<QualityPreset, 'particleCap'>): number {
  return Math.max(1, Math.round(preset.particleCap * capScale));
}

/** Soft radial alpha sprite, built once. */
export function buildSoftSprite(size = EFFECTS_CONFIG.spriteSize): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - h, y - h) / h);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * (1 - r * r) * (1 - r * r));
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** T842 smoke density 0…haze.max (post uFog): accumulates while `on` (energised contact), stays (slow passive
 *  clearing), falls fast while `suction` (sucker held). */
export class LensFog {
  value = 0;
  on = false;
  suction = false;
  clear(): void {
    this.value = 0;
  }
  update(dt: number): void {
    const H = CAUTERY.haze;
    const v = this.on ? Math.min(H.max, this.value + H.riseRate * dt) : this.value - H.decayRate * dt;
    this.value = Math.max(0, this.suction ? v - CAUTERY.suction.hazeClearPerSec * dt : v);
  }
}

interface PointPoolConfig {
  readonly color: readonly [number, number, number];
  readonly size: number;
  readonly opacity: number;
  readonly lifeSec: number;
}

/** Fixed-capacity point particles: per-slot position/velocity/age, RGBA vertex colours carry the fade. */
export class PointPool {
  readonly points: Points;
  readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array; // < 0 = dead
  private readonly rgba: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private head = 0;
  private alive = 0;
  private dirty = false;

  constructor(
    capacity: number,
    private readonly cfg: PointPoolConfig,
    sprite: DataTexture,
  ) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(-1);
    this.rgba = new Float32Array(capacity * 4);
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.rgba, 4);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    // transparent/depthWrite/vertexColors fixed from creation (§6.10: never toggled at runtime)
    const mat = new PointsMaterial({
      size: cfg.size,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false; // bounds change every frame; pools are small
  }

  get aliveCount(): number {
    return this.alive;
  }

  /** Reuse the next slot (overwrites the oldest when full). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    if ((this.age[i] ?? -1) < 0) this.alive++;
    this.age[i] = 0;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.dirty = true;
  }

  clear(): void {
    this.age.fill(-1);
    this.rgba.fill(0);
    this.alive = 0;
    this.dirty = true;
  }

  /** T842 suction: live particles within `radius` of `tip` flow to it with a small swirl (round +Y) and are
   *  aspirated within `capture`. Allocation-free. */
  attract(tip: Vector3, dt: number): void {
    if (this.alive === 0) return;
    const K = CAUTERY.suction;
    for (let i = 0; i < this.capacity; i++) {
      if ((this.age[i] ?? -1) < 0) continue;
      const p = i * 3;
      const dx = tip.x - (this.pos[p] ?? 0);
      const dy = tip.y - (this.pos[p + 1] ?? 0);
      const dz = tip.z - (this.pos[p + 2] ?? 0);
      const d = Math.hypot(dx, dy, dz);
      if (d >= K.radiusM) continue;
      if (d < K.captureM) {
        this.age[i] = -1;
        this.rgba[i * 4 + 3] = 0;
        this.alive--;
        continue;
      }
      const k = (K.flowSpeed * dt) / d;
      const h = (K.swirl * dt) / Math.max(K.captureM, Math.hypot(dx, dz));
      this.pos[p] = (this.pos[p] ?? 0) + dx * k - dz * h;
      this.pos[p + 1] = (this.pos[p + 1] ?? 0) + dy * k;
      this.pos[p + 2] = (this.pos[p + 2] ?? 0) + dz * k + dx * h;
      this.vel[p] = this.vel[p + 1] = this.vel[p + 2] = 0; // caught in the flow
    }
    this.dirty = true;
  }

  update(dt: number): void {
    if (this.alive > 0) {
      const { color, opacity, lifeSec } = this.cfg;
      for (let i = 0; i < this.capacity; i++) {
        const a = this.age[i] ?? -1;
        if (a < 0) continue;
        const t = a + dt;
        const c = i * 4;
        if (t >= lifeSec) {
          this.age[i] = -1;
          this.rgba[c + 3] = 0;
          this.alive--;
          continue;
        }
        this.age[i] = t;
        const p = i * 3;
        this.pos[p] = (this.pos[p] ?? 0) + (this.vel[p] ?? 0) * dt;
        this.pos[p + 1] = (this.pos[p + 1] ?? 0) + (this.vel[p + 1] ?? 0) * dt;
        this.pos[p + 2] = (this.pos[p + 2] ?? 0) + (this.vel[p + 2] ?? 0) * dt;
        this.rgba[c] = color[0];
        this.rgba[c + 1] = color[1];
        this.rgba[c + 2] = color[2];
        this.rgba[c + 3] = opacity * Math.sin((Math.PI * t) / lifeSec); // fade in and out
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.dirty = false;
    }
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const _z = new Vector3(0, 0, 1);
const _zero = new Matrix4().makeScale(0, 0, 0);

/** Growing glossy blood decals (one InstancedMesh) with ooze sources; slots reused ring-buffer style. */
export class BloodPool {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly quat: Float32Array;
  private readonly age: Float32Array; // < 0 = unused
  private readonly bleeding: Uint8Array;
  private readonly oozeAcc: Float32Array;
  private readonly radius: Float32Array; // final radius per slot (m)
  private head = 0;

  constructor(
    capacity: number,
    private readonly ooze: PointPool,
  ) {
    const D = EFFECTS_CONFIG.decal;
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.quat = new Float32Array(capacity * 4);
    this.age = new Float32Array(capacity).fill(-1);
    this.bleeding = new Uint8Array(capacity);
    this.oozeAcc = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    const mat = new MeshPhysicalMaterial({
      color: D.color,
      roughness: D.roughness,
      clearcoat: D.clearcoat,
      clearcoatRoughness: D.clearcoatRoughness,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new InstancedMesh(new CircleGeometry(1, D.segments), mat, capacity);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, _zero);
  }

  /** Start a bleed at a surface point (world/effects-group space) with its unit normal and final radius (m,
   *  capped at decal.maxRadius). Returns the slot. */
  spawn(point: Vector3, normal: Vector3, radius: number = EFFECTS_CONFIG.decal.maxRadius): number {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    _n.copy(normal).normalize();
    _q.setFromUnitVectors(_z, _n);
    _p.copy(point).addScaledVector(_n, EFFECTS_CONFIG.decal.normalOffset);
    _p.toArray(this.pos, i * 3);
    _q.toArray(this.quat, i * 4);
    this.age[i] = 0;
    this.bleeding[i] = 1;
    this.oozeAcc[i] = 0;
    this.radius[i] = Math.min(radius, EFFECTS_CONFIG.decal.maxRadius);
    return i;
  }

  /** Bleeding controlled (sucker + pressure): decal stays, ooze stops. */
  stop(slot: number): void {
    this.bleeding[slot] = 0;
  }

  /** T842 suction: pooled blood within suction.radiusM of `tip` shrinks (gone unless still bleeding). */
  drain(tip: Vector3, dt: number): void {
    const K = CAUTERY.suction;
    const D = EFFECTS_CONFIG.decal;
    let changed = false;
    for (let i = 0; i < this.capacity; i++) {
      const a = this.age[i] ?? -1;
      const r0 = this.radius[i] ?? 0;
      if (a < 0 || _p.fromArray(this.pos, i * 3).distanceToSquared(tip) > K.radiusM * K.radiusM) continue;
      const floor = this.bleeding[i] ? D.maxRadius * K.bloodMinShare : 0;
      const r = Math.max(Math.min(r0, floor), r0 - K.bloodShrinkPerSec * dt);
      if (r === r0) continue;
      this.radius[i] = r;
      changed = true;
      if (r <= 0) {
        this.age[i] = -1;
        this.mesh.setMatrixAt(i, _zero);
        continue;
      }
      if (a < D.growSec) continue; // still growing: update() writes it
      _q.fromArray(this.quat, i * 4);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(r, r, r)));
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** T884 (critic S2): a sealed node bed takes the fresh-blood decals round it with it (within `r` of `p`). */
  clearNear(p: Vector3, r: number): void {
    let changed = false;
    for (let i = 0; i < this.capacity; i++) {
      if ((this.age[i] ?? -1) < 0 || _p.fromArray(this.pos, i * 3).distanceToSquared(p) > r * r) continue;
      this.age[i] = -1;
      this.bleeding[i] = 0;
      this.mesh.setMatrixAt(i, _zero);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  get activeBleeds(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) n += this.bleeding[i] ?? 0;
    return n;
  }

  clear(): void {
    this.age.fill(-1);
    this.bleeding.fill(0);
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, _zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    const D = EFFECTS_CONFIG.decal;
    const O = EFFECTS_CONFIG.ooze;
    let changed = false;
    for (let i = 0; i < this.capacity; i++) {
      const a = this.age[i] ?? -1;
      if (a < 0) continue;
      if (a < D.growSec) {
        const t = Math.min(D.growSec, a + dt);
        this.age[i] = t;
        const r = (this.radius[i] ?? 0) * Math.sqrt(t / D.growSec); // area grows ~linearly
        _p.fromArray(this.pos, i * 3);
        _q.fromArray(this.quat, i * 4);
        _m.compose(_p, _q, _s.set(r, r, r));
        this.mesh.setMatrixAt(i, _m);
        changed = true;
      }
      if (this.bleeding[i]) {
        let acc = (this.oozeAcc[i] ?? 0) + O.ratePerSec * dt;
        const p = i * 3;
        for (; acc >= 1; acc--) {
          this.ooze.spawn(
            this.pos[p] ?? 0,
            this.pos[p + 1] ?? 0,
            this.pos[p + 2] ?? 0,
            (Math.random() - 0.5) * O.jitter,
            -O.fallSpeed,
            (Math.random() - 0.5) * O.jitter,
          );
        }
        this.oozeAcc[i] = acc;
      }
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Radial char texture, built once: dark mottled eschar core → pale coagulated rim → transparent edge. */
export function buildCharTexture(size: number = CAUTERY.char.textureSize): DataTexture {
  const K = CAUTERY.char;
  const data = new Uint8Array(size * size * 4);
  const h = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - h, y - h) / h);
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const core = 1 + K.mottle * (n - Math.floor(n) - 0.5) * 2;
      const t = Math.min(1, Math.max(0, (r - K.coreEnd) / (K.rimPeak - K.coreEnd)));
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (K.coreRgb[c] ?? 0) * core * (1 - t) + (K.rimRgb[c] ?? 0) * t;
        data[i + c] = Math.min(255, Math.round(v));
      }
      const fade = r <= K.edgeStart ? 1 : Math.max(0, 1 - (r - K.edgeStart) / (1 - K.edgeStart));
      data[i + 3] = Math.round(255 * K.coreAlpha * fade);
    }
  }
  const tex = new DataTexture(data, size, size);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Char / singe marks (one InstancedMesh). begin() places a mark at the contact point; it grows while held. */
export class CharPool {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  /** Marks placed so far (capped at capacity; oldest slots are reused). */
  count = 0;
  private readonly pos: Float32Array;
  private readonly quat: Float32Array;
  private head = 0;
  private held = -1;
  private heldAge = 0;

  constructor(capacity: number) {
    const K = CAUTERY.char;
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.quat = new Float32Array(capacity * 4);
    // transparent/depthWrite fixed from creation (§6.10)
    const mat = new MeshStandardMaterial({
      map: buildCharTexture(),
      roughness: K.roughness,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new InstancedMesh(new CircleGeometry(1, K.segments), mat, capacity);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, _zero);
  }

  begin(point: Vector3, normal: Vector3): void {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
    _n.copy(normal).normalize();
    _q.setFromUnitVectors(_z, _n);
    _p.copy(point).addScaledVector(_n, CAUTERY.char.normalOffset);
    _p.toArray(this.pos, i * 3);
    _q.toArray(this.quat, i * 4);
    this.held = i;
    this.heldAge = 0;
    this.write(i, CAUTERY.char.startRadiusM);
  }

  release(): void {
    this.held = -1;
  }

  /** The mark still growing lies within `r` of `p`. */
  near(p: Vector3, r: number): boolean {
    if (this.held < 0) return false;
    return _p.fromArray(this.pos, this.held * 3).distanceToSquared(p) < r * r;
  }

  clear(): void {
    this.held = -1;
    this.count = this.head = 0;
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, _zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    const K = CAUTERY.char;
    if (this.held < 0 || this.heldAge >= K.growSec) return;
    this.heldAge = Math.min(K.growSec, this.heldAge + dt);
    this.write(this.held, K.startRadiusM + ((K.maxRadiusM - K.startRadiusM) * this.heldAge) / K.growSec);
  }

  private write(i: number, r: number): void {
    _p.fromArray(this.pos, i * 3);
    _q.fromArray(this.quat, i * 4);
    _m.compose(_p, _q, _s.set(r, r, r));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** T842: per-vertex "opened" field of a dissectable layer (0 intact … 1 open), the tissue shader's attribute. */
export const OPENED_ATTR = 'aOpened';
/** Interpolated opened above this is discarded (the field is 1 − d / (falloff × radius)). */
export const OPEN_THRESHOLD = 1 - 1 / CAUTERY.dissect.falloff;
/** T852: per-vertex 1 where the latest opening was blunt (peanut): torn soft edge, no coagulated rim. */
export const BLUNT_ATTR = 'aBlunt';

/** Load time: the zeroed opened attribute on a dissectable layer (fixed from load: the program never changes). */
export function addOpenedAttribute(mesh: Mesh): void {
  const n = mesh.geometry.getAttribute('position').count;
  mesh.geometry.setAttribute(OPENED_ATTR, new BufferAttribute(new Float32Array(n), 1));
  mesh.geometry.setAttribute(BLUNT_ATTR, new BufferAttribute(new Float32Array(n), 1));
}

interface Layer {
  mesh: Mesh;
  opened: BufferAttribute;
  blunt: BufferAttribute;
  minRadius: number; // m: edgeFactor × mean edge (coarse layers still open where touched)
  range: { start: number; count: number }; // the one pending upload range, reused (no allocation)
}

const _inv = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _ab = new Vector3();
const _tri = new Triangle();
const _bary = new Vector3();
const _near: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 };

/** BVH geometry (morph layers: the pick-baked pose) when the picker built one, else the render geometry. */
const pickGeometry = (m: Mesh) => (m.geometry.boundsTree as MeshBVH | undefined)?.geometry ?? m.geometry;

/** T842 persistent dissection openings: touch() raises the opened field of the touched layer's vertices along the
 *  stroke (capsule from the previous sample: fast sweeps stay continuous), widening on dwell. Values only rise, so
 *  nothing ever closes; reset() (step / mode change) clears. Brute force over the layer's vertices at the ≤ 30 Hz
 *  contact rate. ponytail: O(vertices) per sample (≈ 6 k on the hilar pleura); a BVH sphere shapecast if a layer gets
 *  big. Allocation-free except the BVH query in inside(). */
export class CutPool {
  /** Vertices opened (field above the threshold) across all layers. */
  count = 0;
  private readonly layers = new Map<string, Layer>();
  private last: Layer | null = null; // layer of the current stroke, null = lifted
  private readonly anchor = new Vector3();
  private dwell = 0;

  constructor(meshes: readonly Mesh[]) {
    for (const mesh of meshes) {
      const opened = mesh.geometry.getAttribute(OPENED_ATTR) as BufferAttribute | undefined;
      const blunt = mesh.geometry.getAttribute(BLUNT_ATTR) as BufferAttribute | undefined;
      if (!opened || !blunt) continue;
      const minRadius = CAUTERY.dissect.edgeFactor * meanEdge(mesh);
      this.layers.set(mesh.name, { mesh, opened, blunt, minRadius, range: { start: 0, count: 0 } });
    }
  }

  /** Energised contact (`blunt`: peanut sweep, wider, no coagulum) on layer `name` at world `p`; non-layers lift. */
  touch(name: string, p: Vector3, dt: number, blunt = false): void {
    const layer = this.layers.get(name);
    if (!layer) return this.lift();
    const D = CAUTERY.dissect;
    if (this.last !== layer) {
      this.last = layer;
      this.anchor.copy(p);
      this.dwell = 0;
    }
    const moved = this.anchor.distanceTo(p) >= D.spacingM;
    this.dwell = moved ? 0 : this.dwell + dt;
    const r = Math.max(layer.minRadius, Math.min(D.maxRadiusM, D.startRadiusM + D.growPerSec * this.dwell));
    this.paint(layer, this.anchor, p, blunt ? r * D.blunt.radiusScale : r, blunt);
    if (moved) this.anchor.copy(p);
  }

  /** T875 blunt sweep on a structure the layers wrap (peanut on an artery): every layer's fascia within the widest
   *  blunt reach of `p` tears open there (soft torn edge), so the tunnel shows round the vessel. Layers whose bounds
   *  are out of reach are skipped; allocation-free. */
  touchNear(p: Vector3): void {
    const D = CAUTERY.dissect;
    for (const layer of this.layers.values()) {
      const r = Math.max(layer.minRadius, D.maxRadiusM) * D.blunt.radiusScale;
      const g = pickGeometry(layer.mesh);
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs) continue;
      const w = layer.mesh.matrixWorld;
      const scale = w.getMaxScaleOnAxis();
      if (_a.copy(bs.center).applyMatrix4(w).distanceTo(p) > bs.radius * scale + D.falloff * r) continue;
      this.paint(layer, p, p, r, true);
    }
  }

  /** A stroke is in progress (touched since the last lift). */
  get stroking(): boolean {
    return this.last !== null;
  }

  /** Tip lifted / energy off: the next contact starts a new stroke. */
  lift(): void {
    this.last = null;
  }

  /** World `p` on layer `mesh` lies in an opening: the same interpolated field the shader discards on. */
  inside(mesh: Mesh, p: Vector3): boolean {
    const layer = this.layers.get(mesh.name);
    const bvh = mesh.geometry.boundsTree as MeshBVH | undefined;
    if (!layer || !bvh || this.count === 0) return false;
    _a.copy(p).applyMatrix4(_inv.copy(mesh.matrixWorld).invert());
    const h = bvh.closestPointToPoint(_a, _near);
    if (!h) return false;
    const g = bvh.geometry;
    const idx = g.index;
    const k = h.faceIndex * 3;
    const i0 = idx ? idx.getX(k) : k;
    const i1 = idx ? idx.getX(k + 1) : k + 1;
    const i2 = idx ? idx.getX(k + 2) : k + 2;
    _tri.setFromAttributeAndIndices(g.getAttribute('position'), i0, i1, i2).getBarycoord(h.point, _bary);
    const o = layer.opened;
    return _bary.x * o.getX(i0) + _bary.y * o.getX(i1) + _bary.z * o.getX(i2) > OPEN_THRESHOLD;
  }

  reset(): void {
    for (const l of this.layers.values()) {
      (l.opened.array as Float32Array).fill(0);
      (l.blunt.array as Float32Array).fill(0);
      mark(l, 0, l.opened.count - 1);
    }
    this.count = 0;
    this.last = null;
  }

  /** Raise the field of every vertex within falloff × r of segment a→b (world); upload only the changed range. */
  private paint(layer: Layer, a: Vector3, b: Vector3, r: number, blunt: boolean): void {
    const { mesh } = layer;
    const w = mesh.matrixWorld;
    const reach = (CAUTERY.dissect.falloff * r) / w.getMaxScaleOnAxis(); // local units
    _inv.copy(w).invert();
    _a.copy(a).applyMatrix4(_inv);
    _ab.copy(b).applyMatrix4(_inv).sub(_a);
    const len2 = _ab.lengthSq();
    const pos = pickGeometry(mesh).getAttribute('position');
    const o = layer.opened.array as Float32Array;
    const bl = layer.blunt.array as Float32Array;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < pos.count; i++) {
      _b.fromBufferAttribute(pos, i).sub(_a);
      const t = len2 > 0 ? Math.min(1, Math.max(0, _b.dot(_ab) / len2)) : 0;
      const d = _b.addScaledVector(_ab, -t).length();
      if (d >= reach) continue;
      const v = 1 - d / reach;
      const was = o[i] ?? 0;
      if (v <= was) continue;
      o[i] = v;
      if (was <= OPEN_THRESHOLD && (o[i] ?? 0) > OPEN_THRESHOLD) this.count++; // the stored float32, as the shader
      bl[i] = blunt ? 1 : 0; // the latest (widest) opening sets the edge look
      if (lo < 0) lo = i;
      hi = i;
    }
    if (lo >= 0) mark(layer, lo, hi);
  }
}

/** Queue vertices lo..hi of opened + blunt for upload: one reused range shared by both (same geometry, uploaded and
 *  cleared together), widened while an upload is pending. */
function mark(l: Layer, lo: number, hi: number): void {
  const u = l.opened.updateRanges;
  const r = l.range;
  if (u.length === 0) {
    r.start = lo;
    r.count = hi - lo + 1;
    u.push(r);
    l.blunt.updateRanges.length = 0;
    l.blunt.updateRanges.push(r);
  } else {
    const end = Math.max(r.start + r.count, hi + 1);
    r.start = Math.min(r.start, lo);
    r.count = end - r.start;
  }
  l.opened.needsUpdate = true;
  l.blunt.needsUpdate = true;
}

/** Mean triangle edge of a mesh in metres (load time, first triangles sampled). */
function meanEdge(mesh: Mesh): number {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = Math.min(idx ? idx.count : pos.count, 3 * 2000);
  let sum = 0;
  for (let k = 0; k + 2 < n; k += 3) {
    _a.fromBufferAttribute(pos, idx ? idx.getX(k) : k);
    _b.fromBufferAttribute(pos, idx ? idx.getX(k + 1) : k + 1);
    sum += _a.distanceTo(_b);
  }
  return n >= 3 ? (sum / (n / 3)) * mesh.matrixWorld.getMaxScaleOnAxis() : 0;
}

type BedState = BedFxApi['state'];

/** Pure node-bed timeline (unit-tested): growth 0…1 over bed.oozeSec while oozing (frozen once sealed); coag 0…1
 *  over bed.coagSec after the seal. */
export class BedTimeline {
  state: BedState = 'none';
  grow = 0;
  coag = 0;
  ooze(): void {
    this.state = 'oozing';
    this.grow = this.coag = 0;
  }
  /** Cautery seal: the ooze stops where it is and darkens. Only an oozing bed coagulates. */
  coagulate(): void {
    if (this.state === 'oozing') this.state = 'coagulated';
  }
  /** Instant end-state (seek). */
  set(s: 'none' | 'coagulated'): void {
    this.state = s;
    this.grow = s === 'coagulated' ? EFFECTS_CONFIG.bed.coagulatedGrow : 0;
    this.coag = s === 'coagulated' ? 1 : 0;
  }
  update(dt: number): void {
    const B = EFFECTS_CONFIG.bed;
    if (this.state === 'oozing') this.grow = Math.min(1, this.grow + dt / B.oozeSec);
    else if (this.state === 'coagulated') this.coag = Math.min(1, this.coag + dt / B.coagSec);
  }
}

/** Nearest visible surface to `p` within `maxDist` (wireM4: the BVH picker); null = none. */
export type SurfaceProbe = (
  p: Vector3,
  maxDist: number,
) => { readonly point: Vector3; readonly normal: Vector3 } | null;

const RIV = EFFECTS_CONFIG.bed.rivulet.steps;
/** Blob instances per bed: drop, rivulet segments, pool. */
const BED_BLOBS = RIV + 2;
const _g = new Vector3();
const _t = new Vector3();
const _w = new Vector3();
const _y = new Vector3();
const _c = new Vector3();
const _bn = new Vector3();
const _o = new Vector3();

/** Load time: the unit-sphere blob geometry shared by every bed, with each instance's growth span [start, end]. */
function buildBedGeometry(): SphereGeometry {
  const B = EFFECTS_CONFIG.bed;
  const geo = new SphereGeometry(1, B.segments[0], B.segments[1]);
  const span = new Float32Array(BED_BLOBS * 2);
  span.set(B.drop.grow, 0);
  const [r0, r1] = B.rivulet.grow;
  for (let i = 0; i < RIV; i++)
    span.set([r0 + ((r1 - r0) * i) / RIV, r0 + ((r1 - r0) * (i + 1)) / RIV], (i + 1) * 2);
  span.set(B.pool.grow, (RIV + 1) * 2);
  geo.setAttribute('aGrow', new InstancedBufferAttribute(span, 2));
  return geo;
}

/** One node bed: an InstancedMesh of blobs (own material = own growth / coag uniforms; one shared program). */
export class BedFx {
  readonly mesh: InstancedMesh;
  readonly timeline = new BedTimeline();
  readonly at = new Vector3();
  private readonly uGrow = { value: 0 };
  private readonly uCoag = { value: 0 };

  constructor(geo: SphereGeometry) {
    const B = EFFECTS_CONFIG.bed;
    const mat = new MeshPhysicalMaterial({
      name: 'bedFx',
      color: B.color,
      roughness: B.roughness,
      clearcoat: 1, // fixed (> 0 from load: the clearcoat define never toggles)
      clearcoatRoughness: B.clearcoatRoughness,
    });
    const uClot = { value: new Color(B.clotColor) };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uGrow: this.uGrow, uCoag: this.uCoag, uClot });
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec2 aGrow;\nuniform float uGrow;\nuniform float uCoag;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed *= smoothstep( aGrow.x, aGrow.y, uGrow ) * ( 1.0 - ${B.clotShrink.toFixed(3)} * uCoag );`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCoag;\nuniform vec3 uClot;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uClot, uCoag );',
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix( roughnessFactor, ${B.clotRoughness.toFixed(3)}, uCoag );`,
        );
    };
    mat.customProgramCacheKey = () => 'bedFx';
    this.mesh = new InstancedMesh(geo, mat, BED_BLOBS);
    this.mesh.name = 'node_bed_ooze';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Event time: drop at `at`, rivulet traced down the surface along gravity (`probe` re-snaps each step), pool at
   *  the low point. `ref` orients the surface normal (toward the viewer); allocation-free. */
  place(at: Vector3, ref: Vector3 | null, probe: SurfaceProbe | null): void {
    const B = EFFECTS_CONFIG.bed;
    const R = B.rivulet;
    this.at.copy(at);
    _g.set(...B.gravity);
    const h0 = probe?.(at, B.snapM);
    if (h0) _bn.copy(h0.normal);
    else if (ref) _bn.copy(ref);
    else _bn.copy(_g).negate();
    if (ref && _bn.dot(ref) < 0) _bn.negate();
    _bn.normalize();
    _p.copy(at);
    this.blob(0, _p, _bn, null, B.drop.radiusM, B.drop.radiusM, B.drop.radiusM * B.drop.flat);
    let i = 0;
    for (; i < RIV; i++) {
      _t.copy(_g).addScaledVector(_bn, -_g.dot(_bn));
      if (_t.length() < B.minSlope) break; // low point
      _w.copy(_p).addScaledVector(_t.normalize(), R.stepM);
      if (probe) {
        const h = probe(_w, B.snapM);
        if (!h) break; // ran off the surface
        _w.copy(h.point);
        _n.copy(h.normal);
        if (_n.dot(_bn) < 0) _n.negate();
      } else _n.copy(_bn);
      _c.addVectors(_p, _w).multiplyScalar(0.5);
      _t.subVectors(_w, _p);
      const half = (_t.length() / 2) * R.overlap;
      this.blob(i + 1, _c, _bn, _t, half, R.widthM, R.widthM * R.flat);
      _p.copy(_w);
      _bn.copy(_n).normalize();
    }
    for (let k = i; k < RIV; k++) this.mesh.setMatrixAt(k + 1, _zero);
    const P = B.pool;
    this.blob(RIV + 1, _p, _bn, i > 0 ? _t : null, P.radiusM, P.radiusM, P.radiusM * P.flat);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Blob `i` centred at `c` (lifted off the surface), flattened along normal `n`, long axis `dir` (null = any). */
  private blob(
    i: number,
    c: Vector3,
    n: Vector3,
    dir: Vector3 | null,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    if (dir && Math.abs(dir.dot(n)) < dir.length() * 0.999) _t.copy(dir);
    else _t.set(n.y, n.z, n.x); // any direction not along n
    _y.crossVectors(n, _t).normalize();
    _t.crossVectors(_y, n);
    _m.makeBasis(_t, _y, n).scale(_s.set(sx, sy, sz));
    _m.setPosition(_o.copy(c).addScaledVector(n, EFFECTS_CONFIG.bed.liftM));
    this.mesh.setMatrixAt(i, _m);
  }

  /** Per frame: timeline → uniforms (written only when changed). */
  update(dt: number): void {
    const tl = this.timeline;
    tl.update(dt);
    const show = tl.state !== 'none';
    if (this.mesh.visible !== show) this.mesh.visible = show;
    if (this.uGrow.value !== tl.grow) this.uGrow.value = tl.grow;
    if (this.uCoag.value !== tl.coag) this.uCoag.value = tl.coag;
  }
}

export interface Effects {
  /** Add to the scene and registerWarmupObject() it once at load. */
  readonly group: Group;
  readonly objects: readonly Object3D[];
  readonly smoke: PointPool;
  /** T842 drifting cavity smoke (density = fog.value). */
  readonly haze: PointPool;
  readonly ooze: PointPool;
  readonly bubbles: PointPool;
  readonly blood: BloodPool;
  readonly char: CharPool;
  readonly fog: LensFog;
  /** Energy on (`tip`, kept by reference) / off (null). Free space: nothing on tissue (the tip glow is the tool's). */
  cautery(tip: Vector3 | null): void;
  /** Energised tip touching tissue at `at` (copied) facing `normal`: smoke plume + haze from there; `mark` lays a
   *  sear mark every char.spacingM along the path (the newest grows on dwell). null = lifted off. */
  contact(at: Vector3 | null, normal?: Vector3, mark?: boolean): void;
  /** Energy on. */
  readonly energised: boolean;
  /** Energy on and touching tissue (smoke plume emitting). */
  readonly touching: boolean;
  /** Irrigation leak bubbles (water test). */
  bubbleBurst(at: Vector3): void;
  /** Instant clear of smoke, haze particles and loose fluid (tests / probe; the held sucker is suck()). */
  suction(): void;
  /** T842 sucker held at `tip` (kept by reference) / released (null): aspirates smoke, haze and blood near it. */
  suck(tip: Vector3 | null): void;
  /** The sucker is held. */
  readonly sucking: boolean;
  /** T842/T861 node-bed ooze at `point` (`normal` = toward the viewer); energised contact seals it (coag rule). */
  startOoze(point: Vector3, normal: Vector3 | null): void;
  /** An unsealed node-bed ooze lies within coag.radiusM of `p` (the cautery placed there coagulates). */
  oozeNear(p: Vector3): boolean;
  /** Unsealed node-bed oozes. */
  readonly oozing: number;
  /** T861 node beds (fixed slots, nodeBed.max). */
  readonly beds: readonly BedFx[];
  /** T861 the latest node bed (walkthrough: window.__sim.m4.fx.bed). */
  readonly bed: BedFxApi;
  /** T861 surface the rivulet follows (wireM4 sets the BVH picker's nearest()); null = a straight run. */
  surface: SurfaceProbe | null;
  /** T872 retrieval bag (wireM4 builds it from the instruments' materials at load; in `group`). */
  bag: RetrievalBag | null;
  update(dt: number): void;
}

function burst(pool: PointPool, at: Vector3, n: number, up: number, jitter: number): void {
  for (let k = 0; k < n; k++) {
    pool.spawn(
      at.x,
      at.y,
      at.z,
      (Math.random() - 0.5) * jitter,
      up + (Math.random() - 0.5) * jitter,
      (Math.random() - 0.5) * jitter,
    );
  }
}

/** Build all pools once at load for the chosen preset. */
export function createEffects(preset: Pick<QualityPreset, 'particleCap'>): Effects {
  const C = EFFECTS_CONFIG;
  const H = CAUTERY.haze.particles;
  const NB = CAUTERY.nodeBed;
  const COAG = CAUTERY.coag;
  const sprite = buildSoftSprite();
  const smoke = new PointPool(poolCapacity(C.smoke.capScale, preset), C.smoke, sprite);
  const haze = new PointPool(poolCapacity(H.capScale, preset), H, sprite);
  const ooze = new PointPool(poolCapacity(C.ooze.capScale, preset), C.ooze, sprite);
  const bubbles = new PointPool(poolCapacity(C.bubbles.capScale, preset), C.bubbles, sprite);
  const blood = new BloodPool(poolCapacity(C.decal.capScale, preset), ooze);
  const char = new CharPool(poolCapacity(CAUTERY.char.capScale, preset));
  const fog = new LensFog();
  let tip: Vector3 | null = null;
  let suckTip: Vector3 | null = null;
  let touching = false;
  const touchAt = new Vector3(); // last contact = the smoky field's centre
  let smokeAcc = 0;
  let hazeAcc = 0;
  // Node-bed oozes: fixed slots (ring), seconds of energised contact per slot.
  const bedGeo = buildBedGeometry();
  const beds = Array.from({ length: NB.max }, () => new BedFx(bedGeo));
  const oozeCoag = new Float32Array(NB.max);
  let oozeHead = 0;
  let current = beds[0] as BedFx;
  const nearOoze = (b: BedFx, p: Vector3): boolean =>
    b.timeline.state === 'oozing' && b.at.distanceToSquared(p) < COAG.radiusM * COAG.radiusM;
  const nextBed = (): BedFx => {
    current = beds[oozeHead] as BedFx;
    oozeCoag[oozeHead] = 0;
    oozeHead = (oozeHead + 1) % NB.max;
    return current;
  };
  const bedAt = new Vector3();
  const onBed = (p: Vector3): boolean => {
    for (const b of beds)
      if (b.timeline.state !== 'none' && b.at.distanceToSquared(p) < COAG.radiusM * COAG.radiusM) return true;
    return false;
  };
  const contact = (p: Vector3 | null, normal?: Vector3, mark = false): void => {
    if (!p || !tip) {
      touching = fog.on = false;
      char.release();
      return;
    }
    if (!touching) {
      smokeAcc = 0;
      burst(smoke, p, C.smoke.perPuff, C.smoke.riseSpeed, C.smoke.jitter);
    }
    touching = fog.on = true;
    touchAt.copy(p);
    // T875: no sear mark on a node bed: the cautery's touch there leaves only the dark coagulum (the char decal read
    // as a bright red flat patch beside it).
    if (!mark || !normal || onBed(p)) char.release();
    else if (!char.near(p, CAUTERY.char.spacingM)) char.begin(p, normal);
  };
  const group = new Group();
  group.name = 'effects';
  const objects = [
    smoke.points,
    haze.points,
    ooze.points,
    bubbles.points,
    blood.mesh,
    char.mesh,
    ...beds.map((b) => b.mesh),
  ];
  group.add(...objects);
  const fx: Effects = {
    group,
    objects,
    smoke,
    haze,
    ooze,
    bubbles,
    blood,
    char,
    fog,
    get energised() {
      return tip !== null;
    },
    get touching() {
      return touching;
    },
    get sucking() {
      return suckTip !== null;
    },
    get oozing() {
      let n = 0;
      for (const b of beds) if (b.timeline.state === 'oozing') n++;
      return n;
    },
    beds,
    surface: null,
    bag: null,
    bed: {
      get state() {
        return current.timeline.state;
      },
      ooze(at) {
        fx.startOoze(bedAt.set(at.x, at.y, at.z), null);
      },
      coagulate() {
        // T872: the walkthrough's one cautery beat seals every node bed (11R + 12R): an earlier bed left oozing kept
        // welling into a wet, brightly lit pool that read as red patches into step 5.
        for (const b of beds) b.timeline.coagulate();
      },
      set(st, at) {
        if (st === 'none') {
          for (const b of beds) b.timeline.set('none');
          return;
        }
        const b = at ? nextBed() : current;
        if (at) b.place(bedAt.set(at.x, at.y, at.z), null, fx.surface);
        b.timeline.set('coagulated');
      },
    },
    cautery(t) {
      tip = t;
      if (!t) contact(null);
    },
    contact,
    bubbleBurst(at) {
      burst(bubbles, at, C.bubbles.perBurst, C.bubbles.riseSpeed, C.bubbles.jitter);
    },
    suction() {
      smoke.clear();
      haze.clear();
      ooze.clear();
    },
    suck(t) {
      suckTip = t;
      fog.suction = t !== null;
    },
    startOoze(point, normal) {
      const b = nextBed();
      b.place(point, normal, fx.surface);
      b.timeline.ooze();
    },
    oozeNear(p) {
      for (const b of beds) if (nearOoze(b, p)) return true;
      return false;
    },
    update(dt) {
      // Node-bed ooze: continuous energised contact within coag.radiusM for coag.sec seals it (complications' rule).
      for (let i = 0; i < NB.max; i++) {
        const b = beds[i] as BedFx;
        oozeCoag[i] = touching && nearOoze(b, touchAt) ? (oozeCoag[i] ?? 0) + dt : 0;
        if ((oozeCoag[i] ?? 0) >= COAG.sec) b.timeline.coagulate();
        // Just sealed (coag still 0; a seek's instant set() starts at 1): fresh-blood decals round it clear.
        if (b.timeline.state === 'coagulated' && b.timeline.coag === 0)
          blood.clearNear(b.at, C.bed.clearDecalM);
        b.update(dt);
      }
      blood.update(dt);
      char.update(dt);
      if (touching) {
        smokeAcc += CAUTERY.smoke.ratePerSec * dt;
        const n = Math.floor(smokeAcc);
        smokeAcc -= n;
        burst(smoke, touchAt, n, C.smoke.riseSpeed, C.smoke.jitter);
      }
      // Cavity smoke: wisps drift round the field at a rate ∝ density.
      hazeAcc += (H.ratePerSec * fog.value * dt) / CAUTERY.haze.max;
      for (; hazeAcc >= 1; hazeAcc--) {
        const r = H.radiusM;
        haze.spawn(
          touchAt.x + (Math.random() - 0.5) * 2 * r,
          touchAt.y + (Math.random() - 0.5) * 2 * r,
          touchAt.z + (Math.random() - 0.5) * 2 * r,
          (Math.random() - 0.5) * H.driftSpeed,
          (Math.random() - 0.5) * H.driftSpeed,
          (Math.random() - 0.5) * H.driftSpeed,
        );
      }
      if (suckTip) {
        smoke.attract(suckTip, dt);
        haze.attract(suckTip, dt);
        ooze.attract(suckTip, dt);
        blood.drain(suckTip, dt);
      }
      smoke.update(dt);
      haze.update(dt);
      ooze.update(dt);
      bubbles.update(dt);
      fog.update(dt);
    },
  };
  return fx;
}
