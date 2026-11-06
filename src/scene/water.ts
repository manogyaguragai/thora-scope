// T842 irrigation leak test (§6.10): one surface disc + one fixed transparent material built at load. The level only
// drives uniforms (surface height in the vertex shader, tint / caustics in the tissue shader); visibility skips the
// draw while dry. Wiring (wireM4): scene.add(water.mesh) before compile; water.fill() on irrigation; per frame
// water.update(dt, bubbles, suckTip). Allocation-free per frame.
import { CircleGeometry, Color, DoubleSide, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Vector3Like } from 'three';
import { config } from '../core/config';
import type { PointPool } from './effects';
import { waterConfig as C } from './water.config';

/** Shared with every tissue program (materials.ts), present from load; only values change. */
export const waterUniforms = {
  uWaterLevel: { value: C.dryY as number }, // world Y of the surface
  uWaterTime: { value: 0 },
  uWaterDisc: { value: new Vector3(0, 0, 0) }, // surface disc centre x, z + radius (world); radius 0 = none
};

const f = (x: number): string => x.toFixed(4);
const S = C.surface;
const U = C.under;

/** Tissue fragment (before opaque_fragment, wet meshes only): tint by the view ray's path through the saline
 *  (cameraPosition may be under too: underwater scope), caustic net on submerged surfaces; inside the disc only. */
export const WATER_TISSUE_FRAG = /* glsl */ `
	float waterD = uWaterLevel - vTissueWorld.y;
	float waterCam = uWaterLevel - cameraPosition.y;
	if ( uWaterOn > 0.0 && max( waterD, waterCam ) > 0.0 && distance( vTissueWorld.xz, uWaterDisc.xy ) < uWaterDisc.z ) {
		float wetShare = min( 1.0, ( max( waterD, 0.0 ) + max( waterCam, 0.0 ) ) / max( abs( waterD - waterCam ), 1e-5 ) );
		float wetPath = wetShare * distance( vTissueWorld, cameraPosition );
		outgoingLight *= mix( vec3( ${U.tint.map(f).join(', ')} ), vec3( 1.0 ), exp( - wetPath * ${f(U.attenPerM)} ) );
		if ( waterD > 0.0 ) {
			// Tileable iterated caustic net (thin bright cells), 3 iterations.
			vec2 cp = mod( vTissueWorld.xz * ${f(U.causticScale)}, 6.28318 ) - 250.0;
			vec2 ci = cp;
			float cn = 1.0;
			for ( int k = 0; k < 3; k++ ) {
				float ct = uWaterTime * ${f(U.causticSpeed)} * ( 1.0 - 3.5 / float( k + 1 ) );
				ci = cp + vec2( cos( ct - ci.x ) + sin( ct + ci.y ), sin( ct - ci.y ) + cos( ct + ci.x ) );
				cn += 1.0 / length( vec2( cp.x / ( sin( ci.x + ct ) / 0.005 ), cp.y / ( cos( ci.y + ct ) / 0.005 ) ) );
			}
			float caus = clamp( pow( abs( 1.17 - pow( cn / 3.0, 1.4 ) ), ${f(U.causticSharp)} ), 0.0, 1.0 );
			outgoingLight *= 1.0 + ${f(U.causticStrength)} * caus * smoothstep( 0.0, ${f(U.causticFadeM)}, waterD );
		}
	}
`;

const SURFACE_PARS = /* glsl */ `
uniform float uWaterLevel;
uniform float uWaterTime;
varying vec2 vWaterXZ;
`;

export class Water {
  readonly mesh: Mesh<CircleGeometry, MeshStandardMaterial>;
  /** 0 dry … 1 every listed structure submerged. */
  level = 0;
  readonly bottomY: number;
  readonly topY: number;
  private target = 0;
  private readonly leakAt = new Vector3();
  private leaking = false;
  private leakAcc = 0;
  private readonly cx: number;
  private readonly cz: number;

