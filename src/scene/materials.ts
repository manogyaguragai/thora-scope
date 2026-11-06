// Realism materials (CONTEXT §8): every mesh gets MeshPhysicalMaterial variants built ONCE at load (§6.5, §6.10).
// One shared shader patch (uniform-driven per tissue class) + one constant program cache key, so tissues share programs.
// X-ray/opacity only swap pre-compiled variants and set opacity; nothing toggles transparent/defines at runtime.
// Clipping: every variant has the same fixed-length clippingPlanes = [shared cut-away, ...per-mesh division planes],
// parked far away until used; moving a plane only mutates its values, so programs never change.
import {
  Color,
  DataArrayTexture,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  Plane,
  RepeatWrapping,
  ShaderChunk,
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
import { cauteryConfig } from './cautery.config';
import { addOpenedAttribute, BLUNT_ATTR, OPEN_THRESHOLD, OPENED_ATTR } from './effects';
import { setupLights } from './lights';
import {
  DISSECTABLE,
  FALLBACK_TISSUE,
  HIDDEN_AT_LOAD,
  PULSE,
  TISSUES,
  TISSUE_RULES,
  look,
  paletteParams,
} from './materials.config';
import type { Palette, TissueClass, TissueParams } from './materials.config';
import { TISSUE_DETAIL_PARS, buildTissueDetailTexture, hash } from './tissueTextures';
import { FAMILIES } from './tissueTextures.config';
import { WATER_TISSUE_FRAG, waterUniforms } from './water';
import { waterConfig } from './water.config';

interface Variants {
  opaque: MeshPhysicalMaterial; // default look (keeps the glTF's own BLEND for pleura/pericardium/connective)
  transparent: MeshPhysicalMaterial; // X-ray / opacity < 1
  baseOpacity: number;
  xray: number; // X-ray opacity cap (look.xrayByClass, else look.xrayOpacity)
  opacity: number; // user opacity (layer panel)
  fade: number; // transient multiplier (guided visibility fades), × opacity
  division: readonly Plane[]; // clippingPlanes[1..N] of both variants
  own: MeshUniforms; // shared by both variants
}
/** T807 per-mesh uniforms: step-focus highlight weight (0..1).
 *  T822/T842: uCutOn = 1 on DISSECTABLE layers (they carry the per-vertex opened attribute), fixed at load. */
interface MeshUniforms {
  uFocus: { value: number };
  uCutOn: { value: number };
  uRestScale: { value: Vector3 }; // T824: world scale of the mesh (quantised glb positions → metres)
  uPulse: { value: number }; // T831: heartbeat pulse amplitude in metres (manifest weight × look.pulse; 0 = still)
  uNormalFix: { value: Vector2 }; // T807/T831: normal-fix smoothstep edges (0, 0 = off, e.g. meshes with morph normals)
  uWaterOn: { value: number }; // T842: 1 = inside the right pleural cavity (irrigation tint / caustics apply)
  uPushOn: { value: number }; // T850: 1 = lung tissue classes (the instrument tip indents them, pushUniforms)
}
interface TissueUniforms {
  uTissueMap: { value: Vector4 }; // retint, mapLuma, speckle, lobular
  uTissueWrap: { value: number };
  uTissueScatter: { value: Color }; // colour × strength
  uTissueRim: { value: Color }; // colour × strength
  uTissueExtra: { value: Vector2 }; // T807: env-reflection scale; T831: membrane veil (grazing alpha boost)
  uTissueDetailA: { value: Vector4 }; // T824: family, scale (0 = off), bump, albedo
  uTissueDetailB: { value: Vector4 }; // T824: mask colour (linear rgb), mask strength
  uTissueBlood: { value: number }; // T824: blood-staining strength (0 = off)
}

declare global {
  interface Window {
    /** Test/debug hook (e2e screenshots, X-ray program check). */
    __look?: {
      setXray: (on: boolean) => void;
      setOpacity: (name: string, a: number) => void;
      setCutaway: (normal: readonly [number, number, number], constant: number) => void;
      parkCutaway: () => void;
      setPalette: (p: Palette) => void;
      setHeartbeat: (v: number) => void;
    };
  }
}

const variants = new Map<Mesh, Variants>();
/** T826: per tissue class, its uniforms + every variant material (setPalette writes their colour values). */
const byClass = new Map<TissueClass, { u: TissueUniforms; mats: MeshPhysicalMaterial[] }>();
let palette: Palette = look.palette.default;
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
const CUT = cauteryConfig.dissect;
/** T842: dissectable meshes, each with its zeroed opened attribute from load (effects.ts CutPool writes it). */
export const openedLayers: Mesh[] = [];
// Opened-field bands (effects.ts: field = 1 − d / (falloff × radius)) of the coagulated rim / browned edge.
const RIM_BAND = CUT.rimWidth / CUT.falloff;
const BURN_BAND = CUT.burnWidth / CUT.falloff;
const TORN = CUT.blunt;
const f = (x: number): string => x.toFixed(4);
const vec3 = (v: readonly number[]): string => `vec3(${v.map(f).join(', ')})`;
const BLOOD = look.blood;
const BLOOD_LAYER = FAMILIES.indexOf('blood');
const BLOOD_RGB = new Color(BLOOD.color).toArray(); // linear working space
const CLOT_RGB = new Color(BLOOD.clot).toArray();
/** T824: the procedural detail atlas, one texture bound to every tissue program from load (built on first use). */
const detailUniforms: { uTissueDetail: { value: DataArrayTexture | null } } = {
  uTissueDetail: { value: null },
};

const PARS = /* glsl */ `
#include <lights_physical_pars_fragment>
uniform vec4 uTissueMap;
uniform float uTissueWrap;
uniform vec3 uTissueScatter;
uniform vec3 uTissueRim;
uniform vec2 uTissueExtra;
uniform vec2 uNormalFix;
uniform float uFocus;
uniform vec3 uFocusColor;
uniform float uCutOn;
uniform float uWaterLevel;
uniform float uWaterTime;
uniform vec3 uWaterDisc;
uniform float uWaterOn;
varying float vOpened;
varying float vBlunt;
uniform vec4 uTissueDetailA;
uniform vec4 uTissueDetailB;
uniform float uTissueBlood;
varying vec3 vTissueWorld;
varying vec3 vTissueRestPos;
varying vec3 vTissueRestN;
${TISSUE_DETAIL_PARS}
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
uniform vec3 uRestScale;
uniform float uPulse;
uniform float uHeartbeat;
uniform float uCutOn;
uniform float uPushOn;
uniform vec3 uPushPoint;
uniform vec3 uPushDir;
uniform float uPushRadius;
attribute float ${OPENED_ATTR};
attribute float ${BLUNT_ATTR};
varying float vOpened;
varying float vBlunt;
varying vec3 vTissueWorld;
varying vec3 vTissueRestPos;
varying vec3 vTissueRestN;
void main() {
	vOpened = uCutOn > 0.0 ? ${OPENED_ATTR} : 0.0; // only dissectable layers carry the attribute
	vBlunt = uCutOn > 0.0 ? ${BLUNT_ATTR} : 0.0;
	// T824: PRE-morph rest pose (metres, object axes) so the procedural detail stays glued to the tissue.
	vTissueRestPos = position * uRestScale;
	vTissueRestN = normal / uRestScale;`;
const GRASP_VERTEX = /* glsl */ `
	// T831 heartbeat pulse: radial push along the (morphed) normal, world metres → object units via uRestScale.
	if ( uPulse * uHeartbeat > 0.0 ) transformed += normalize( objectNormal ) * ( uPulse * uHeartbeat ) / uRestScale;
	if ( dot( uGraspOffset, uGraspOffset ) > 0.0 ) {
		float graspK = 1.0 - smoothstep( 0.0, uGraspRadius, distance( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, uGraspPoint ) );
		transformed += inverse( mat3( modelMatrix ) ) * ( uGraspOffset * graspK );
	}
	// T850 lung push: the instrument tip indents the lung (world offset uPushDir = depth × direction, smooth falloff).
	if ( uPushOn * dot( uPushDir, uPushDir ) > 0.0 ) {
		float pushK = 1.0 - smoothstep( 0.0, uPushRadius, distance( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, uPushPoint ) );
		// world → local without a per-vertex inverse: valid for rotation + uniform scale (all scene meshes).
		transformed += transpose( mat3( modelMatrix ) ) * ( uPushDir * pushK ) / dot( modelMatrix[0].xyz, modelMatrix[0].xyz );
	}
	vTissueWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#include <project_vertex>`;

// T807: focus rim colour, shared by every tissue program.
const sharedLook = {
  uFocusColor: { value: new Color(look.focus.color).multiplyScalar(look.focus.strength) },
  uHeartbeat: { value: 0 }, // T831: state.heartbeat (0 diastole … 1 systole), setHeartbeat
};
/** T831: per-frame heartbeat (state.heartbeat) for the manifest `pulse` meshes; a uniform write, never a program change. */
export function setHeartbeat(v: number): void {
  sharedLook.uHeartbeat.value = v;
}
const FOCUS = /* glsl */ `
#include <emissivemap_fragment>
	if ( uFocus > 0.0 ) {
		float focusRim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), ${f(look.focus.rimPower)} );
		totalEmissiveRadiance += uFocus * ( uFocusColor * focusRim + diffuseColor.rgb * ${f(look.focus.self)} );
	}
	// T831 membrane veil: a thin sheet reads denser (milky) toward grazing angles; transparent variants only.
	if ( uTissueExtra.y > 0.0 ) diffuseColor.a = mix( diffuseColor.a, 1.0, uTissueExtra.y * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), ${f(look.rimPower)} ) );
`;
// T807: POSITION-only glb morphs leave collapsed/retracted surfaces with rest-pose normals; where such a normal
// turns away from the true (screen-derivative) surface normal it lit as dark blotches. Blend toward the derivative
// normal there, before three builds its tangent frames from it. T831: per mesh, off when it ships morph normals.
const TBN_ANCHOR =
  '#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )';
const NORMAL_BEGIN = ShaderChunk.normal_fragment_begin.replace(
  TBN_ANCHOR,
  /* glsl */ `
	vec3 tissueFlat = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
	if ( uNormalFix.y > 0.0 ) normal = normalize( mix( tissueFlat, normal, smoothstep( uNormalFix.x, uNormalFix.y, dot( normal, tissueFlat ) ) ) );
	if ( uTissueDetailA.z > 0.0 ) normal = tissueBump( - vViewPosition, normal, tissueTd.xy, uTissueDetailA.z );
${TBN_ANCHOR}`,
);
const ENV = /* glsl */ `
#include <lights_fragment_maps>
	radiance *= uTissueExtra.x;
	clearcoatRadiance *= uTissueExtra.x;
`;
// T842 irrigation: below the saline surface (uWaterLevel, world Y) depth tint + caustics (water.ts).
const WATER = `${WATER_TISSUE_FRAG}
#include <opaque_fragment>`;

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

/** T850: the one lung-push uniform set (tip indent: world centre, depth × direction, radius); mutate `.value`s only.
 *  Applied where the per-mesh uPushOn is 1 (PUSHED classes), compiled at load like the grasp. */
export const pushUniforms = {
  uPushPoint: { value: new Vector3() },
  uPushDir: { value: new Vector3() },
  uPushRadius: { value: 1 },
};
const PUSHED: readonly TissueClass[] = ['collapsedLung', 'ventilatedLung'];

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
	// T824 procedural triplanar detail (sampled before the cut discard; uniform-gated, so derivatives stay valid).
	vec4 tissueTd = vec4( 0.0, 0.0, 0.5, 0.0 );
	float tissueWet = 0.0;
	if ( uTissueDetailA.y > 0.0 ) {
		tissueTd = tissueDetail( vTissueRestPos, normalize( vTissueRestN ), uTissueDetailA.y, int( uTissueDetailA.x ) );
		diffuseColor.rgb *= 1.0 + uTissueDetailA.w * ( 2.0 * tissueTd.z - 1.0 );
		diffuseColor.rgb = mix( diffuseColor.rgb, uTissueDetailB.rgb, uTissueDetailB.w * tissueTd.w );
	}
	if ( uTissueBlood > 0.0 ) {
		vec4 tissueBl = tissueDetail( vTissueRestPos, normalize( vTissueRestN ), ${f(BLOOD.scale)}, ${BLOOD_LAYER} );
		tissueWet = uTissueBlood * tissueBl.z;
		diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(BLOOD_RGB)}, tissueWet );
		diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(CLOT_RGB)}, uTissueBlood * tissueBl.w );
		diffuseColor.a = mix( diffuseColor.a, 1.0, tissueWet ); // blood on a translucent veil is opaque
	}
	// T842 persistent cautery openings: where the interpolated opened field passes the threshold the layer is gone
	// (what lies beneath shows); just outside a thin browned edge, then a pale, opaque, slightly glossy coagulated rim.
	// T852 blunt (peanut) openings (vBlunt): no coagulum; a soft, moist, thinning torn fringe instead.
	float tissueCutRim = 0.0;
	float tissueTorn = 0.0;
	if ( uCutOn > 0.0 ) {
		if ( vOpened > ${f(OPEN_THRESHOLD)} ) discard;
		float cutBand = smoothstep( ${f(OPEN_THRESHOLD - RIM_BAND)}, ${f(OPEN_THRESHOLD)}, vOpened );
		tissueCutRim = cutBand * ( 1.0 - vBlunt );
		tissueTorn = cutBand * vBlunt;
		float cutBurn = smoothstep( ${f(OPEN_THRESHOLD - BURN_BAND)}, ${f(OPEN_THRESHOLD)}, vOpened ) * ( 1.0 - vBlunt );
		diffuseColor.rgb = mix( mix( diffuseColor.rgb, ${vec3(CUT.rimRgb)}, tissueCutRim ), ${vec3(CUT.burnRgb)}, cutBurn );
		diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(TORN.tornRgb)}, ${f(TORN.tornMix)} * tissueTorn );
		diffuseColor.a = mix( diffuseColor.a, 1.0, tissueCutRim ) * ( 1.0 - ${f(TORN.tornThin)} * tissueTorn );
	}
