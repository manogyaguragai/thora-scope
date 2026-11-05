// Irrigation fluid surface for the water test (§6.4, §6.10): one disc mesh + one fixed transparent material built
// at load. Level only moves the mesh along +Y (gravity is −Y, §7.1) and toggles visibility; no material changes.
// Wiring (T409): scene.add(fluid.mesh); registerWarmupObject(fluid.mesh); fluid.placeAt(stumpWorldPos) once;
// on a finish 'fluid' request fluid.setLevel(level); per frame fluid.update(dt).
import { CircleGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { config } from '../core/config';

export const FLUID_CONFIG = config.fluid; // values in src/core/config.ts

export class IrrigationFluid {
  readonly mesh: Mesh<CircleGeometry, MeshStandardMaterial>;
  level = 0;
  private target = 0;
  private readonly base = new Vector3();

  constructor(private readonly cfg: typeof FLUID_CONFIG = FLUID_CONFIG) {
    const geo = new CircleGeometry(cfg.radius, cfg.segments);
    geo.rotateX(-Math.PI / 2); // horizontal surface, normal +Y
    const mat = new MeshStandardMaterial({
      color: cfg.color,
      transparent: true, // fixed at load, never toggled
      opacity: cfg.opacity,
      roughness: cfg.roughness,
      metalness: cfg.metalness,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'irrigation_fluid';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Pool bottom (level 0) in the mesh's parent space, e.g. just below the stump. */
  placeAt(bottom: Vector3): void {
    this.base.copy(bottom);
    this.apply();
  }

  /** Target level 0–1; update() eases toward it. */
  setLevel(level: number): void {
    this.target = level < 0 ? 0 : level > 1 ? 1 : level;
  }

  /** Per frame, allocation-free; only touches the matrix when the level moves. */
  update(dt: number): void {
    if (this.level === this.target) return;
    const step = this.cfg.fillPerSec * dt;
    const d = this.target - this.level;
    this.level = Math.abs(d) <= step ? this.target : this.level + Math.sign(d) * step;
    this.apply();
  }

  private apply(): void {
    this.mesh.position.set(this.base.x, this.base.y + this.cfg.depth * this.level, this.base.z);
    this.mesh.visible = this.level > 0;
    this.mesh.updateMatrix();
  }
}