  /** `submerge`: world points that level 1 covers (hilar targets + stumps). */
  constructor(submerge: readonly Vector3Like[]) {
    let lo = Infinity;
    let hi = -Infinity;
    let cx = 0;
    let cz = 0;
    for (const p of submerge) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
      cx += p.x / submerge.length;
      cz += p.z / submerge.length;
    }
    this.bottomY = (submerge.length ? lo : 0) - C.bottomMarginM;
    // Capped below the scope ports so the leak test is viewed from above, through the surface (T845).
    this.topY = Math.min((submerge.length ? hi : 0) + C.submergeMarginM, C.maxTopY);
    const geo = new CircleGeometry(C.radiusM, C.segments);
    geo.rotateX(-Math.PI / 2).translate(cx, 0, cz); // horizontal, y = 0: uWaterLevel lifts it in the shader
    waterUniforms.uWaterDisc.value.set(cx, cz, C.radiusM);
    this.cx = cx;
    this.cz = cz;
    const mat = new MeshStandardMaterial({
      color: new Color(S.color),
      transparent: true, // fixed at load, never toggled
      opacity: S.opacity,
      roughness: S.roughness,
      metalness: S.metalness,
      envMapIntensity: S.envIntensity,
      depthWrite: false,
      side: DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, waterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${SURFACE_PARS}\nvoid main() {`)
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\ttransformed.y += uWaterLevel;\n\tvWaterXZ = transformed.xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${SURFACE_PARS}\nvoid main() {`)
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
	vec2 wq = vWaterXZ * ${f(S.rippleFreq)};
	float wt = uWaterTime * ${f(S.rippleSpeed)};
	vec2 wg = vec2( cos( wq.x + wt ) + 0.6 * cos( ( wq.x + wq.y ) * 0.7 - wt * 1.3 ),
		cos( wq.y * 1.2 - wt * 0.9 ) + 0.6 * cos( ( wq.x - wq.y ) * 0.8 + wt ) ) * ${f(S.rippleAmp)};
	normal = normalize( normal + ( viewMatrix * vec4( - wg.x, 0.0, - wg.y, 0.0 ) ).xyz );`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `diffuseColor.a = mix( diffuseColor.a, ${f(S.edgeOpacity)}, pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 ) );
#include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => 'water-v1';
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = 'irrigation_water';
    this.mesh.frustumCulled = false; // the shader moves it
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** World Y of the surface right now. */
  get surfaceY(): number {
    return this.bottomY + (this.topY - this.bottomY) * this.level;
  }

  /** Fill toward `level` (0–1) at fillPerSec. */
  fill(level = 1): void {
    this.target = Math.min(1, Math.max(0, level));
  }

  /** Bubbles stream from `p` (a failed staple line) while it is under water; null = sealed. */
  setLeak(p: Vector3Like | null): void {
    this.leaking = p !== null;
    if (p) this.leakAt.copy(p);
  }

  /** Dry at once, no leak (step / mode change). */
  reset(): void {
    this.level = this.target = 0;
    this.leaking = false;
    this.apply();
  }

  /** T852: a sucker tip at `p` aspirates the saline: inside the pool's disc, under the surface or within reach above. */
  reaches(p: Vector3Like): boolean {
    return (
      this.level > 0 &&
      p.y <= this.surfaceY + C.suctionReachM &&
      Math.hypot(p.x - this.cx, p.z - this.cz) < C.radiusM
    );
  }

  /** Per frame. `suckTip`: the held sucker's tip (null = not sucking); in reach the level falls (and stays down). */
  update(dt: number, bubbles: PointPool | null, suckTip: Vector3Like | null): void {
    if (suckTip && this.reaches(suckTip))
      this.level = this.target = Math.max(0, this.level - C.drainPerSec * dt);
    else if (this.level !== this.target) {
      const step = C.fillPerSec * dt;
      const d = this.target - this.level;
      this.level = Math.abs(d) <= step ? this.target : this.level + Math.sign(d) * step;
    }
    this.apply();
    if (!this.mesh.visible) return;
    waterUniforms.uWaterTime.value += dt;
    if (!bubbles || !this.leaking || this.leakAt.y >= this.surfaceY) return;
    this.leakAcc += C.leak.ratePerSec * dt;
    const j = C.leak.jitterM;
    for (; this.leakAcc >= 1; this.leakAcc--) {
      bubbles.spawn(
        this.leakAt.x + (Math.random() - 0.5) * j,
        this.leakAt.y,
        this.leakAt.z + (Math.random() - 0.5) * j,
        0,
        config.effects.bubbles.riseSpeed,
        0,
      );
    }
  }

  private apply(): void {
    this.mesh.visible = this.level > 0;
    waterUniforms.uWaterLevel.value = this.mesh.visible ? this.surfaceY : C.dryY;
  }
}
