// Pooled effects (§6.4 cautery/bleeding/water test, §8 effects, §6.10 build-once pools). Everything is allocated at
// load for the chosen preset's capacity; spawns reuse slots ring-buffer style (oldest overwritten), never grow.
// Wiring: scene.add(fx.group) before the compile stage; per frame fx.update(dt) then uFog.value = fx.fog.value.
// T817: cautery = smoke plume at the tip while energised + growing char decal + slow smoke haze (no image warp).
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DataTexture,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import type { QualityPreset } from '../core/quality';
import { config } from '../core/config';
import { cauteryConfig as CAUTERY } from './cautery.config';

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

/** Smoke haze 0…1 (post uFog): builds slowly while `on` (energy active) up to haze.max, clears slowly after. */
export class LensFog {
  value = 0;
  on = false;
  clear(): void {
    this.value = 0;
  }
  update(dt: number): void {
    const H = CAUTERY.haze;
    this.value = this.on
      ? Math.min(H.max, this.value + H.riseRate * dt)
      : Math.max(0, this.value - H.decayRate * dt);
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

export interface Effects {
  /** Add to the scene and registerWarmupObject() it once at load. */
  readonly group: Group;
  readonly objects: readonly Object3D[];
  readonly smoke: PointPool;
  readonly ooze: PointPool;
  readonly bubbles: PointPool;
  readonly blood: BloodPool;
  readonly char: CharPool;
  readonly fog: LensFog;
  /** Energy on: smoke burst + plume from `tip` (kept by reference, read every frame), char mark at `contact`
   *  facing `normal` (copied), haze builds. Energy off: `cautery(null)`. */
  cautery(tip: Vector3 | null, contact?: Vector3, normal?: Vector3): void;
  /** Energy on (smoke plume emitting). */
  readonly energised: boolean;
  /** Irrigation leak bubbles (water test). */
  bubbleBurst(at: Vector3): void;
  /** Sucker: clear smoke and loose fluid. */
  suction(): void;
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
  const sprite = buildSoftSprite();
  const smoke = new PointPool(poolCapacity(C.smoke.capScale, preset), C.smoke, sprite);
  const ooze = new PointPool(poolCapacity(C.ooze.capScale, preset), C.ooze, sprite);
  const bubbles = new PointPool(poolCapacity(C.bubbles.capScale, preset), C.bubbles, sprite);
  const blood = new BloodPool(poolCapacity(C.decal.capScale, preset), ooze);
  const char = new CharPool(poolCapacity(CAUTERY.char.capScale, preset));
  const fog = new LensFog();
  let tip: Vector3 | null = null;
  let smokeAcc = 0;
  const group = new Group();
  group.name = 'effects';
  const objects = [smoke.points, ooze.points, bubbles.points, blood.mesh, char.mesh];
  group.add(...objects);
  return {
    group,
    objects,
    smoke,
    ooze,
    bubbles,
    blood,
    char,
    fog,
    get energised() {
      return tip !== null;
    },
    cautery(at, contact, normal) {
      tip = at;
      fog.on = at !== null;
      if (!at) {
        char.release();
        return;
      }
      smokeAcc = 0;
      burst(smoke, at, C.smoke.perPuff, C.smoke.riseSpeed, C.smoke.jitter);
      if (contact && normal) char.begin(contact, normal);
    },
    bubbleBurst(at) {
      burst(bubbles, at, C.bubbles.perBurst, C.bubbles.riseSpeed, C.bubbles.jitter);
    },
    suction() {
      smoke.clear();
      ooze.clear();
    },
    update(dt) {
      blood.update(dt);
      char.update(dt);
      if (tip) {
        smokeAcc += CAUTERY.smoke.ratePerSec * dt;
        const n = Math.floor(smokeAcc);
        smokeAcc -= n;
        burst(smoke, tip, n, C.smoke.riseSpeed, C.smoke.jitter);
      }
      smoke.update(dt);
      ooze.update(dt);
      bubbles.update(dt);
      fog.update(dt);
    },
  };
}