`;
const ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
	roughnessFactor = mix( roughnessFactor, ${f(BLOOD.roughness)}, tissueWet );
	roughnessFactor = mix( roughnessFactor, ${f(CUT.rimRoughness)}, tissueCutRim );
	roughnessFactor = mix( roughnessFactor, ${f(TORN.tornRoughness)}, tissueTorn );
`;

function patch(shader: WebGLProgramParametersWithUniforms, u: TissueUniforms, own: MeshUniforms): void {
  Object.assign(
    shader.uniforms,
    u,
    graspUniforms,
    pushUniforms,
    sharedLook,
    waterUniforms,
    detailUniforms,
    own,
  );
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', GRASP_PARS)
    .replace('#include <project_vertex>', GRASP_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_physical_pars_fragment>', PARS)
    .replace('#include <map_fragment>', MAP)
    .replace('#include <roughnessmap_fragment>', ROUGH)
    .replace('#include <normal_fragment_begin>', NORMAL_BEGIN)
    .replace('#include <emissivemap_fragment>', FOCUS)
    .replace('#include <lights_fragment_maps>', ENV)
    .replace('#include <opaque_fragment>', WATER);
}
const cacheKey = (): string => 'tissue-v1'; // one patch for all tissues → programs differ only by three's own params

export function tissueOf(name: string): TissueClass {
  for (const [re, cls] of TISSUE_RULES) if (re.test(name)) return cls;
  return FALLBACK_TISSUE;
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
  own: MeshUniforms,
  noise: DataTexture,
  transparent: boolean,
  opacity: number,
  clippingPlanes: Plane[],
): MeshPhysicalMaterial {
  const t: TissueParams = TISSUES[cls];
  const baked = t.bakedMaps ?? true;
  const m = new MeshPhysicalMaterial({
    name: `${src.name}:${transparent ? 'transparent' : 'opaque'}`,
    color: paletteParams(cls, palette).color,
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
  m.onBeforeCompile = (shader) => patch(shader, u, own);
  m.customProgramCacheKey = cacheKey;
  return m;
}

/** TissueParams.detail → the T824 per-class uniforms (scale 0 = off, no fetches). Blood: per palette. */
function detailOf(t: TissueParams): Pick<TissueUniforms, 'uTissueDetailA' | 'uTissueDetailB'> {
  const d = t.detail;
  const c = new Color(d?.maskColor ?? '#000000');
  return {
    uTissueDetailA: {
      value: new Vector4(d ? FAMILIES.indexOf(d.family) : 0, d?.scale ?? 0, d?.bump ?? 0, d?.albedo ?? 0),
    },
    uTissueDetailB: { value: new Vector4(c.r, c.g, c.b, d?.mask ?? 0) },
  };
}

/** TissueParams.normalFix → smoothstep edges (true = look.normalFix; off = 0, 0). T831: off for meshes whose morphs
 *  carry normals (the rest-normal problem it fixes does not exist there; it would only facet a correct normal). */
function normalFixEdges(n: TissueParams['normalFix'], mesh: Mesh): Vector2 {
  if (!n || mesh.geometry.morphAttributes.normal) return new Vector2();
  return new Vector2(...(n === true ? look.normalFix : n));
}

function apply(mesh: Mesh, v: Variants): void {
  const a = (xray ? Math.min(v.opacity, v.xray) : v.opacity) * v.fade;
  if (a >= 1) {
    mesh.material = v.opaque;
    return;
  }
  v.transparent.opacity = v.baseOpacity * a;
  mesh.material = v.transparent;
}

/** T826 colour palette: writes material.color + the retint/rim uniforms of the compiled variants (no recompile). */
export function setPalette(p: Palette): void {
  palette = p;
  for (const [cls, { u, mats }] of byClass) {
    const c = paletteParams(cls, p);
    for (const m of mats) m.color.set(c.color);
    u.uTissueMap.value.x = c.retint;
    u.uTissueRim.value.set(c.rim).multiplyScalar(TISSUES[cls].rimStrength);
    u.uTissueScatter.value.set(TISSUES[cls].scatter).multiplyScalar(c.scatterStrength);
    u.uTissueBlood.value = c.blood;
  }
}
export const getPalette = (): Palette => palette;

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

/** T807 step-focus highlight weight (0 = off … 1 = full rim); a uniform write, never a program change. */
export function setFocusHighlight(mesh: Mesh, k: number): void {
  const v = variants.get(mesh);
  if (v) v.own.uFocus.value = k;
}

/**
 * Replace every mesh material under root with its tissue variants. Load-time only.
 * Returns proxies (shared geometry + transparent variant) for the loader's compile stage, so X-ray never compiles.
 */
export function applyMaterials(root: Object3D): Group {
  const proxies = new Group();
  const noise = buildNoiseTexture();
  detailUniforms.uTissueDetail.value ??= buildTissueDetailTexture();
  const replaced = new Set<Material>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.material as MeshStandardMaterial;
    const cls = tissueOf(mesh.name);
    const t: TissueParams = TISSUES[cls];
    let entry = byClass.get(cls);
    if (!entry) {
      const c = paletteParams(cls, palette);
      const u: TissueUniforms = {
        uTissueMap: { value: new Vector4(c.retint, t.mapLuma, t.speckle, t.lobular) },
        uTissueWrap: { value: t.wrap },
        uTissueScatter: { value: new Color(t.scatter).multiplyScalar(c.scatterStrength) },
        uTissueRim: { value: new Color(c.rim).multiplyScalar(t.rimStrength) },
        uTissueExtra: { value: new Vector2(t.env ?? 1, t.veil ?? 0) },
        ...detailOf(t),
        uTissueBlood: { value: c.blood }, // T824 blood-staining strength, per palette (T846b)
      };
      entry = { u, mats: [] };
      byClass.set(cls, entry);
    }
    const u = entry.u;
    const baseOpacity = src.transparent ? (t.opacity ?? src.opacity) : 1;
    const division = Array.from({ length: config.clipping.divisionPlanes }, parked);
    const planes = [cutaway, ...division];
    const blend = src.transparent && baseOpacity < 1; // a config opacity of 1 makes a glTF BLEND mesh truly opaque
    const dissectable = DISSECTABLE.test(mesh.name);
    if (dissectable) {
      addOpenedAttribute(mesh);
      openedLayers.push(mesh);
    }
    const own: MeshUniforms = {
      uFocus: { value: 0 },
      uCutOn: { value: dissectable ? 1 : 0 },
      uRestScale: { value: new Vector3().setFromMatrixScale(mesh.matrixWorld) },
      uPulse: { value: (PULSE[mesh.name] ?? 0) * look.pulse.amplitudeM },
      uNormalFix: { value: normalFixEdges(t.normalFix, mesh) },
      uWaterOn: { value: waterConfig.dryMeshes.test(mesh.name) ? 0 : 1 },
      uPushOn: { value: PUSHED.includes(cls) ? 1 : 0 },
    };
    if (HIDDEN_AT_LOAD.includes(mesh.name)) mesh.visible = false; // T831 manifest `hidden` (warm-up still compiles it)
    const opaque = makeMaterial(src, cls, u, own, noise, blend, baseOpacity, planes);
    if (blend) opaque.depthWrite = src.depthWrite;
    const transparent = makeMaterial(src, cls, u, own, noise, true, baseOpacity, planes);
    const bias = look.depthBias[mesh.name] ?? look.depthBias[mesh.parent?.name ?? ''];
    if (bias)
      for (const m of [opaque, transparent]) {
        m.polygonOffset = true;
        [m.polygonOffsetFactor, m.polygonOffsetUnits] = bias;
      }
    entry.mats.push(opaque, transparent);
    const xr = look.xrayByClass[cls] ?? look.xrayOpacity;
    variants.set(mesh, { opaque, transparent, baseOpacity, xray: xr, opacity: 1, fade: 1, division, own });
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
    setPalette,
    setHeartbeat,
  };
  return proxies;
}
