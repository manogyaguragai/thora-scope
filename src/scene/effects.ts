// Pooled effects (§6.4 cautery/bleeding/water test, §8 effects, §6.10 build-once pools). Everything is allocated at
// load for the chosen preset's capacity; spawns reuse slots ring-buffer style (oldest overwritten), never grow.
// Wiring (later pass): scene.add(fx.group); registerWarmupObject(fx.group); per frame fx.update(dt) then
// postUniforms.uFog.value = fx.fog.value.
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
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import type { QualityPreset } from '../core/quality';
import { config } from '../core/config';

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

/** Lens fog 0…1: pulse() sets a target the value rises to, then it decays back to 0. Drives the post uFog uniform. */
export class LensFog {
  value = 0;
  private target = 0;
  pulse(amount: number): void {
    this.target = Math.min(1, Math.max(this.target, this.value + amount));
  }
  clear(): void {
    this.value = this.target = 0;
  }
  update(dt: number): void {
    const F = EFFECTS_CONFIG.fog;
    if (this.target > this.value) {
      this.value = Math.min(this.target, this.value + F.riseRate * dt);
      if (this.value >= this.target) this.target = 0;
    } else {
      this.target = 0;
      this.value = Math.max(0, this.value - F.decayRate * dt);
    }
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

  /** Start a bleed at a surface point (world/effects-group space) with its unit normal. Returns the slot. */
  spawn(point: Vector3, normal: Vector3): number {
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
        const r = D.maxRadius * Math.sqrt(t / D.growSec); // area grows ~linearly
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

export interface Effects {
  /** Add to the scene and registerWarmupObject() it once at load. */
  readonly group: Group;
  readonly objects: readonly Object3D[];
  readonly smoke: PointPool;
  readonly ooze: PointPool;
  readonly bubbles: PointPool;
  readonly blood: BloodPool;
  readonly fog: LensFog;
  /** Cautery puff at the tip: smoke wisps + lens-fog pulse. */
  cautery(at: Vector3): void;
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
  const fog = new LensFog();
  const group = new Group();
  group.name = 'effects';
  const objects = [smoke.points, ooze.points, bubbles.points, blood.mesh];
  group.add(...objects);
  return {
    group,
    objects,
    smoke,
    ooze,
    bubbles,
    blood,
    fog,
    cautery(at) {
      burst(smoke, at, C.smoke.perPuff, C.smoke.riseSpeed, C.smoke.jitter);
      fog.pulse(C.fog.cauteryPulse);
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
      smoke.update(dt);
      ooze.update(dt);
      bubbles.update(dt);
      fog.update(dt);
    },
  };
}
