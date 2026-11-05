// Realism materials (CONTEXT §8): every mesh gets MeshPhysicalMaterial variants built ONCE at load (§6.5, §6.10).
// One shared shader patch (uniform-driven per tissue class) + one constant program cache key, so tissues share programs.
// X-ray/opacity only swap pre-compiled variants and set opacity; nothing toggles transparent/defines at runtime.
// Clipping: every variant has the same fixed-length clippingPlanes = [shared cut-away, ...per-mesh division planes],
// parked far away until used; moving a plane only mutates its values, so programs never change.
import {
  Color,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  Plane,
  RepeatWrapping,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type {
  Camera,
  Material,
  MeshStandardMaterial,
  Object3D,
  Scene,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';
import { config } from '../core/config';
import { setupLights } from './lights';
import { FALLBACK_TISSUE, TISSUES, TISSUE_RULES, look } from './materials.config';
import type { TissueClass, TissueParams } from './materials.config';

interface Variants {
  opaque: MeshPhysicalMaterial; // default look (keeps the glTF's own BLEND for pleura/pericardium/connective)
  transparent: MeshPhysicalMaterial; // X-ray / opacity < 1
  baseOpacity: number;
  opacity: number; // user opacity (layer panel)
  fade: number; // transient multiplier (guided visibility fades), × opacity
  division: readonly Plane[]; // clippingPlanes[1..N] of both variants
}
interface TissueUniforms {
  uTissueMap: { value: Vector4 }; // retint, mapLuma, speckle, lobular
  uTissueWrap: { value: number };
  uTissueScatter: { value: Color }; // colour × strength
  uTissueRim: { value: Color }; // colour × strength
}

declare global {
  interface Window {
    /** Test/debug hook (e2e screenshots, X-ray program check). */
    __look?: {
      setXray: (on: boolean) => void;
      setOpacity: (name: string, a: number) => void;
      setCutaway: (normal: readonly [number, number, number], constant: number) => void;
      parkCutaway: () => void;
    };
  }
}

const variants = new Map<Mesh, Variants>();
let xray = false;

const PARK_NORMAL = new Vector3(0, 0, 1);
const parked = (): Plane => new Plane(PARK_NORMAL.clone(), config.clipping.parkConstant);
/** Global cut-away plane (§6.5), index 0 of every realism material's clippingPlanes. */
const cutaway = parked();

/** Move the cut-away plane (world space; points with n·p + c < 0 are clipped). Mutates values only. */
export function setCutawayPlane(normal: Vector3, constant: number): void {
  cutaway.set(normal, constant);
}
export function parkCutaway(): void {
  cutaway.set(PARK_NORMAL, config.clipping.parkConstant);
}
/** The mesh's local division planes (staple-divide, §6.4): mutate their values, never replace them. */
export function getDivisionPlanes(mesh: Mesh): readonly Plane[] | undefined {
  return variants.get(mesh)?.division;
}

const N = look.noise;
const f = (x: number): string => x.toFixed(4);
const vec3 = (v: readonly number[]): string => `vec3(${v.map(f).join(', ')})`;

const PARS = /* glsl */ `
#include <lights_physical_pars_fragment>
uniform vec4 uTissueMap;
uniform float uTissueWrap;
uniform vec3 uTissueScatter;
uniform vec3 uTissueRim;
void RE_Direct_Tissue( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	float ndl = dot( geometryNormal, directLight.direction );
	float wrapped = saturate( ( ndl + uTissueWrap ) / ( 1.0 + uTissueWrap ) );
	// Wrap lighting (soft terminator) + red-shifted back-scatter where light grazes: cheap subsurface look.
	reflectedLight.directDiffuse += directLight.color * ( BRDF_Lambert( material.diffuseContribution ) * ( wrapped - saturate( ndl ) )
		+ uTissueScatter * material.diffuseContribution * RECIPROCAL_PI * wrapped * ( 1.0 - saturate( ndl ) ) );
	float fres = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), ${f(look.rimPower)} );
	reflectedLight.directSpecular += directLight.color * uTissueRim * fres;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Tissue
`;

// Grasp-and-pull (§6.4): world-space offset around the grasp point, smooth falloff, zero offset = no-op.
// Uniforms are shared by every tissue program and present from load; only their values change (T404 retract.ts).
const GRASP_PARS = /* glsl */ `
uniform vec3 uGraspPoint;
uniform vec3 uGraspOffset;
uniform float uGraspRadius;
void main() {`;
const GRASP_VERTEX = /* glsl */ `
	if ( dot( uGraspOffset, uGraspOffset ) > 0.0 ) {
		float graspK = 1.0 - smoothstep( 0.0, uGraspRadius, distance( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, uGraspPoint ) );
		transformed += inverse( mat3( modelMatrix ) ) * ( uGraspOffset * graspK );
	}
#include <project_vertex>`;

export interface GraspUniforms {
  uGraspPoint: { value: Vector3 };
  uGraspOffset: { value: Vector3 };
  uGraspRadius: { value: number };
}
/** The one grasp-and-pull uniform set shared by all tissue materials; mutate `.value`s only. */
export const graspUniforms: GraspUniforms = {
  uGraspPoint: { value: new Vector3() },
  uGraspOffset: { value: new Vector3() },
  uGraspRadius: { value: 1 },
};

const MAP = /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	// Retint: blend the baked hue toward material.color, keeping map luminance (normalised to the class mean) as detail.
	vec3 mapDetail = mix( sampledDiffuseColor.rgb, vec3( dot( sampledDiffuseColor.rgb, ${vec3(look.lumaWeights)} ) ), uTissueMap.x );
	diffuseColor *= vec4( clamp( mapDetail / uTissueMap.y, ${f(look.detailRange[0])}, ${f(look.detailRange[1])} ), sampledDiffuseColor.a );
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	if ( uTissueMap.z + uTissueMap.w > 0.0 ) {
		float speck = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv * ${f(N.speckleTiling)} ).a;
		float lobule = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv * ${f(N.lobularTiling)} ).a;
		float border = smoothstep( ${f(N.lobularEdge[0])}, ${f(N.lobularEdge[1])}, lobule );
		// Anthracotic dots cluster along lobule borders (irregular density instead of an even polka-dot grid).
		float dots = smoothstep( ${f(N.speckleEdge[0])}, ${f(N.speckleEdge[1])}, speck ) * mix( ${f(N.speckleFloor)}, 1.0, border );
		diffuseColor.rgb *= ( 1.0 - uTissueMap.z * dots ) * ( 1.0 - uTissueMap.w * border );
	}
#endif
`;

function patch(shader: WebGLProgramParametersWithUniforms, u: TissueUniforms): void {
  Object.assign(shader.uniforms, u, graspUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', GRASP_PARS)
    .replace('#include <project_vertex>', GRASP_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_pars_fragment>', PARS)
    .replace('#include <map_fragment>', MAP);
}
const cacheKey = (): string => 'tissue-v1'; // one patch for all tissues → programs differ only by three's own params

export function tissueOf(name: string): TissueClass {
  for (const [re, cls] of TISSUE_RULES) if (re.test(name)) return cls;
  return FALLBACK_TISSUE;
}

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable noise, built once: RGB = micro-normal from value-noise fBm, A = Worley F1 (cell units, clamped to 1). */
export function buildNoiseTexture(): DataTexture {
  const S = N.size;
  const height = new Float32Array(S * S);
  for (let o = 0; o < N.heightOctaves; o++) {
    const cells = N.heightCells << o;
    const amp = 0.5 ** o;
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * cells;
      const iy = Math.floor(fy);
      const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * cells;
        const ix = Math.floor(fx);
        const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
        const x1 = (ix + 1) % cells;
        const y1 = (iy + 1) % cells;
        const a = hash(ix, iy, N.seed + o) + (hash(x1, iy, N.seed + o) - hash(ix, iy, N.seed + o)) * tx;
        const b = hash(ix, y1, N.seed + o) + (hash(x1, y1, N.seed + o) - hash(ix, y1, N.seed + o)) * tx;
        height[y * S + x] = (height[y * S + x] ?? 0) + amp * (a + (b - a) * ty);
      }
    }
  }
  const W = N.worleyCells;
  const data = new Uint8Array(S * S * 4);
  const n = new Vector2();
  const at = (x: number, y: number): number => height[((y + S) % S) * S + ((x + S) % S)] ?? 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      n.set(at(x - 1, y) - at(x + 1, y), at(x, y - 1) - at(x, y + 1)).multiplyScalar(N.heightAmp);
      const inv = 1 / Math.hypot(n.x, n.y, 1);
      let f1 = 1;
      const cx = (x / S) * W;
      const cy = (y / S) * W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = Math.floor(cx) + dx;
          const gy = Math.floor(cy) + dy;
          const wx = (gx + W) % W;
          const wy = (gy + W) % W;
          const px = gx + hash(wx, wy, N.seed ^ 0x5bd1);
          const py = gy + hash(wy, wx, N.seed ^ 0x1b87);
          f1 = Math.min(f1, Math.hypot(px - cx, py - cy));
        }
      }
      const i = (y * S + x) * 4;
      data[i] = Math.round((n.x * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((n.y * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(f1 * 255);
    }
  }
  const tex = new DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.repeat.set(N.microTiling, N.microTiling);
  tex.needsUpdate = true;
  return tex;
}

function makeMaterial(
  src: MeshStandardMaterial,
  cls: TissueClass,
  u: TissueUniforms,
  noise: DataTexture,
  transparent: boolean,
  opacity: number,
  clippingPlanes: Plane[],
): MeshPhysicalMaterial {
  const t: TissueParams = TISSUES[cls];
  const baked = t.bakedMaps ?? true;
  const m = new MeshPhysicalMaterial({
    name: `${src.name}:${transparent ? 'transparent' : 'opaque'}`,
    color: t.color,
    map: baked ? src.map : null,
    normalMap: baked ? src.normalMap : null,
    normalScale: src.normalScale,
    roughnessMap: baked ? src.roughnessMap : null, // roughness below multiplies the baked map
    roughness: t.roughness,
    metalness: 0,
    clearcoat: t.clearcoat,
    clearcoatRoughness: t.clearcoatRoughness,
    clearcoatNormalMap: noise,
    clearcoatNormalScale: new Vector2(t.microNormal, t.microNormal),
    side: src.side,
    opacity,
    transparent,
    depthWrite: !transparent,
    forceSinglePass: true, // double-sided transparents: one pass, no per-frame side flips/needsUpdate
    clippingPlanes,
  });
  m.onBeforeCompile = (shader) => patch(shader, u);
  m.customProgramCacheKey = cacheKey;
  return m;
}

function apply(mesh: Mesh, v: Variants): void {
  const a = (xray ? Math.min(v.opacity, look.xrayOpacity) : v.opacity) * v.fade;
  if (a >= 1) {
    mesh.material = v.opaque;
    return;
  }
  v.transparent.opacity = v.baseOpacity * a;
  mesh.material = v.transparent;
}

export function setXray(on: boolean): void {
  xray = on;
  for (const [mesh, v] of variants) apply(mesh, v);
}

export function setOpacity(mesh: Mesh, a: number): void {
  const v = variants.get(mesh);
  if (!v) return;
  v.opacity = a;
  apply(mesh, v);
}

/** Guided fade factor; multiplies the layer opacity, so a fade ending at 1 restores the layer-panel look. */
export function setFade(mesh: Mesh, f: number): void {
  const v = variants.get(mesh);
  if (!v || v.fade === f) return;
  v.fade = f;
  apply(mesh, v);
}

/**
 * Replace every mesh material under root with its tissue variants. Load-time only.
 * Returns proxies (shared geometry + transparent variant) for the loader's compile stage, so X-ray never compiles.
 */
export function applyMaterials(root: Object3D): Group {
  const proxies = new Group();
  const noise = buildNoiseTexture();
  const uniforms = new Map<TissueClass, TissueUniforms>();
  const replaced = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.material as MeshStandardMaterial;
    const cls = tissueOf(mesh.name);
    const t: TissueParams = TISSUES[cls];
    let u = uniforms.get(cls);
    if (!u) {
      u = {
        uTissueMap: { value: new Vector4(t.retint, t.mapLuma, t.speckle, t.lobular) },
        uTissueWrap: { value: t.wrap },
        uTissueScatter: { value: new Color(t.scatter).multiplyScalar(t.scatterStrength) },
        uTissueRim: { value: new Color(t.rim).multiplyScalar(t.rimStrength) },
      };
      uniforms.set(cls, u);
    }
    const baseOpacity = src.transparent ? (t.opacity ?? src.opacity) : 1;
    const division = Array.from({ length: config.clipping.divisionPlanes }, parked);
    const planes = [cutaway, ...division];
    const blend = src.transparent && baseOpacity < 1; // a config opacity of 1 makes a glTF BLEND mesh truly opaque
    const opaque = makeMaterial(src, cls, u, noise, blend, baseOpacity, planes);
    if (blend) opaque.depthWrite = src.depthWrite;
    const transparent = makeMaterial(src, cls, u, noise, true, baseOpacity, planes);
    variants.set(mesh, { opaque, transparent, baseOpacity, opacity: 1, fade: 1, division });
    mesh.material = opaque;
    replaced.add(src);
    proxies.add(new Mesh(mesh.geometry, transparent));
  });
  for (const m of replaced) m.dispose(); // textures stay: they are reused by the variants
  return proxies;
}

/**
 * Look entry (load time, before the loader's upload/compile stages): lights + env on the rendered camera, tissue
 * variants with clipping planes. Returns the transparent-variant proxies to register for warm-up compilation.
 */
export function applyRealism(scene: Scene, renderer: WebGLRenderer, camera: Camera, root: Object3D): Group {
  renderer.localClippingEnabled = true;
  setupLights(scene, camera, renderer);
  const proxies = applyMaterials(root);
  const n = new Vector3();
  window.__look = {
    setXray,
    setOpacity: (name, a) => {
      const mesh = scene.getObjectByName(name) as Mesh | undefined;
      if (mesh) setOpacity(mesh, a);
    },
    setCutaway: (normal, constant) => setCutawayPlane(n.set(...normal).normalize(), constant),
    parkCutaway,
  };
  return proxies;
}
